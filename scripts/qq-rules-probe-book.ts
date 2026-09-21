// Probe book detail pages for rules where book.enabled=Y but book.cover missing
import { db } from '/home/z/my-project/src/lib/db'
import { fetchPage } from '/home/z/my-project/src/lib/crawl/fetcher'
import { parseRuleConfig } from '/home/z/my-project/src/lib/crawl/types'
import * as cheerio from 'cheerio'

const PROBES: Array<{ name: string; bookUrl: string; listUrl?: string; listPageSub?: string }> = [
  { name: '大微小说网 (daweixs.com)', bookUrl: 'https://www.daweixs.com/767_767872/' },
  { name: '大奉打更人 (dafengdagengren.com)', bookUrl: 'https://www.dafengdagengren.com/897_897821/' },
  { name: '得奇小说网 (deqixs.cc)·直连+签名代理正文', bookUrl: 'https://www.deqixs.cc/books/7523/', listUrl: 'https://www.deqixs.cc/sort/1/1.html' },
  { name: '黄金屋(huangjinwu.org)·首页最新更新', bookUrl: 'https://www.huangjinwu.org/novel/99' },
  { name: '努努书坊(www.kanunu8.com)·中文综合书坊采集', bookUrl: 'https://www.kanunu8.com/book7/dnajdssji_1/', listUrl: 'https://www.kanunu8.com/files/chinese/29-1.html' },
  { name: '笔趣阁bqg713(www.bqg713.cc)·纯JSON API站采集', bookUrl: 'https://www.bqg713.cc/api/book?id=2530', listUrl: 'https://www.bqg713.cc/api/index?sort=all' },
  { name: '久久小说网 (aijjxs.com)', bookUrl: 'https://www.aijjxs.com/txt/57319.html', listUrl: 'https://www.aijjxs.com/txt/xuanhuan/index_1.html' },
  { name: '飘天文学(www.piaotia.com)·直连GBK采集', bookUrl: 'https://www.piaotia.com/bookinfo/15/15967.html', listUrl: 'https://www.piaotia.com/booksort1/0/1.html' },
  { name: '好读小说网(www.hodei.net)·直连SSR采集', bookUrl: 'https://www.hodei.net/book/1102/', listUrl: 'https://www.hodei.net/xuanhuan/1.html' },
  { name: 'UU看书(uukanshu.cc)·自定义框架繁体站采集', bookUrl: 'https://uukanshu.cc/book/25822/', listUrl: 'https://uukanshu.cc/class_1_1.html' },
]

async function probeBook(name: string, url: string, fetchCfg: any) {
  console.log(`\n=== BOOK: ${name} ===`)
  console.log(`  url=${url}`)
  let res
  try { res = await fetchPage(url, fetchCfg) } catch (e: any) { console.log(`  ❌ fetch err: ${e?.message || e}`); return }
  if (res.blocked) { console.log(`  ❌ BLOCKED captcha=${res.captchaType || ''}`); return }
  if (!res.html || res.html.length < 200) { console.log(`  ❌ empty html (len=${res.html?.length || 0}) engine=${res.engine}`); return }
  console.log(`  html len=${res.html.length} engine=${res.engine}`)
  const $ = cheerio.load(res.html)
  // Scan img tags globally
  const imgs: string[] = []
  $('img').slice(0, 12).each((_, img) => {
    const raw = (img as any).attribs || {}
    const attrs: string[] = []
    for (const k of ['src', 'data-src', 'data-original', 'class', 'alt']) {
      if (raw[k]) attrs.push(`${k}=${raw[k].slice(0, 100)}`)
    }
    imgs.push(attrs.join(' | '))
  })
  if (imgs.length) {
    console.log(`  IMG tags (first 12):`)
    for (const i of imgs) console.log(`    ${i}`)
  }
  // Check og:image meta
  const og = $('meta[property="og:image"]').attr('content')
  if (og) console.log(`  og:image = ${og}`)
  // Look for common cover selectors
  const coverSelectors = ['.cover img', '.book-cover img', '.bookimg img', '.bookimg', 'img.cover', '.thumb img', '.pic img', '#bookimg img', '#fm img', '.fm img', '.summary img', '#info img', '.intro img']
  for (const sel of coverSelectors) {
    const $el = $(sel).first()
    if ($el.length) {
      const src = $el.attr('src') || $el.attr('data-src') || $el.attr('data-original') || ''
      if (src) console.log(`  COVER via ${sel}: src=${src.slice(0, 100)}`)
    }
  }
}

async function probeList(name: string, url: string, fetchCfg: any) {
  console.log(`\n=== LIST: ${name} ===`)
  console.log(`  url=${url}`)
  let res
  try { res = await fetchPage(url, fetchCfg) } catch (e: any) { console.log(`  ❌ fetch err: ${e?.message || e}`); return }
  if (res.blocked) { console.log(`  ❌ BLOCKED captcha=${res.captchaType || ''}`); return }
  if (!res.html || res.html.length < 200) { console.log(`  ❌ empty html (len=${res.html?.length || 0}) engine=${res.engine}`); return }
  console.log(`  html len=${res.html.length} engine=${res.engine}`)
}

async function main() {
  for (const p of PROBES) {
    const r = await db.rule.findFirst({ where: { name: p.name } })
    if (!r) { console.log(`\nNOT FOUND: ${p.name}`); continue }
    const cfg = parseRuleConfig(r.config)
    if (p.listUrl) await probeList(p.name, p.listUrl, cfg.fetch)
    await probeBook(p.name, p.bookUrl, cfg.fetch)
  }
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
