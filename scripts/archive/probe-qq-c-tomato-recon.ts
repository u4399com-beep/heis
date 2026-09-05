// qq-c: 搜索响应结构侦察
export {}
const BASE = 'https://fq.taijiwang.top'
const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'

async function main(): Promise<void> {
  const res = await fetch(`${BASE}/api/search?key=${encodeURIComponent('剑仙')}&tab_type=3&offset=0`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  const body = await res.text()
  console.log('status', res.status, 'len', body.length)
  try {
    const j = JSON.parse(body)
    console.log('top keys:', Object.keys(j))
    console.log('code=', j.code, 'message=', j.message)
    const d = j.data
    if (d) {
      console.log('data keys:', Object.keys(d))
      const st = d.search_tabs
      if (Array.isArray(st)) {
        for (const t of st) {
          console.log(`  tab_type=${t.tab_type} title=${t.title} keys=${Object.keys(t)} data_keys=${t.data ? Object.keys(t.data) : 'n/a'}`)
          if (t.data?.book_data) {
            console.log(`    book_data len=${t.data.book_data.length} first=${JSON.stringify(t.data.book_data[0]).slice(0, 300)}`)
          }
        }
      } else {
        console.log('search_tabs:', JSON.stringify(st).slice(0, 500))
      }
    }
  } catch {
    console.log('body head:', body.slice(0, 600))
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
