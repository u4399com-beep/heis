// Specific probe: deqixs list page structure + 久久小说网 list + 努努书坊 list + 黄金屋 list (a.book-card)
import { fetchPage } from '/home/z/my-project/src/lib/crawl/fetcher'
import { DEFAULT_FETCH_CONFIG } from '/home/z/my-project/src/lib/crawl/types'
import * as cheerio from 'cheerio'

async function probe(url: string, selector: string, label: string) {
  console.log(`\n=== ${label} ===`)
  console.log(`  url=${url}`)
  console.log(`  selector=${selector}`)
  const cfg = { ...DEFAULT_FETCH_CONFIG, uaMode: 'desktop' as const, autoCookie: true, referer: true, timeout: 20000, retries: 2 }
  const res = await fetchPage(url, cfg)
  if (res.blocked) { console.log(`  BLOCKED`); return }
  if (!res.html) { console.log(`  empty`); return }
  const $ = cheerio.load(res.html)
  let sel = selector
  const hasIdx = sel.indexOf(':has(')
  if (hasIdx >= 0) sel = sel.substring(0, hasIdx)
  const first = $(sel).first()
  if (first.length) {
    console.log(`  first item html (max 800):`)
    console.log(`    ${$.html(first).slice(0, 800)}`)
    const imgs = first.find('img').toArray()
    for (const img of imgs) {
      const $i = $(img)
      const raw = (img as any).attribs || {}
      console.log(`    IMG: src=${raw.src||''} data-src=${raw['data-src']||''} class=${raw.class||''}`)
    }
  } else {
    console.log(`  selector matched nothing`)
  }
}

async function main() {
  await probe('https://www.deqixs.cc/sort/1/1.html', 'div.bookbox', 'deqixs sort list')
  await probe('https://www.aijjxs.com/txt/xuanhuan/index_1.html', 'div.listbg', 'aijjxs list')
  await probe('https://www.huangjinwu.org/', 'a.book-card', 'huangjinwu home')
  await probe('https://www.piaotia.com/booksort1/0/1.html', 'table.grid tr', 'piaotia sort list')
  await probe('https://uukanshu.cc/class_1_1.html', 'div.bookbox', 'uukanshu list')
  await probe('https://www.hodei.net/xuanhuan/1.html', 'dl', 'hodei list')
}
main().catch(e => { console.error(e); process.exit(1) })
