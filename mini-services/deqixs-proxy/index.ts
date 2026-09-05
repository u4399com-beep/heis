/**
 * deqixs.cc 正文三参数动态签名外置转换代理 (rr-a)
 * ============================================================
 * 背景(worklog qq-b 探测定性 → rr-a 重新实测收口, 2026-09-04):
 *   - deqixs.cc 杰奇系: 列表/书页/目录三段直连可用, 正文层双墙:
 *     ①章节页 div#chapter-content SSR 为空, 20KB 内联渲染脚本按 24 行/页懒加载
 *     ②真实内容 = /scripts/chapter.js.php?aid&cid&referrer → 三参数
 *       (chapterToken 32hex + timestamp 13位ms + nonce 8hex) →
 *       /modules/article/ajax2.php?aid&cid&token&timestamp&nonce → GBK JSON
 *       {status:1, data.content: 全文HTML(<br/>分段)}
 *   - ★ajax2 三重校验(rr-a 实测, qq-b 时代"裸三参数即成"已失效):
 *       1) 缺 X-Requested-With / Referer 头        → {"status":0,"message":"仅支持网页端访问"}
 *       2) Referer 头 ≠ 签发时的 referrer 参数值    → {"status":0,"message":"Token验证失败"}
 *          (token 与 chapter.js.php 调用时携带的 referrer 查询参数值绑定, 每章独立)
 *       3) timestamp 限时(旧时间戳)                 → {"status":0,"message":"请求已过期"}
 *       → 每章动态三参数, 引擎 token 预取钩子(单 token 槽位)不可表达 → 外置转换代理
 *   - GBK 解码: Bun TextDecoder('gbk') 实测通过(中文回环+真实响应), 免 iconv-lite
 *
 * 与采集引擎的对接面(deqixs 规则六段: list/book/toc 直连 deqixs.cc, content 指本代理):
 *   content.fields.url (const) = http://127.0.0.1:3014/content?u={章节URL}
 *
 * 接口:
 *   GET /health                → {ok,service,port,selfTestOk,upstreamReachable,upstream,ts}
 *   GET /content?u={章节URL}   → {ok,aid,cid,len,content}  (content=UTF-8 纯文本 \n 分段)
 *
 * 启动: cd mini-services/deqixs-proxy && bun run start   (bun --hot 热更, 端口固定 3014)
 */
const PORT = Number(process.env.PORT || 3014)
const UPSTREAM = 'https://www.deqixs.cc'
const UPSTREAM_TIMEOUT_MS = 15000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
/** 自检/可达性探针用固定章节(书126第一章, 11KB 正文) */
const PROBE_AID = '126'
const PROBE_CID = '81417'

// ---------- GBK 解码 ----------
// bun 运行时 TextDecoder('gbk') 实测支持(rr-a 中文回环+真站响应双验), 但 @types/bun 的
// Encoding 联合未收录 gbk 标签 → 收口单点 cast(免 iconv-lite 依赖)
const GBK = 'gbk' as never

// ---------- 启动自检(离线确定性: GBK 解码 + 三参数提取 + JSON 解析 + HTML→文本) ----------
function selfTest(): { ok: boolean; detail: string } {
  const fails: string[] = []
  // ① GBK 解码: "中文" 的 GBK 字节
  const gbk = new TextDecoder(GBK).decode(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))
  if (gbk !== '中文') fails.push('GBK解码')
  // ② chapter.js.php 三参数提取(与真站响应同构的样例)
  const jsBody = `var chapterToken = '975a047fddd2c1f188e0d1ef6beaae9d';\nvar timestamp = 1788519451000;\nvar nonce = '91fdf006';\nvar tokenUrl = '';\n`
  const token = jsBody.match(/chapterToken\s*=\s*'([^']+)'/)?.[1] ?? ''
  const ts = jsBody.match(/timestamp\s*=\s*(\d+)/)?.[1] ?? ''
  const nonce = jsBody.match(/nonce\s*=\s*'([^']+)'/)?.[1] ?? ''
  if (token !== '975a047fddd2c1f188e0d1ef6beaae9d' || ts !== '1788519451000' || nonce !== '91fdf006') fails.push('三参数提取')
  // ③ GBK 编码的 JSON 响应解析(模拟 ajax2 返回: {"status":1,"data":{"content":"你好<br/>世界"}} 的 GBK 字节)
  const canned = new Uint8Array([
    0x7b, 0x22, 0x73, 0x74, 0x61, 0x74, 0x75, 0x73, 0x22, 0x3a, 0x31, 0x2c, 0x22, 0x64, 0x61, 0x74, 0x61, 0x22, 0x3a, 0x7b,
    0x22, 0x63, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x22, 0x3a, 0x22, 0xc4, 0xe3, 0xba, 0xc3, 0x3c, 0x62, 0x72, 0x2f, 0x3e,
    0xca, 0xc0, 0xbd, 0xe7, 0x22, 0x7d, 0x7d,
  ])
  try {
    const j = JSON.parse(new TextDecoder(GBK).decode(canned)) as { status: number; data: { content: string } }
    if (j.status !== 1 || j.data.content !== '你好<br/>世界') fails.push('GBK-JSON解析')
  } catch {
    fails.push('GBK-JSON解析(异常)')
  }
  // ④ HTML→文本转换(含 ss-d2⑥ 双解码防线: &amp; 最后解码, 'a&amp;lt;b' → 'a&lt;b' 而非 'a<b')
  const conv = htmlToText('你好<br />  世界<b>x</b><br/><br/><br/> tail&nbsp;end')
  if (conv !== '你好\n世界x\n\ntail end') fails.push(`HTML→文本(${JSON.stringify(conv)})`)
  const dd = htmlToText('a&amp;lt;b&amp;gt;c')
  if (dd !== 'a&lt;b&gt;c') fails.push(`HTML→文本双解码(${JSON.stringify(dd)})`)
  // ⑤ 章节 URL 解析
  const pc = parseChapterUrl('https://www.deqixs.cc/books/126/81417.html')
  if (!pc || pc.aid !== '126' || pc.cid !== '81417') fails.push('章节URL解析')
  return { ok: fails.length === 0, detail: fails.length ? fails.join('+') : 'GBK解码/三参数提取/GBK-JSON解析/HTML→文本(含双解码)/URL解析 6项全过' }
}
const st = selfTest()
console.log(`[deqixs-proxy] self-test: ${st.ok ? 'PASS' : 'FAIL'} (${st.detail}) port=${PORT}`)

// ---------- 工具 ----------
/** 章节 URL → {aid, cid} (仅接受 /books/{aid}/{cid}.html 形态, 防开放代理滥用) */
function parseChapterUrl(u: string): { aid: string; cid: string } | null {
  try {
    const url = new URL(u)
    if (url.hostname !== 'www.deqixs.cc' && url.hostname !== 'deqixs.cc') return null
    const m = url.pathname.match(/^\/books\/(\d+)\/(\d+)\.html$/)
    if (!m) return null
    return { aid: m[1], cid: m[2] }
  } catch {
    return null
  }
}

/** ajax2 content HTML片段 → 纯文本: <br>/<p>断行, 剥标签, 解实体, 压空行, 掐行首空白 */
function htmlToText(html: string): string {
  const t = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    // ss-d2⑥: 实体解码顺序 — &amp; 必须最后解码。若先解 &amp; 则 '&amp;lt;' 先变 '&lt;'
    // 再被后面的 &lt; 规则二次解码成 '<', 用户正文里的字面展示文本会被静默改写
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
  return t
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 带超时+瞬态重试1次的 GET(全态返回, 不抛); ss-d2④: 5xx/429 属瞬态同样重试, 4xx 确定性失败不重试 */
async function getRes(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; buf: ArrayBuffer; error?: string }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
      if ((res.status >= 500 || res.status === 429) && attempt === 1) {
        await res.body?.cancel().catch(() => {}) // 重试前泄掉未消费响应体(连接归还, rr-c3 卫生同款)
        await new Promise((r) => setTimeout(r, 600))
        continue
      }
      return { ok: res.ok, status: res.status, buf: await res.arrayBuffer() }
    } catch (e) {
      if (attempt === 2) return { ok: false, status: -1, buf: new ArrayBuffer(0), error: String(e).slice(0, 120) }
      await new Promise((r) => setTimeout(r, 600))
    }
  }
  return { ok: false, status: -1, buf: new ArrayBuffer(0), error: 'unreachable' }
}

/** 章节页头组: UA+Referer+XRW 三件套(ajax2 网页端校验的最低要求, rr-a 实测) */
function chapterHeaders(chapterUrl: string): Record<string, string> {
  return {
    'User-Agent': UA,
    Referer: chapterUrl,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  }
}

// ---------- 核心链路: 章节 URL → 三参数 → GBK-JSON → 纯文本 ----------
type ContentResult = { ok: true; aid: string; cid: string; content: string } | { ok: false; error: string; aid?: string; cid?: string }

async function fetchContent(chapterUrl: string): Promise<ContentResult> {
  const pc = parseChapterUrl(chapterUrl)
  if (!pc) return { ok: false, error: `u 必须为 deqixs 章节页 URL(/books/{aid}/{cid}.html), 收到: ${chapterUrl.slice(0, 120)}` }
  const { aid, cid } = pc
  const headers = chapterHeaders(chapterUrl)

  // ① 三参数签发: chapter.js.php(referrer 参数值=章节URL, 与后续 Referer 头严格一致)
  const jsUrl = `${UPSTREAM}/scripts/chapter.js.php?aid=${aid}&cid=${cid}&referrer=${encodeURIComponent(chapterUrl)}`
  const js1 = await getRes(jsUrl, headers)
  if (!js1.ok) return { ok: false, error: `chapter.js.php 上游失败(${js1.status}${js1.error ? ' ' + js1.error : ''})`, aid, cid }
  const jsText = new TextDecoder('utf-8', { fatal: false }).decode(js1.buf)
  const token = jsText.match(/chapterToken\s*=\s*'([^']+)'/)?.[1] ?? ''
  const timestamp = jsText.match(/timestamp\s*=\s*(\d+)/)?.[1] ?? ''
  const nonce = jsText.match(/nonce\s*=\s*'([^']+)'/)?.[1] ?? ''
  if (!token || !timestamp || !nonce) {
    return { ok: false, error: `三参数提取失败(token=${token ? 'OK' : '空'}/ts=${timestamp ? 'OK' : '空'}/nonce=${nonce ? 'OK' : '空'}), 响应头120B: ${jsText.slice(0, 120)}`, aid, cid }
  }

  // ② 正文: ajax2.php(GBK JSON), Referer 必须与①的 referrer 值一致(token 绑定校验)
  const q = new URLSearchParams({ aid, cid, token, timestamp, nonce })
  const aj = await getRes(`${UPSTREAM}/modules/article/ajax2.php?${q}`, headers)
  if (!aj.ok) return { ok: false, error: `ajax2.php 上游失败(${aj.status}${aj.error ? ' ' + aj.error : ''})`, aid, cid }
  const bodyText = new TextDecoder(GBK, { fatal: false }).decode(aj.buf)
  let json: { status?: number; message?: string; data?: { content?: string } }
  try {
    json = JSON.parse(bodyText)
  } catch {
    return { ok: false, error: `ajax2.php 响应非JSON(${bodyText.length}B): ${bodyText.slice(0, 80)}`, aid, cid }
  }
  if (json.status !== 1 || typeof json.data?.content !== 'string' || !json.data.content) {
    return { ok: false, error: `ajax2.php 业务失败(status=${json.status}, message=${json.message ?? ''})`, aid, cid }
  }
  return { ok: true, aid, cid, content: htmlToText(json.data.content) }
}

// ---------- 路由 ----------
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

let upstreamReachable = false
let upstreamStatus: number | null = null
let lastProbe = 0
/** ss-d2⑤: /health 并发探针在途去重 — 并发冷启动探针共享同一 Promise, 不重复打上游 */
let healthProbe: Promise<void> | null = null

async function handle(req: Request): Promise<Response> {
  const u = new URL(req.url)
  const p = u.pathname

  if (p === '/health') {
    const now = Date.now()
    if (now - lastProbe > 60_000 && !healthProbe) {
      healthProbe = (async () => {
        // 可达性探针: chapter.js.php 仅 159B, 不打 ajax2(避免自检流量惊动上游)
        const r = await getRes(`${UPSTREAM}/scripts/chapter.js.php?aid=${PROBE_AID}&cid=${PROBE_CID}`, {
          'User-Agent': UA,
          Referer: `${UPSTREAM}/books/${PROBE_AID}/${PROBE_CID}.html`,
        })
        const body = r.ok ? new TextDecoder('utf-8', { fatal: false }).decode(r.buf) : ''
        upstreamReachable = r.ok && body.includes('chapterToken')
        upstreamStatus = r.status
        lastProbe = Date.now()
      })().finally(() => {
        healthProbe = null
      })
    }
    if (healthProbe) await healthProbe
    return json({ ok: true, service: 'deqixs-proxy', port: PORT, selfTestOk: st.ok, selfTestDetail: st.detail, upstreamReachable, upstream: upstreamStatus, ts: Date.now() })
  }

  if (p === '/content') {
    const target = u.searchParams.get('u') || ''
    if (!target) return json({ ok: false, error: '缺 u 参数(章节URL)' }, 400)
    try {
      const r = await fetchContent(target)
      if (!r.ok) return json(r, 502)
      return json({ ok: true, aid: r.aid, cid: r.cid, len: r.content.length, content: r.content })
    } catch (e) {
      return json({ ok: false, error: `代理内部错误: ${String(e).slice(0, 160)}` }, 500)
    }
  }

  return json({ ok: false, error: `未知路径 ${p}(可用: /health /content?u=)` }, 404)
}

// ss-d 实证: Bun.serve 缺省 idleTimeout(~10s) 会杀在途无出字请求 — 本链路两步各 15s 超时, 需放宽
Bun.serve({ port: PORT, idleTimeout: 120, fetch: (req) => handle(req) })
console.log(`[deqixs-proxy] listening on http://127.0.0.1:${PORT} (upstream: ${UPSTREAM})`)
