// Find enabled rules where book.enabled=true but book.fields.cover is missing
import { db } from '/home/z/my-project/src/lib/db'

async function main() {
  const rules = await db.rule.findMany({ where: { enabled: true } })
  console.log('=== Rules with book.enabled=true but book.fields.cover missing ===')
  for (const r of rules) {
    let cfg: any
    try { cfg = JSON.parse(r.config) } catch { continue }
    const book = cfg.book || {}
    if (book.enabled && !(book.fields?.cover && book.fields.cover.type)) {
      console.log(`  ${r.name}`)
      console.log(`    list.urlTemplate=${cfg.list?.urlTemplate}`)
      console.log(`    book.fields keys=${Object.keys(book.fields || {}).join(',')}`)
    }
  }
  console.log('\n=== Rules with list.enabled=true but list.fields.cover missing ===')
  for (const r of rules) {
    let cfg: any
    try { cfg = JSON.parse(r.config) } catch { continue }
    const list = cfg.list || {}
    if (list.enabled && !(list.fields?.cover && list.fields.cover.type)) {
      console.log(`  ${r.name}  (url=${list.urlTemplate?.slice(0,80)})`)
    }
  }
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
