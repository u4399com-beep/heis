// bb-b 探针: 验证项目 fetchPage(auto) 能否破解 daweixs.com / dafengdagengren.com 的
// 110字节 403 双 Set-Cookie 挑战(md5 壳 Cookie + server_name_session 会话 Cookie)。
// 机制假设: HTTP 首访 403 种 2 枚 Cookie → 带 Cookie 二连 200(curl 实测成立)。
// 按 aa-b 范式: 显式 process.exit(0) 释放 obscura 单例不阻塞 bun 事件循环。
import { fetchPage, fetchHttpWithCurlFallback, cookieJar, UA_POOL } from '../src/lib/crawl/fetcher'
import { DEFAULT_FETCH_CONFIG } from '../src/lib/crawl/types'

const SITES = [
  'https://www.daweixs.com/',
  'https://www.dafengdagengren.com/',
]

async function main() {
  for (const url of SITES) {
    const origin = new URL(url).origin
    console.log(`\n===== ${url} =====`)
    // 0) 裸 bun fetch 信号探测(不走引擎): 确认 TLS 指纹是否被 WAF 区别对待
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA_POOL[0], Accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
      })
      const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : []
      console.log(`[0] bun raw fetch: status=${r.status} setCookies=${sc.length}`)
    } catch (e: any) {
      console.log(`[0] bun raw fetch ERROR: ${e?.message}`)
    }
    // 1) 引擎 auto 模式完整链(cookie 重试 → obscura → 裸 Playwright)
    try {
      const t0 = Date.now()
      const res = await fetchPage(url, { engine: 'auto', timeout: 25000, retries: 2, autoCookie: true, referer: true })
      console.log(`[1] fetchPage(auto): engine=${res.engine} blocked=${res.blocked} htmlLen=${res.html.length} ${Date.now() - t0}ms`)
      const m = res.html.match(/<title[^>]*>([^<]*)<\/title>/i)
      console.log(`    title=${JSON.stringify(m?.[1] ?? '')}`)
      console.log(`    head=${JSON.stringify(res.html.slice(0, 160))}`)
    } catch (e: any) {
      console.log(`[1] fetchPage(auto) ERROR: ${String(e?.message).slice(0, 200)}`)
    }
    // 2) 罐内 Cookie 复核 + 第二次调用(http 引擎直连, 验证会话续用)
    console.log(`[2] cookieJar(${origin}).count = ${cookieJar.count(origin)}`)
    try {
      const t0 = Date.now()
      const res = await fetchPage(url, { engine: 'http', timeout: 25000, retries: 1, autoCookie: true, referer: true })
      console.log(`[2] fetchPage(http 2nd): engine=${res.engine} blocked=${res.blocked} htmlLen=${res.html.length} ${Date.now() - t0}ms`)
    } catch (e: any) {
      console.log(`[2] fetchPage(http 2nd) ERROR: ${String(e?.message).slice(0, 200)}`)
    }
    // 3) 子路径同拦测试(挑战是否站级)
    try {
      const res = await fetchPage(`${origin}/book/`, { engine: 'http', timeout: 20000, retries: 1, autoCookie: true, referer: true })
      console.log(`[3] subpath /book/: engine=${res.engine} blocked=${res.blocked} htmlLen=${res.html.length}`)
    } catch (e: any) {
      console.log(`[3] subpath /book/ ERROR(status=${e?.status}): ${String(e?.message).slice(0, 120)}`)
    }
  }
  console.log('\nprobe done')
}

main().finally(() => process.exit(0))
