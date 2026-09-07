// ============================================================
// cc-a 探针: book4.cc 浏览器引擎渲染验证(壳站解壳判定)
// 用法: bun run scripts/probe-cc-a-browser.ts
// 验证: engine='browser' 能拿到解码后 DOM(无 html_b 壳残留),
//       列表/书籍/目录(JS注入)/正文 四层选择器可命中
// ============================================================
import { fetchPage } from '../src/lib/crawl/fetcher'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const LIST = 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/1'
const BOOK = 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/411853/'
const CHAPTER =
  'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/411853/YXV3eHcvNDExODUzL2FIUjBjSE02THk5M2QzY3VZWFYzZUhjdVkyOXRMMkYxY21WaFpDODFNamcwTUY4ek16QXdPREU0Tmk1b2RHMXMuanNvbg==.html'

async function main() {
  const t0 = Date.now()

  // ---- 1. 列表页 ----
  console.log('--- [1] list page (browser) ---')
  const tList = Date.now()
  const list = await fetchPage(LIST, {
    engine: 'browser', uaMode: 'custom', customUa: UA, timeout: 60000, retries: 0, waitMs: 1200,
  })
  console.log(`status: blocked=${list.blocked} engine=${list.engine} htmlLen=${list.html.length} ${Date.now() - tList}ms`)
  console.log('  壳残留 html_b:', list.html.includes('html_b'), ' book-title-cell:', /book-title-cell/.test(list.html))
  const liCount = (list.html.match(/class="[^"]*book-info"/g) || []).length
  console.log('  book-info 项数:', liCount)
  const mName = list.html.match(/<h3[^>]*><a href="([^"]+)">《([^》]+)》<\/a>/)
  console.log('  首项样例:', mName ? `${mName[2]} -> ${mName[1]}` : 'N/A')
  const mAuthor = list.html.match(/作者[:：]\s*([^<\s]{1,40})/)
  console.log('  首项作者:', mAuthor ? mAuthor[1] : 'N/A')

  // ---- 2. 书籍页 ----
  console.log('--- [2] book page (browser) ---')
  const tBook = Date.now()
  const book = await fetchPage(BOOK, {
    engine: 'browser', uaMode: 'custom', customUa: UA, timeout: 60000, retries: 0, waitMs: 1200,
  })
  console.log(`blocked=${book.blocked} htmlLen=${book.html.length} ${Date.now() - tBook}ms`)
  console.log('  壳残留:', book.html.includes('html_b'))
  const bName = book.html.match(/book-detail-info[^>]*>[\s\S]{0,200}?<h2>([^<]+)<\/h2>/)
  console.log('  书名:', bName ? bName[1] : 'N/A')
  const bAuthor = book.html.match(/<p>作者[:：]([^<]{1,40})<\/p>/)
  console.log('  作者:', bAuthor ? bAuthor[1] : 'N/A')
  const bIntro = book.html.match(/<div class="intro"[^>]*>\s*<p[^>]*>([\s\S]{0,120})/)
  console.log('  简介:', bIntro ? bIntro[1].slice(0, 80) : 'N/A')
  const bCover = book.html.match(/<div class="book-img">\s*<img[^>]*src="([^"]+)"/)
  console.log('  封面:', bCover ? bCover[1] : 'N/A')

  // ---- 3. 目录(书籍页 JS 注入 #chapter_list) ----
  console.log('--- [3] toc via book page (browser, waitSelector #chapter_list li a) ---')
  const tToc = Date.now()
  const toc = await fetchPage(BOOK, {
    engine: 'browser', uaMode: 'custom', customUa: UA, timeout: 60000, retries: 0,
    waitSelector: '#chapter_list li a', waitMs: 2000,
  })
  console.log(`blocked=${toc.blocked} htmlLen=${toc.html.length} ${Date.now() - tToc}ms`)
  const liAs = (toc.html.match(/id="chapter_id_\d+"/g) || []).length
  console.log('  #chapter_list 章节项数:', liAs)
  const firstChapter = toc.html.match(/id="chapter_id_1"><a target="_blank" href="([^"]+)">([^<]+)</)
  console.log('  第一章:', firstChapter ? `${firstChapter[2]} -> ${firstChapter[1].slice(0, 60)}...` : 'N/A')

  // ---- 4. 正文页 ----
  console.log('--- [4] chapter page (browser) ---')
  const tCh = Date.now()
  const ch = await fetchPage(CHAPTER, {
    engine: 'browser', uaMode: 'custom', customUa: UA, timeout: 60000, retries: 0, waitMs: 1200,
  })
  console.log(`blocked=${ch.blocked} htmlLen=${ch.html.length} ${Date.now() - tCh}ms`)
  console.log('  壳残留:', ch.html.includes('html_b'))
  const entry = ch.html.match(/<div class="entry-content">([\s\S]*?)<div id="content_html_bottom"/)
  const entryHtml = entry ? entry[1] : ''
  const pCount = (entryHtml.match(/<p[ >]/g) || []).length
  console.log('  entry-content p 数:', pCount, ' htmlLen:', entryHtml.length)
  const h1 = ch.html.match(/<div class="title">\s*<h1>([^<]+)<\/h1>/)
  console.log('  章节标题:', h1 ? h1[1] : 'N/A')

  console.log(`总耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  process.exit(0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
export {}
