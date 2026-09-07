// qq-c: 并发压力实测 — 3/6 并发拉 content, 看是否触发限流(空content)
export {}
const BOOK_ID = '6511963569901276163'
const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'
const H = { 'User-Agent': UA, Accept: 'application/json' }

async function getj(url: string): Promise<any> {
  const res = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) })
  return res.json()
}

async function main(): Promise<void> {
  const tj = await getj(`https://fq.taijiwang.top/api/book?book_id=${BOOK_ID}&bid=${BOOK_ID}`)
  const items = (tj?.data?.data?.chapterListWithVolume || []).flat()
  console.log(`chapters=${items.length}`)
  // 6 并发 × 4 轮 = 24 章(从第40章起避开已测面)
  for (let round = 0; round < 4; round++) {
    const batch = items.slice(40 + round * 6, 46 + round * 6)
    const t0 = Date.now()
    const rs = await Promise.all(batch.map(async (it: any, k: number) => {
      try {
        const j = await getj(`https://fq.taijiwang.top/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id=${it.itemId}&bid=${BOOK_ID}`)
        const ct = j?.data?.content
        return `ch[${41 + round * 6 + k}]len=${typeof ct === 'string' ? ct.length : -1}`
      } catch (e: any) {
        return `ch[${41 + round * 6 + k}]ERR=${e?.message?.slice(0, 30)}`
      }
    }))
    console.log(`round${round + 1} ms=${Date.now() - t0}: ${rs.join(' ')}`)
    await new Promise((r) => setTimeout(r, 800))
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
