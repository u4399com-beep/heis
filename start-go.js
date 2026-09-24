// R57-1A: bun wrapper auto-restart + auto-build Go 后端 (platform 只允许 bun 进程)
//
// 设计目标:
//   1. 平台 git clone 后没有 heis-backend 二进制 → 自动 go build (仅一次, 缓存命中快)
//   2. Go 进程崩溃 → 2 秒后自动重启 (R49 原行为)
//   3. 二进制缺失 / 源码比二进制新 → 重新 go build
//   4. 全程输出到 stdout, 平台日志可观察
//
// 历史背景:
//   - R46-1A 把 heis-backend 二进制入 git 以让平台 git clone 后直接运行
//   - 但二进制 24MB, 每次重编 git status 总是 dirty, 565M .git 目录膨胀
//   - 更严重: 平台偶发 git reset --hard 把 OLDER 二进制覆盖到工作目录,
//     老二进制可能因 schema 变更 / 依赖升级与新 DB 不兼容 → 启动崩溃 → start-go.js
//     死循环 retry → "预览总是挂掉"
//   - R57-1A 改为不入 git, 启动时自动 build, 二进制只在工作目录, 永远匹配当前源码
//
// Go 路径: ~/go/go/bin/go (用户自定义安装, 非 PATH 全局)
const GO_BIN = '/home/z/go/go/bin/go';
const HEIS_BIN = './go-backend/heis-backend';
const GO_DIR = './go-backend';

const fs = require('fs');
const path = require('path');

// statOrZero: 文件不存在返 mtime=0
function mtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

// ensureBinaryBuilt: 若二进制不存在 OR 源码比二进制新 → 重新 build
function ensureBinaryBuilt() {
  const binM = mtime(HEIS_BIN);
  // 收集 go-backend 下所有 *.go (递归, 跳过 services/ 子项目与 r57probe/)
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
      } else if (e.name.endsWith('.go')) {
        const m = mtime(full);
        if (m > newestSrc) newestSrc = m;
      }
    }
  }
  walk(GO_DIR, 0);
  // 也比对 go.mod
  const goModM = mtime(path.join(GO_DIR, 'go.mod'));
  if (goModM > newestSrc) newestSrc = goModM;

  if (binM > 0 && binM >= newestSrc) {
    console.log(`[start-go] binary fresh (bin ${new Date(binM).toISOString()}, src ${new Date(newestSrc).toISOString()})`);
    return true;
  }

  if (binM === 0) {
    console.log('[start-go] binary missing, building...');
  } else {
    console.log(`[start-go] binary stale (bin ${new Date(binM).toISOString()} < src ${new Date(newestSrc).toISOString()}), rebuilding...`);
  }
  // Bun.spawnSync 同步执行 go build, stdout/stderr 直接 inherit
  const r = Bun.spawnSync({
    cmd: [GO_BIN, 'build', '-o', HEIS_BIN, '.'],
    cwd: GO_DIR,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (r.exitCode !== 0) {
    console.error(`[start-go] go build failed (exit ${r.exitCode})`);
    return false;
  }
  console.log('[start-go] go build OK');
  return true;
}

// 主循环: build → spawn → 崩溃后 2s 重启
while (true) {
  // 每次 spawn 前都检查二进制新鲜度 (源码可能在运行时被 agent 改动)
  if (!ensureBinaryBuilt()) {
    console.log('[start-go] build failed, wait 5s before retry...');
    await Bun.sleep(5000);
    continue;
  }
  try {
    const proc = Bun.spawn([HEIS_BIN], { stdio: ['ignore', 'inherit', 'inherit'] });
    await proc.exited;
  } catch (e) { console.error('[start-go] Go crashed:', e); }
  console.log('[start-go] Go exited, restarting in 2s...');
  await Bun.sleep(2000);
}
