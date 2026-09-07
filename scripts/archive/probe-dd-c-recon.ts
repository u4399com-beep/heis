// dd-c 侦察探针: dafengdagengren.com / daweixs.com 新模板改版适配侦察
// 用法: bun run scripts/probe-dd-c-recon.ts [dafeng|daweixs]
// 方法: 两步法(首请求收 403 壳 + Set-Cookie → 带 Cookie 二请求), 全程串行 + ≥1.5s 间隔,
//       每站 ≤10 请求(任务上限 15)。编码判定: 同一响应体分别按 GBK/UTF-8 解码数 U+FFFD。
// 产出: 分类页结构 / 书籍页结构 / 目录页 / 章节页 / 分页形态 / 编码结论 / 引擎 fetchPage 抽检。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const SITES: Record<string, string> = {
  dafeng: 'https://www.dafengdagengren.com',
  daweixs: 'https://www.daweixs.com',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const GAP = 1500

function detectCharset(headers: Headers, buf: Uint8Array): string {
  const ct = headers.get('content-type') ?? ''
  const m1 = ct.match(/charset\s*=\s*["']?([\w-]+)/i)
  if (m1) return m1[1].toLowerCase()
  const headStr = new TextDecoder('latin1').decode(buf.slice(0, 2048))
  const m2 = headStr.match(/<meta[^>]+charset=["']?([\w-]+)/i)
  if (m2) return m2[1].toLowerCase()
  return ''
}

function decodeAs(buf: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(buf)
  } catch {
    return Buffer.from(buf).toString('utf8')
  }
}

const fffdCount = (s: string) => (s.match(/\uFFFD/g) || []).length

interface RawResp {
  status: number
  contentType: string
  buf: Uint8Array
  setCookies: string[]
}

async function rawReq(url: string, cookie?: string): Promise<RawResp> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...(cookie ? { Cookie: cookie } : {}) },
    redirect: 'manual',
  })
  const buf = new Uint8Array(await res.arrayBuffer())
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', buf, setCookies }
}

function navAnchors(html: string): string[] {
  const out = new Map<string, string>()
  const re = /<a[^>]+href="(\/[a-z0-9-]*\/)"[^>]*>\s*([^<]{1,16}?)\s*<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (!out.has(m[1])) out.set(m[1], m[2])
  }
  return [...out.entries()].map(([p, t]) => `${p} => ${t}`).slice(0, 40)
}

function count(re: RegExp, s: string): number {
  return (s.match(re) || []).length
}

function toText(r: RawResp, fallbackCharset = 'gbk'): { text: string; declared: string } {
  const declared = detectCharset({ get: () => null } as unknown as Headers, r.buf) || (r.contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase() ?? '')
  return { text: decodeAs(r.buf, declared || fallbackCharset), declared }
}

async function main() {
  const which = process.argv[2] ?? 'dafeng'
  const host = SITES[which]
  if (!host) throw new Error('usage: bun run scripts/probe-dd-c-recon.ts [dafeng|daweixs]')
  console.log(`########## 侦察 ${which} (${host}) ##########`)

  // ---- 第 1 步: 裸首访主页, 收挑战壳 + Set-Cookie (1 请求) ----
  const raw1 = await rawReq(host + '/')
  const { text: t1, declared: d1 } = toText(raw1)
  console.log(`[1] GET / 裸访: status=${raw1.status} bytes=${raw1.buf.length} ct="${raw1.contentType}" declared=${d1 || '(无,按gbk解)'}`)
  console.log(`    GBK解码FFFD=${fffdCount(decodeAs(raw1.buf, 'gbk'))} / UTF8解码FFFD=${fffdCount(decodeAs(raw1.buf, 'utf-8'))}`)
  const title1 = (t1.match(/<title>([^<]*)<\/title>/) || [])[1] ?? ''
  console.log(`    title="${title1}"`)
  console.log(`    meta-charset行: ${(t1.match(/<meta[^>]*charset[^>]*>/i) || ['(无)'])[0].slice(0, 120)}`)
  for (const sc of raw1.setCookies) console.log(`    Set-Cookie: ${sc.slice(0, 100)}`)
  const cookieJar = raw1.setCookies.map((sc) => sc.split(';')[0]).join('; ')
  console.log(`    cookieJar(${cookieJar.length}B)=${cookieJar.slice(0, 140)}`)
  console.log(`    nav锚点(前36):\n      ${navAnchors(t1).join('\n      ')}`)
  await sleep(GAP)

  // ---- 第 2 步: 带 Cookie 打 /paihangbang/(旧 list 段 URL) (1 请求) ----
  const raw2 = await rawReq(host + '/paihangbang/', cookieJar)
  const { text: t2 } = toText(raw2)
  console.log(`[2] GET /paihangbang/ 带Cookie: status=${raw2.status} bytes=${raw2.buf.length} FFFD=${fffdCount(t2)}`)
  if (raw2.status === 200) {
    console.log(`    ul.txt-list出现=${count(/class="txt-list"/g, t2)}; <li>=${count(/<li>/g, t2)}; span.s2 a=${count(/class="s2"><a /g, t2)}`)
    const firstLi = (t2.match(/<li>[\s\S]*?<\/li>/) || [''])[0].replace(/\s+/g, ' ').slice(0, 220)
    console.log(`    首个li片段: ${JSON.stringify(firstLi)}`)
  } else {
    console.log(`    前220字符: ${JSON.stringify(decodeAs(raw2.buf, 'utf-8').slice(0, 220))}`)
  }
  await sleep(GAP)

  // ---- 第 3 步: 带 Cookie 打新分类页 /xuanhuanxiaoshuo/ (1~2 请求) ----
  const raw3 = await rawReq(host + '/xuanhuanxiaoshuo/', cookieJar)
  const { text: t3 } = toText(raw3)
  console.log(`[3] GET /xuanhuanxiaoshuo/ 带Cookie: status=${raw3.status} bytes=${raw3.buf.length} FFFD=${fffdCount(t3)}`)
  let firstBookUrl = ''
  if (raw3.status === 200) {
    const bookLinks = [...t3.matchAll(/<a[^>]+href="((?:\/[0-9_]+\/)|(?:\/book\/[^"]+\/)|(?:\/xiaoshuo\/[^"]+\/))"[^>]*>([^<]{1,40})</g)]
    console.log(`    书籍链接形态样本(共${bookLinks.length}, 前5): ${bookLinks.slice(0, 5).map((m) => `${m[1]}(${m[2].trim()})`).join(' | ')}`)
    for (const sel of ['class="txt-list"', 'class="book-info"', 'class="item"', 'class="l"', '<table', 'class="list"', 'class="novelslist"', 'class="bookbox"', 'class="grid"', 'class="cover"', 'class="bookimg"']) {
      const c = t3.split(sel).length - 1
      if (c > 0) console.log(`    容器嗅探 "${sel}" ×${c}`)
    }
    const pages = [...t3.matchAll(/<a[^>]+href="([^"]*)"[^>]*>(下一页|末页|下页|\[?2\]?)<\/a>/g)].filter((m) => !m[1].endsWith('.html') || /[0-9]/.test(m[1]))
    console.log(`    分页锚点: ${pages.slice(0, 6).map((m) => `${m[2]}=>${m[1]}`).join(' | ') || '(未见明显翻页锚)'}`)
    firstBookUrl = bookLinks[0]?.[1] ?? ''
    const page2 = pages.find((m) => m[2] === '下一页' || m[2] === '下页' || m[1].includes('2'))
    if (page2 && page2[1]) {
      const u = page2[1].startsWith('http') ? page2[1] : host + (page2[1].startsWith('/') ? page2[1] : '/xuanhuanxiaoshuo/' + page2[1])
      await sleep(GAP)
      const rp2 = await rawReq(u, cookieJar)
      const t2p = toText(rp2).text
      const bl2 = [...t2p.matchAll(/<a[^>]+href="((?:\/[0-9_]+\/)|(?:\/book\/[^"]+\/))"/g)].length
      console.log(`    翻页跟随 ${u}: status=${rp2.status} bytes=${rp2.buf.length} 书籍链接数=${bl2}`)
    }
  } else {
    console.log(`    前220字符: ${JSON.stringify(decodeAs(raw3.buf, 'utf-8').slice(0, 220))}`)
  }
  await sleep(GAP)

  // ---- 第 4 步: 书籍页(取分类页第 1 本书) (1 请求) ----
  if (firstBookUrl) {
    const bu = firstBookUrl.startsWith('http') ? firstBookUrl : host + firstBookUrl
    const raw4 = await rawReq(bu, cookieJar)
    const { text: t4 } = toText(raw4)
    console.log(`[4] GET ${bu}: status=${raw4.status} bytes=${raw4.buf.length} FFFD=${fffdCount(t4)}`)
    if (raw4.status === 200) {
      console.log(`    .info出现=${count(/class="info"/g, t4)}; <h1=${count(/<h1/g, t4)}; .desc=${count(/class="desc"/g, t4)}; #section-list=${count(/id="section-list"/g, t4)}; id="list"=${count(/id="list"/g, t4)}`)
      console.log(`    作者regex命中: ${JSON.stringify((t4.match(/作者[:：]\s*([^\s<]{1,30})/) || [])[1] ?? '(无)')}`)
      console.log(`    类别regex命中: ${JSON.stringify((t4.match(/类别[:：]\s*([^\s<]{1,12})/) || [])[1] ?? '(无)')}`)
      console.log(`    状态regex命中: ${JSON.stringify((t4.match(/状态[:：]\s*([^\s<]{1,10})/) || [])[1] ?? '(无)')}`)
      const chapLinks = [...t4.matchAll(/<a[^>]+href="([^"]+\.html)"[^>]*>([^<]{1,40})<\/a>/g)].filter((m) => /[0-9]+\.html$/.test(m[1]))
      console.log(`    章节链接形态样本(前3): ${chapLinks.slice(0, 3).map((m) => `${m[1]}(${m[2].trim()})`).join(' | ')}`)
      const uniqChaps = new Set(chapLinks.map((m) => m[1]))
      console.log(`    书籍页内 .html 章节链接去重数=${uniqChaps.size}`)
      const secList = (t4.match(/<ul[^>]*id="section-list"[\s\S]{0,300}/) || [''])[0]
      if (secList) console.log(`    section-list 开头片段: ${JSON.stringify(secList.slice(0, 240))}`)
      // ---- 第 5 步: 章节页(第一个章节链接) (1 请求) ----
      if (chapLinks[0]) {
        const cu0 = chapLinks[0][1]
        const cu = cu0.startsWith('http') ? cu0 : host + (cu0.startsWith('/') ? cu0 : bu.replace(/[^/]*$/, '') + cu0)
        await sleep(GAP)
        const raw5 = await rawReq(cu, cookieJar)
        const { text: t5 } = toText(raw5)
        console.log(`[5] GET ${cu}: status=${raw5.status} bytes=${raw5.buf.length} FFFD=${fffdCount(t5)}`)
        if (raw5.status === 200) {
          console.log(`    #content出现=${count(/id="content"/g, t5)}; .section-opt=${count(/section-opt/g, t5)}`)
          const contentDiv = (t5.match(/<div[^>]*id="content"[^>]*>([\s\S]{0,500})/) || [''])[1]
          const sampleText = (contentDiv || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)
          console.log(`    正文样本: ${JSON.stringify(sampleText)}`)
        }
      }
    }
  } else {
    console.log('[4] 跳过(分类页未取得书籍链接)')
  }

  // ---- 第 6 步: 引擎 fetchPage 抽检(autoCookie + decodeBuffer 全链路) (1 请求) ----
  await sleep(GAP)
  const { fetchPage } = await import('../src/lib/crawl/fetcher')
  try {
    const er = await fetchPage(host + '/xuanhuanxiaoshuo/', {
      engine: 'http', uaMode: 'rotate', autoCookie: true, referer: true, timeout: 25000, retries: 2, waitMs: 800,
    } as never)
    console.log(`[6] 引擎fetchPage /xuanhuanxiaoshuo/: blocked=${er.blocked} engine=${er.engine} len=${er.html.length} FFFD=${fffdCount(er.html)}`)
    console.log(`    引擎title: ${JSON.stringify((er.html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? '')}`)
  } catch (e) {
    console.log(`[6] 引擎fetchPage 异常: ${(e as Error).message}`)
  }
  console.log(`########## 侦察完成 (${which}, 站点请求≈8) ##########`)
}

main()

export {}
