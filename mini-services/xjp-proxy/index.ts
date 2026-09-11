/**
 * xinjianpan.com(新键盘小说网) 正文双层合并 + var c 解密外置转换代理 (ss-b2)
 * ============================================================
 * 背景(ss-b 探测定性 → ss-b2 离线复现收口, 2026-09-04):
 *   - biquge2023 仿站(类名带部署哈希尾缀 -84c1078c), 列表/书页/目录三段直连零反爬,
 *     正文层"双层": 章节页 #chaptercontent SSR 前半 + <div id="morecontent"> 占位,
 *     后半正文加密在页内内嵌 var c(base64 大串) 中, 由 /public/js/get20260103.js
 *     (jsjiami.com.v7 RC4 字符串混淆) 客户端解密后注入(仅 isMobile()+10s 倒计时后)。
 *   - ★解密算法(ss-b2 对真实样本离线复现 100% 还原, 与 ss-b 反混淆产物对齐):
 *       s      = atob(c)                            // c 为章节页 var c 原文
 *       n      = parseInt(s.substring(8, 11), 10)   // 3 位数字(100..999)校验
 *       payload= s.substring(11 + n, s.length - n)  // 掐头(11+n)去尾(n)
 *       payload= payload.replace(/-/g,'PHA+').replace(/_/g,'8L3A+')
 *       // 标记膨胀: '-' 还原为 base64 组 'PHA+'(=字节 '<p>'), '_' 还原为 '8L3A+'
 *       part2  = utf8(atob(payload))                // <p>分段 HTML
 *     桌面/移动 UA 的章节页 HTML 字节级一致(ss-b2 diff 实证), var c 每章恒定(非每请求随机)。
 *   - 引擎声明式六段不可表达此解密(需 atob+切片+标记膨胀) → 外置转换代理
 *     mini-services/xjp-proxy(端口 3015, deqixs-proxy 同形态)承载全链路。
 *
 * agent-L: 章节分页支持
 *   - 部分长章节在 xinjianpan 上跨多页(每页 ~3KB 正文), 页脚有"下一页"链接指向
 *     `_{N}.html` 后缀的续页(如 /txt/abc/123.html → /txt/abc/123_2.html)。
 *   - 本代理自动检测续页链接并迭代抓取, 合并所有页的 #chaptercontent + var c 解密结果。
 *   - 上限 XJP_MAX_PAGES(默认 10, env 可调)防失控; 超出截断并附 pagesTruncated=true。
 *
 * 与采集引擎的对接面(规则六段: list/book/toc 直连, content 指向本代理):
 *   toc url 字段: attr=onclick, replaceFrom ^location\.href='(.+)'$ →
 *     http://127.0.0.1:3015/content?u=https://www.xinjianpan.com$1
 *
 * 接口:
 *   GET /health                → {ok,service,port,selfTestOk,selfTestDetail,upstreamReachable,upstream,ts}
 *   GET /info                  → {service,version,uptime,config,...}
 *   GET /metrics               → Prometheus 文本
 *   GET /content?u={章节URL}   → {ok,len,content,pages,pagesTruncated?}
 *                                 (content=UTF-8 纯文本 \n 分段; pages=实际抓取页数;
 *                                  pagesTruncated=true 表示触及 XJP_MAX_PAGES 上限被截断)
 *
 * 启动: cd mini-services/xjp-proxy && bun run start   (bun --hot 热更, 端口固定 3015)
 */
import { createBridgeServer, json } from '../_shared/server'

const PORT = Number(process.env.PORT || 3015)
const UPSTREAM = 'https://www.xinjianpan.com'
const UPSTREAM_TIMEOUT_MS = 15000
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
/** ss-d 实证: Bun.serve 缺省 idleTimeout ~10s 会杀在途无出字请求(上游 fetch 最长 15s×2) */
const IDLE_TIMEOUT_S = 120
/** agent-L: 章节分页上限(防失控; env XJP_MAX_PAGES 可调, 上限 50) */
const MAX_PAGES = Math.min(Math.max(Number(process.env.XJP_MAX_PAGES) || 10, 1), 50)

// ---------- 启动自检(离线确定性: 合成 c 全链路回环) ----------
function selfTest(): { ok: boolean; detail: string } {
  const fails: string[] = []
  // ① 合成 c 回环: 明文以 '<p>' 开头 → 其 base64 首 4 字符恒为 'PHA+' → 编码侧替换为 '-',
  //    解码侧应膨胀还原(覆盖 atob→n 解析→边界切片→标记膨胀→UTF-8 全链路)
  const plain = '<p>你好，世界。</p><p>第二章内容验证段落。</p>'
  const b64 = Buffer.from(plain, 'utf-8').toString('base64')
  if (!b64.startsWith('PHA+')) fails.push('合成样本构造(首组非 PHA+)')
  const payloadMarked = b64.replace('PHA+', '-')
  // 包裹形态: 8 任意字符 + 3 位数字 n + n 个任意字符 + payload + n 个任意字符(与真站同构)
  const n = 442
  const s = 'aaaaaaaa' + String(n) + 'b'.repeat(n) + payloadMarked + 'c'.repeat(n)
  const c = Buffer.from(s, 'latin1').toString('base64')
  const round = safeDecryptC(c)
  if (round !== plain) fails.push(`合成c回环(${round.slice(0, 30)})`)
  // ② 边界校验: n 越界(099)应拒绝
  const bad = Buffer.from('aaaaaaaa099' + 'b'.repeat(99) + payloadMarked + 'c'.repeat(99), 'latin1').toString('base64')
  if (safeDecryptC(bad) !== '') fails.push('n<100 未拒绝')
  // ③ HTML→文本
  const conv = htmlToText('<p>你好</p><p>　世界&nbsp;x</p><p></p><p>尾段</p>')
  if (!conv.startsWith('你好\n世界 x\n')) fails.push(`HTML→文本(${JSON.stringify(conv)})`)
  // ④ 章节页抽取: 合成章节页 HTML(#chaptercontent 前半 + morecontent 占位)
  const fakePage = `<div class="content chaptercontent-84c1078c" id="chaptercontent"><p>前半A</p><div id="morecontent"><p>更多内容加载中...</p></div><p>转载尾巴</p></div>`
  const got = extractChapterInner(fakePage)
  if (got.inner !== '<p>前半A</p><p>转载尾巴</p>' || !got.ok) fails.push(`章节抽取(${JSON.stringify(got)})`)
  return { ok: fails.length === 0, detail: fails.length ? fails.join('+') : '合成c回环/n越界拒绝/HTML→文本/章节抽取 4项全过' }
}
const st = selfTest()
console.log(`[xjp-proxy] self-test: ${st.ok ? 'PASS' : 'FAIL'} (${st.detail}) port=${PORT}`)

// ---------- var c 解密(ss-b2 离线复现: get20260103.js php_decrypt_js 等价实现) ----------
/** 解密失败返回 ''(由调用方报错, 不抛) */
function safeDecryptC(c: string): string {
  try {
    const s = Buffer.from(c, 'base64').toString('latin1')
    if (s.length < 32) return ''
    const n = parseInt(s.substring(8, 11), 10)
    if (Number.isNaN(n) || n < 100 || n > 999) return ''
    const head = 11 + n
    const tail = s.length - n
    if (tail <= head) return ''
    const payload = s.substring(head, tail).replace(/-/g, 'PHA+').replace(/_/g, '8L3A+')
    const buf = Buffer.from(payload, 'base64')
    if (buf.length === 0) return ''
    return Buffer.from(buf).toString('utf-8')
  } catch {
    return ''
  }
}

// ---------- 章节页抽取 ----------
/** 从章节页 HTML 提取 #chaptercontent div 内层(div 平衡扫描, 免嵌套正则陷阱)。
 *  真站开标签形态: <div class="content chaptercontent-{hash}" id="chaptercontent">
 *  (class 在前 id 在后 → 以 id="chaptercontent"> 定位内层起点, 与前置属性无关) */
function extractChapterInner(html: string): { ok: boolean; inner: string } {
  const open = 'id="chaptercontent">'
  const start = html.indexOf(open)
  if (start < 0) return { ok: false, inner: '' }
  const i = start + open.length
  let depth = 1
  const re = /<div\b|<\/div>/g
  re.lastIndex = i
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    depth += m[0].startsWith('<div') ? 1 : -1
    if (depth === 0) {
      const inner = html.slice(i, m.index)
      // 摘除 morecontent 占位(SSR 态为"加载中/失败提示", 真后半由 var c 解密补充)
      const stripped = inner.replace(/<div[^>]*id="morecontent"[^>]*>[\s\S]*?<\/div>/, '')
      return { ok: true, inner: stripped }
    }
  }
  return { ok: false, inner: '' }
}

/** HTML 片段 → 纯文本: <p>/<br>断行, 剥标签, 解实体, 压空行, 掐行首空白 */
function htmlToText(html: string): string {
  const t = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    // ss-d2⑥: 实体解码顺序 — &amp; 必须最后解码(防 '&amp;lt;' 被二次解码成 '<')
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

// ---------- 工具 ----------
/** 章节 URL → 校验(仅接受 xinjianpan.com /txt/{code}/{page}[_N].html 形态, 防开放代理滥用)
 *  agent-L: 接受分页形态 {page}_{N}.html(如 123_2.html)。返回归一化后的 URL(去 query/fragment)。 */
function parseChapterUrl(u: string): { ok: boolean; norm: string; pathOnly: string } {
  try {
    const url = new URL(u)
    if (url.hostname !== 'www.xinjianpan.com' && url.hostname !== 'xinjianpan.com') return { ok: false, norm: '', pathOnly: '' }
    // 接受 /txt/{code}/{page}.html 或 /txt/{code}/{page}_{N}.html
    if (!/^\/txt\/[A-Za-z0-9]+\/[A-Za-z0-9]+(?:_\d+)?\.html$/.test(url.pathname)) return { ok: false, norm: '', pathOnly: '' }
    return { ok: true, norm: `${UPSTREAM}${url.pathname}`, pathOnly: url.pathname }
  } catch {
    return { ok: false, norm: '', pathOnly: '' }
  }
}

/** 从章节页 HTML 提取"下一页"链接(agent-L)。
 *  候选选择:
 *    1. <a href="...">下一页</a> / <a href="...">下页</a> / <a href="...">下一章</a>(非下一章链接)
 *    2. .page-next / .nextpage / #nexturl 等常见 class
 *  返回绝对 URL(若相对则按 UPSTREAM 解析); 未找到返回 null。 */
function findNextPageUrl(html: string, currentPagePath: string): string | null {
  // 候选模式: 文本"下一页"/"下页" 的 <a> 标签 href
  // 注意 "下一章" 是不同的语义(下一章节), 不应跟随
  const candidates: RegExp[] = [
    /<a[^>]+href=["']([^"']+)["'][^>]*>\s*(?:下一页|下页|下壹頁|下一頁)\s*<\/a>/i,
    /<a[^>]+class=["'][^"']*(?:nextpage|page-next|next-page|nexturl)[^"']*["'][^>]*href=["']([^"']+)["']/i,
  ]
  for (const re of candidates) {
    const m = re.exec(html)
    if (m && m[1]) {
      const href = m[1]
      // 排除 "javascript:" / "#" 等无效链接
      if (/^(?:javascript|#|void)/i.test(href)) continue
      try {
        // 相对 URL → 基于 UPSTREAM 解析为绝对
        const abs = new URL(href, UPSTREAM).toString()
        // 必须仍在 xinjianpan 域内, 且仍是 /txt/ 路径
        const u = new URL(abs)
        if (u.hostname !== 'www.xinjianpan.com' && u.hostname !== 'xinjianpan.com') continue
        if (!/^\/txt\/[A-Za-z0-9]+\/[A-Za-z0-9]+(?:_\d+)?\.html$/.test(u.pathname)) continue
        // 避免回环: 下一页路径不能等于当前页路径
        if (u.pathname === currentPagePath) continue
        return abs
      } catch {
        continue
      }
    }
  }
  return null
}

/** 带超时+瞬态重试1次的 GET(全态返回, 不抛) */
async function getRes(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; buf: ArrayBuffer; error?: string }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
      return { ok: res.ok, status: res.status, buf: await res.arrayBuffer() }
    } catch (e) {
      if (attempt === 2) return { ok: false, status: -1, buf: new ArrayBuffer(0), error: String(e).slice(0, 120) }
      await new Promise((r) => setTimeout(r, 600))
    }
  }
  return { ok: false, status: -1, buf: new ArrayBuffer(0), error: 'unreachable' }
}

function chapterHeaders(): Record<string, string> {
  return {
    'User-Agent': UA,
    Referer: `${UPSTREAM}/`,
    Accept: 'text/html,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  }
}

// ---------- 核心链路: 章节 URL → 章节页 → 前半SSR + var c 解密后半 → 纯文本 ----------
type ContentResult =
  | { ok: true; content: string; pages: number; pagesTruncated: boolean }
  | { ok: false; error: string }

/** 抓取单页并提取其前半+var c 后半(agent-L: 抽取自原 fetchContent, 供分页循环复用) */
async function fetchOnePage(pageUrl: string, pagePath: string): Promise<
  | { ok: true; content: string; nextUrl: string | null }
  | { ok: false; error: string }
> {
  const res = await getRes(pageUrl, chapterHeaders())
  if (!res.ok) return { ok: false, error: `章节页上游失败(${res.status}${res.error ? ' ' + res.error : ''})` }
  const html = new TextDecoder('utf-8', { fatal: false }).decode(res.buf)

  // ① 前半: #chaptercontent 内层(已摘 morecontent 占位)
  const got = extractChapterInner(html)
  if (!got.ok) return { ok: false, error: '#chaptercontent 未找到(结构变更/风控页?)' }

  // ② 后半: var c 解密(缺 c 视为结构变更)
  const c = /var c="([^"]+)"/.exec(html)?.[1] ?? ''
  if (!c) return { ok: false, error: 'var c 未找到(结构变更?)' }
  const part2 = safeDecryptC(c)
  if (!part2) return { ok: false, error: 'var c 解密失败(算法失配/样本异常)' }

  // ③ 合并 → 纯文本(站点头尾广告行由规则 clean.adPatterns 过滤)
  const content = htmlToText(got.inner + part2)

  // ④ 探测下一页链接(agent-L: 分页支持)
  const nextUrl = findNextPageUrl(html, pagePath)
  return { ok: true, content, nextUrl }
}

/** 主链路: 抓取章节首页, 若有下一页则迭代抓取并合并, 最多 MAX_PAGES 页(agent-L) */
async function fetchContent(chapterUrl: string): Promise<ContentResult> {
  const pc = parseChapterUrl(chapterUrl)
  if (!pc.ok) return { ok: false, error: `u 必须为 xinjianpan 章节页 URL(/txt/{code}/{page}.html), 收到: ${chapterUrl.slice(0, 120)}` }

  const allParts: string[] = []
  let pages = 0
  let pagesTruncated = false
  let currentUrl: string | null = pc.norm
  let currentPath: string = pc.pathOnly
  const visited = new Set<string>([currentPath])

  while (currentUrl && pages < MAX_PAGES) {
    const r = await fetchOnePage(currentUrl, currentPath)
    if (!r.ok) {
      // 首页失败直接返回错误; 续页失败返回已合并的部分内容 + 错误标注
      if (pages === 0) return { ok: false, error: r.error }
      // 续页失败: 截断但保留已抓取内容
      pagesTruncated = true
      break
    }
    allParts.push(r.content)
    pages++

    if (!r.nextUrl) break
    // 解析下一页 path 并检查是否回环
    const nextPath = (() => {
      try { return new URL(r.nextUrl).pathname } catch { return '' }
    })()
    if (!nextPath || visited.has(nextPath)) break
    visited.add(nextPath)
    currentUrl = r.nextUrl
    currentPath = nextPath
  }
  if (pages >= MAX_PAGES && currentUrl) pagesTruncated = true

  const merged = allParts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  return { ok: true, content: merged, pages, pagesTruncated }
}

// ---------- 路由 ----------
let upstreamReachable = false
let upstreamStatus: number | null = null
let lastProbe = 0

/** /health 健康检查回调: 在 60s 缓存窗口外探测上游可达性, 返回快照 */
async function healthCheck(): Promise<Record<string, unknown>> {
  const now = Date.now()
  if (now - lastProbe > 60_000) {
    // 可达性探针: 首页仅 ~55KB 且无业务副作用
    const r = await getRes(`${UPSTREAM}/`, { 'User-Agent': UA })
    const body = r.ok ? new TextDecoder('utf-8', { fatal: false }).decode(r.buf) : ''
    upstreamReachable = r.ok && body.includes('新键盘小说网')
    upstreamStatus = r.status
    lastProbe = now
  }
  return { upstreamReachable, upstream: upstreamStatus }
}

async function handle(req: Request): Promise<Response> {
  const u = new URL(req.url)
  const p = u.pathname

  if (p === '/content') {
    const target = u.searchParams.get('u') || ''
    if (!target) return json({ ok: false, error: '缺 u 参数(章节URL)' }, 400)
    try {
      const r = await fetchContent(target)
      if (!r.ok) return json(r, 502)
      return json({ ok: true, len: r.content.length, content: r.content, pages: r.pages, pagesTruncated: r.pagesTruncated })
    } catch (e) {
      return json({ ok: false, error: `代理内部错误: ${String(e).slice(0, 160)}` }, 500)
    }
  }

  return json({ ok: false, error: `未知路径 ${p}(可用: /health /info /metrics /content?u=)` }, 404)
}

// 1-c 重构: 改用 _shared/server 的 createBridgeServer, 始终绑定 127.0.0.1(H4 修复)
createBridgeServer({
  name: 'xjp-proxy',
  port: PORT,
  version: '1.1.0',
  idleTimeoutS: IDLE_TIMEOUT_S,
  selfTest: () => st.ok,
  healthCheck,
  extraInfo: () => ({
    upstream: UPSTREAM,
    maxPages: MAX_PAGES,
    endpoints: ['/health', '/info', '/metrics', '/content?u='],
  }),
  fetch: (req) => handle(req),
})
console.log(`[xjp-proxy] upstream: ${UPSTREAM}  selfTestDetail: ${st.detail}  maxPages: ${MAX_PAGES}`)
