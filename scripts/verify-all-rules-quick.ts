import { db } from '/home/z/my-project/src/lib/db'
import { parseRuleConfig, DEFAULT_FETCH_CONFIG } from '/home/z/my-project/src/lib/crawl/types'
import { fetchPage } from '/home/z/my-project/src/lib/crawl/fetcher'
import { parseList } from '/home/z/my-project/src/lib/crawl/parser'

async function main() {
  const rules = await db.rule.findMany({ where: { enabled: true }, select: { name: true, config: true }, orderBy: { name: 'asc' } })
  let ok = 0, fail = 0, skip = 0
  for (const r of rules) {
    const cfg = parseRuleConfig(r.config)
    const u = cfg.list.urlTemplate?.replace('{page}','1').replace('{keyword}','小说').replace('{cat}','0') || ''
    if (!u || u.includes('127.0.0.1') || u.includes('{keyword}')) { skip++; continue }
    try {
      const res = await fetchPage(u, { ...DEFAULT_FETCH_CONFIG, ...cfg.fetch, timeout: 8000 })
      const p = parseList(res.html||'', u, cfg.list, ['url','bookUrl'])
      if (p.items.length > 0) { ok++; console.log('  ✓', r.name.substring(0,40).padEnd(40), p.items.length+'本') }
      else { fail++; console.log('  ✗', r.name.substring(0,40).padEnd(40), '0本') }
    } catch(e) { fail++; console.log('  ✗', r.name.substring(0,40).padEnd(40), 'ERR') }
  }
  console.log('\n=== Summary: OK='+ok+' FAIL='+fail+' SKIP='+skip+' / Total='+rules.length+' ===')
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
