// cc-d2 直连验证探针: proxy /rewrite → 拿 token 与改写 URL → 直接 fetch 改写 URL
// 断言: HTTP 200 且 body 含章节文本(chaptername/txt 字段非空)
// 运行: bun scripts/probe-cc-d2-direct.ts
export {}
const TARGET = 'https://apibi.cc/api/chapter?id=2530&chapterid=1'

async function main() {
  // 1) proxy health
  const h = await fetch('http://127.0.0.1:3010/health').then((r) => r.json() as Promise<{ ok: boolean; selfTestOk: boolean }>)
  console.log('[1] proxy health:', JSON.stringify(h))
  if (!h.ok || !h.selfTestOk) throw new Error('proxy health/selfTest FAIL')

  // 2) /rewrite 换 token 与改写 URL
  const rw = await fetch(`http://127.0.0.1:3010/rewrite?url=${encodeURIComponent(TARGET)}`).then(
    (r) => r.json() as Promise<{ ok: boolean; token: string; url: string; plaintext: string }>,
  )
  console.log('[2] rewrite:', JSON.stringify({ ok: rw.ok, token: rw.token.slice(0, 16) + '...', url: rw.url, plaintext: rw.plaintext }))
  if (!rw.ok || !rw.token || !rw.url) throw new Error('rewrite FAIL')

  // 3) 直接 fetch 改写 URL → 200 且含章节文本
  const res = await fetch(rw.url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' } })
  const body = await res.text()
  console.log('[3] fetch rewritten URL: status=' + res.status + ' len=' + body.length)
  let parsed: { chaptername?: string; txt?: string; title?: string } | undefined
  try {
    parsed = JSON.parse(body) as { chaptername?: string; txt?: string; title?: string }
  } catch { /* 非 JSON */ }
  const txt = parsed?.txt || ''
  console.log('[3] chaptername=' + (parsed?.chaptername || parsed?.title || '(none)') + ' txtLen=' + txt.length)
  console.log('[3] txt head:', txt.slice(0, 80).replace(/\n/g, '⏎'))
  if (res.status !== 200) throw new Error('status=' + res.status)
  if (!txt || txt.length < 200) throw new Error('章节文本为空或过短 txtLen=' + txt.length)
  console.log('PASS: 直连验证 200 + 章节文本', txt.length, '字')
}
main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
