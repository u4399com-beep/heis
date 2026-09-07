// ============================================================
// Task ee-d 探针③ — fetchHttp 302 逐跳响应体未消费 → 连接滞留(不归还连接池)
// 手段: mock 服务逐跳 302(每跳 body 64KB), 服务端统计 TCP connection 总数。
//       bun fetch(redirect:'manual') 每跳的 3xx 响应 body 从未被读取/cancel ——
//       未消费 body 的连接不归还连接池(undici/Bun 同语义), 20 跳 ≈ 20 条连接;
//       body 消费/cancel 后 keep-alive 复用, 连接数 ≈ 1~3。
// 运行: bun scripts/verify-ee-d-redirect.ts (修前跑=连接数高, 修后跑=连接数低)
// ============================================================
import http from 'http'

export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}

const PORT = 3378
const BASE = `http://127.0.0.1:${PORT}`
const HOPS = 12
const PAD = 'x'.repeat(64 * 1024)

let connections = 0
const server = http.createServer((req, res) => {
  const n = Number(new URL(req.url || '/', BASE).searchParams.get('n') || '0')
  if (n < HOPS) {
    res.writeHead(302, { Location: `/hop?n=${n + 1}`, 'Content-Type': 'text/html' })
    res.end(`<html><body>302 pad:${PAD}</body></html>`)
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<html><body>final</body></html>')
})
server.on('connection', () => { connections++ })
await new Promise<void>((r) => server.listen(PORT, () => r()))

const { fetchHttpWithCurlFallback } = await import('../src/lib/crawl/fetcher')

try {
  console.log(`\n== 场景: ${HOPS} 跳 302(每跳 body 64KB) + 服务端连接计数 ==`)
  const html = await fetchHttpWithCurlFallback(`${BASE}/hop?n=0`, { engine: 'http', timeout: 10000, retries: 0, autoCookie: true, referer: true } as any, 'ee-d-probe/1.0')
  ok('20 跳链最终页内容正确', html.includes('final'), `len=${html.length}`)
  // 给 keep-alive 池一点时间观察(不改变判定口径)
  await new Promise((r) => setTimeout(r, 300))
  console.log(`  服务端 TCP 连接总数: ${connections} (跳数 ${HOPS})`)
  // 消费路径下 keep-alive 复用, 连接数应远小于跳数; 泄漏路径下每跳新建 ≈ 跳数+1
  ok('连接复用(连接数 ≤ 跳数一半, 泄漏路径 ≈ 跳数)', connections <= Math.ceil(HOPS / 2), `connections=${connections} hops=${HOPS}`)
} catch (e: any) {
  fail++
  console.log(`  ✗ 脚本异常: ${e?.stack?.slice(0, 400) || e}`)
} finally {
  server.closeAllConnections?.()
  server.close()
  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
  process.exit(fail ? 1 : 0)
}
