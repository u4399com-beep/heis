// qq-c: 番茄官方 App 端点直连侦察(社区已知形态) — 不带签名先试
export {}
const BOOK_ID = '6511963569901276163' // 剑仙
const UA = 'Mozilla/5.0 (Linux; Android 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.99 Safari/537.36'

interface Ep { label: string; url: string }
const EPS: Ep[] = [
  { label: 'reader/full/v1(正文)', url: `https://api5-normal-lf.fqnovel.com/reading/reader/full/v1/?item_id=6511978580325433864&aid=1967&channel=0&os_version=0&device_type=Android&device_platform=android&iid=466614321180296&passback={}` },
  { label: 'directory/all_items(目录)', url: `https://api5-normal-lf.fqnovel.com/reading/bookapi/directory/all_items/v/?book_id=${BOOK_ID}&aid=1967&channel=0&os_version=0&device_type=Android&device_platform=android&iid=466614321180296` },
  { label: 'bookapi/detail(详情)', url: `https://api5-normal-lf.fqnovel.com/reading/bookapi/detail/v/?book_id=${BOOK_ID}&aid=1967&channel=0&os_version=0&device_type=Android&device_platform=android&iid=466614321180296` },
  { label: 'reader/multi(批量正文)', url: `https://api5-normal-lf.fqnovel.com/reading/reader/multi/v1/?item_id=6511978580325433864&aid=1967&channel=0&os_version=0&device_type=Android&device_platform=android&iid=466614321180296` },
  { label: 'bff item_content_full', url: `https://api5-normal-lf.fqnovel.com/reading/reader/bff/fq/v1/item_content_full?item_id=6511978580325433864&book_id=${BOOK_ID}&aid=1967&channel=0&os_version=0&device_type=Android&device_platform=android&iid=466614321180296` },
  { label: 'api-normal-lf.yinghua(镜像域)', url: `https://api5-normal-lf.yinghuafqnovel.com/reading/reader/full/v1/?item_id=6511978580325433864&aid=1967` },
]

async function main(): Promise<void> {
  for (const ep of EPS) {
    const t0 = Date.now()
    try {
      const res = await fetch(ep.url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      })
      const body = await res.text()
      let head = body.slice(0, 220).replace(/\s+/g, ' ')
      try {
        const j = JSON.parse(body)
        head = `code=${j.code ?? j.status_code ?? '?'} message=${j.message ?? j.data?.message ?? ''} keys=${Object.keys(j.data || j).slice(0, 8).join(',')}`
        const content = j?.data?.content ?? j?.data?.item?.content ?? j?.data?.content_data?.content
        if (typeof content === 'string') head += ` contentLen=${content.length}`
      } catch { /* keep raw */ }
      console.log(`\n== ${ep.label}\n   http=${res.status} ms=${Date.now() - t0} len=${body.length}\n   ${head}`)
    } catch (e: any) {
      console.log(`\n== ${ep.label}\n   ERR ms=${Date.now() - t0}: ${e?.message?.slice(0, 100)}`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
