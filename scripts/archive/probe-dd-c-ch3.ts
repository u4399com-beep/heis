// dd-c 定位 e2e 第3章(你娶我？)的 URL 并检查 "捧场" 上下文(引擎管线全口径)
import { fetchPage } from '../src/lib/crawl/fetcher'
import { parseToc, parseContent } from '../src/lib/crawl/parser'
import { cleanContentHtml } from '../src/lib/crawl/cleaner'

const FETCH = {
  engine: 'http', uaMode: 'rotate', autoCookie: true, referer: true,
  timeout: 25000, retries: 2, waitMs: 800, browserFallbackStatus: [403, 412, 429, 503],
} as const

async function main() {
  const res = await fetchPage('https://www.dafengdagengren.com/0_2/', FETCH as never)
  const toc = await parseToc('https://www.dafengdagengren.com/0_2/', res.html, {
    enabled: true,
    itemSelector: { type: 'css', expression: '#section-list li' },
    fields: {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    },
    pagination: { enabled: false, maxPages: 1 },
  } as never, FETCH as never)
  const hit = toc.items.find((c) => c.title.includes('你娶我'))
  console.log('第3章 URL:', hit?.url, ' title:', hit?.title, ' 前后章节:', toc.items.slice(1, 5).map((c) => `${c.title}=${c.url}`).join(' | '))
  if (!hit) return
  await new Promise((r) => setTimeout(r, 1600))
  const ch = await fetchPage(hit.url, FETCH as never)
  const parsed = await parseContent(hit.url, ch.html, {
    enabled: true,
    fields: { content: { type: 'css', expression: '#content', attr: 'html' } },
    pagination: { enabled: false, maxPages: 1 },
  } as never, FETCH as never)
  const text = cleanContentHtml(parsed.content, undefined).replace(/<[^>]+>/g, '').trim()
  console.log(`全文=${text.length} FFFD=${(text.match(/\uFFFD/g) || []).length}`)
  let idx = text.indexOf('捧场')
  let n = 0
  while (idx >= 0 && n < 4) {
    console.log(`捧场#${n + 1} @${idx}: …${text.slice(Math.max(0, idx - 130), idx + 150).replace(/\s+/g, ' ')}…`)
    idx = text.indexOf('捧场', idx + 2); n++
  }
  if (n === 0) console.log('捧场 0 命中')
  let j = text.indexOf('http://')
  let m = 0
  while (j >= 0 && m < 4) {
    console.log(`http#${m + 1} @${j}: …${text.slice(Math.max(0, j - 80), j + 90).replace(/\s+/g, ' ')}…`)
    j = text.indexOf('http://', j + 1); m++
  }
  if (m === 0) console.log('http:// 0 命中')
}

main()
