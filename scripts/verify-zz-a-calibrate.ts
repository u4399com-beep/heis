// ============================================================
// verify-zz-a-calibrate — 采集规则极限校准系统回归断言 (zz 轮)
//
// 覆盖面:
//  A 段(静态) 校准引擎 calibrate.ts — 三阶段探测协议常量/判定阈值/
//             首档封禁残余韧性重试(zz-a2)/resetBefore 回环安全门
//  B 段(静态) API 路由 — globalThis job 单例/202·409·abort 语义/
//             Setting 落库键格式/渐进轨迹(zz-a4)
//  C 段(静态) 模拟源站 ratelimit-site.ts — 三档参数表/封禁升级链/
//             /reset 观测端点(zz-a2)
//  D 段(动态) 模拟源站行为实测 — spawn 子进程(独立端口): 正常放行/
//             突发窗 429+Retry-After 头/滑动窗口/stats 观测/reset 清零
//
// 用法: bun scripts/verify-zz-a-calibrate.ts
// ============================================================
import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

// ab-c: import.meta.dir → fileURLToPath(等价定位仓库根, 消除 tsc TS2339; 断言零改动)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
let pass = 0
let fail = 0
const fails: string[] = []

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) pass++
  else {
    fail++
    fails.push(name + (detail ? ` (${detail})` : ''))
  }
}

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const calib = read('src/lib/crawl/calibrate.ts')
const routeSingle = read('src/app/api/admin/rules/[id]/calibrate/route.ts')
const routeBatch = read('src/app/api/admin/rules/calibrate-all/route.ts')
const site = read('scripts/ratelimit-site.ts')

// ---------- A 段: 校准引擎 ----------
// A1 三阶段签名与导出契约
ok('A1 calibrateRule 导出+CalibrationResult 契约字段', calib.includes('export async function calibrateRule') && calib.includes('maxConcurrency') && calib.includes('minIntervalMs') && calib.includes('recommended'))
ok('A2 CalibrateAbort 可取消异常', calib.includes('export class CalibrateAbort') && calib.includes("name = 'CalibrateAbort'"))
ok('A3 并发梯 1→2→3→4→6→8→10', calib.includes('CONCURRENCY_LADDER = [1, 2, 3, 4, 6, 8, 10]'))
ok('A4 间隔梯 2000→…→150', calib.includes('INTERVAL_LADDER = [2000, 1500, 1000, 700, 500, 300, 150]'))
ok('A5 判定阈值 0.1 与每档 12 请求', calib.includes('PROBES_PER_LEVEL = 12') && calib.includes('PASS_FAIL_RATIO = 0.1'))
ok('A6 hostGateLimit 钳 1~8 保守上限', calib.includes('HOST_GATE_CLAMP_MAX = 8'))
// A7 zz-a2 韧性: 首档临时封禁残余重试(403 占多数+带 Retry-After)
ok('A7 封禁残余判定 looksLikeBanResidue(403 多数+Retry-After)', calib.includes('function looksLikeBanResidue') && calib.includes('trace.hit403 / trace.requests > 0.5') && calib.includes('maxRetryAfterMs > 0'))
ok('A8 首档重探两阶段都在场(临时封禁冷却后重探)', (calib.match(/临时封禁冷却后重探/g) || []).length >= 2)
// A9 zz-a2 resetBefore + zz-a3 档位一致性提醒
ok('A9 resetBefore 重置模拟源站(POST /reset 容错)', calib.includes('opts.resetBefore') && calib.includes("'/reset'") !== undefined && calib.includes(`${'`'}${'${base}/reset'}${'`'}`))
ok('A10 档位不一致提醒(读 /stats.profile 比对)', calib.includes('/stats') && calib.includes('不一致, 结果按源站实际档位计'))
// A11 验证回退一档(并发-1/间隔×1.3)
ok('A11 验证失败回退一档再验', calib.includes('fallbackApplied') && calib.includes('threadMax - 1') && calib.includes('intervalMin * 1.3'))
// A12 推荐值落库形态(threadMin=floor(threadMax/2), intervalMax=×2.5)
ok('A12 recommended 推荐公式', calib.includes('Math.floor(threadMax / 2)') && calib.includes('minIntervalMs * 2.5'))

// ---------- B 段: API 路由 ----------
for (const [tag, src, kind] of [['B', routeSingle, 'single'], ['B2', routeBatch, 'batch']] as const) {
  const label = (n: string) => (kind === 'single' ? n : n.replace('B', 'B2'))
  ok(label(`${tag}1 globalThis job 单例 __novelCalibJobs_v1`), src.includes('__novelCalibJobs_v1'))
  ok(label(`${tag}2 202 后台启动+409 重复启动`), src.includes("status: 202") && src.includes("status: 409"))
  ok(label(`${tag}3 Setting 落库键 calibration:`), src.includes('`calibration:${') || src.includes("`calibration:${jobId}`") || src.includes('`calibration:${id}`'))
  ok(label(`${tag}4 abortFlag 取消语义`), src.includes('abortFlag') && src.includes('校准已取消'))
  ok(label(`${tag}5 resetBefore 回环安全门`), src.includes('isLoopback') && src.includes('127.0.0.1') && src.includes('resetMock === false'))
  ok(label(`${tag}6 渐进轨迹(zz-a4)`), (src.match(/[tT]races?\.push/) || []).length >= 1 && src.includes("job.status === 'running' ? job"))
}
ok('B7 批量串行+渐进持久化(逐条落 Setting)', routeBatch.includes('runBatch') && routeBatch.includes('currentIndex = i + 1'))
ok('B8 批量空规则明确提示不崩溃', routeBatch.includes('当前没有启用的采集规则'))
ok('B9 force-dynamic 禁路由缓存', routeSingle.includes("dynamic = 'force-dynamic'") && routeBatch.includes("dynamic = 'force-dynamic'"))

// ---------- C 段: 模拟源站 ----------
ok('C1 三档参数表(lenient/standard/strict)', site.includes('lenient: { windowLimit: 120') && site.includes('standard: { windowLimit: 60') && site.includes('strict: { windowLimit: 30'))
ok('C2 封禁升级链(临时封→永久 410)', site.includes('register429') && site.includes('permanent = true') && site.includes('rebanThreshold'))
ok('C3 突发窗与滑动窗口双记账', site.includes('prune(st.burst') && site.includes('prune(st.win'))
ok('C4 429 带 Retry-After 头', (site.match(/'Retry-After'/g) || []).length >= 3)
ok('C5 /reset 观测端点(zz-a2, POST 豁免限流)', site.includes("/reset' && req.method === 'POST'") && site.includes('ipStates.clear()'))
ok('C6 /stats 观测端点(perIp/byStatus)', site.includes("'/stats'") && site.includes('perIp'))
ok('C7 x-forwarded-for 客户端 IP(多出口可测)', site.includes('x-forwarded-for'))
ok('C8 strict 指纹检测(bot UA/UA 单化)', site.includes('P.fingerprint') && site.includes('bot|spider|curl|python'))

// ---------- D 段: 动态行为实测(独立端口 3041) ----------
async function dynamicSection(): Promise<void> {
  const PORT = 3041
  const child = spawn('bun', ['scripts/ratelimit-site.ts', '--port', String(PORT), '--profile', 'standard'], {
    cwd: ROOT,
    stdio: 'ignore',
  })
  const base = `http://127.0.0.1:${PORT}`
  try {
    // 等就绪(最多 5s)
    let ready = false
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200))
      try {
        const s = await fetch(`${base}/stats`, { signal: AbortSignal.timeout(800) })
        if (s.ok) { ready = true; break }
      } catch { /* not yet */ }
    }
    ok('D1 模拟源站启动就绪', ready)
    if (!ready) return

    // D2 正常放行 + UA 必需(standard 无指纹检测, 缺 UA 也放行; 有 UA 一定 200)
    const r1 = await fetch(`${base}/chapter/1/1`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137 Safari/537.36' } })
    ok('D2 正常请求 200 + X-RateLimit-Remaining 头', r1.status === 200 && r1.headers.get('x-ratelimit-remaining') !== null)

    // D3 突发窗(standard: 2s>6 → 429): 8 连发(burst 已有 D2 的 1 个 → 200×5+429×3;
    // 故意控制在封禁阈值 5 次以下, 避免触发封禁升级链污染 D4/D5)
    const burst = await Promise.all(Array.from({ length: 8 }, () =>
      fetch(`${base}/chapter/1/1`, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/137' } }).then((r) => r.status)
    ))
    const n429 = burst.filter((s) => s === 429).length
    const n200 = burst.filter((s) => s === 200).length
    ok('D3 突发 8 连发触发限流(200+429 混合, 429≥1)', n429 >= 1 && n200 >= 1, `200×${n200}/429×${n429}`)
    // D4 429 响应带 Retry-After(取一个仍处窗口满的请求)
    const r4 = await fetch(`${base}/chapter/1/1`, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/137' } })
    ok('D4 429 带 Retry-After 头', r4.status === 429 && r4.headers.get('retry-after') !== null, `status=${r4.status}`)
    // D5 突发窗隔离 3s 后恢复放行
    await new Promise((r) => setTimeout(r, 3000))
    const r5 = await fetch(`${base}/chapter/1/1`, { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/137' } })
    ok('D5 突发窗过后恢复 200', r5.status === 200)
    // D6 stats 观测: total 计数与 byStatus 分类
    const st = (await (await fetch(`${base}/stats`)).json()) as { total: number; byStatus: Record<string, number>; profile: string }
    ok('D6 stats 计数与档位一致', st.profile === 'standard' && st.total >= 11 && (st.byStatus['429'] || 0) >= 1)
    // D7 reset 清零
    await fetch(`${base}/reset`, { method: 'POST' })
    const st2 = (await (await fetch(`${base}/stats`)).json()) as { total: number; perIp: Record<string, unknown> }
    ok('D7 reset 后 total=0 且 IP 状态清空', st2.total === 0 && Object.keys(st2.perIp).length === 0)
  } finally {
    child.kill('SIGKILL')
  }
}

await dynamicSection()

// ---------- 汇总 ----------
console.log(`\n========== verify-zz-a-calibrate: ${pass + fail} 项 ==========`)
if (fail === 0) {
  console.log(`========== 结果: ${pass} 通过 / 0 失败 ==========`)
  console.log('verify-zz-a-calibrate: ALL PASS')
} else {
  console.log(`========== 结果: ${pass} 通过 / ${fail} 失败 ==========`)
  for (const f of fails) console.log('  FAIL:', f)
  process.exit(1)
}
