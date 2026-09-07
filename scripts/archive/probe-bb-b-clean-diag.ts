// bb-b 诊断: 用规则 clean 配置本地清洗 df 章节页, 精确定位残余 http:// 与 捧场 来源
import { fetchPage } from '../src/lib/crawl/fetcher'
import { parseContent } from '../src/lib/crawl/parser'
import { cleanContentHtml } from '../src/lib/crawl/cleaner'

const clean = {
  removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', 'h4'],
  adPatterns: [
    '(www\\.)?dafengdagengren\\.com\\S*',
    '本站所有小说为转载作品[^。<>]*',
    '捧场\\d*纵横币',
    '投\\d*张月票',
    '疯求各种点击、收藏、红票、月票！?',
    '如果觉得本章写的精彩[^<]*',
    '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
  ],
  whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h5', 'h6'],
  normalize: true,
  plainText: false,
}
const contentRule = { enabled: true, fields: { content: { type: 'css', expression: '#content', attr: 'html' } }, pagination: { enabled: false, maxPages: 1 } }

async function main() {
  for (const url of [
    'https://www.dafengdagengren.com/0_2/23409004.html',
    'https://www.dafengdagengren.com/0_2/23409009.html',
    'https://www.dafengdagengren.com/0_2/23409012.html',
  ]) {
    const res = await fetchPage(url, { engine: 'http', timeout: 25000, retries: 1, autoCookie: true, referer: true })
    const parsed = await parseContent(url, res.html, contentRule as any, undefined)
    const cleaned = cleanContentHtml(parsed.content || '', clean as any)
    const text = cleaned.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
    console.log(`\n===== ${url} 文本=${text.length}`)
    // 命中上下文
    for (const key of ['http://', 'https://', '捧场', '纵横币', '月票']) {
      let idx = text.indexOf(key)
      while (idx >= 0) {
        console.log(`  [${key}] ...${JSON.stringify(text.slice(Math.max(0, idx - 60), idx + 80))}...`)
        idx = text.indexOf(key, idx + 1)
        if (idx > 200000) break
      }
    }
  }
}

main().finally(() => process.exit(0))
