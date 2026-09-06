// qq-c: fanqie web reader 页正文位置解剖
export {}
const ITEM_ID = '6511978580325433864'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

async function main(): Promise<void> {
  const res = await fetch(`https://fanqienovel.com/reader/${ITEM_ID}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(15000),
  })
  const body = await res.text()
  console.log('len=', body.length)
  // 找正文特征: 已知描述 "春秋，谢。寨北算是流寨"
  const idx = body.indexOf('流寨')
  console.log('流寨 idx=', idx)
  if (idx > 0) console.log('ctx:', body.slice(Math.max(0, idx - 400), idx + 200).replace(/\s+/g, ' '))
  // script 内 INITIAL_STATE
  const si = body.indexOf('__INITIAL_STATE__')
  if (si > 0) console.log('\nINITIAL_STATE ctx:', body.slice(si, si + 300).replace(/\s+/g, ' '))
  // 常见正文容器
  for (const pat of ['mokuai', 'chapter-content', 'article', 'reader-content', 'page-content']) {
    console.log(`pat ${pat}:`, body.includes(pat))
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
