// ============================================================
// cc-a 探针: 引擎级全文清洗质量检查(不截断, 与实采同管线)
// 用法: bun run scripts/probe-cc-a-clean.ts
// 管线: fetchPage(engine=browser) → parseContent → cleanContentHtml
// 断言: 无 \u0000 / 无壳残留(html_b/window.user_ip) / 无 base64 片段 /
//       无站点推广残留(正在阅读/当前章节/推广本站/服务商故障)
// ============================================================
import { fetchPage } from '../src/lib/crawl/fetcher'
import { parseContent } from '../src/lib/crawl/parser'
import { cleanContentHtml } from '../src/lib/crawl/cleaner'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const BOOK_URL = 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/411853/'

const CHAPTERS = [
  { name: '第一章(3095字)', url: 'YXV3eHcvNDExODUzL2FIUjBjSE02THk5M2QzY3VZWFYzZUhjdVkyOXRMMkYxY21WaFpDODFNamcwTUY4ek1UVXhOREExTnk1b2RHMXMuanNvbg==.html' },
  { name: '第九百九十七章(1265字, 已知混入污染段)', url: 'YXV3eHcvNDExODUzL2FIUjBjSE02THk5M2QzY3VZWFYzZUhjdVkyOXRMMkYxY21WaFpDODFNamcwTUY4ek16QXdPREU0Tmk1b2RHMXMuanNvbg==.html' },
  { name: '第二百四十章(14059字, 最长章)', url: 'YXV3eHcvNDExODUzL2FIUjBjSE02THk5M2QzY3VZWFYzZUhjdVkyOXRMMkYxY21WaFpDODFNamcwTUY4ek1UVXpORFk1TXk1b2RHMXMuanNvbg==.html' },
]

// 库内规则 seed 的 clean 配置(与 seed-rule-book4.ts 保持一致)
const CLEAN = {
  removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
  adPatterns: [
    '<!--[\\s\\S]{0,300}?-->',
    '(www\\.)?book4\\.cc\\S*',
    '请各位大哥大姐帮忙推广[^<]{0,200}',
    '正在阅读《[^<]{0,80}》?',
    '当前章节[:：][^<]{0,120}',
    '本站长期运营[^<]{0,120}',
    '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
  ],
  whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  normalize: true,
  plainText: false,
}

const JUNK = ['html_b', 'window[', 'user_ip', 'document.write', '\\u0000', 'YXV3eHc', 'eGluZ3', 'aHR0cHM', '正在阅读', '当前章节', '推广本站', '服务商故障', 'book4.cc', '追更书架', '内容报错']

async function main() {
  let fail = 0
  for (const ch of CHAPTERS) {
    const url = BOOK_URL + ch.url
    const t0 = Date.now()
    const res = await fetchPage(url, { engine: 'browser', uaMode: 'custom', customUa: UA, timeout: 60000, retries: 1, waitMs: 1500, hostGateLimit: 2 })
    const tFetch = Date.now() - t0
    const parsed = await parseContent(url, res.html, { enabled: true, fields: { content: { type: 'css', expression: '.entry-content', attr: 'html' } }, pagination: { enabled: false, maxPages: 1 } }, { engine: 'browser', timeout: 60000 })
    const cleaned = cleanContentHtml(parsed.content, CLEAN)
    const plain = cleaned.replace(/<[^>]+>/g, '')
    const hits = JUNK.filter((j) => {
      if (j === '\\u0000') return plain.includes('\u0000')
      return cleaned.includes(j) || plain.includes(j)
    })
    const okLen = plain.length >= 2000
    const tail = plain.replace(/\s+/g, ' ').slice(-90)
    const head = plain.replace(/\s+/g, ' ').slice(0, 60)
    console.log(`${hits.length === 0 && okLen ? '✅' : '❌'} ${ch.name}: fetch=${tFetch}ms clean=${plain.length}字 pages=${parsed.pages}`)
    console.log(`   头部: ${head}`)
    console.log(`   尾部: ${tail}`)
    if (hits.length) { console.log('   !! 命中垃圾:', hits.join(', ')); fail++ }
    if (!okLen) { console.log('   !! clean<2000'); fail++ }
    await new Promise((r) => setTimeout(r, 800))
  }
  console.log(fail === 0 ? '== 全部章节清洗质量过关 ==' : `== ${fail} 项未过 ==`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
export {}
