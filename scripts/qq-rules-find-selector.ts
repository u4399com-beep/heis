// Probe structure of book detail pages + list pages — find precise cover selector
import { db } from '/home/z/my-project/src/lib/db'
import { fetchPage } from '/home/z/my-project/src/lib/crawl/fetcher'
import { parseRuleConfig } from '/home/z/my-project/src/lib/crawl/types'
import * as cheerio from 'cheerio'

const PROBES: Array<{ name: string; bookUrl?: string; listUrl?: string; }> = [
  // Book detail page probes — find cover selector
  { name: '大微小说网 (daweixs.com)', bookUrl: 'https://www.daweixs.com/767_767872/' },
  { name: '大奉打更人 (dafengdagengren.com)', bookUrl: 'https://www.dafengdagengren.com/897_897821/' },
  { name: '得奇小说网 (deqixs.cc)·直连+签名代理正文', bookUrl: 'https://www.deqixs.cc/books/7523/' },
  { name: '黄金屋(huangjinwu.org)·首页最新更新', bookUrl: 'https://www.huangjinwu.org/novel/99' },
  { name: '努努书坊(www.kanunu8.com)·中文综合书坊采集', bookUrl: 'https://www.kanunu8.com/book7/dnajdssji_1/' },
  { name: '久久小说网 (aijjxs.com)', bookUrl: 'https://www.aijjxs.com/txt/57319.html' },
  { name: '飘天文学(www.piaotia.com)·直连GBK采集', bookUrl: 'https://www.piaotia.com/bookinfo/15/15967.html' },
  { name: '好读小说网(www.hodei.net)·直连SSR采集', bookUrl: 'https://www.hodei.net/book/1102/' },
  { name: 'UU看书(uukanshu.cc)·自定义框架繁体站采集', bookUrl: 'https://uukanshu.cc/book/25822/' },
  // List page probes — check if cover img visible
  { name: '大微小说网 (daweixs.com)', listUrl: 'https://www.daweixs.com/xuanhuanxiaoshuo/' },
  { name: '久久小说网 (aijjxs.com)', listUrl: 'https://www.aijjxs.com/txt/xuanhuan/index_1.html' },
  { name: '飘天文学(www.piaotia.com)·直连GBK采集', listUrl: 'https://www.piaotia.com/booksort1/0/1.html' },
  { name: '好读小说网(www.hodei.net)·直连SSR采集', listUrl: 'https://www.hodei.net/xuanhuan/1.html' },
  { name: 'UU看书(uukanshu.cc)·自定义框架繁体站采集', listUrl: 'https://uukanshu.cc/class_1_1.html' },
  { name: '努努书坊(www.kanunu8.com)·中文综合书坊采集', listUrl: 'https://www.kanunu8.com/files/chinese/29-1.html' },
]

async function probe(name: string, url: string, fetchCfg: any) {
  console.log(`\n=== ${name} ===`)
  console.log(`  url=${url}`)
  let res
  try { res = await fetchPage(url, fetchCfg) } catch (e: any) { console.log(`  ❌ fetch err: ${e?.message || e}`); return }
  if (res.blocked) { console.log(`  ❌ BLOCKED`); return }
  if (!res.html) { console.log(`  ❌ empty`); return }
  const $ = cheerio.load(res.html)
  // Print parent chain + siblings of each img to find selector
  const imgs = $('img').slice(0, 8).toArray()
  for (let i = 0; i < imgs.length; i++) {
    const $img = $(imgs[i])
    const src = $img.attr('src') || ''
    if (!src) continue
    if (src.includes('logo') || src.includes('icon') || src.includes('loading') || src.includes('pixel') || src.includes('blank')) continue
    // Build selector chain
    const chain: string[] = []
    let $p: any = $img
    for (let depth = 0; depth < 6; depth++) {
      if (!$p || !$p.length) break
      const tag = ($p[0] as any).tagName || ''
      const id = $p.attr('id') || ''
      const cls = $p.attr('class') || ''
      const parts: string[] = [tag]
      if (id) parts.push(`#${id}`)
      if (cls) parts.push(`.${cls.split(/\s+/).slice(0, 2).join('.')}`)
      chain.unshift(parts.join(''))
      $p = $p.parent()
    }
    console.log(`  IMG[${i}] src=${src.slice(0, 80)}`)
    console.log(`     chain: ${chain.join(' > ')}`)
  }
}

async function main() {
  for (const p of PROBES) {
    const r = await db.rule.findFirst({ where: { name: p.name } })
    if (!r) { console.log(`\nNOT FOUND: ${p.name}`); continue }
    const cfg = parseRuleConfig(r.config)
    if (p.listUrl) await probe(p.name, p.listUrl, cfg.fetch)
    if (p.bookUrl) await probe(p.name, p.bookUrl, cfg.fetch)
  }
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
