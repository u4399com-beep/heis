// ============================================================
// rr-a 探针2: deqixs ajax2 "Token验证失败" 假设矩阵
// H1 会话 Cookie(PHPSESSID) 绑定 / H2 chapter.js.php referrer 参数
// H3 ajax2 Referer 头 / H4 X-Requested-With / 组合穷举
// 运行: bun run scripts/probe-rr-a-deqixs2.ts
// ============================================================
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const B = 'https://www.deqixs.cc'
const AID = '126'
const CID = '81417'
const CHAPTER = `${B}/books/${AID}/${CID}.html`

interface Step { cookies: Map<string, string> }

function cookieHeader(c: Map<string, string>): string {
  return [...c.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}
function absorb(res: Response, jar: Map<string, string>) {
  const raw = res.headers.getSetCookie?.() ?? []
  for (const line of raw) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}

async function get(url: string, jar: Map<string, string>, extra: Record<string, string> = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(jar.size ? { Cookie: cookieHeader(jar) } : {}), ...extra },
    signal: AbortSignal.timeout(15000),
  })
  absorb(res, jar)
  return { status: res.status, buf: await res.arrayBuffer(), res }
}

/** 一次完整链路: 章节页(可选) → chapter.js.php(可选 referrer) → ajax2(可选 Referer/XRW) */
async function chain(opts: {
  visitPage: boolean
  referrerParam: boolean
  refererHeader: boolean
  xrw: boolean
  label: string
}) {
  const jar = new Map<string, string>()
  if (opts.visitPage) await get(CHAPTER, jar, { Accept: 'text/html' })
  const refQ = opts.referrerParam ? `&referrer=${encodeURIComponent(CHAPTER)}` : ''
  const js = await get(`${B}/scripts/chapter.js.php?aid=${AID}&cid=${CID}${refQ}`, jar, opts.refererHeader ? { Referer: CHAPTER } : {})
  const jsText = new TextDecoder('utf-8', { fatal: false }).decode(js.buf)
  const token = jsText.match(/chapterToken\s*=\s*'([^']+)'/)?.[1] ?? ''
  const timestamp = jsText.match(/timestamp\s*=\s*(\d+)/)?.[1] ?? ''
  const nonce = jsText.match(/nonce\s*=\s*'([^']+)'/)?.[1] ?? ''
  const q = new URLSearchParams({ aid: AID, cid: CID, token, timestamp, nonce })
  const ajax = await get(`${B}/modules/article/ajax2.php?${q}`, jar, {
    ...(opts.refererHeader ? { Referer: CHAPTER } : {}),
    ...(opts.xrw ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
  })
  const txt = new TextDecoder('gbk', { fatal: false }).decode(ajax.buf)
  let out = ''
  try {
    const j = JSON.parse(txt)
    out = `status=${j.status} contentLen=${j.data?.content?.length ?? 0} msg=${String(j.message ?? '')}`
  } catch {
    out = `非JSON(${txt.length}B)`
  }
  console.log(`[${opts.label}] cookies=${[...jar.keys()].join(',') || '无'} token=${token ? 'OK' : 'EMPTY'} → ${out}`)
  return j_parse(txt)
}
function j_parse(txt: string): { status: number; len: number } {
  try {
    const j = JSON.parse(txt)
    return { status: j.status, len: j.data?.content?.length ?? 0 }
  } catch {
    return { status: -1, len: 0 }
  }
}

// ---- 组合矩阵 ----
await chain({ visitPage: false, referrerParam: false, refererHeader: false, xrw: false, label: '基线(裸, 上一探针已证败) 复测' })
await chain({ visitPage: true, referrerParam: false, refererHeader: false, xrw: false, label: 'H1 只加会话(先访问章节页)' })
await chain({ visitPage: false, referrerParam: true, refererHeader: false, xrw: false, label: 'H2 只加 referrer 参数' })
await chain({ visitPage: false, referrerParam: false, refererHeader: true, xrw: true, label: 'H3+H4 只加 Referer头+XRW' })
await chain({ visitPage: true, referrerParam: true, refererHeader: true, xrw: true, label: '全组合(完全拟真浏览器)' })
await chain({ visitPage: true, referrerParam: true, refererHeader: true, xrw: true, label: '全组合复测(看 token 是否一次性)' })

console.log('\n---- 全组合成功后再验边界 ----')
// 完全拟真后: ①复用同一 token 第二次 ajax2 ②不带 cookie 打 ajax2
{
  const jar = new Map<string, string>()
  await get(CHAPTER, jar, { Accept: 'text/html' })
  const js = await get(`${B}/scripts/chapter.js.php?aid=${AID}&cid=${CID}&referrer=${encodeURIComponent(CHAPTER)}`, jar, { Referer: CHAPTER })
  const jsText = new TextDecoder('utf-8', { fatal: false }).decode(js.buf)
  const token = jsText.match(/chapterToken\s*=\s*'([^']+)'/)?.[1] ?? ''
  const timestamp = jsText.match(/timestamp\s*=\s*(\d+)/)?.[1] ?? ''
  const nonce = jsText.match(/nonce\s*=\s*'([^']+)'/)?.[1] ?? ''
  const mk = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ aid: AID, cid: CID, token, timestamp, nonce })
    return get(`${B}/modules/article/ajax2.php?${q}`, jar, extra)
  }
  const r1 = await mk({ Referer: CHAPTER, 'X-Requested-With': 'XMLHttpRequest' })
  const t1 = new TextDecoder('gbk', { fatal: false }).decode(r1.buf)
  console.log('[拟真#1]', j_parse(t1))
  const r2 = await mk({ Referer: CHAPTER, 'X-Requested-With': 'XMLHttpRequest' })
  console.log('[拟真#2 同token复用]', j_parse(new TextDecoder('gbk', { fatal: false }).decode(r2.buf)))
  const noJar = new Map<string, string>()
  const q = new URLSearchParams({ aid: AID, cid: CID, token, timestamp, nonce })
  const r3 = await get(`${B}/modules/article/ajax2.php?${q}`, noJar, { Referer: CHAPTER })
  console.log('[拟真#3 同token无cookie]', j_parse(new TextDecoder('gbk', { fatal: false }).decode(r3.buf)))
  if (j_parse(t1).status === 1) {
    await Bun.write('/home/z/my-project/scripts/rr-a-deqixs-content-ok.json', t1)
    console.log('成功响应已存 scripts/rr-a-deqixs-content-ok.json')
  }
}
process.exit(0)
