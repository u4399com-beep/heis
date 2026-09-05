// qq-c 缺陷②症状实测: 番茄聚合API 抓 50+ 章的书, 对比第 10/11+ 章 content 响应
export {}
const BASE = 'https://fq.taijiwang.top'
const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'

const H = { 'User-Agent': UA, Accept: 'application/json' }

async function getJson(url: string): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000), redirect: 'follow' })
    const body = await res.text()
    return { status: res.status, body }
  } catch (e) {
    return { status: -1, body: `FETCH_ERR: ${e instanceof Error ? e.message : String(e)}` }
  }
}

async function main(): Promise<void> {
  // 1. search
  const s = await getJson(`${BASE}/api/search?key=${encodeURIComponent('剑')}&tab_type=3&offset=0`)
  console.log(`search status=${s.status} len=${s.body.length}`)
  if (s.status !== 200) { console.log('search body:', s.body.slice(0, 400)); process.exit(1) }
  let sj: any
  try { sj = JSON.parse(s.body) } catch { console.log('search non-JSON:', s.body.slice(0, 300)); process.exit(1) }
  const books = sj?.data?.search_tabs?.find((t: any) => String(t.tab_type) === '3')?.data?.book_data || []
  console.log(`search books=${books.length}`)
  if (!books.length) { console.log('no books'); process.exit(1) }
  // 找一本章节数多的书
  let picked: any = null
  for (const b of books.slice(0, 10)) {
    console.log(`  cand: book_id=${b.book_id} ${b.book_name} 作者=${b.author} category=${b.category || ''}`)
  }
  picked = books[0]
  const bookId = picked.book_id
  console.log(`\npick book_id=${bookId} 《${picked.book_name}》`)

  // 2. detail
  const d = await getJson(`${BASE}/api/detail?book_id=${bookId}`)
  console.log(`detail status=${d.status} len=${d.body.length} head=${d.body.slice(0, 160).replace(/\n/g, '')}`)

  // 3. toc
  const t = await getJson(`${BASE}/api/book?book_id=${bookId}&bid=${bookId}`)
  console.log(`toc status=${t.status} len=${t.body.length}`)
  let tj: any
  try { tj = JSON.parse(t.body) } catch { console.log('toc non-JSON:', t.body.slice(0, 300)); process.exit(1) }
  const vols = tj?.data?.data?.chapterListWithVolume || []
  const items = vols.flat()
  console.log(`toc volumes=${vols.length} chapters=${items.length}`)
  if (items.length < 12) { console.log('book too short for defect test; pick another'); process.exit(1) }
  console.log('first3:', items.slice(0, 3).map((i: any) => `${i.itemId}:${i.title}`))
  console.log('last2:', items.slice(-2).map((i: any) => `${i.itemId}:${i.title}`))

  // 4. content: 逐章 1..18 + 中段几章, 记录 status/content 长度/content head
  const probeIdx = [0, 1, 4, 8, 9, 10, 11, 12, 13, 17, Math.floor(items.length / 2), items.length - 1]
  for (const i of probeIdx) {
    const it = items[i]
    if (!it) continue
    const url = `${BASE}/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id=${it.itemId}&bid=${bookId}`
    const c = await getJson(url)
    let head = c.body.slice(0, 200).replace(/\s+/g, ' ')
    let contentLen = -1
    let code: any = '?'
    let msg = ''
    try {
      const cj = JSON.parse(c.body)
      code = cj?.code
      msg = cj?.message || cj?.msg || ''
      const ct = cj?.data?.content
      contentLen = typeof ct === 'string' ? ct.length : -1
      head = typeof ct === 'string' ? ct.slice(0, 120).replace(/\s+/g, ' ') : head
    } catch { /* keep raw head */ }
    console.log(`ch[${i + 1}] item=${it.itemId} http=${c.status} code=${code} msg=${String(msg).slice(0, 40)} contentLen=${contentLen} bodyLen=${c.body.length}`)
    console.log(`    head: ${head}`)
    await new Promise((r) => setTimeout(r, 400))
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
