// qq-c: 搜索 tab3 数据项结构细看
export {}
const BASE = 'https://fq.taijiwang.top'
const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'

async function main(): Promise<void> {
  const res = await fetch(`${BASE}/api/search?key=${encodeURIComponent('剑仙')}&tab_type=3&offset=0`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  const j = await res.json()
  const tab3 = j.data.search_tabs.find((t: any) => String(t.tab_type) === '3')
  const data = tab3.data
  console.log('isArray=', Array.isArray(data))
  if (Array.isArray(data)) {
    console.log('len=', data.length)
    console.log('item0 keys=', Object.keys(data[0] || {}))
    console.log('item0:', JSON.stringify(data[0], null, 1).slice(0, 1200))
    // 是否包一层 book_data?
    if (data[0]?.book_data) console.log('item0.book_data len=', data[0].book_data.length)
  } else {
    console.log('keys:', Object.keys(data || {}))
    console.log(JSON.stringify(data, null, 1).slice(0, 800))
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
