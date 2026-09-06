// qq-c: 多本书 11+ 章实测 — 重点验证付费书是否只给前10章试读
export {}
const BASE = 'https://fq.taijiwang.top'
const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'

const H = { 'User-Agent': UA, Accept: 'application/json' }

async function getj(url: string): Promise<any> {
  const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) })
  return res.json()
}

async function probeBook(bookId: string, name: string, author: string): Promise<void> {
  const tj = await getj(`${BASE}/api/book?book_id=${bookId}&bid=${bookId}`)
  const items = (tj?.data?.data?.chapterListWithVolume || []).flat()
  console.log(`\n《${name}》${author} book_id=${bookId} chapters=${items.length}`)
  if (items.length < 12) { console.log('  (章节不足12, 跳过)'); return }
  for (const i of [0, 9, 10, 11, 30]) {
    const it = items[i]
    if (!it) continue
    try {
      const j = await getj(`${BASE}/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id=${it.itemId}&bid=${bookId}`)
      const ct = j?.data?.content
      const len = typeof ct === 'string' ? ct.length : -1
      const tail = typeof ct === 'string' ? ct.slice(-60).replace(/\s+/g, ' ') : ''
      console.log(`  ch[${i + 1}] len=${len} ${len >= 0 ? 'TAIL: ' + tail : 'RAW: ' + JSON.stringify(j).slice(0, 180)}`)
    } catch (e: any) {
      console.log(`  ch[${i + 1}] ERR ${e?.message?.slice(0, 50)}`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function main(): Promise<void> {
  // 生产任务入口: key=剑 的搜索首书
  const s = await getj(`${BASE}/api/search?key=${encodeURIComponent('剑')}&tab_type=3&offset=0`)
  const books = s?.data?.search_tabs?.find((t: any) => String(t.tab_type) === '3')?.data?.flatMap((c: any) => c.book_data || []) || []
  console.log(`key=剑 books=${books.length}`)
  for (const b of books.slice(0, 6)) console.log(`  ${b.book_id} 《${b.book_name}》${b.author} ${b.category || ''}`)
  if (books[0]) await probeBook(books[0].book_id, books[0].book_name, books[0].author)
  // 付费书样本: 十日终焉 / 长夜余火(知乎盐选?) — 搜两本热门
  for (const kw of ['十日终焉', '我废柴 midway'.split(' ')[0]]) {
    try {
      const s2 = await getj(`${BASE}/api/search?key=${encodeURIComponent(kw)}&tab_type=3&offset=0`)
      const bs = s2?.data?.search_tabs?.find((t: any) => String(t.tab_type) === '3')?.data?.flatMap((c: any) => c.book_data || []) || []
      if (bs[0]) await probeBook(bs[0].book_id, bs[0].book_name, bs[0].author)
    } catch (e: any) { console.log(`kw ${kw} ERR ${e?.message?.slice(0, 60)}`) }
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
