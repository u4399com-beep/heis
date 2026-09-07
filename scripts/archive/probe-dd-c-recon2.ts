// dd-c 侦察探针2: 分类页 item 结构深挖(保存 HTML 到 tmp/dd-c/ 供离线分析)
// 用法: bun run scripts/probe-dd-c-recon2.ts [dafeng|daweixs]   (每站 4 请求)

// 根 tsconfig 不含 @types/bun(cc-d2 裁定), Bun 全局最小类型面(运行时由 bun 提供)
declare const Bun: {
  $(strings: TemplateStringsArray, ...values: unknown[]): { quiet(): Promise<unknown> }
  write(path: string, data: Uint8Array | string): Promise<number>
}


const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const SITES: Record<string, string> = {
  dafeng: 'https://www.dafengdagengren.com',
  daweixs: 'https://www.daweixs.com',
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const GAP = 1500

function decodeAs(buf: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(buf)
  } catch {
    return Buffer.from(buf).toString('utf8')
  }
}

const fffdCount = (s: string) => (s.match(/\uFFFD/g) || []).length

async function rawReq(url: string, cookie?: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...(cookie ? { Cookie: cookie } : {}) },
    redirect: 'manual',
  })
  const buf = new Uint8Array(await res.arrayBuffer())
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const ct = res.headers.get('content-type') ?? ''
  return { status: res.status, ct, buf, setCookies }
}

function metaCharset(buf: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2048))
  return (head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? '').toLowerCase()
}

async function main() {
  const which = process.argv[2] ?? 'dafeng'
  const host = SITES[which]
  const outDir = '/home/z/my-project/tmp/dd-c'
  await Bun.$`mkdir -p ${outDir}`.quiet()

  // [1] 主页(裸) → cookie
  const raw1 = await rawReq(host + '/')
  const jar = raw1.setCookies.map((sc) => sc.split(';')[0]).join('; ')
  console.log(`[1] / status=${raw1.status} bytes=${raw1.buf.length} setCookies=${raw1.setCookies.length}`)
  await Bun.write(`${outDir}/${which}-home.html`, raw1.buf)
  const homeHtml = decodeAs(raw1.buf, metaCharset(raw1.buf) || 'gbk')
  // 宽松 nav 提取: 所有 href 形如 /xxx/ 的锚
  const navs = new Map<string, string>()
  for (const m of homeHtml.matchAll(/<a[^>]*href="(\/[a-z0-9_-]*\/?)"[^>]*>([\s\S]{0,60}?)<\/a>/g)) {
    const label = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim()
    if (label && !navs.has(m[1])) navs.set(m[1], label)
  }
  console.log(`    主页锚点:\n      ${[...navs.entries()].slice(0, 36).map(([p, t]) => `${p} => ${t}`).join('\n      ')}`)
  await sleep(GAP)

  // [2] 分类页
  const raw2 = await rawReq(host + '/xuanhuanxiaoshuo/', jar)
  const cs2 = metaCharset(raw2.buf)
  const t2 = decodeAs(raw2.buf, cs2 || 'gbk')
  console.log(`[2] /xuanhuanxiaoshuo/ status=${raw2.status} bytes=${raw2.buf.length} metaCharset="${cs2 || '(无)'}" FFFD=${fffdCount(t2)} ct="${raw2.ct}"`)
  await Bun.write(`${outDir}/${which}-category.html`, raw2.buf)
  // item 块结构
  const itemIdx = t2.indexOf('class="item"')
  if (itemIdx > 0) {
    console.log('    === 首个 class="item" 附近 900 字符 ===')
    console.log(t2.slice(Math.max(0, itemIdx - 120), itemIdx + 780).replace(/\r/g, ''))
  }
  // 全页 href 形态统计
  const hrefCounts = new Map<string, number>()
  for (const m of t2.matchAll(/href="([^"]+)"/g)) {
    const shape = m[1].replace(/\d+/g, 'N')
    hrefCounts.set(shape, (hrefCounts.get(shape) ?? 0) + 1)
  }
  console.log(`    href形态统计: ${[...hrefCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([s, c]) => `${s}×${c}`).join('  ')}`)
  // 分页区
  const pgIdx = t2.indexOf('下一页')
  if (pgIdx > 0) console.log(`    === 分页区片段 ===\n${t2.slice(pgIdx - 400, pgIdx + 200).replace(/\r/g, '')}`)
  await sleep(GAP)

  // [3] 书籍页(从 item 块提取第一个书籍锚)
  let bookUrl = ''
  const ctx = t2.slice(Math.max(0, itemIdx - 120), itemIdx + 900)
  const bm = ctx.match(/href="([^"]+)"/)
  const allAnchors = [...t2.matchAll(/<a[^>]+href="([^"]+)"[^>]*title="([^"]*)"/g)]
  const pick = allAnchors[0]?.[1] ?? bm?.[1] ?? ''
  if (pick) {
    bookUrl = pick.startsWith('http') ? pick : host + (pick.startsWith('/') ? pick : '/xuanhuanxiaoshuo/' + pick)
  }
  console.log(`[3] 书籍页: ${bookUrl || '(未取得)'}`)
  if (bookUrl) {
    const raw3 = await rawReq(bookUrl, jar)
    const cs3 = metaCharset(raw3.buf)
    const t3 = decodeAs(raw3.buf, cs3 || 'gbk')
    console.log(`    status=${raw3.status} bytes=${raw3.buf.length} metaCharset="${cs3 || '(无)'}" FFFD=${fffdCount(t3)}`)
    await Bun.write(`${outDir}/${which}-book.html`, raw3.buf)
    const h1Idx = t3.search(/<h1/)
    if (h1Idx >= 0) console.log(`    === <h1> 附近 700 字符 ===\n${t3.slice(h1Idx - 60, h1Idx + 640).replace(/\r/g, '')}`)
    const secIdx = t3.indexOf('id="section-list"')
    if (secIdx >= 0) console.log(`    === #section-list 附近 400 字符 ===\n${t3.slice(secIdx - 120, secIdx + 280).replace(/\r/g, '')}`)
    else {
      const listIdx = t3.indexOf('id="list"')
      console.log(`    #section-list 不在; id="list" @${listIdx}`)
      if (listIdx >= 0) console.log(t3.slice(listIdx - 120, listIdx + 320).replace(/\r/g, ''))
    }
    const chapLinks = [...t3.matchAll(/<a[^>]+href="([^"]+\.html)"[^>]*>([^<]{1,40})<\/a>/g)].filter((m) => /[0-9]+\.html$/.test(m[1]))
    console.log(`    章节链接(前3): ${chapLinks.slice(0, 3).map((m) => `${m[1]}(${m[2].trim()})`).join(' | ')}, 去重数=${new Set(chapLinks.map((m) => m[1])).size}`)
    await sleep(GAP)

    // [4] 章节页
    if (chapLinks[0]) {
      const c0 = chapLinks[0][1]
      const cu = c0.startsWith('http') ? c0 : host + (c0.startsWith('/') ? c0 : bookUrl.replace(/[^/]*$/, '') + c0)
      const raw4 = await rawReq(cu, jar)
      const cs4 = metaCharset(raw4.buf)
      const t4 = decodeAs(raw4.buf, cs4 || 'gbk')
      console.log(`[4] 章节页 ${cu}: status=${raw4.status} bytes=${raw4.buf.length} metaCharset="${cs4 || '(无)'}" FFFD=${fffdCount(t4)}`)
      await Bun.write(`${outDir}/${which}-chapter.html`, raw4.buf)
      const cIdx = t4.indexOf('id="content"')
      if (cIdx >= 0) {
        console.log(`    === #content 开头 400 字符 ===\n${t4.slice(cIdx - 40, cIdx + 360).replace(/\r/g, '')}`)
      } else console.log('    id="content" 不在!')
    }
  }
  console.log(`########## 侦察2完成 (${which}) ##########`)
}

main()

export {}
