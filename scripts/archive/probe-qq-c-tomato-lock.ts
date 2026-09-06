// qq-c: isChapterLock 分布 — 前10章 vs 11+ 章
export {}
const BOOK_ID = '6511963569901276163'
const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'
const H = { 'User-Agent': UA, Accept: 'application/json' }

async function main(): Promise<void> {
  const res = await fetch(`https://fq.taijiwang.top/api/book?book_id=${BOOK_ID}&bid=${BOOK_ID}`, { headers: H, signal: AbortSignal.timeout(15000) })
  const tj = await res.json()
  const vols = tj?.data?.data?.chapterListWithVolume || []
  const items = vols.flat()
  const unlocked = items.filter((i: any) => !i.isChapterLock).length
  console.log(`total=${items.length} locked=${items.length - unlocked} unlocked=${unlocked}`)
  console.log('first 14:', items.slice(0, 14).map((i: any, k: number) => `${k + 1}${i.isChapterLock ? '🔒' : '🔓'}`).join(' '))
  console.log('last 5:', items.slice(-5).map((i: any) => (i.isChapterLock ? '🔒' : '🔓')).join(' '))
  // 其他书对照: 十日终焉
  const B2 = '7143038691944959011'
  const tj2 = await (await fetch(`https://fq.taijiwang.top/api/book?book_id=${B2}&bid=${B2}`, { headers: H, signal: AbortSignal.timeout(15000) })).json()
  const items2 = (tj2?.data?.data?.chapterListWithVolume || []).flat()
  const un2 = items2.filter((i: any) => !i.isChapterLock).length
  console.log(`\n十日终焉 total=${items2.length} locked=${items2.length - un2} unlocked=${un2}`)
  console.log('first 14:', items2.slice(0, 14).map((i: any, k: number) => `${k + 1}${i.isChapterLock ? '🔒' : '🔓'}`).join(' '))
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
