// dd-c 侦察探针3: 收尾核实 — /list/1_{page}.html 第1页形态 / dafeng 书籍页502复测 / dafeng章节页 / daweixs paihangbang
// 用法: bun run scripts/probe-dd-c-recon3.ts   (dafeng +3, daweixs +2 请求)

// 根 tsconfig 不含 @types/bun(cc-d2 裁定), Bun 全局最小类型面(运行时由 bun 提供)
declare const Bun: {
  $(strings: TemplateStringsArray, ...values: unknown[]): { quiet(): Promise<unknown> }
  write(path: string, data: Uint8Array | string): Promise<number>
}


const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const GAP = 1600

function decodeAs(buf: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(buf)
  } catch {
    return Buffer.from(buf).toString('utf8')
  }
}

async function rawReq(url: string, cookie?: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...(cookie ? { Cookie: cookie } : {}) },
    redirect: 'manual',
  })
  const buf = new Uint8Array(await res.arrayBuffer())
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  return { status: res.status, buf, setCookies, finalUrl: res.url }
}

function metaCharset(buf: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2048))
  return (head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? '').toLowerCase()
}

async function grab(url: string, jar?: string): Promise<{ status: number; text: string }> {
  const r = await rawReq(url, jar)
  const t = decodeAs(r.buf, metaCharset(r.buf) || 'gbk')
  return { status: r.status, text: t }
}

async function challengeFirst(host: string): Promise<string> {
  const r = await rawReq(host + '/')
  const jar = r.setCookies.map((sc) => sc.split(';')[0]).join('; ')
  console.log(`  challenge ${host}/: status=${r.status} cookies=${r.setCookies.length}`)
  return jar
}

async function main() {
  // ============ dafeng ============
  const dafeng = 'https://www.dafengdagengren.com'
  console.log('== dafeng ==')
  const jarA = await challengeFirst(dafeng)
  await sleep(GAP)

  const p1 = await grab(`${dafeng}/list/1_1.html`, jarA)
  const row5 = (p1.text.match(/class="txt-list txt-list-row5"/g) || []).length
  const row3 = (p1.text.match(/class="txt-list txt-list-row3"/g) || []).length
  const liCnt = (p1.text.match(/<li>/g) || []).length
  console.log(`[a] /list/1_1.html: status=${p1.status} bytes≈${p1.text.length} row5=${row5} row3=${row3} li=${liCnt}`)
  const pg = (p1.text.match(/当前：(\d+)\/(\d+)/) || [])
  console.log(`    分页指示: 当前=${pg[1]}/${pg[2]}`)
  await sleep(GAP)

  const bk = await grab(`${dafeng}/0_2/`, jarA)
  console.log(`[b] /0_2/ 复测: status=${bk.status} bytes≈${bk.text.length}`)
  if (bk.status === 200) {
    console.log(`    .info=${bk.text.includes('class="info"')} h1书名=${(bk.text.match(/<div class="top">\s*<h1>([^<]*)</) || [])[1] ?? '(?)'} section-list=${bk.text.includes('id="section-list"')} 章节li=${(bk.text.match(/<li><a href="[0-9]+\.html"/g) || []).length}`)
    console.log(`    作者=${(bk.text.match(/作者[:：]\s*([^\s<]{1,30})/) || [])[1]} 类别=${(bk.text.match(/类别[:：]\s*([^\s<]{1,12})/) || [])[1]} 状态=${(bk.text.match(/状态[:：]\s*([^\s<]{1,10})/) || [])[1]}`)
    console.log(`    desc=${bk.text.includes('class="desc')}`)
  } else {
    console.log(`    片段: ${JSON.stringify(bk.text.slice(0, 120))}`)
  }
  await sleep(GAP)

  const ch = await grab(`${dafeng}/0_2/23409004.html`, jarA)
  console.log(`[c] /0_2/23409004.html: status=${ch.status} bytes≈${ch.text.length}`)
  if (ch.status === 200) {
    const ci = ch.text.indexOf('id="content"')
    console.log(`    #content=${ci > 0}`)
    const sample = (ch.text.slice(ci, ci + 400) || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 150)
    console.log(`    正文样本: ${JSON.stringify(sample)}`)
  }
  await Bun.write('/home/z/my-project/tmp/dd-c/dafeng-chapter.html', new TextEncoder().encode(ch.text))

  // ============ daweixs ============
  const daweixs = 'https://www.daweixs.com'
  console.log('== daweixs ==')
  await sleep(GAP)
  const jarB = await challengeFirst(daweixs)
  await sleep(GAP)

  const pb = await grab(`${daweixs}/paihangbang/`, jarB)
  console.log(`[d] /paihangbang/: status=${pb.status} bytes≈${pb.text.length} ${pb.status !== 200 ? JSON.stringify(pb.text.slice(0, 80)) : ''}`)
  await sleep(GAP)

  const p1b = await grab(`${daweixs}/list/1_1.html`, jarB)
  console.log(`[e] /list/1_1.html: status=${p1b.status} row5=${(p1b.text.match(/class="txt-list txt-list-row5"/g) || []).length} li=${(p1b.text.match(/<li>/g) || []).length} 分页=${(p1b.text.match(/当前：(\d+)\/(\d+)/) || []).slice(1).join('/')}`)

  console.log('########## 侦察3完成 ##########')
}

main()

export {}
