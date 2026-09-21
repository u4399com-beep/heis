// Deep probe: list page + book page for specified rules, dump full first item HTML to find cover selector
import { db } from '/home/z/my-project/src/lib/db'
import { fetchPage } from '/home/z/my-project/src/lib/crawl/fetcher'
import { parseList } from '/home/z/my-project/src/lib/crawl/parser'
import { parseRuleConfig } from '/home/z/my-project/src/lib/crawl/types'
import * as cheerio from 'cheerio'

const RULES = [
  '黄金屋(huangjinwu.org)·首页最新更新',
  '努努书坊(www.kanunu8.com)·中文综合书坊采集',
  '大微小说网 (daweixs.com)',
  '大奉打更人 (dafengdagengren.com)',
  '得奇小说网 (deqixs.cc)·直连+签名代理正文',
  '得奇小说网(deqixs.cc)·首页最近更新',
  '笔趣阁bqg713(www.bqg713.cc)·纯JSON API站采集',
  '笔趣阁bqg713(www.bqg713.cc)·首页最近更新',
  '飘天文学(www.piaotia.com)·直连GBK采集',
  '好读小说网(www.hodei.net)·直连SSR采集',
  'UU看书(uukanshu.cc)·自定义框架繁体站采集',
  '77读书(77shuku.info)·搜索采集',
  'ttkan中文(cn.ttkan.co)·首页最近更新',
  '久久小说网 (aijjxs.com)',
]

async function dumpFirstItem(name: string, url: string, selector: string, fetchCfg: any, listRule: any) {
  console.log(`\n=== ${name} ===\n  url=${url}\n  selector=${selector}`)
  const res = await fetchPage(url, fetchCfg)
  if (res.blocked) { console.log(`  BLOCKED`); return }
  if (!res.html) { console.log(`  empty`); return }
  // Look for image anywhere in the page that could be a cover
  const $ = cheerio.load(res.html)
  // Try parsing items
  const parsed = parseList(res.html, url, listRule, ['bookUrl', 'url'])
  console.log(`  items=${parsed.items.length}`)
  if (parsed.items[0]) {
    console.log(`  first item fields: ${JSON.stringify(parsed.items[0].fields).slice(0, 300)}`)
  }
  // Find first matching selector
  let sel = selector
  const hasIdx = sel.indexOf(':has(')
  if (hasIdx >= 0) sel = sel.substring(0, hasIdx)
  const firstNode = $(sel).first()
  if (firstNode.length) {
    const html = $.html(firstNode) || ''
    console.log(`  FIRST ITEM HTML (full, max 1500):\n${html.slice(0, 1500)}`)
    // scan img in first item
    const imgs: string[] = []
    firstNode.find('img').each((_, img) => {
      const $img = $(img)
      const attrs: string[] = []
      const raw = (img as any).attribs || {}
      for (const k of ['src', 'data-src', 'data-original', 'data-lazy-src', 'class']) {
        if (raw[k]) attrs.push(`${k}=${raw[k].slice(0, 80)}`)
      }
      imgs.push(attrs.join(' | '))
    })
    if (imgs.length) {
      console.log(`  IMG in first item:`)
      for (const i of imgs) console.log(`    ${i}`)
    }
    // Also scan parent for img (some sites put img outside the item)
    const parentImgs: string[] = []
    firstNode.parent().find('img').slice(0, 3).each((_, img) => {
      const $img = $(img)
      const attrs: string[] = []
      const raw = (img as any).attribs || {}
      for (const k of ['src', 'data-src', 'class']) {
        if (raw[k]) attrs.push(`${k}=${raw[k].slice(0, 80)}`)
      }
      parentImgs.push(attrs.join(' | '))
    })
    if (parentImgs.length) console.log(`  IMG in parent (first 3): \n    ${parentImgs.join('\n    ')}`)
  } else {
    console.log(`  ⚠ selector matched nothing; try .img/.cover scan globally`)
    $('img').slice(0, 5).each((_, img) => {
      const raw = (img as any).attribs || {}
      console.log(`    img: src=${(raw.src||'').slice(0,80)} class=${raw.class||''}`)
    })
  }
}

async function dumpBookPage(name: string, rule: any) {
  // Use a known book URL or probe via list. For now just show config.
  console.log(`\n  book.fields for ${name}:`)
  console.log(`    ${JSON.stringify(rule.book?.fields, null, 2).slice(0, 800)}`)
  console.log(`    list.fields keys=${Object.keys(rule.list?.fields||{}).join(',')}`)
  if (rule.list?.fields?.bookUrl) {
    console.log(`    list.fields.bookUrl=${JSON.stringify(rule.list.fields.bookUrl)}`)
  }
}

async function main() {
  for (const name of RULES) {
    const r = await db.rule.findFirst({ where: { name } })
    if (!r) { console.log(`\nNOT FOUND: ${name}`); continue }
    const cfg = parseRuleConfig(r.config)
    if (!cfg.list?.urlTemplate) { console.log(`\nNO LIST URL: ${name}`); continue }
    try {
      await dumpFirstItem(name, cfg.list.urlTemplate, cfg.list.itemSelector?.expression || '', cfg.fetch, cfg.list)
      await dumpBookPage(name, cfg)
    } catch (e: any) {
      console.log(`  ERROR: ${e?.message || e}`)
    }
  }
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
