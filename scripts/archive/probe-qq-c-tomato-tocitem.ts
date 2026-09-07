// qq-c: toc 章节项完整结构 + 不同 content URL 变体测试
export {}
const BOOK_ID = '6511963569901276163'
const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'
const H = { 'User-Agent': UA, Accept: 'application/json' }

async function main(): Promise<void> {
  const res = await fetch(`https://fq.taijiwang.top/api/book?book_id=${BOOK_ID}&bid=${BOOK_ID}`, { headers: H, signal: AbortSignal.timeout(15000) })
  const tj = await res.json()
  const vols = tj?.data?.data?.chapterListWithVolume || []
  console.log('volumes=', vols.length, 'sizes=', vols.map((v: any) => v.length))
  const item = vols[0]?.[11] // 第12章
  console.log('ch12 item:', JSON.stringify(item, null, 1).slice(0, 600))
  // 卷结构第一卷前3项的 key 差异
  console.log('item keys:', Object.keys(item || {}))
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
