// Dump the full config JSON of key rules to inspect content structure
import { db } from '/home/z/my-project/src/lib/db'

const NAMES = [
  '七猫官方API (wtzw.com)·Legado7698·签名代理',
  '新键盘小说网 (xinjianpan.com)·直连+var c解密代理正文',
  '得奇小说网 (deqixs.cc)·直连+签名代理正文',
  '得奇小说网(deqixs.cc)·首页最近更新',
  '新键盘小说网(xinjianpan.com)·首页最近更新',
  '黄金屋(huangjinwu.org)·首页最新更新',
  '零点看书(23.225.143.230)·首页最近更新',
  '二三阅读(23.225.66.244)·首页最近更新',
  '久久小说网(aijjxs.com)·首页最新上传',
  '好读小说网(hodei.net)·首页最近更新小说列表',
  '格格党(gegedangbook.com)·首页最近更新小说列表',
  '江湖神算(jhsssd.com)·首页最新小说',
  '努努书坊(kanunu8.com)·首页最新更新',
  '八零电子书(80ge.info)·首页最新TXT电子书',
  'UU看书(uukanshu.cc)·首页最近更新',
  'ttkan中文(cn.ttkan.co)·首页最近更新',
  '爱下电子书(ixdzs8.com)·首页最近更新',
  '笔趣阁(www.biquge.tw)·首页最近更新',
  '笔趣阁bqg713(www.bqg713.cc)·首页最近更新',
  '速读谷(shudugu.org)·首页最近更新',
  '飘天文学(www.piaotia.com)·首页最近更新',
]

async function main() {
  for (const name of NAMES) {
    const r = await db.rule.findFirst({ where: { name } })
    if (!r) { console.log(`\n=== NOT FOUND: ${name} ===`); continue }
    console.log(`\n=== ${name} ===`)
    console.log(`  enabled=${r.enabled}`)
    console.log(`  description=${r.description?.slice(0, 200)}`)
    let cfg: any
    try { cfg = JSON.parse(r.config) } catch { console.log('  INVALID CONFIG'); continue }
    console.log(`  list.urlTemplate=${cfg.list?.urlTemplate}`)
    console.log(`  list.itemSelector=${JSON.stringify(cfg.list?.itemSelector)}`)
    console.log(`  list.fields keys=${Object.keys(cfg.list?.fields || {}).join(',')}`)
    console.log(`  book.enabled=${cfg.book?.enabled} book.fields keys=${Object.keys(cfg.book?.fields || {}).join(',')}`)
    console.log(`  content.enabled=${cfg.content?.enabled}`)
    console.log(`  content.fields keys=${Object.keys(cfg.content?.fields || {}).join(',')}`)
    if (cfg.content?.fields?.url) console.log(`  content.fields.url=${JSON.stringify(cfg.content.fields.url)}`)
    if (cfg.fetch?.contentProxyUrl) console.log(`  fetch.contentProxyUrl=${cfg.fetch.contentProxyUrl}`)
  }
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
