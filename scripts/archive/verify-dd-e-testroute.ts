// dd-e: rules/test 路由重建验证(本地 echo 服务, 不依赖外网)
// 断言: ①空body/非法section/非法URL → 400 ②列表段 {page}/{offset:N} 占位符展开
//       (原始形态+%7B%7D编码形态, 与 runner 同口径 {offset:N}=(p-1)*N, p=1→0)
//       ③limit 钳制 ④tocLink 0章回退书籍页 ⑤book段fields
// 运行: bun scripts/verify-dd-e-testroute.ts (需 dev server 存活)
export {}
import http from 'node:http'
const BASE = 'http://localhost:3000'
const ECHO_PORT = 3371

let passed = 0
let failed = 0
function assert(cond: boolean, name: string, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS: ${name}`)
  } else {
    failed++
    console.log(`  FAIL: ${name} ${detail}`)
  }
}

/** echo 服务: 返回 {"path":"<请求路径>","items":[...N项]} */
async function startEcho(): Promise<{ urlOf: (p: string) => string; stop: () => void }> {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', `http://127.0.0.1:${ECHO_PORT}`)
    if (u.pathname === '/html') {
      // 目录链接嗅探回退测试页: 一个"目录"锚指向 /toc_real
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body><a href="/toc_real">目录</a></body></html>')
      return
    }
    if (u.pathname === '/toc_real') {
      const lis = Array.from({ length: 3 }, (_, i) => `<li><a href="/c${i + 1}.html">第${i + 1}章</a></li>`).join('')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html><body><ul id="list">${lis}</ul></body></html>`)
      return
    }
    const n = Number(u.searchParams.get('n') || '3')
    const full = u.pathname + u.search
    const arr = Array.from({ length: n }, (_, i) => ({ path: full, i: i + 1 }))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ path: full, items: arr }))
  })
  await new Promise<void>((r) => server.listen(ECHO_PORT, '127.0.0.1', r))
  return { urlOf: (p: string) => `http://127.0.0.1:${ECHO_PORT}${p}`, stop: () => server.close() }
}

interface TestResp {
  ok: boolean
  message?: string
  data?: Record<string, unknown>
}

async function post(payload: unknown): Promise<{ status: number; body: TestResp }> {
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: (await res.json()) as TestResp }
}

async function main() {
  const echo = await startEcho()

  // ---- ① 契约 400 ----
  const empty = await post({})
  assert(empty.status === 400 && empty.body.ok === false, '空 body → 400', JSON.stringify(empty.body))
  const badSection = await post({ section: 'nope', url: 'http://x.com' })
  assert(badSection.status === 400, '非法 section → 400')
  const badUrl = await post({ section: 'list', url: 'ftp://x.com/a' })
  assert(badUrl.status === 400, '非法 URL → 400')
  const noRule = await post({ section: 'list', url: 'http://x.com/a' })
  assert(noRule.status === 400, '缺规则配置 → 400')

  // ---- ② 列表段占位符展开(原始形态) ----
  const jsonListRule = {
    enabled: true,
    itemSelector: { type: 'json', expression: 'items' },
    fields: { path: { type: 'json', expression: 'path' } },
  }
  const raw1 = await post({
    section: 'list',
    url: echo.urlOf('/list/{page}/o{offset:10}.html'),
    rule: jsonListRule,
    fetch: { engine: 'http' },
  })
  const p1 = (raw1.body.data?.sample as { path?: string }[] | undefined)?.[0]?.path
  assert(raw1.status === 200 && p1 === '/list/1/o0.html', '占位符展开(原始): /list/{page}/o{offset:10} → /list/1/o0', `got ${p1}`)

  // ---- ②b 占位符展开(已编码形态, 模拟 httpUrl 规范化后的输入) ----
  const raw2 = await post({
    section: 'list',
    url: echo.urlOf('/list/%7Bpage%7D/o%7Boffset:10%7D.html'),
    rule: jsonListRule,
    fetch: { engine: 'http' },
  })
  const p2 = (raw2.body.data?.sample as { path?: string }[] | undefined)?.[0]?.path
  assert(raw2.status === 200 && p2 === '/list/1/o0.html', '占位符展开(编码形态 %7Bpage%7D) → /list/1/o0', `got ${p2}`)

  // ---- ③ limit 钳制(1~200) ----
  const lim = await post({
    section: 'list',
    url: echo.urlOf('/x?n=9'),
    rule: jsonListRule,
    fetch: { engine: 'http' },
    limit: 4,
  })
  assert(lim.status === 200 && (lim.body.data?.count as number) === 9 && ((lim.body.data?.sample as unknown[]) || []).length === 4, 'limit 钳制: count=9 sample=4')
  const lim2 = await post({
    section: 'list',
    url: echo.urlOf('/x?n=9'),
    rule: jsonListRule,
    fetch: { engine: 'http' },
    limit: 999,
  })
  assert(((lim2.body.data?.sample as unknown[]) || []).length === 9, 'limit 越界(999) → 钳 200, 9 项全取')

  // ---- ④ toc 段: 嗅探回退(无 tocLink, 书籍页无章节 → 嗅探"目录"锚 → /toc_real 3章) ----
  const tocRule = {
    enabled: true,
    itemSelector: { type: 'css', expression: '#list li' },
    fields: {
      title: { type: 'css', expression: 'a' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    },
  }
  const toc = await post({ section: 'toc', url: echo.urlOf('/html'), rule: tocRule, fetch: { engine: 'http' } })
  assert(toc.status === 200 && (toc.body.data?.count as number) === 3, 'toc 嗅探回退: 3 章', JSON.stringify(toc.body))

  // ---- ⑤ book 段: 单值字段提取 ----
  const bookRule = {
    enabled: true,
    fields: { name: { type: 'css', expression: 'h1' } },
  }
  const book = await post({
    section: 'book',
    url: echo.urlOf('/html2'),
    rule: { ...bookRule },
    fetch: { engine: 'http' },
  })
  // echo /html2 无 h1 → fields 空对象也 200(测试语义: 抓取成功即 200, 解析空是合法结果)
  assert(book.status === 200 && typeof book.body.data?.fields === 'object', 'book 段 200 + fields 对象')

  echo.stop()
  console.log(`\nverify-dd-e-testroute: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}
main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
