// ============================================================
// rr-a 探针: deqixs.cc 重新探测(前置情报=worklog qq-b 条目, 验证时效性)
// 任务: ①列表/书页/章节页结构 ②章节页内联脚本→chapter.js.php 请求形态
//       ③三参数(token/timestamp/nonce)实测 ④ajax2.php GBK-JSON 实测
//       ⑤每章三参数动态边界复证
// 运行: bun run scripts/probe-rr-a-deqixs.ts
// ============================================================
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const B = 'https://www.deqixs.cc'

async function get(path: string, opt: { referer?: string; save?: string } = {}): Promise<{ status: number; bytes: number; text: string }> {
  const res = await fetch(`${B}${path}`, {
    headers: { 'User-Agent': UA, ...(opt.referer ? { Referer: opt.referer } : {}), Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(15000),
  })
  const buf = await res.arrayBuffer()
  // 站点为 GBK 编码(杰奇系老站), 先按 GBK 解; 若是 PHP JSON 再按需处理
  const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  // utf-8 解出大量替换符说明真是 GBK → 换 GBK 解码
  const badRatio = (text.match(/\uFFFD/g) || []).length / Math.max(1, text.length)
  let finalText = text
  let charset = 'utf-8?'
  if (badRatio > 0.01) {
    const gbk = new TextDecoder('gbk', { fatal: false }).decode(buf)
    if (!(gbk.match(/\uFFFD/g) || []).length || (gbk.match(/\uFFFD/g) || []).length < (text.match(/\uFFFD/g) || []).length) {
      finalText = gbk
      charset = 'gbk'
    }
  }
  console.log(`[GET] ${path} → status=${res.status} bytes=${buf.byteLength} charset=${charset} head=${finalText.slice(0, 80).replace(/\s+/g, ' ')}`)
  if (opt.save) {
    await Bun.write(opt.save, finalText)
    console.log(`      saved → ${opt.save}`)
  }
  return { status: res.status, bytes: buf.byteLength, text: finalText }
}

// ---------- ① 列表页 ----------
console.log('======== ① 列表页 /sort/1/1.html ========')
const listHtml = await get('/sort/1/1.html', { save: '/home/z/my-project/scripts/rr-a-deqixs-list.html' })
const listItems = listHtml.text.match(/class="[^"]*item[^"]*"/g)?.slice(0, 6) ?? []
console.log('item class 样本:', JSON.stringify(listItems))
console.log('bookbox 出现次数:', (listHtml.text.match(/bookbox/g) || []).length)
console.log('分页锚样本:', (listHtml.text.match(/href="[^"]*sort[^"]*"\s*[^>]*>[^<]{0,8}下一页[^<]{0,4}</) || [''])[0].slice(0, 160))

// ---------- ② 书页 ----------
console.log('\n======== ② 书页(从列表提第一本书) ========')
const firstBookHref = listHtml.text.match(/href="(\/book\/[^"]+|\/books\/[^"]+)"/)?.[1] ?? ''
console.log('列表首本书链接:', firstBookHref)
if (!firstBookHref) {
  // 兜底: 直接用情报里的形态 /books/{id}/
  console.log('列表未提出书链, 直接探 /books/126/')
}
const bookPath = firstBookHref || '/books/126/'
const bookHtml = await get(bookPath, { save: '/home/z/my-project/scripts/rr-a-deqixs-book.html' })
console.log('h1.booktitle:', (bookHtml.text.match(/<h1[^>]*booktitle[^>]*>([\s\S]{0,120}?)<\/h1>/) || [''])[0].replace(/\s+/g, ' ').slice(0, 160))
console.log('booktag 出现:', (bookHtml.text.match(/booktag/g) || []).length, '次 | bookintro 出现:', (bookHtml.text.match(/bookintro/g) || []).length, '次')
console.log('og:novel meta:', (bookHtml.text.match(/<meta[^>]*og:novel[^>]*>/g) || []).map((m) => m.slice(0, 110)))
console.log('dl.book.chapterlist 出现:', (bookHtml.text.match(/chapterlist/g) || []).length, '次')
// 章节链接形态
const chapterHrefs = [...new Set(bookHtml.text.match(/href="([^"]*\/\d+\/\d+[^"]*)"/g) || [])].slice(0, 5)
console.log('章节链接样本:', chapterHrefs.slice(0, 5))

// ---------- ③ 章节页 + 内联脚本拆解 ----------
console.log('\n======== ③ 章节页(取目录第一章) ========')
// 从书页提取第一个形如 /books/{aid}/{cid}.html 的章节链
const mch = bookHtml.text.match(/href="(\/books\/(\d+)\/(\d+)\.html)"/)
let chapterPath = mch?.[1] ?? ''
let aid = mch?.[2] ?? ''
let cid = mch?.[3] ?? ''
console.log('章节链接:', chapterPath, `aid=${aid} cid=${cid}`)
if (!chapterPath) {
  // 兜底用 qq-b 情报样例
  chapterPath = '/books/126/81417.html'
  aid = '126'
  cid = '81417'
  console.log('未从书页提出章节链, 用情报样例', chapterPath)
}
const chapHtml = await get(chapterPath, { referer: `${B}${bookPath}`, save: '/home/z/my-project/scripts/rr-a-deqixs-chapter.html' })
console.log('chapter-content 容器出现:', (chapHtml.text.match(/chapter-content/g) || []).length, '次')
// 提取 chapter-content div 的内容看是否 SSR 为空
const divContent = chapHtml.text.match(/<div[^>]*id="chapter-content"[^>]*>([\s\S]{0,300})/)?.[1]?.replace(/\s+/g, ' ') ?? '(未找到)'
console.log('chapter-content 开头 300 字符:', divContent.slice(0, 300))
// 内联脚本: 找 chapter.js.php 相关行
const scriptChunks = chapHtml.text.match(/<script[^>]*>[\s\S]*?<\/script>/g) ?? []
console.log('内联 script 块数:', scriptChunks.length)
let jsBlock = scriptChunks.find((s) => s.includes('chapter.js.php') || s.includes('ajax2')) ?? ''
console.log('含 chapter.js.php 的块长度:', jsBlock.length)
// 提取 aid/cid 来源: 查找内联变量
for (const pat of [/aid\s*[:=]\s*['"]?\d+/g, /cid\s*[:=]\s*['"]?\d+/g, /book_id|article_id|chapter_id/g, /chapter\.js\.php[^'"]*/g]) {
  const hits = jsBlock.match(pat) ?? chapHtml.text.match(pat) ?? []
  console.log(`  模式 ${pat.source} →`, [...new Set(hits)].slice(0, 6))
}
await Bun.write('/home/z/my-project/scripts/rr-a-deqixs-chapter-script.js', jsBlock || '(空)')
console.log('内联脚本已存 scripts/rr-a-deqixs-chapter-script.js')

// ---------- ④ chapter.js.php 三参数 ----------
console.log('\n======== ④ chapter.js.php 三参数实测 ========')
const jsRes = await fetch(`${B}/scripts/chapter.js.php?aid=${aid}&cid=${cid}`, {
  headers: { 'User-Agent': UA, Referer: `${B}${chapterPath}` },
  signal: AbortSignal.timeout(15000),
})
const jsBuf = await jsRes.arrayBuffer()
const jsText = new TextDecoder('utf-8', { fatal: false }).decode(jsBuf)
console.log(`chapter.js.php → status=${jsRes.status} bytes=${jsBuf.byteLength} content-type=${jsRes.headers.get('content-type')}`)
console.log('头 500 字符:\n', jsText.slice(0, 500))
const token = jsText.match(/chapterToken\s*=\s*'([^']+)'/)?.[1] ?? ''
const timestamp = jsText.match(/timestamp\s*=\s*(\d+)/)?.[1] ?? ''
const nonce = jsText.match(/nonce\s*=\s*'([^']+)'/)?.[1] ?? ''
console.log(`→ token=${token.slice(0, 24)}…(len=${token.length}) timestamp=${timestamp} nonce=${nonce}`)

// ---------- ⑤ ajax2.php GBK-JSON ----------
console.log('\n======== ⑤ ajax2.php 带三参数 GBK-JSON 实测 ========')
async function hitAjax2(extra: Record<string, string>, label: string, useGbk = true) {
  const q = new URLSearchParams({ aid, cid, ...extra })
  const res = await fetch(`${B}/modules/article/ajax2.php?${q}`, {
    headers: { 'User-Agent': UA, Referer: `${B}${chapterPath}`, 'X-Requested-With': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(15000),
  })
  const buf = await res.arrayBuffer()
  const txt = useGbk ? new TextDecoder('gbk', { fatal: false }).decode(buf) : new TextDecoder('utf-8', { fatal: false }).decode(buf)
  let info = `status=${res.status} bytes=${buf.byteLength}`
  try {
    const j = JSON.parse(txt)
    info += ` | JSON status=${j.status} msg=${String(j.msg ?? '').slice(0, 30)} contentLen=${j.data?.content?.length ?? 0}`
    if (j.data?.content) info += ` | 内容头60: ${j.data.content.slice(0, 60).replace(/\s+/g, ' ')}`
  } catch {
    info += ` | 非JSON: ${txt.slice(0, 100).replace(/\s+/g, ' ')}`
  }
  console.log(`[${label}] ${info}`)
  return txt
}
const full = await hitAjax2({ token, timestamp, nonce }, '全三参数')
await Bun.write('/home/z/my-project/scripts/rr-a-deqixs-content.json', full)
// 负例复证
await hitAjax2({ token, timestamp }, '缺nonce')
await hitAjax2({}, '全缺')
// 跨章复用 token: 拿同书另一章
const cid2 = bookHtml.text.match(new RegExp(`href="\\/books\\/${aid}\\/(\\d+)\\.html"`))?.[1]
if (cid2 && cid2 !== cid) {
  const r2 = await fetch(`${B}/scripts/chapter.js.php?aid=${aid}&cid=${cid2}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
  const t2 = await r2.text()
  const tok2 = t2.match(/chapterToken\s*=\s*'([^']+)'/)?.[1] ?? ''
  await hitAjax2({ token: tok2, timestamp, nonce }, `第2章(cid=${cid2})参数打第1章(cid=${cid})接口`)
  // 正确组合: 第2章参数打第2章
  await (async () => {
    const q = new URLSearchParams({ aid, cid: cid2, token: tok2, timestamp, nonce })
    const res = await fetch(`${B}/modules/article/ajax2.php?${q}`, { headers: { 'User-Agent': UA, Referer: `${B}${chapterPath}` }, signal: AbortSignal.timeout(15000) })
    const buf = await res.arrayBuffer()
    const txt = new TextDecoder('gbk', { fatal: false }).decode(buf)
    try {
      const j = JSON.parse(txt)
      console.log(`[第2章全参自洽] status=${res.status} JSON status=${j.status} contentLen=${j.data?.content?.length ?? 0}`)
    } catch {
      console.log(`[第2章全参自洽] 非JSON: ${txt.slice(0, 80)}`)
    }
  })()
} else {
  console.log('(未取得第2章 cid, 跳过跨章复证)')
}
// 旧时间戳复证
await hitAjax2({ token, timestamp: '1000000000000', nonce }, '旧时间戳')

// ---------- ⑥ GBK 解码方案验证: bun TextDecoder('gbk') 已在上文使用 ----------
console.log('\n======== ⑥ Bun TextDecoder("gbk") 验证 ========')
const dec = new TextDecoder('gbk')
const sample = dec.decode(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])) // GBK "中文"
console.log(`GBK 字节 d6 d0 ce c4 → "${sample}" (期望"中文"):`, sample === '中文' ? 'PASS' : 'FAIL')

console.log('\n======== 探测完成 ========')
process.exit(0)
