/**
 * bqg713(笔趣阁 www.bqg713.cc) AES-token 外置转换代理
 * ============================================================
 * 背景(逆向结论, 2026-cc-d, 已真网验证 200):
 *   - 站点为 SPA 壳(www.bqg713.cc) + 纯 JSON API; 章节正文接口的真实 API 域名
 *     是站点 JS 内置的 site[] 三域名轮换: apibi.cc / apiqu.cc / apige.cc
 *     (www.bqg713.cc/api/chapter 本身就被 CF WAF 403, 属规则侧历史误配)。
 *   - 章节请求形态: GET https://apibi.cc/api/chapter?token=<urlencoded base64>
 *     (携带明文 id/chapterid 参数亦可, 只要 token 合法; 纯明文参数 → 403)。
 *   - token = enaes(JSON.stringify({id, chapterid})):
 *       算法      AES-128-CBC + PKCS7, 密文 Base64(toString() 形态, 无 OpenSSL 盐头)
 *       密钥派生  code = MD5('book@token.html').toString()  // 32 位 hex, 静态
 *                 iv  = Utf8(code[0..16))  = '394c2c3202da6270'
 *                 key = Utf8(code[16..32)) = 'a3dc22cf70418a51'
 *       明文结构  {"id":<number>,"chapterid":<number>}  (键序 id 在前, 必须数字类型)
 *   - 逆向方法: 站点 /js/read.js 混淆段(jsjiami v7)在 bun 中原生执行,
 *     以 CryptoJS.MD5 spy 捕获 enaes 内部真实 seed 输入; 直接调用其混淆字符串
 *     解码器 dec(0x1cb,'0d[v]') 会得到诱饵串('ª²qé)'), 不能作为 seed 来源 ——
 *     行为捕获 + 真网 200 双重验证为准(详见 worklog cc-d)。
 *
 * 对接面(采集引擎 tokenUrl {url} 占位符形态, bb-d 交付):
 *   FetchConfig.tokenUrl     = http://127.0.0.1:3010/rewrite?url={url}
 *   FetchConfig.tokenPattern = token            (本服务返回 JSON 的 token 字段)
 *   FetchConfig.tokenInjection = url            (引擎追加 &token=<enc> 或替换 {token})
 *
 * 接口:
 *   GET /health                  → 健康检查
 *   GET /rewrite?url=<urlenc>    → {ok,id,chapterid,plaintext,token,url}  (url=改写后最终URL)
 *   GET /token?url=<urlenc>      → 纯文本 token(便于 curl 调试)
 *
 * 启动: cd mini-services/bqg713-proxy && bun run dev   (bun --hot 热更, 端口固定 3010)
 */
import { createCipheriv, createHash } from 'node:crypto'

const PORT = Number(process.env.PORT || 3010)

// ---------- enaes 逆向产物 ----------
/** enaes 种子串: 'book' + '@' + 'token' + '.' + 'html'(站点混淆串拼接的有效等价形态) */
const ENAES_SEED = 'book@token.html'
/** code = MD5(seed) hex; 前 16 字符作 IV、后 16 字符作 KEY(均按 UTF-8 字节) —— 静态密钥 */
const CODE_HEX = createHash('md5').update(ENAES_SEED, 'utf8').digest('hex')
const IV = Buffer.from(CODE_HEX.slice(0, 16), 'utf8')
const KEY = Buffer.from(CODE_HEX.slice(16), 'utf8')

/** 与站点 enaes 等价: AES-128-CBC/PKCS7 → Base64 */
export function enaesToken(id: number, chapterid: number): string {
  const plaintext = JSON.stringify({ id, chapterid })
  const cipher = createCipheriv('aes-128-cbc', KEY, IV)
  return Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64')
}

// 启动自检: 与真网 200 验证过的测试向量比对, 不符则大声告警(密钥派生被站点更换时首知于此)
const SELF_TEST_VECTOR = 'b+vXnT3wjuXQsxBmZh033ZjqwezLEinKfOakcVaiDx0='
const selfTest = enaesToken(2530, 1)
const selfTestOk = selfTest === SELF_TEST_VECTOR
// ss-d2⑦: 启动日志不打印 token/iv/key 明文(站点公开常量, 但日志会被 docker logs 存档, 无谓扩散面)
console.log(`[bqg713-proxy] self-test(id=2530,chapterid=1): ${selfTestOk ? 'PASS' : 'FAIL'}`)

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** 从目标 URL 解析 id/chapterid(必须为正整数), 返回 null 表示不可用 */
function parseTarget(raw: string): { target: URL; id: number; chapterid: number } | null {
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return null
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  const id = Number(target.searchParams.get('id'))
  const chapterid = Number(target.searchParams.get('chapterid'))
  if (!Number.isSafeInteger(id) || id <= 0) return null
  if (!Number.isSafeInteger(chapterid) || chapterid <= 0) return null
  return { target, id, chapterid }
}

Bun.serve({
  port: PORT,
  idleTimeout: 30,
  async fetch(req): Promise<Response> {
    const u = new URL(req.url)
    if (u.pathname === '/health') {
      // ss-d2⑦: 不再回显 iv/key(无消费方, grep 全仓实锤; 防开放面无谓扩散密钥材料)
      return json({
        ok: true,
        service: 'bqg713-proxy',
        port: PORT,
        selfTestOk,
        now: new Date().toISOString(),
      })
    }

    if (u.pathname === '/rewrite' || u.pathname === '/token') {
      const raw = u.searchParams.get('url')
      if (!raw) return json({ ok: false, error: 'missing ?url=<urlencoded 目标URL>' }, 400)
      const parsed = parseTarget(raw)
      if (!parsed) {
        // 引擎侧语义: 预取失败 → 静默降级直连, 故非章节形态 URL(如 list/book 段)回 404 即可
        return json({ ok: false, error: '目标 URL 缺少可用的 id/chapterid 查询参数(需正整数)', target: raw }, 404)
      }
      const { target, id, chapterid } = parsed
      const token = enaesToken(id, chapterid)
      // 站点真实请求形态: 仅 token 一个查询参数(base64 经 encodeURIComponent)
      const finalUrl = `${target.origin}${target.pathname}?token=${encodeURIComponent(token)}`
      console.log(`[bqg713-proxy] rewrite id=${id} chapterid=${chapterid} token=${token.slice(0, 12)}...`)
      if (u.pathname === '/token') {
        return new Response(token, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      }
      return json({
        ok: true,
        id,
        chapterid,
        plaintext: JSON.stringify({ id, chapterid }),
        token,
        url: finalUrl,
        target: raw,
      })
    }

    return json({ ok: false, error: 'not found', endpoints: ['/health', '/rewrite?url=', '/token?url='] }, 404)
  },
})

console.log(`[bqg713-proxy] listening on http://127.0.0.1:${PORT} (GET /health | /rewrite?url= | /token?url=)`)
