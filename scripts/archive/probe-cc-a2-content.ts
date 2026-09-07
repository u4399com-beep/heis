// ============================================================
// cc-a2 content 段攻坚探针: book4.cc 三路实验
//  (a) browser 引擎加长等待 → 渲染后 entry-content 真实容器/选择器
//  (b) 章节 file_name 双层 base64 解码 → /show_jsload_book_info/*.json 直抓
//  (c) origin 源站 auwxw.com 直抓对照
// 用法: bun run scripts/probe-cc-a2-content.ts
// ============================================================
import { fetchPage } from '../src/lib/crawl/fetcher'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

// 目录最后一章(997) —— tmp/cc-a/chapter.html 样本同章, 可对照
const CHAPTER_FN =
  'YXV3eHcvNDExODUzL2FIUjBjSE02THk5M2QzY3VZWFYzZUhjdVkyOXRMMkYxY21WaFpDODFNamcwTUY4ek16QXdPREU0Tmk1b2RHMXMuanNvbg==.html'
const CHAPTER_URL = `https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/411853/${CHAPTER_FN}`

// 双层解码 → json 端点路径
const layer1 = Buffer.from(CHAPTER_FN.replace(/\.html$/, ''), 'base64').toString('utf8')
const JSON_URL = `https://book4.cc/show_jsload_book_info/${layer1}`
const ORIGIN_URL = Buffer.from(
  (layer1.split('/').pop() || '').replace(/\.json$/, ''),
  'base64',
).toString('utf8')

// 容错提取 entry-content(渲染后 class 可能附加 font-* 类)
function extractEntry(html: string): string {
  const m = html.match(/<div class="entry-content[^"]*"[^>]*>([\s\S]*?)<div id="content_html_bottom"/)
  return m ? m[1] : ''
}

function analyze(tag: string, html: string) {
  const entry = extractEntry(html)
  const pCount = (entry.match(/<p[ >]/g) || []).length
  const text = entry
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
  console.log(
    `[${tag}] htmlLen=${html.length} shell(html_b)=${html.includes('html_b=')} ` +
      `entryLen=${entry.length} p=${pCount} textLen=${text.length}`,
  )
  if (text) {
    console.log(`  head: ${JSON.stringify(text.slice(0, 90))}`)
    console.log(`  tail: ${JSON.stringify(text.slice(-90))}`)
  }
  // 主题词(本章真实内容) vs 填充词(其他小说乱入句)
  const theme = ['星宿海', '鹏鸟', '雷云战舰', '陆长生'].filter((w) => text.includes(w))
  const filler = ['慕容战神', '顾婉晚', '立硕', '舒洋'].filter((w) => text.includes(w))
  console.log(`  theme命中: ${theme.join(',') || '无'} | filler命中: ${filler.join(',') || '无'}`)
  // 推广尾段(需清洗的对象)
  const ads = ['请各位大哥大姐', '正在阅读《', '当前章节'].filter((w) => text.includes(w))
  console.log(`  推广尾段命中: ${ads.join(',') || '无'}`)
  return { pCount, textLen: text.length }
}

async function main() {
  console.log('json endpoint:', JSON_URL)
  console.log('origin url   :', ORIGIN_URL)

  // ---- (a1) browser 基线等待 1.2s(复现前驱 p=0 现象定位) ----
  try {
    const t0 = Date.now()
    const r = await fetchPage(CHAPTER_URL, {
      engine: 'browser', uaMode: 'custom', customUa: UA, timeout: 60000, retries: 0, waitMs: 1200,
    })
    console.log(`\n-- (a1) browser waitMs=1200 (${Date.now() - t0}ms) blocked=${r.blocked} engine=${r.engine}`)
    analyze('browser-1.2s', r.html)
  } catch (e) { console.log('a1 FAIL', e) }

  // ---- (a2) browser waitSelector '.entry-content p' + waitMs 5500 ----
  try {
    const t0 = Date.now()
    const r = await fetchPage(CHAPTER_URL, {
      engine: 'browser', uaMode: 'custom', customUa: UA, timeout: 60000, retries: 0,
      waitSelector: '.entry-content p', waitMs: 5500,
    })
    console.log(`\n-- (a2) browser waitSelector+p waitMs=5500 (${Date.now() - t0}ms) blocked=${r.blocked}`)
    analyze('browser-long', r.html)
  } catch (e) { console.log('a2 FAIL', e) }

  // ---- (a3) http 引擎直抓章节 .html(是否原始页/有无正文) ----
  try {
    const t0 = Date.now()
    const r = await fetchPage(CHAPTER_URL, {
      engine: 'http', uaMode: 'custom', customUa: UA, timeout: 30000, retries: 0,
    })
    console.log(`\n-- (a3) http 引擎章节页 (${Date.now() - t0}ms) blocked=${r.blocked} engine=${r.engine}`)
    analyze('http-html', r.html)
  } catch (e) { console.log('a3 FAIL', e) }

  // ---- (b) json 内容端点直抓 ----
  try {
    const t0 = Date.now()
    const res = await fetch(JSON_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
    const body = await res.text()
    console.log(`\n-- (b) json 端点 HTTP ${res.status} len=${body.length} (${Date.now() - t0}ms)`)
    console.log('  head 200:', JSON.stringify(body.slice(0, 200)))
    const m = body.match(/dstr="([A-Za-z0-9+/=]+)"/)
    if (m) {
      const data = JSON.parse(decodeURIComponent(Buffer.from(m[1], 'base64').toString('utf8'))) as Record<string, unknown>
      console.log('  json keys:', Object.keys(data))
      for (const k of Object.keys(data)) {
        const v = String(data[k])
        console.log(`   ${k}: len=${v.length} ${v.length < 100 ? JSON.stringify(v) : JSON.stringify(v.slice(0, 80))}`)
      }
      const content = String(data['content'] ?? data['text'] ?? '')
      const theme = ['星宿海', '鹏鸟', '雷云战舰'].filter((w) => content.includes(w))
      const filler = ['慕容战神', '顾婉晚', '立硕'].filter((w) => content.includes(w))
      console.log(`  content theme=${theme.join(',')} filler=${filler.join(',')}`)
    } else {
      console.log('  无 dstr 字段(响应格式不同)')
      console.log('  body 500-1200:', JSON.stringify(body.slice(500, 1200)))
    }
  } catch (e) { console.log('b FAIL', e) }

  // ---- (c) origin 源站直抓对照 ----
  try {
    const t0 = Date.now()
    const res = await fetch(ORIGIN_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
    const body = await res.text()
    console.log(`\n-- (c) origin ${ORIGIN_URL} HTTP ${res.status} len=${body.length} (${Date.now() - t0}ms)`)
    if (res.ok) {
      const text = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '\n').replace(/\n{2,}/g, '\n').trim()
      console.log('  textLen~', text.length, 'head:', JSON.stringify(text.slice(0, 120)))
    }
  } catch (e) { console.log('c FAIL', e) }

  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
export {}
