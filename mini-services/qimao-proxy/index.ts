/**
 * 七猫官方 API 签名+AES 外置转换代理 (qq-d)
 * ============================================================
 * 背景(Legado 书源 yckceo 7698.json「⭐七猫[官方]v3.1✨」反译, 2026-qq-d 真网验证):
 *   - 官方 API 双域名: api-bc.wtzw.com(search/detail/leader-board) + api-ks.wtzw.com(toc/content)
 *   - 全部端点强制验签(实测: search 无sign→44010102 参数错误 / detail→401 /
 *     toc+content→44010120 验签失败):
 *       params.sign  = MD5(按键名排序 k=v 顺序拼接 + sign_key)   —— 逐请求变化
 *       headers.sign = MD5(头组按键名排序 k=v 拼接 + sign_key)   —— 头组静态, 值固定
 *       sign_key = 'd3dGiJc651gSQ8w1' (书源明文内置)
 *   - 正文加密: content API data.content = Base64( IV[16B] + AES-128-CBC/PKCS5Padding 密文 ),
 *     静态密钥 key='242ccb8230d709e1'(16字节 ASCII), IV=密文前16字节随包(实测为 ASCII 数字串)
 *   - 出版书(磨铁等 source 非空)正文解出 EPUB ZIP(PK 魔头), 网文书(source 空)解出纯文本
 *     —— 本代理对 PK 魔头如实返回 ok=false, 规则侧该章 content 为空(诚实留痕)
 *
 * 与采集引擎的对接面(规则六段全部指向本代理, 纯 JSON):
 *   list.urlTemplate   = http://127.0.0.1:3013/rank?rank_type=hot_list&tab_type=1
 *   list.bookUrl(const)= /detail?bid={id}
 *   book/toc/content   = /detail?bid= / /toc?bid= / /content?bid=&cid=
 *
 * 接口:
 *   GET /health                     → {ok,service,selfTestOk,apiReachable,upstream}
 *   GET /search?wd=&page=           → {ok,total,books:[{id,name,author,intro,cover,category,words,status,heat}]}
 *   GET /rank?rank_type=&tab_type=  → 同 /search 形态(leader-board 单页50本, page 参数上游忽略)
 *   GET /detail?bid=                → {ok,book:{id,name,author,intro,cover,status,category,category2,keywords,words,latestChapter,isOver}}
 *   GET /toc?bid=                   → {ok,total,chapters:[{cid,title,words}]}
 *   GET /content?bid=&cid=          → {ok,cid,content}  (content=解密后纯文本 \n 分段)
 *
 * 启动: cd mini-services/qimao-proxy && bun run start   (bun --hot 热更, 端口固定 3013)
 */
import { createCipheriv, createDecipheriv, createHash } from 'node:crypto'

const PORT = Number(process.env.PORT || 3013)
const SIGN_KEY = 'd3dGiJc651gSQ8w1'
const AES_KEY = Buffer.from('242ccb8230d709e1', 'utf8') // 16 字节 ASCII = AES-128
const API_BC = 'https://api-bc.wtzw.com'
const API_KS = 'https://api-ks.wtzw.com'
const IMEI_IP = '2937357107' // 书源内置固定设备参数
const UPSTREAM_UA = 'okhttp/3.12.0'
const UPSTREAM_TIMEOUT_MS = 15000

// ---------- 双签名(书源 searchUrl/ruleBookInfo.tocUrl 原文语义) ----------
// 头组两套: search 用 channel=qm-xiaomi_If, detail/toc/content 用 channel=unknown(书源原文)
const HEADERS_UNK = {
  'app-version': '80400', platform: 'android', reg: '0', AUTHORIZATION: '',
  'application-id': 'com.kmxs.reader', 'net-env': '1', channel: 'unknown', 'qm-params': '',
}
const HEADERS_SEARCH = { ...HEADERS_UNK, channel: 'qm-xiaomi_If' }

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')
/** 头组签名: 按键名排序(默认字典序, 大写在前=书源 Object.keys().sort() 语义) k=v 拼接 + key */
function signHeaders(h: Record<string, string>): Record<string, string> {
  const sign = md5(Object.keys(h).sort().reduce((pre, n) => pre + n + '=' + h[n], '') + SIGN_KEY)
  return { ...h, sign }
}
/** 参数签名: 按键名排序 k=v 拼接 + key */
function signParams(p: Record<string, string | number>): string {
  return md5(Object.keys(p).sort().reduce((pre, n) => pre + n + '=' + String(p[n]), '') + SIGN_KEY)
}
const qs = (p: Record<string, string | number>) =>
  Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')

// ---------- 启动自检: AES 加解密回环(离线确定性, 验证 crypto 接线) ----------
function aesDecrypt(b64: string): { ok: true; text: string } | { ok: false; error: string } {
  try {
    const blob = Buffer.from(b64, 'base64')
    if (blob.length <= 16) return { ok: false, error: '密文过短(无IV)' }
    const iv = blob.subarray(0, 16)
    const d = createDecipheriv('aes-128-cbc', AES_KEY, iv)
    return { ok: true, text: Buffer.concat([d.update(blob.subarray(16)), d.final()]).toString('utf8') }
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) }
  }
}
function aesRoundtripSelfTest(): boolean {
  const iv = Buffer.from('1234567890abcdef', 'utf8')
  const c = createCipheriv('aes-128-cbc', AES_KEY, iv)
  const blob = Buffer.concat([iv, c.update('七猫代理自检-七猫代理自检', 'utf8'), c.final()])
  const r = aesDecrypt(blob.toString('base64'))
  return r.ok && r.text === '七猫代理自检-七猫代理自检'
}
const selfTestOk = aesRoundtripSelfTest()
// ss-d2⑦: 启动日志不打印密钥明文(密钥在源码内已属公开常量, 但日志会被 docker logs 采集存档, 无谓扩散面)
console.log(`[qimao-proxy] self-test(AES-128-CBC 回环): ${selfTestOk ? 'PASS' : 'FAIL'} port=${PORT}`)

// ---------- 上游请求 ----------
// ss-d2④: 5xx/429 属瞬态同样退避重试一次(4xx 验签/参数类为确定性失败, 不重试)
async function upstreamJSON(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; json?: any; error?: string }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { ...headers, 'user-agent': UPSTREAM_UA },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      if ((res.status >= 500 || res.status === 429) && attempt === 1) {
        await res.body?.cancel().catch(() => {}) // 重试前泄掉未消费响应体(连接归还, rr-c3 卫生同款)
        await new Promise((r) => setTimeout(r, 600))
        continue
      }
      const text = await res.text()
      let json: any
      try { json = JSON.parse(text) } catch { return { ok: false, status: res.status, error: `非JSON响应(${text.length}B): ${text.slice(0, 80)}` } }
      if (!res.ok) return { ok: false, status: res.status, json, error: `上游 ${res.status}: ${JSON.stringify(json?.errors || json?.Status || '').slice(0, 120)}` }
      return { ok: true, status: res.status, json }
    } catch (e) {
      if (attempt === 2) return { ok: false, status: -1, error: `上游网络错误: ${String(e).slice(0, 120)}` }
      await new Promise((r) => setTimeout(r, 600)) // 瞬态韧性: 退避后重试一次
    }
  }
  return { ok: false, status: -1, error: 'unreachable' }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

// ---------- 响应归一化 ----------
interface NormBook { id: string; name: string; author: string; intro: string; cover: string; category: string; words: string; status: string; heat: string }
function normBook(b: any): NormBook | null {
  const id = String(b?.id ?? '')
  if (!id || !/^\d+$/.test(id)) return null
  const tags = Array.isArray(b?.ptags) ? b.ptags.join(',') : ''
  const rankTags = Array.isArray(b?.book_tag_list) ? b.book_tag_list.filter((t: any) => typeof t === 'string').join(',') : ''
  // leader-board 项无 author/intro/words_num, 仅 title/id/image_link/sub_title/book_tag_list
  // (sub_title 形态 "扮猪吃虎・连载・1632万字" — 折出状态/字数; 作者/简介由详情段补全)
  const sub = String(b?.sub_title ?? '')
  const wordsFromSub = sub.match(/([\d.]+万?字)/)?.[1] ?? ''
  const statusFromSub = /完结/.test(sub) ? '完结' : /连载/.test(sub) ? '连载中' : ''
  return {
    id,
    name: String(b?.original_title ?? b?.title ?? '').trim(),
    author: String(b?.original_author ?? b?.author ?? '').trim(),
    intro: String(b?.intro ?? '').trim(),
    cover: String(b?.image_link ?? ''),
    category: String(b?.category_over_words ?? b?.category ?? (tags || rankTags)).trim(),
    words: String(b?.words_num ?? b?.words ?? wordsFromSub),
    status: b?.is_over === 1 || b?.is_over === '1' ? '完结' : b?.is_over === 0 || b?.is_over === '0' ? '连载中' : statusFromSub,
    heat: String(b?.heat_number ?? ''),
  }
}
function normBooks(list: any[]): NormBook[] {
  return (Array.isArray(list) ? list : []).map(normBook).filter((b): b is NormBook => !!b)
}

// ---------- 路由 ----------
const seen = new Map<string, number>() // 简易路径健康缓存
let apiReachable = false
let apiLastCheck = 0
/** ss-d2⑤: /health 并发探针在途去重 — 并发冷启动探针共享同一 Promise, 不重复打上游 */
let healthProbe: Promise<void> | null = null

async function handle(req: Request): Promise<Response> {
  const u = new URL(req.url)
  const p = u.pathname

  if (p === '/health') {
    const now = Date.now()
    if (now - apiLastCheck > 60_000 && !healthProbe) {
      healthProbe = (async () => {
        const sp = { gender: '3', imei_ip: IMEI_IP, page: 1, wd: '七猫' }
        const r = await upstreamJSON(`${API_BC}/search/v1/words?${qs({ ...sp, sign: signParams(sp) })}`, signHeaders(HEADERS_SEARCH))
        apiReachable = r.ok && !!r.json?.data?.books
        apiLastCheck = Date.now()
        seen.set('api', r.status)
      })().finally(() => {
        healthProbe = null
      })
    }
    if (healthProbe) await healthProbe
    return json({ ok: true, service: 'qimao-proxy', port: PORT, selfTestOk, apiReachable, upstream: seen.get('api') ?? null, ts: Date.now() })
  }

  try {
    // ── 搜索 ──
    if (p === '/search') {
      const wd = (u.searchParams.get('wd') || '').slice(0, 60)
      const page = Math.max(1, Math.min(100, Number(u.searchParams.get('page') || 1) || 1))
      if (!wd) return json({ ok: false, error: '缺 wd 参数' }, 400)
      const sp = { gender: '3', imei_ip: IMEI_IP, page, wd }
      const r = await upstreamJSON(`${API_BC}/search/v1/words?${qs({ ...sp, sign: signParams(sp) })}`, signHeaders(HEADERS_SEARCH))
      if (!r.ok) return json({ ok: false, error: r.error }, 502)
      const books = normBooks(r.json?.data?.books)
      return json({ ok: true, total: books.length, page, books })
    }

    // ── 排行榜(发现页; 上游 page 参数被忽略, 单页 50 本) ──
    if (p === '/rank') {
      const rp = {
        rank_type: (u.searchParams.get('rank_type') || 'hot_list').slice(0, 40),
        category_id: 0,
        tab_type: Number(u.searchParams.get('tab_type') || 1) || 1,
        category_type: 0,
        imei_ip: IMEI_IP,
        book_privacy: 1,
        read_preference: 0,
      }
      const r = await upstreamJSON(`${API_BC}/api/v1/leader-board?${qs({ ...rp, sign: signParams(rp) })}`, signHeaders(HEADERS_UNK))
      if (!r.ok) return json({ ok: false, error: r.error }, 502)
      const books = normBooks(r.json?.data?.books)
      return json({ ok: true, total: books.length, books })
    }

    // ── 书籍详情 ──
    if (p === '/detail') {
      const bid = u.searchParams.get('bid') || ''
      if (!/^\d+$/.test(bid)) return json({ ok: false, error: 'bid 必须为数字' }, 400)
      const dp = { id: bid, imei_ip: IMEI_IP, teeny_mode: 0 }
      const r = await upstreamJSON(`${API_BC}/api/v4/book/detail?${qs({ ...dp, sign: signParams(dp) })}`, signHeaders(HEADERS_UNK))
      if (!r.ok) return json({ ok: false, error: r.error }, 502)
      const b = r.json?.data?.book
      if (!b) return json({ ok: false, error: '上游 data.book 为空' }, 502)
      const tags = Array.isArray(b.book_tag_list) ? b.book_tag_list.map((t: any) => String(t?.title ?? t)).filter(Boolean).join(',') : ''
      return json({
        ok: true,
        book: {
          id: String(b.id ?? bid),
          name: String(b.title ?? '').trim(),
          author: String(b.author ?? '').trim(),
          intro: String(b.intro ?? '').trim(),
          cover: String(b.image_link ?? ''),
          category: String(b.category1_name ?? '').trim(),
          category2: String(b.category2_name ?? '').trim(),
          keywords: tags,
          words: String(b.words_num ?? ''),
          latestChapter: String(b.latest_chapter_title ?? '').trim(),
          isOver: String(b.is_over ?? ''),
          status: b.is_over === 1 || b.is_over === '1' ? '完结' : b.is_over === 0 || b.is_over === '0' ? '连载中' : '',
        },
      })
    }

    // ── 目录(单次全量) ──
    if (p === '/toc') {
      const bid = u.searchParams.get('bid') || ''
      if (!/^\d+$/.test(bid)) return json({ ok: false, error: 'bid 必须为数字' }, 400)
      const tp = { id: bid }
      const r = await upstreamJSON(`${API_KS}/api/v1/chapter/chapter-list?${qs({ ...tp, sign: signParams(tp) })}`, signHeaders(HEADERS_UNK))
      if (!r.ok) return json({ ok: false, error: r.error }, 502)
      const list = r.json?.data?.chapter_lists
      if (!Array.isArray(list)) return json({ ok: false, error: '上游 data.chapter_lists 非数组' }, 502)
      const chapters = list
        .map((c: any) => ({ cid: String(c?.id ?? ''), title: String(c?.title ?? '').trim(), words: String(c?.words ?? '') }))
        .filter((c) => c.cid && c.title)
      return json({ ok: true, total: chapters.length, chapters })
    }

    // ── 正文(签名 + AES 解密) ──
    if (p === '/content') {
      const bid = u.searchParams.get('bid') || ''
      const cid = u.searchParams.get('cid') || ''
      if (!/^\d+$/.test(bid) || !/^\d+$/.test(cid)) return json({ ok: false, error: 'bid/cid 必须为数字' }, 400)
      const cp = { id: bid, chapterId: cid }
      const r = await upstreamJSON(`${API_KS}/api/v1/chapter/content?${qs({ ...cp, sign: signParams(cp) })}`, signHeaders(HEADERS_UNK))
      if (!r.ok) return json({ ok: false, error: r.error }, 502)
      const content = r.json?.data?.content
      if (typeof content !== 'string' || !content) return json({ ok: false, error: '上游 data.content 为空' }, 502)
      const dec = aesDecrypt(content)
      if (!dec.ok) return json({ ok: false, error: `AES 解密失败: ${dec.error}` }, 502)
      if (dec.text.slice(0, 2) === 'PK') return json({ ok: false, error: '出版书正文为 EPUB 包, 不支持文本提取', cid }, 200)
      return json({ ok: true, cid, content: dec.text })
    }

    return json({ ok: false, error: `未知路径 ${p}` }, 404)
  } catch (e) {
    return json({ ok: false, error: `代理内部错误: ${String(e).slice(0, 160)}` }, 500)
  }
}

// ss-d 实证: Bun.serve 缺省 idleTimeout(~10s) 会杀在途无出字请求 — /health 探针与上游超时 15s×2, 需放宽
Bun.serve({ port: PORT, idleTimeout: 120, fetch: (req) => handle(req) })
console.log(`[qimao-proxy] listening on http://127.0.0.1:${PORT} (upstream: ${API_BC} / ${API_KS})`)
