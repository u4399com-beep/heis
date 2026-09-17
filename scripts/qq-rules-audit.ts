// 临时审计脚本: 列出所有规则并标识 list.fields.cover / book.fields.cover / content json:content
import { db } from '/home/z/my-project/src/lib/db'

interface RuleSummary {
  id: string
  name: string
  enabled: boolean
  listHasCover: boolean
  bookHasCover: boolean
  bookEnabled: boolean
  contentEnabled: boolean
  contentIsJsonContent: boolean
  contentProxy: boolean
  listUrl: string
  listSelector: string
}

function hasField(fields: any, name: string): boolean {
  return !!(fields && fields[name] && fields[name].type)
}

async function main() {
  const rules = await db.rule.findMany({ orderBy: { name: 'asc' } })
  const out: RuleSummary[] = []
  for (const r of rules) {
    let cfg: any = null
    try { cfg = JSON.parse(r.config) } catch { cfg = null }
    if (!cfg) {
      out.push({
        id: r.id, name: r.name, enabled: r.enabled,
        listHasCover: false, bookHasCover: false, bookEnabled: false,
        contentEnabled: false, contentIsJsonContent: false, contentProxy: false,
        listUrl: '<INVALID CONFIG>', listSelector: ''
      })
      continue
    }
    const listFields = cfg.list?.fields || {}
    const bookFields = cfg.book?.fields || {}
    const contentFields = cfg.content?.fields || {}
    const contentUrl = contentFields?.url || {}
    out.push({
      id: r.id, name: r.name, enabled: r.enabled,
      listHasCover: hasField(listFields, 'cover'),
      bookHasCover: hasField(bookFields, 'cover'),
      bookEnabled: !!cfg.book?.enabled,
      contentEnabled: !!cfg.content?.enabled,
      contentIsJsonContent: contentUrl.type === 'json' && contentUrl.expression === 'content',
      contentProxy: !!cfg.fetch?.contentProxyUrl,
      listUrl: cfg.list?.urlTemplate || '',
      listSelector: cfg.list?.itemSelector?.expression || '',
    })
  }
  console.log('=== ALL RULES SUMMARY ===')
  for (const r of out) {
    console.log(
      `[${r.enabled ? '✓' : ' '}] ${r.name.padEnd(50).slice(0, 50)} | L.cover=${r.listHasCover ? 'Y' : 'N'} B.cover=${r.bookHasCover ? 'Y' : 'N'} B.en=${r.bookEnabled ? 'Y' : 'N'} C.en=${r.contentEnabled ? 'Y' : 'N'} C.jsonContent=${r.contentIsJsonContent ? 'Y' : 'N'} C.proxy=${r.contentProxy ? 'Y' : 'N'}`
    )
  }
  console.log(`\nTotal: ${out.length}`)
  console.log(`Enabled: ${out.filter(r => r.enabled).length}`)
  console.log(`Enabled missing list.cover: ${out.filter(r => r.enabled && !r.listHasCover).length}`)
  console.log(`Enabled missing book.cover (and book enabled): ${out.filter(r => r.enabled && r.bookEnabled && !r.bookHasCover).length}`)
  console.log(`Enabled with content enabled but no json:content: ${out.filter(r => r.enabled && r.contentEnabled && !r.contentIsJsonContent).length}`)
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
