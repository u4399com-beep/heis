// qq-c: 检查 content 是否被截断(尾部检查) — 判断是否"免费试读10章"式截断
export {}
const BASE = 'https://fq.taijiwang.top'
const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'
const BOOK_ID = '6511963569901276163'

async function main(): Promise<void> {
  const t = await fetch(`${BASE}/api/book?book_id=${BOOK_ID}&bid=${BOOK_ID}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  const tj = await t.json()
  const items = (tj?.data?.data?.chapterListWithVolume || []).flat()
  for (const i of [4, 14, 100, 500, 1347]) {
    const it = items[i]
    if (!it) continue
    const url = `${BASE}/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id=${it.itemId}&bid=${BOOK_ID}`
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
      const j: any = await res.json()
      const ct = j?.data?.content
      console.log(`ch[${i + 1}] ${String(it.title).slice(0, 20)} len=${typeof ct === 'string' ? ct.length : -1}`)
      if (typeof ct === 'string') {
        console.log('   TAIL:', ct.slice(-160).replace(/\s+/g, ' '))
      } else {
        console.log('   FULL:', JSON.stringify(j).slice(0, 300))
      }
    } catch (e: any) {
      console.log(`ch[${i + 1}] ERR ${e?.message?.slice(0, 60)}`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
