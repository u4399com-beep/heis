// ============================================================
// ratelimit-site — 生产级限流模拟源站 (zz-a 校准系统配套)
//
// 模拟真实小说站的四段结构 + 工业级反爬限流建模, 供
// src/lib/crawl/calibrate.ts 校准引擎探测"极限速率/并发"。
//
// 用法:
//   bun scripts/ratelimit-site.ts --port 3040 --profile standard
//   (port 默认 3040; profile ∈ lenient | standard | strict, 默认 standard)
//
// 三档参数表:
//   ┌──────────┬─────────────────────┬───────────────────┬──────────────┬────────────────────────────┐
//   │ profile  │ 60s 滑动窗口(429)   │ 2s 突发窗(429)    │ 封禁升级链   │ 指纹检测                   │
//   ├──────────┼─────────────────────┼───────────────────┼──────────────┼────────────────────────────┤
//   │ lenient  │ >120 请求 → 429     │ 2s>12 请求 → 429  │ 8 次 429 →   │ 无                         │
//   │          │                     │                   │ 临时封 60s   │                            │
//   │ standard │ >60 请求 → 429      │ 2s>6 请求 → 429   │ 5 次 429 →   │ 无                         │
//   │          │                     │                   │ 临时封 60s   │                            │
//   │ strict   │ >30 请求 → 429      │ 2s>3 请求 → 429   │ 3 次 429 →   │ UA 缺失/含 bot|spider|curl │
//   │          │                     │                   │ 临时封 60s   │ |python → 403; 同一 UA 连  │
//   │          │                     │                   │              │ 续 25 次请求 → 403         │
//   └──────────┴─────────────────────┴───────────────────┴──────────────┴────────────────────────────┘
//   封禁升级链(三档同构): 累计收到 429 ≥ 阈值 → 临时封禁 60s(403 + Retry-After: 60)
//   → 解封后再收到 429 ≥ 3 次 → 永久封禁(410 Gone)。
//
// 语义细节:
//  - 所有计数按客户端 IP(x-forwarded-for 头优先, 否则 socket remoteAddress);
//    校准引擎可伪造 xff 头实现"多出口"测试(可选, 单出口即可)。
//  - 滑动窗口/突发窗只记账"通过限流检查"的请求(429 拒绝不占预算, 与 nginx
//    limit_req 语义一致); 429/403/410 响应不写入窗口。
//  - 429 响应带 Retry-After: <窗口重置剩余秒>; 403 带 Retry-After: <封禁剩余秒>;
//    全部内容响应带 X-RateLimit-Remaining 便于观测。
//  - 每个内容请求(含被拒的)带随机 30~80ms 处理延迟模拟真实站点; /stats 观测
//    端点豁免限流与延迟(带外观测, 不污染窗口)。
//
// 页面结构(供校准引擎抓取, 与真实小说站四段同构):
//   GET /list/{page}         → 书籍列表 HTML(8 本书, <a href="/book/{id}">)
//   GET /book/{id}           → 书籍信息页(书名/作者/简介/分类 + /toc/{id} 链接)
//   GET /toc/{id}            → 目录页(每书 60 章, 链接 /chapter/{id}/{n})
//   GET /chapter/{id}/{n}    → 正文页(几段中文正文)
//   GET /stats               → JSON 观测端点 { total, byStatus, windowCount, banned, banActive, ... }
//   POST /reset              → 清空全部 IP 状态与计数(测试/校准可重复性; 豁免限流)
// ============================================================
import http from 'http'

// ---------- 三档限流参数 ----------
interface ProfileCfg {
  windowLimit: number // 60s 滑动窗口容量(超出 → 429)
  windowMs: number
  burstLimit: number // 2s 突发窗容量(超出 → 429)
  burstMs: number
  banThreshold: number // 累计 429 达到该值 → 临时封禁
  banMs: number // 临时封禁时长
  rebanThreshold: number // 解封后再犯(再收 429)该值 → 永久封禁
  fingerprint: boolean // 是否启用 UA 指纹检测(strict)
}

const PROFILES: Record<string, ProfileCfg> = {
  lenient: { windowLimit: 120, windowMs: 60_000, burstLimit: 12, burstMs: 2_000, banThreshold: 8, banMs: 60_000, rebanThreshold: 3, fingerprint: false },
  standard: { windowLimit: 60, windowMs: 60_000, burstLimit: 6, burstMs: 2_000, banThreshold: 5, banMs: 60_000, rebanThreshold: 3, fingerprint: false },
  strict: { windowLimit: 30, windowMs: 60_000, burstLimit: 3, burstMs: 2_000, banThreshold: 3, banMs: 60_000, rebanThreshold: 3, fingerprint: true },
}

// ---------- CLI 参数 ----------
function argOf(name: string, def: string): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const PORT = parseInt(argOf('--port', '3040'), 10) || 3040
const PROFILE_KEY = PROFILES[argOf('--profile', 'standard')] ? argOf('--profile', 'standard') : 'standard'
const P = PROFILES[PROFILE_KEY]

// ---------- 内容数据(8 本书 × 每书 60 章) ----------
const BOOKS: Array<{ name: string; author: string; cat: string; intro: string }> = [
  { name: '溯源记', author: '观山客', cat: '玄幻', intro: '一卷残图引出千年秘辛，少年自边城起行，踏遍山河溯源而上。' },
  { name: '长风渡', author: '江南雨', cat: '武侠', intro: '长风渡口一叶扁舟，载着灭门孤女与落魄刀客，渡尽江湖恩仇。' },
  { name: '星陨大陆', author: '铁马冰河', cat: '奇幻', intro: '星辰坠落的那个夜晚，大陆灵气复苏，凡人亦可执星而行。' },
  { name: '墨色江山', author: '青砚', cat: '历史', intro: '一介书生执笔为刀，在庙堂与烽烟之间，写下半部墨色江山。' },
  { name: '机械之心', author: '齿轮先生', cat: '科幻', intro: '当机械拥有了心跳，人类才第一次真正学会思考自己是什么。' },
  { name: '山海食单', author: '饕小餮', cat: '美食', intro: '以山海经为菜单，把妖兽端上餐桌，这是一间开在结界里的小馆。' },
  { name: '雾都疑云', author: '夜航西飞', cat: '悬疑', intro: '浓雾锁城第七天，第七位失踪者的鞋，整齐地摆在了警局门口。' },
  { name: '剑问长生', author: '白衣沽酒', cat: '仙侠', intro: '修行五百年，他终于有机会问出那个问题：长生究竟是恩赐还是刑罚。' },
]
const CHAPTER_WORDS = ['初入', '相遇', '风波', '线索', '反转', '余波', '夜行', '破局', '山雨', '灯影', '旧约', '新程', '对峙', '真相', '远行', '归途', '终章前夜']
const PARA_SEEDS = [
  '山雨欲来风满楼，他握紧手中的旧伞，一步一步走进巷子深处。',
  '夜色如墨，远处的灯火忽明忽暗，像是谁在用光影打着哑谜。',
  '老人咳了两声，从袖中摸出半块碎银，压在了桌角的账簿下面。',
  '风从海面吹来，带着咸腥味，也带着消息——船队三日后靠岸。',
  '她数着更声走过长街，靴底敲在青石上，一声一声都像是叩门。',
  '卷宗摊开在案上，朱笔悬了许久，终究没有落下去。',
  '钟声撞碎雾气，整座城从睡梦里惊起，又缓缓合上眼睛。',
  '他把信折成方胜塞进瓶里，任它顺水漂向看不见的下一个人。',
]

function chapterTitle(id: number, n: number): string {
  const w = CHAPTER_WORDS[(id * 7 + n * 3) % CHAPTER_WORDS.length]
  return `第${n}章 ${w}`
}

function chapterBody(id: number, n: number): string {
  const paras: string[] = []
  for (let p = 0; p < 4; p++) {
    const a = PARA_SEEDS[(id * 5 + n * 11 + p) % PARA_SEEDS.length]
    const b = PARA_SEEDS[(id * 3 + n * 7 + p + 4) % PARA_SEEDS.length]
    paras.push(`<p>${a}${b}（${BOOKS[(id - 1) % BOOKS.length].name}·${chapterTitle(id, n)}·第${p + 1}段）</p>`)
  }
  return paras.join('\n')
}

const page = {
  list(p: number): string {
    const items = BOOKS.map((b, i) => `<li class="book-item"><a href="/book/${i + 1}">${b.name}</a><span>${b.author}</span></li>`).join('')
    return `<html><head><meta charset="utf-8"><title>书库列表 - 第${p}页</title></head>
<body><h1>书库 · 第${p}页</h1><ul id="list">${items}</ul>
<div class="pager"><a href="/list/${Math.max(1, p - 1)}">上一页</a> <a href="/list/${p + 1}">下一页</a></div></body></html>`
  },
  book(id: number): string {
    const b = BOOKS[(id - 1) % BOOKS.length]
    return `<html><head><meta charset="utf-8"><title>${b.name}</title></head>
<body><div id="maininfo"><h1>${b.name}</h1><p>作者：${b.author}</p><p>分类：${b.cat}</p>
<meta name="keywords" content="${b.name},${b.cat},${b.author}">
<div id="intro">${b.intro}</div>
<a id="toclink" href="/toc/${id}">查看完整目录</a></div></body></html>`
  },
  toc(id: number): string {
    const items = Array.from({ length: 60 }, (_, i) => `<dd><a href="/chapter/${id}/${i + 1}">${chapterTitle(id, i + 1)}</a></dd>`).join('')
    return `<html><head><meta charset="utf-8"><title>目录 - ${BOOKS[(id - 1) % BOOKS.length].name}</title></head>
<body><h1>${BOOKS[(id - 1) % BOOKS.length].name} · 目录(共60章)</h1><dl id="toc">${items}</dl></body></html>`
  },
  chapter(id: number, n: number): string {
    return `<html><head><meta charset="utf-8"><title>${chapterTitle(id, n)}</title></head>
<body><div id="content"><h2>${chapterTitle(id, n)}</h2>
${chapterBody(id, n)}
</div></body></html>`
  },
}

// ---------- 每 IP 限流状态 ----------
interface IpState {
  win: number[] // 60s 滑动窗口(仅记录通过检查的请求时间戳)
  burst: number[] // 2s 突发窗(同上)
  total429: number // 累计收到 429 次数(封禁升级链输入)
  postUnban429: number // 最近一次临时封禁解除后新收到的 429 次数
  banUntil: number // 临时封禁截止时刻(0=未封)
  banCount: number // 已触发临时封禁次数(0/1, 触发过一次后走"再犯"通道)
  permanent: boolean // 永久封禁
  uaStreak: string // strict: 连续相同 UA 记录
  uaStreakCount: number
}

const ipStates = new Map<string, IpState>()

function stateOf(ip: string): IpState {
  let st = ipStates.get(ip)
  if (!st) {
    st = { win: [], burst: [], total429: 0, postUnban429: 0, banUntil: 0, banCount: 0, permanent: false, uaStreak: '', uaStreakCount: 0 }
    ipStates.set(ip, st)
  }
  return st
}

function clientIp(req: http.IncomingMessage): string {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim()
  const ra = req.socket.remoteAddress || 'unknown'
  return ra.replace(/^::ffff:/, '')
}

function prune(arr: number[], now: number, ms: number): void {
  while (arr.length > 0 && arr[0] <= now - ms) arr.shift()
}

// 登记 429(封禁升级链推进); 返回是否因此进入永久封禁
function register429(st: IpState, now: number): boolean {
  st.total429++
  if (st.banCount > 0) {
    st.postUnban429++
    if (st.postUnban429 >= P.rebanThreshold) {
      st.permanent = true
      return true
    }
  }
  if (st.banCount === 0 && st.total429 >= P.banThreshold) {
    st.banUntil = now + P.banMs
    st.banCount = 1
  }
  return false
}

// ---------- 观测计数 ----------
const stats = { total: 0, byStatus: {} as Record<string, number>, banEvents: 0, permanentEvents: 0 }

function bumpStatus(code: number): void {
  stats.total++
  const k = String(code)
  stats.byStatus[k] = (stats.byStatus[k] || 0) + 1
}

// ---------- 响应工具 ----------
const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

function respond(res: http.ServerResponse, code: number, headers: Record<string, string>, body: string, delayMs: number): void {
  setTimeout(() => {
    try {
      res.writeHead(code, headers)
      res.end(body)
    } catch {
      /* 客户端提前断开 */
    }
  }, delayMs)
}

function contentHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close', ...extra }
}

// ---------- 服务器 ----------
const BOOT = Date.now()
const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', `http://localhost:${PORT}`)
  const p = u.pathname
  const now = Date.now()

  // 观测端点: 豁免限流/延迟/计数(带外观测, 不污染窗口)
  if (p === '/reset' && req.method === 'POST') {
    ipStates.clear()
    stats.total = 0
    stats.byStatus = {}
    stats.banEvents = 0
    stats.permanentEvents = 0
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ ok: true, resetAt: new Date().toISOString() }))
    return
  }
  if (p === '/stats') {
    let windowCount = 0
    let tempBanned = 0
    let permBanned = 0
    const perIp: Record<string, unknown> = {}
    for (const [ip, st] of ipStates) {
      prune(st.win, now, P.windowMs)
      windowCount += st.win.length
      if (st.permanent) permBanned++
      else if (st.banUntil > now) tempBanned++
      perIp[ip] = {
        total429: st.total429,
        postUnban429: st.postUnban429,
        banCount: st.banCount,
        banUntil: st.banUntil,
        permanent: st.permanent,
        windowCount: st.win.length,
      }
    }
    const banned = tempBanned + permBanned
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(
      JSON.stringify({
        profile: PROFILE_KEY,
        total: stats.total,
        byStatus: stats.byStatus,
        windowCount,
        banned,
        banActive: banned > 0,
        tempBanned,
        permBanned,
        banEvents: stats.banEvents,
        permanentEvents: stats.permanentEvents,
        perIp,
        uptimeMs: now - BOOT,
      })
    )
    return
  }

  const ip = clientIp(req)
  const st = stateOf(ip)

  // ---- 封禁检查(最高优先级) ----
  if (st.permanent) {
    bumpStatus(410)
    respond(res, 410, contentHeaders({ 'X-RateLimit-Remaining': '0' }), '<html><body><h1>410 Gone</h1><p>该地址已被永久封禁。</p></body></html>', rand(30, 80))
    return
  }
  if (st.banUntil > now) {
    const retryAfter = Math.max(1, Math.ceil((st.banUntil - now) / 1000))
    bumpStatus(403)
    respond(res, 403, contentHeaders({ 'X-RateLimit-Remaining': '0', 'Retry-After': String(retryAfter) }), '<html><body><h1>403 Forbidden</h1><p>访问频率异常，已被临时封禁。</p></body></html>', rand(30, 80))
    return
  }

  // ---- strict: UA 指纹检测 ----
  if (P.fingerprint) {
    const ua = Array.isArray(req.headers['user-agent']) ? req.headers['user-agent'][0] : req.headers['user-agent']
    if (!ua || /bot|spider|curl|python/i.test(ua)) {
      bumpStatus(403)
      respond(res, 403, contentHeaders({ 'X-RateLimit-Remaining': String(Math.max(0, P.windowLimit - st.win.length)) }), '<html><body><h1>403 Forbidden</h1><p>客户端指纹被拒绝。</p></body></html>', rand(30, 80))
      return
    }
    if (ua === st.uaStreak) {
      st.uaStreakCount++
      if (st.uaStreakCount >= 25) {
        bumpStatus(403)
        respond(res, 403, contentHeaders({ 'X-RateLimit-Remaining': String(Math.max(0, P.windowLimit - st.win.length)) }), '<html><body><h1>403 Forbidden</h1><p>UA 指纹单化，已被拦截。</p></body></html>', rand(30, 80))
        return
      }
    } else {
      st.uaStreak = ua
      st.uaStreakCount = 1
    }
  }

  // ---- 2s 突发窗 ----
  prune(st.burst, now, P.burstMs)
  if (st.burst.length >= P.burstLimit) {
    const oldest = st.burst[0]
    const retryAfter = Math.min(3, Math.max(2, Math.ceil((oldest + P.burstMs - now) / 1000)))
    const permanent = register429(st, now)
    if (permanent) stats.permanentEvents++
    if (st.banUntil > now && st.banCount === 1 && st.total429 === P.banThreshold) stats.banEvents++
    bumpStatus(429)
    respond(res, 429, contentHeaders({ 'X-RateLimit-Remaining': '0', 'Retry-After': String(retryAfter) }), '<html><body><h1>429 Too Many Requests</h1><p>突发请求过于密集。</p></body></html>', rand(30, 80))
    return
  }

  // ---- 60s 滑动窗口 ----
  prune(st.win, now, P.windowMs)
  if (st.win.length >= P.windowLimit) {
    const idx = Math.max(0, st.win.length - P.windowLimit)
    const oldest = st.win[idx]
    const retryAfter = Math.max(1, Math.ceil((oldest + P.windowMs - now) / 1000))
    const permanent = register429(st, now)
    if (permanent) stats.permanentEvents++
    if (st.banUntil > now && st.banCount === 1 && st.total429 === P.banThreshold) stats.banEvents++
    bumpStatus(429)
    respond(res, 429, contentHeaders({ 'X-RateLimit-Remaining': '0', 'Retry-After': String(retryAfter) }), '<html><body><h1>429 Too Many Requests</h1><p>请求过于频繁，请稍后再试。</p></body></html>', rand(30, 80))
    return
  }

  // ---- 通过限流: 记账 + 随机处理延迟 + 出页面 ----
  st.win.push(now)
  st.burst.push(now)
  const remaining = Math.max(0, P.windowLimit - st.win.length)

  let code = 200
  let body = ''
  const mList = /^\/list\/(\d+)$/.exec(p)
  const mBook = /^\/book\/(\d+)$/.exec(p)
  const mToc = /^\/toc\/(\d+)$/.exec(p)
  const mChap = /^\/chapter\/(\d+)\/(\d+)$/.exec(p)
  if (mList) {
    body = page.list(parseInt(mList[1], 10) || 1)
  } else if (mBook) {
    body = page.book(parseInt(mBook[1], 10) || 1)
  } else if (mToc) {
    body = page.toc(parseInt(mToc[1], 10) || 1)
  } else if (mChap) {
    body = page.chapter(parseInt(mChap[1], 10) || 1, parseInt(mChap[2], 10) || 1)
  } else {
    code = 404
    body = '<html><body><h1>404 Not Found</h1></body></html>'
  }
  bumpStatus(code)
  respond(res, code, contentHeaders({ 'X-RateLimit-Remaining': String(remaining) }), body, rand(30, 80))
})

server.listen(PORT, () => {
  console.log(`[ratelimit-site] profile=${PROFILE_KEY} window=${P.windowLimit}/${P.windowMs / 1000}s burst=${P.burstLimit}/${P.burstMs / 1000}s ban=${P.banThreshold}x429→${P.banMs / 1000}s→+${P.rebanThreshold}x429→410 · listening on :${PORT}`)
})

export {}
