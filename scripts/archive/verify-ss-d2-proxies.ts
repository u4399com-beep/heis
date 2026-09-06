// ============================================================
// scripts/verify-ss-d2-proxies.ts — mini-services 第二批修复断言矩阵 (ss-d2)
// ============================================================
// 覆盖 ss-d2 主控收编批次:
//   A. deqixs-proxy(3014): idleTimeout/5xx·429 重试/health 并发去重/&amp; 双解码顺序 — 静态+活体
//   B. qimao-proxy(3013): 同上四项 + 启动日志密钥摘除 — 静态+活体
//   C. bqg713-proxy(3010): /health 与启动日志 iv/key 泄漏摘除 — 静态+活体
//   D. xjp-proxy(3015): &amp; 双解码顺序 — 静态
//   E. fetch-relay(3011): ss-d2 检查点1 批次(流式帽/idleTimeout/请求体帽) — 活体(独立脚本复跑)
// 用法: bun run scripts/verify-ss-d2-proxies.ts   (exit 0 = 全过)
// ============================================================
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export {} // module 守卫(bun 顶层代码 + tsc 惯例)

// 最小 Bun 类型面(运行时由 bun 提供真实实现, 与 verify-dd-b-mirror.ts 同惯例)
declare const Bun: {
  spawnSync(cmd: string[], options?: { cwd?: string; stdout?: string; stderr?: string; timeout?: number }): {
    exitCode: number
    stdout: Uint8Array
    stderr: Uint8Array
  }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}`)
  }
}
const read = (p: string) => readFileSync(`${ROOT}/${p}`, 'utf8')
async function getJSON(port: number, path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(45_000) })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

// ---------- A. deqixs-proxy ----------
console.log('A. deqixs-proxy (3014)')
{
  const src = read('mini-services/deqixs-proxy/index.ts')
  ok(src.includes('idleTimeout: 120'), 'A1 idleTimeout 放宽(缺省~10s 会杀两步链 15s×2)')
  ok(src.includes('res.status >= 500 || res.status === 429') && src.includes('重试前泄掉未消费响应体'), 'A2 5xx/429 瞬态重试+body cancel')
  ok(src.includes('let healthProbe: Promise<void> | null = null'), 'A3 /health 并发探针在途去重')
  const ampIdx = src.indexOf(".replace(/&amp;/gi, '&')")
  const aposIdx = src.indexOf(".replace(/&#39;|&apos;/gi")
  ok(ampIdx > aposIdx && ampIdx > 0, 'A4 &amp; 实体最后解码(双解码防线)')
  ok(src.includes("htmlToText('a&amp;lt;b&amp;gt;c')"), 'A5 selfTest 含双解码回环用例')
  const h = await getJSON(3014, '/health')
  ok(h.status === 200 && h.body.ok === true && h.body.selfTestOk === true, 'A6 /health 活体 selfTestOk')
  ok(String(h.body.selfTestDetail ?? '').includes('双解码'), 'A7 活体自检含双解码标记(热更生效)')
  ok(h.body.upstreamReachable === true, 'A8 上游可达')
}

// ---------- B. qimao-proxy ----------
console.log('B. qimao-proxy (3013)')
{
  const src = read('mini-services/qimao-proxy/index.ts')
  ok(src.includes('idleTimeout: 120'), 'B1 idleTimeout 放宽')
  ok(src.includes('res.status >= 500 || res.status === 429'), 'B2 5xx/429 瞬态重试')
  ok(src.includes('let healthProbe: Promise<void> | null = null'), 'B3 /health 并发探针在途去重')
  ok(!src.includes("key=${AES_KEY.toString('utf8')}"), 'B4 启动日志密钥明文摘除')
  const h = (await getJSON(3013, '/health')).body
  ok(h.ok === true && h.selfTestOk === true, 'B5 /health 活体 selfTestOk')
  ok(h.apiReachable === true, 'B6 上游 API 可达')
}

// ---------- C. bqg713-proxy ----------
console.log('C. bqg713-proxy (3010)')
{
  const src = read('mini-services/bqg713-proxy/index.ts')
  const healthIdx = src.indexOf("'/health'")
  const healthBlock = src.slice(healthIdx, src.indexOf('}', src.indexOf('now:', healthIdx)))
  ok(!healthBlock.includes('IV.toString') && !healthBlock.includes('KEY.toString'), 'C1 /health 不回显 iv/key')
  ok(!src.includes('token=${selfTest} iv='), 'C2 启动日志 token/iv/key 明文摘除')
  const h = (await getJSON(3010, '/health')).body
  ok(h.ok === true && h.selfTestOk === true, 'C3 /health 活体 selfTestOk(密钥派生未被站点更换)')
  ok(!('iv' in h) && !('key' in h), 'C4 活体响应零密钥字段')
}

// ---------- D. xjp-proxy ----------
console.log('D. xjp-proxy (3015)')
{
  const src = read('mini-services/xjp-proxy/index.ts')
  const ampIdx = src.indexOf(".replace(/&amp;/gi, '&')")
  const aposIdx = src.indexOf(".replace(/&#39;|&apos;/gi")
  ok(ampIdx > aposIdx && ampIdx > 0, 'D1 &amp; 实体最后解码(双解码防线)')
  const h = (await getJSON(3015, '/health')).body
  ok(h.ok === true && h.selfTestOk === true, 'D2 /health 活体 selfTestOk')
}

// ---------- E. fetch-relay 批次复跑(独立断言脚本, ss-d2 检查点1 交付) ----------
console.log('E. fetch-relay(3011) 批次 — verify-ss-d-relay.ts 复跑')
{
  const proc = Bun.spawnSync(['bun', 'run', 'scripts/verify-ss-d-relay.ts'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
  })
  const out = new TextDecoder().decode(proc.stdout)
  ok(proc.exitCode === 0, `E1 relay 批次 16 断言复跑 (exit=${proc.exitCode})`)
  if (proc.exitCode !== 0) console.log(out.split('\n').slice(-12).join('\n'))
}

// ---------- 汇总 ----------
console.log(`\n结果: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
console.log('verify-ss-d2-proxies: ALL PASS')
process.exit(0)
