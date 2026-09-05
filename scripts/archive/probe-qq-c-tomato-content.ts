// qq-c 缺陷②核心实测(精简快版): 直连对比第 9/10/11/12 章
export {}
import { parseJsonBody } from '../src/lib/crawl/parser'

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
  console.log(`toc chapters=${items.length}`)
  for (const i of [8, 9, 10, 11]) {
    const it = items[i]
    if (!it) continue
    const url = `${BASE}/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id=${it.itemId}&bid=${BOOK_ID}`
    const t0 = Date.now()
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) })
      const body = await res.text()
      const j: any = parseJsonBody(body)
      const ct = j?.data?.content
      console.log(`ch[${i + 1}] ${String(it.title).slice(0, 16)} http=${res.status} ms=${Date.now() - t0} code=${j?.code} content=${typeof ct === 'string' ? ct.length + '字' : JSON.stringify(ct)?.slice(0, 80)}`)
      if (typeof ct === 'string') console.log('   head:', ct.slice(0, 90).replace(/\s+/g, ' '))
      else console.log('   raw:', body.slice(0, 240).replace(/\s+/g, ' '))
    } catch (e: any) {
      console.log(`ch[${i + 1}] FETCH_ERR ${e?.message} ms=${Date.now() - t0}`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
