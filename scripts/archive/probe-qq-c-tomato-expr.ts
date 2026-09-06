// qq-c: 直接用引擎 parser 对真实搜索响应跑 itemSelector 表达式
export {}
import { jsonArrayAt, jsonGet } from '../src/lib/crawl/parser'

const BASE = 'https://fq.taijiwang.top'
const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'

async function main(): Promise<void> {
  const res = await fetch(`${BASE}/api/search?key=${encodeURIComponent('剑仙')}&tab_type=3&offset=0`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  const root = await res.json()
  const expr = 'data.search_tabs[tab_type=3].data.book_data'
  const items = jsonArrayAt(root, expr)
  console.log('jsonArrayAt len=', items.length)
  const b0: any = items[0]
  console.log('item0 keys=', b0 ? Object.keys(b0).slice(0, 12) : 'n/a')
  console.log('item0.book_name=', b0?.book_name, 'book_id=', b0?.book_id)
  // jsonGet 同表达式(供字段提取对比)
  console.log('jsonGet same expr isArr=', Array.isArray(jsonGet(root, expr)))
  // 诊断: 手动逐层
  const tab3 = root?.data?.search_tabs?.filter((t: any) => String(t.tab_type) === '3')
  console.log('tab3 len=', tab3?.length, 'tab3[0].data isArr=', Array.isArray(tab3?.[0]?.data))
  const cells = tab3?.[0]?.data || []
  console.log('cells len=', cells.length, 'cell0.book_data isArr=', Array.isArray(cells[0]?.book_data), 'cell0.book_data len=', cells[0]?.book_data?.length)
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
