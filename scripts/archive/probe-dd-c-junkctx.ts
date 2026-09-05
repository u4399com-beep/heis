// dd-c junk 命中上下文核查: 对 e2e 扫描命中的章节, 走引擎管线(fetchPage→parseContent→
// cleanContentHtml)取全文, 打印 http:// 与 捧场 命中的 ±120 字符上下文, 判定"广告残留 vs 源站正文原句"
// 用法: bun run scripts/probe-dd-c-junkctx.ts
import { fetchPage } from '../src/lib/crawl/fetcher'
import { parseContent } from '../src/lib/crawl/parser'
import { cleanContentHtml } from '../src/lib/crawl/cleaner'
import type { RuleConfig } from '../src/lib/crawl/types'

const FETCH = {
  engine: 'http', uaMode: 'rotate', autoCookie: true, referer: true,
  timeout: 25000, retries: 2, waitMs: 800, browserFallbackStatus: [403, 412, 429, 503],
} as const

const CLEAN = {
  removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', 'h4'],
  adPatterns: [
    '(www\\.)?dafengdagengren\\.com\\S*',
    '本站所有小说为转载作品[^。<>]*',
    '捧场\\d*纵横币',
    '投\\d*张月票',
    '抽月票',
    '求月票',
    '疯求各种点击、收藏、红票、月票！?',
    '如果觉得本章写的精彩[^<]*',
    '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
  ],
  whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h5', 'h6'],
  normalize: true,
  plainText: false,
}

const CHAPTERS = [
  { tag: '第1章(23409004)', url: 'https://www.dafengdagengren.com/0_2/23409004.html' },
  { tag: '第3章(23409006)', url: 'https://www.dafengdagengren.com/0_2/23409006.html' },
]

function showContexts(text: string, word: string, tag: string) {
  let idx = text.indexOf(word)
  let n = 0
  while (idx >= 0 && n < 4) {
    const s = Math.max(0, idx - 120)
    const e = Math.min(text.length, idx + word.length + 120)
    console.log(`  [${tag}] "${word}" 命中#${n + 1} @${idx}: …${text.slice(s, e).replace(/\s+/g, ' ')}…`)
    idx = text.indexOf(word, idx + word.length)
    n++
  }
  if (n === 0) console.log(`  [${tag}] "${word}" 0 命中`)
}

async function main() {
  const cfg = { content: { enabled: true, fields: { content: { type: 'css', expression: '#content', attr: 'html' } }, pagination: { enabled: false, maxPages: 1 } } } as unknown as RuleConfig
  for (const ch of CHAPTERS) {
    const res = await fetchPage(ch.url, FETCH as never)
    if (res.blocked) { console.log(`[${ch.tag}] blocked!`); continue }
    const parsed = await parseContent(ch.url, res.html, cfg.content, FETCH as never)
    const cleaned = cleanContentHtml(parsed.content, CLEAN as never)
    const text = cleaned.replace(/<[^>]+>/g, '').trim()
    console.log(`== ${ch.tag} 全文=${text.length} 字 ==`)
    showContexts(text, 'http://', ch.tag)
    showContexts(text, 'https://', ch.tag)
    showContexts(text, '捧场', ch.tag)
    showContexts(text, '月票', ch.tag)
    console.log(`  FFFD=${(text.match(/\uFFFD/g) || []).length}`)
    await new Promise((r) => setTimeout(r, 1600))
  }
}

main()
