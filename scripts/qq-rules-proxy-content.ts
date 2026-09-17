// Inspect content.fields.content + fetch.contentProxyUrl for proxy rules
import { db } from '/home/z/my-project/src/lib/db'

const NAMES = [
  '七猫官方API (wtzw.com)·Legado7698·签名代理',
  '新键盘小说网 (xinjianpan.com)·直连+var c解密代理正文',
  '得奇小说网 (deqixs.cc)·直连+签名代理正文',
]

async function main() {
  for (const name of NAMES) {
    const r = await db.rule.findFirst({ where: { name } })
    if (!r) continue
    console.log(`\n=== ${name} ===`)
    const cfg = JSON.parse(r.config)
    console.log(`content.fields = ${JSON.stringify(cfg.content?.fields, null, 2)}`)
    console.log(`content.url = ${JSON.stringify(cfg.content?.fields?.url, null, 2)}`)
    console.log(`fetch.contentProxyUrl = ${cfg.fetch?.contentProxyUrl}`)
    console.log(`toc.fields.url = ${JSON.stringify(cfg.toc?.fields?.url, null, 2)}`)
    console.log(`book.fields.cover = ${JSON.stringify(cfg.book?.fields?.cover, null, 2)}`)
    console.log(`list.fields.cover = ${JSON.stringify(cfg.list?.fields?.cover, null, 2)}`)
  }
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
