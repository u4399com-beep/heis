// qq-c: 番茄官方 Web 端点(fanqienovel.com)侦察 — SSR HTML 是否含正文
export {}
const BOOK_ID = '6511963569901276163'
const ITEM_ID = '6511978580325433864' // 楔子
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

async function probe(label: string, url: string): Promise<void> {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json', 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    })
    const body = await res.text()
    console.log(`\n== ${label} http=${res.status} ms=${Date.now() - t0} len=${body.length}`)
    // 关键特征探测
    const hasMokuai = body.includes('mokuai')
    const hasContent = /class="mokuai-content"|chapter-content|class="content"/.test(body)
    const initialState = body.includes('__INITIAL_STATE__') || body.includes('window.__INITIAL_STATE__')
    const title = (body.match(/<title>([^<]{0,80})<\/title>/) || [])[1]
    console.log(`   title=${title} mokuaiContent=${hasMokuai} contentCls=${hasContent} initialstate=${initialState}`)
    // 挤出正文长度估计: mokuai-content 区段
    const m = body.match(/mokuai-content[\s\S]{0,400}/)
    if (m) console.log(`   mokuai head: ${m[0].slice(0, 260).replace(/\s+/g, ' ')}`)
    else {
      const m2 = body.match(/(?:本章内容|正文)[^<]{0,120}/)
      console.log(`   no mokuai; 正文特征: ${m2 ? m2[0] : '无'} bodyHead: ${body.slice(0, 200).replace(/\s+/g, ' ')}`)
    }
  } catch (e: any) {
    console.log(`\n== ${label} ERR ms=${Date.now() - t0}: ${e?.message?.slice(0, 100)}`)
  }
  await new Promise((r) => setTimeout(r, 400))
}

async function main(): Promise<void> {
  await probe('书籍页 /page/{book_id}', `https://fanqienovel.com/page/${BOOK_ID}`)
  await probe('阅读页 /reader/{item_id}', `https://fanqienovel.com/reader/${ITEM_ID}`)
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
