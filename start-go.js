// R57-1A: bun wrapper auto-restart + auto-build Go 后端 (platform 只允许 bun 进程)
// R66 主控: 监听 *.html 模板改动触发 rebuild (模板加载在 heis-backend 启动期一次性 ParseFiles,
//   改后必须重启 heis-backend 才生效; 监听 *.html mtime → 检测到模板新于 binary → 走
//   "rebuild" 路径触发 wrapper spawn 新进程 → 重载模板)
// R66-D: 4 项稳定性增强
//   1. go 工具链自愈 (DEFAULT_GO_BIN 不存在 → which go → 下载 golang.google.cn 解压)
//   2. WAL 定期 checkpoint (每 30 min sqlite3 wal_checkpoint(TRUNCATE) / fallback HTTP VACUUM)
//   3. 进程死锁检测 (每 60 s fetch :3000/health, 3 次失败 SIGKILL heis-backend 触发重启)
//   4. 日志轮转 (wrapper.log > 10 MB rename + 保留最近 3 个 .bak)
//
// 设计目标:
//   1. 平台 git clone 后没有 heis-backend 二进制 → 自动 go build (仅一次, 缓存命中快)
//   2. Go 进程崩溃 → 2 秒后自动重启 (R49 原行为)
//   3. 二进制缺失 / 源码比二进制新 → 重新 go build
//   4. 全部输出 (wrapper 自身 + heis-backend stdout/stderr + go build 输出) 路由到 wrapper.log
//      (前台 TTY 同时显示终端), 便于统一日志轮转 + 故障排查
//
// 历史背景:
//   - R46-1A 把 heis-backend 二进制入 git 以让平台 git clone 后直接运行
//   - 但二进制 24MB, 每次重编 git status 总是 dirty, 565M .git 目录膨胀
//   - 更严重: 平台偶发 git reset --hard 把 OLDER 二进制覆盖到工作目录,
//     老二进制可能因 schema 变更 / 依赖升级与新 DB 不兼容 → 启动崩溃 → start-go.js
//     死循环 retry → "预览总是挂掉"
//   - R57-1A 改为不入 git, 启动时自动 build, 二进制只在工作目录, 永远匹配当前源码

const DEFAULT_GO_BIN = '/home/z/go/go/bin/go';
const HEIS_BIN = './go-backend/heis-backend';
const GO_DIR = './go-backend';
const DB_FILE = './db/custom.db';
const LOG_FILE = './wrapper.log';
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const HEALTH_URL = 'http://127.0.0.1:3000/health';
const HEALTH_INTERVAL_MS = 60 * 1000; // 60 s
const HEALTH_MAX_FAILURES = 3;
const HEALTH_TIMEOUT_MS = 5000;
const WAL_CHECKPOINT_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const VACUUM_URL = 'http://127.0.0.1:3000/api/admin/backup/vacuum';
const VACUUM_TIMEOUT_MS = 10000;
const GO_DOWNLOAD_URL = 'https://golang.google.cn/dl/go1.26.8.linux-amd64.tar.gz';
const GO_TARBALL = '/tmp/go1.26.8.linux-amd64.tar.gz';
const GO_INSTALL_PARENT = '/home/z/go'; // tar -C 解压后生成 /home/z/go/go/
const GO_TARBALL_MIN_BYTES = 60 * 1024 * 1024; // 60 MB 最小校验, 防下载不全

const fs = require('fs');
const path = require('path');

// ---- 运行时状态 ----
let currentProc = null; // 当前 heis-backend Bun subprocess (供 health probe kill)
let healthFailCount = 0;
let cachedGoBin = null;
let logFd = null; // wrapper.log 文件描述符
let stdoutPiper = null; // 当前 heis-backend stdout pipe coroutine Promise
let stderrPiper = null;
const isForeground = process.stdout.isTTY === true;

// statOrZero: 文件不存在返 mtime=0
function mtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

// ---- 日志管理 ----
function openLogFd() {
  try {
    logFd = fs.openSync(LOG_FILE, 'a');
  } catch (e) {
    console.error(`[start-go] open log fd failed: ${e.message || e}`);
    logFd = null;
  }
}

function writeLog(chunk) {
  if (chunk === null || chunk === undefined) return;
  if (typeof chunk === 'string') chunk = Buffer.from(chunk);
  if (!(chunk instanceof Buffer) && !(chunk instanceof Uint8Array)) {
    chunk = Buffer.from(String(chunk));
  }
  if (logFd === null) openLogFd();
  if (logFd !== null) {
    try { fs.writeSync(logFd, chunk); } catch (e) { /* best-effort */ }
  }
  if (isForeground) {
    try { process.stdout.write(chunk); } catch (e) {}
  }
}

function log(s) {
  // 给 wrapper 自身用: 带时间戳的单行
  writeLog(`${new Date().toISOString()} ${s}\n`);
}

// ---- 1. go 工具链自愈 ----
// 检测 DEFAULT_GO_BIN 存在 → which go → 下载 go1.26.8 from golang.google.cn 解压.
// 系统重启后 /home/z/go/go/bin/go 偶发丢失 (沙箱挂载点变动 / 容器 overlay reset),
// 原实现硬编码 GO_BIN 失败后无限重试 → wrapper 死循环. 本函数自动恢复.
function findGoBinary() {
  if (cachedGoBin && fs.existsSync(cachedGoBin)) return cachedGoBin;
  // (a) 硬编码用户安装位置 (沙箱默认)
  if (fs.existsSync(DEFAULT_GO_BIN)) {
    cachedGoBin = DEFAULT_GO_BIN;
    return cachedGoBin;
  }
  // (b) which go (PATH 全局)
  log(`[start-go] ${DEFAULT_GO_BIN} not found, trying which go...`);
  try {
    const r = Bun.spawnSync({ cmd: ['which', 'go'], stdout: 'pipe', stderr: 'pipe' });
    if (r.exitCode === 0) {
      const p = r.stdout.toString().trim().split('\n')[0];
      if (p && fs.existsSync(p)) {
        log(`[start-go] go toolchain found via which: ${p}`);
        cachedGoBin = p;
        return cachedGoBin;
      }
    }
  } catch (e) { /* ignore: which not available */ }
  // (c) 下载 go1.26.8 from golang.google.cn → 解压到 /home/z/go/go/
  log(`[start-go] no go in PATH, downloading ${GO_DOWNLOAD_URL}...`);
  const dl = Bun.spawnSync({
    cmd: ['curl', '-fsSL', '-o', GO_TARBALL, GO_DOWNLOAD_URL],
    stdout: 'pipe', stderr: 'pipe',
  });
  if (dl.exitCode !== 0) {
    log(`[start-go] download go toolchain failed (exit ${dl.exitCode}): ${dl.stderr.toString().trim()}`);
    return null;
  }
  // 校验 tarball 大小 (≥ 60 MB, 防下载不全误当成功)
  let tarSize = 0;
  try {
    tarSize = fs.statSync(GO_TARBALL).size;
  } catch (e) {
    log(`[start-go] tarball stat failed: ${e.message || e}`);
    return null;
  }
  if (tarSize < GO_TARBALL_MIN_BYTES) {
    log(`[start-go] tarball too small: ${tarSize} bytes (< ${GO_TARBALL_MIN_BYTES}), download incomplete`);
    return null;
  }
  // 解压到 GO_INSTALL_PARENT (tar -C 解压后生成 <GO_INSTALL_PARENT>/go/)
  fs.mkdirSync(GO_INSTALL_PARENT, { recursive: true });
  const extractTarget = path.join(GO_INSTALL_PARENT, 'go');
  try {
    if (fs.existsSync(extractTarget)) {
      log(`[start-go] cleaning existing extract target ${extractTarget}`);
      fs.rmSync(extractTarget, { recursive: true, force: true });
    }
  } catch (e) { /* best-effort */ }
  const ex = Bun.spawnSync({
    cmd: ['tar', '-xzf', GO_TARBALL, '-C', GO_INSTALL_PARENT],
    stdout: 'pipe', stderr: 'pipe',
  });
  if (ex.exitCode !== 0) {
    log(`[start-go] extract go toolchain failed (exit ${ex.exitCode}): ${ex.stderr.toString().trim()}`);
    return null;
  }
  const newBin = path.join(extractTarget, 'bin', 'go');
  if (!fs.existsSync(newBin)) {
    log(`[start-go] extracted but ${newBin} not found`);
    return null;
  }
  log(`[start-go] go toolchain installed: ${newBin} (${tarSize} bytes downloaded)`);
  cachedGoBin = newBin;
  return cachedGoBin;
}

// ---- 2. WAL 定期 checkpoint ----
// 每 30 min 调 sqlite3 db/custom.db "PRAGMA wal_checkpoint(TRUNCATE)" 把 WAL 合并到主库,
// 防系统重启时 WAL 损坏导致数据 "看似丢失" (用户痛点 §9.4).
// sqlite3 CLI 不可用时降级到 POST /api/admin/backup/vacuum (heis-backend 内置 VACUUM,
// 较 wal_checkpoint 重但效果等同).
async function walCheckpoint() {
  if (!fs.existsSync(DB_FILE)) {
    log('[start-go] WAL checkpoint skipped: db not found');
    return;
  }
  // (a) sqlite3 CLI 优先 (wal_checkpoint 比 VACUUM 轻, 不阻塞读写)
  let sqliteOk = false;
  try {
    const r = Bun.spawnSync({
      cmd: ['sqlite3', DB_FILE, 'PRAGMA wal_checkpoint(TRUNCATE);'],
      stdout: 'pipe', stderr: 'pipe',
    });
    if (r.exitCode === 0) {
      const out = r.stdout.toString().trim();
      log(`[start-go] WAL checkpoint OK: ${out || '(empty)'}`);
      sqliteOk = true;
    } else {
      const err = r.stderr.toString().trim();
      log(`[start-go] sqlite3 CLI exit ${r.exitCode}: ${err}`);
    }
  } catch (e) {
    log(`[start-go] sqlite3 CLI unavailable: ${e.message || e}`);
  }
  if (sqliteOk) return;
  // (b) HTTP 降级: POST /api/admin/backup/vacuum (heis-backend 内置 VACUUM)
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), VACUUM_TIMEOUT_MS);
    const resp = await fetch(VACUUM_URL, { method: 'POST', signal: ac.signal });
    clearTimeout(timer);
    if (resp.ok) {
      log(`[start-go] WAL checkpoint via HTTP VACUUM OK (status ${resp.status})`);
    } else {
      log(`[start-go] HTTP VACUUM failed: status ${resp.status}`);
    }
  } catch (e) {
    log(`[start-go] HTTP VACUUM failed: ${e.message || e}`);
  }
}

// ---- 3. 心跳死锁检测 ----
// 每 60 s fetch :3000/health, 5 s 超时. heis-backend hang (死锁 / GC 卡 / SQLite 锁死)
// 但未退出时, await proc.exited 不会返回, 原实现无法触发重启. 本函数连续 3 次失败后
// SIGKILL heis-backend → 触发主循环 await proc.exited 返回 → 2 s 后重启.
async function healthCheck() {
  if (!currentProc) return; // 无运行中的 heis-backend, 跳过
  let ok = false;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), HEALTH_TIMEOUT_MS);
    const resp = await fetch(HEALTH_URL, { signal: ac.signal });
    clearTimeout(timer);
    if (resp.ok) ok = true;
    else log(`[start-go] health check HTTP ${resp.status} (fail ${healthFailCount + 1}/${HEALTH_MAX_FAILURES})`);
  } catch (e) {
    log(`[start-go] health check error: ${e.message || e} (fail ${healthFailCount + 1}/${HEALTH_MAX_FAILURES})`);
  }
  if (ok) {
    if (healthFailCount > 0) {
      log(`[start-go] health recovered after ${healthFailCount} failures`);
    }
    healthFailCount = 0;
    return;
  }
  healthFailCount++;
  if (healthFailCount >= HEALTH_MAX_FAILURES) {
    log(`[start-go] health failed ${healthFailCount} times — heis-backend appears hung, SIGKILL forcing restart`);
    try {
      currentProc.kill('SIGKILL');
    } catch (e) {
      log(`[start-go] SIGKILL failed: ${e.message || e}`);
    }
    healthFailCount = 0; // 重置; 下次 spawn 起重新计数
  }
}

// ---- 4. 日志轮转 ----
// 每次 spawn 前检查 wrapper.log 大小, > 10 MB → rename 为 wrapper.log.<ts>.bak,
// 重新 openLogFd. 保留最近 3 个 .bak, 更老的删. 因 wrapper 全程通过 writeLog 写入
// logFd (heis-backend stdout 经 pipe 路由), 关闭 fd → rename → 重开 不会丢日志
// (并发 pipe coroutine 已在 await Promise.allSettled 等待完成后才进入下次循环).
function rotateLog() {
  if (logFd !== null) {
    try { fs.closeSync(logFd); } catch (e) {}
    logFd = null;
  }
  if (!fs.existsSync(LOG_FILE)) {
    openLogFd();
    return;
  }
  let st;
  try { st = fs.statSync(LOG_FILE); } catch (e) { openLogFd(); return; }
  if (st.size < LOG_MAX_BYTES) {
    openLogFd();
    return;
  }
  const bak = `${LOG_FILE}.${Date.now()}.bak`;
  try {
    fs.renameSync(LOG_FILE, bak);
    // 注意: rename 后 log() 调用写入的是新打开的 fd, 但本函数此刻 logFd=null,
    // log() 会先 openLogFd 再写 → 进入新 wrapper.log. 但 rotateLog 调用 log()
    // 前需先 openLogFd. 顺序: 先 openLogFd, 再 log(rotate 行).
    openLogFd();
    log(`[start-go] log rotated: ${LOG_FILE} (${st.size} bytes) → ${bak}`);
    // 清理旧 bak (保留最近 3 个)
    const dir = path.dirname(path.resolve(LOG_FILE));
    const base = path.basename(LOG_FILE);
    const baks = [];
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(base + '.') && f.endsWith('.bak')) {
          try {
            const m = fs.statSync(path.join(dir, f)).mtimeMs;
            baks.push({ f, m });
          } catch (e) {}
        }
      }
    } catch (e) {}
    baks.sort((a, b) => b.m - a.m);
    for (let i = 3; i < baks.length; i++) {
      try { fs.unlinkSync(path.join(dir, baks[i].f)); } catch (e) {}
    }
  } catch (e) {
    log(`[start-go] log rotate failed: ${e.message || e}`);
    openLogFd();
  }
}

// ---- heis-backend stdout/stderr pipe 路由 ----
// Bun.spawn(..., { stdio: ['ignore', 'pipe', 'pipe'] }) 返回 proc.stdout/stderr 为
// ReadableStream (web stream). 用 getReader + read 循环消费, 写入 writeLog
// (logFd + 前台 TTY). proc 退出后 stream 自动 done, coroutine 返回.
async function pipeToLog(stream) {
  if (!stream || typeof stream.getReader !== 'function') return;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) writeLog(value);
    }
  } catch (e) {
    // stream closed (proc killed / pipe broken) — 静默, 主循环 await proc.exited 会处理
  }
}

// ensureBinaryBuilt: 若二进制不存在 OR 源码比二进制新 → 重新 build
function ensureBinaryBuilt() {
  const binM = mtime(HEIS_BIN);
  let newestSrc = 0;
  function walk(dir, depth) {
    if (depth > 3) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // 跳过 services (各自独立项目) + r57probe (探针, 不入主二进制)
        if (e.name === 'services' || e.name === 'r57probe') continue;
        walk(full, depth + 1);
      } else if (e.name.endsWith('.go') || e.name.endsWith('.html')) {
        // R66: 监听 *.html 模板改动 (R65-A 改 sites.html 等模板后 wrapper 不重启 → 用户看到旧模板).
        //   ParseFiles 在 heis-backend 启动期一次性加载, 模板改后必须重启 heis-backend 才生效.
        //   监听 *.html mtime → 检测到模板新于 binary → 走 "rebuild" 路径触发 wrapper 重启 heis-backend.
        //   注: go build 本身不编译模板, 但 rebuild 触发 wrapper spawn 新进程 → 重载模板.
        const m = mtime(full);
        if (m > newestSrc) newestSrc = m;
      }
    }
  }
  walk(GO_DIR, 0);
  const goModM = mtime(path.join(GO_DIR, 'go.mod'));
  if (goModM > newestSrc) newestSrc = goModM;

  if (binM > 0 && binM >= newestSrc) {
    log(`[start-go] binary fresh (bin ${new Date(binM).toISOString()}, src ${new Date(newestSrc).toISOString()})`);
    return true;
  }

  if (binM === 0) {
    log('[start-go] binary missing, building...');
  } else {
    log(`[start-go] binary stale (bin ${new Date(binM).toISOString()} < src ${new Date(newestSrc).toISOString()}), rebuilding...`);
  }
  // R66-D: 找 go 工具链 (硬编码 → which → 下载)
  const goBin = findGoBinary();
  if (!goBin) {
    log('[start-go] no go binary available, cannot build');
    return false;
  }
  // Bun.spawnSync 同步执行 go build; stdout/stderr 路由到 writeLog (统一日志)
  const r = Bun.spawnSync({
    cmd: [goBin, 'build', '-o', HEIS_BIN, '.'],
    cwd: GO_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (r.stdout && r.stdout.length > 0) writeLog(r.stdout);
  if (r.stderr && r.stderr.length > 0) writeLog(r.stderr);
  if (r.exitCode !== 0) {
    log(`[start-go] go build failed (exit ${r.exitCode})`);
    return false;
  }
  log('[start-go] go build OK');
  return true;
}

// ---- 启动期初始化 ----
openLogFd();
log('[start-go] wrapper started (R66-D: toolchain-self-heal + wal-checkpoint + health-probe + log-rotate)');

// 定时任务: WAL checkpoint 每 30 min + health probe 每 60 s
setInterval(walCheckpoint, WAL_CHECKPOINT_INTERVAL_MS);
setInterval(healthCheck, HEALTH_INTERVAL_MS);
// 启动后 5 s 立即跑一次 wal checkpoint (让重启后 WAL 立刻合并到主库, 防 §9.4 数据丢失)
setTimeout(walCheckpoint, 5000);

// 主循环: build → spawn → 崩溃后 2s 重启
while (true) {
  // 每次 spawn 前检查日志大小 (> 10 MB → rotate)
  rotateLog();
  // 每次 spawn 前都检查二进制新鲜度 (源码可能在运行时被 agent 改动)
  if (!ensureBinaryBuilt()) {
    log('[start-go] build failed, wait 5s before retry...');
    await Bun.sleep(5000);
    continue;
  }
  try {
    const proc = Bun.spawn([HEIS_BIN], { stdio: ['ignore', 'pipe', 'pipe'] });
    currentProc = proc;
    healthFailCount = 0;
    // 启动 stdout/stderr pipe 协程 (后台消费, 与 await proc.exited 并行)
    stdoutPiper = pipeToLog(proc.stdout);
    stderrPiper = pipeToLog(proc.stderr);
    await proc.exited;
    currentProc = null;
    // 等 pipe coroutine 完成 (drain 剩余 buffered 输出), 防 rotateLog 关 fd 时丢日志
    await Promise.allSettled([stdoutPiper, stderrPiper]);
    stdoutPiper = null;
    stderrPiper = null;
  } catch (e) {
    log(`[start-go] Go crashed: ${e.message || e}`);
    currentProc = null;
    stdoutPiper = null;
    stderrPiper = null;
  }
  log('[start-go] Go exited, restarting in 2s...');
  await Bun.sleep(2000);
}
