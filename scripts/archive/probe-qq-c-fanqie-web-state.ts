// qq-c: fanqie web reader INITIAL_STATE 内容字段解剖
export {}
const ITEM_ID = '6511978580325433864'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

async function main(): Promise<void> {
  const res = await fetch(`https://fanqienovel.com/reader/${ITEM_ID}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(15000),
  })
  const body = await res.text()
  const si = body.indexOf('__INITIAL_STATE__=')
  const jsonStart = body.indexOf('{', si)
  // 找到配对结束(script标签结尾) — 粗略: 找 '</script>'
  const jsonEnd = body.indexOf('</script>', jsonStart)
  const raw = body.slice(jsonStart, jsonEnd)
  console.log('state raw len=', raw.length)
  try {
    const j = JSON.parse(raw)
    const keys = Object.keys(j)
    console.log('top keys:', keys)
    // readerData / chapterData
    for (const k of keys) {
      const v = JSON.stringify(j[k])
      console.log(`  ${k}: len=${v.length} head=${v.slice(0, 120)}`)
    }
    const rd = j.reader || j.chapter || j.readerData
    if (rd) console.log('\nreader-ish:', JSON.stringify(rd).slice(0, 600))
    const content = j?.chapterData?.content ?? j?.reader?.content
    if (typeof content === 'string') {
      console.log('\nCONTENT len=', content.length, 'head:', content.slice(0, 300))
    }
  } catch (e: any) {
    console.log('parse err:', e.message)
    console.log('raw head:', raw.slice(0, 500))
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
