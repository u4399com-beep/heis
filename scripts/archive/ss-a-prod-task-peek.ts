// ss-a 临时探针(只读): 查 bqg713 来源的已采书籍(实测书目候选) → 用后即删
export {}
const BASE = 'http://127.0.0.1:3000'
const j: any = await (await fetch(`${BASE}/api/admin/books?page=1&pageSize=100`)).json()
const d = j?.data
const books = (Array.isArray(d) ? d : (d?.items ?? [])) as any[]
for (const b of books) {
  if (String(b.sourceUrl || b.bookUrl || '').includes('bqg713') || String(b.sourceUrl || b.bookUrl || '').includes('apibi')) {
    console.log(JSON.stringify({ id: b.id, name: b.name, sourceUrl: b.sourceUrl ?? b.bookUrl }))
  }
}
console.log('total pages meta:', JSON.stringify(d).slice(0, 200))
