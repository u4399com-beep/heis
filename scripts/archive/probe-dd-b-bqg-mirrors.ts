// ============================================================
// Task dd-b 任务D探针 — bqg713 三备援域名真网 liveness 实测
// 域名: apibi.cc / apiqu.cc / apige.cc(cc-d 逆向: 站点 JS 内置三域名轮换,
// 同 AES token 算法同 WAF 口径), 目标端点 /api/chapter?id=2530&chapterid=1。
// 方法(克制请求: 每域恰 1 次目标请求, 串行 + 2s 间隔):
//   ① 经 mini-services/bqg713-proxy:3010 /rewrite?url=<enc(目标URL)> 领取按域签发 token
//      (顺带验证 {url} 占位符按镜像域重签路径的真网形态)
//   ② GET 改写后 URL(带 token) → 200 + JSON(txt 字段非空) = 域存活
// 判定(主控口径): ≥2 活 → seed 规则落置 mirrorDomains 三域; 仅 1 活 → 引擎能力留置不配置
// 运行: bun scripts/probe-dd-b-bqg-mirrors.ts
// ============================================================
export {}

const DOMAINS = ['apibi.cc', 'apiqu.cc', 'apige.cc']
const CHAPTER_PATH = '/api/chapter?id=2530&chapterid=1'
const PROXY = 'http://127.0.0.1:3010/rewrite?url='

interface Verdict { domain: string; tokenOk: boolean; http: number; alive: boolean; bytes: number; sample: string; ms: number }
const results: Verdict[] = []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log(`bqg713 三备援域 liveness 探测(串行, 每域 1 次目标请求 + 2s 间隔):\n`)
  for (const domain of DOMAINS) {
    const target = `https://${domain}${CHAPTER_PATH}`
    const t0 = Date.now()
    const r: Verdict = { domain, tokenOk: false, http: 0, alive: false, bytes: 0, sample: '', ms: 0 }
    try {
      // ① 领 token(proxy 按目标 URL 的 id/chapterid 签发, 与域无关但 {url} 形态逐域请求)
      const pr = await fetch(PROXY + encodeURIComponent(target))
      const pj = (await pr.json()) as { ok?: boolean; token?: string; url?: string }
      r.tokenOk = pr.status === 200 && !!pj.token
      if (!r.tokenOk) { r.sample = `proxy ${pr.status} ${JSON.stringify(pj).slice(0, 80)}` }
      else {
        // ② 带 token 直抓目标域(改写后 URL = 原路径 + token 参数)
        const rewritten = pj.url || `${target}${target.includes('?') ? '&' : '?'}token=${encodeURIComponent(pj.token!)}`
        const res = await fetch(rewritten, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' } })
        r.http = res.status
        const body = await res.text()
        r.bytes = body.length
        r.sample = body.slice(0, 100).replace(/\s+/g, ' ')
        try {
          const j = JSON.parse(body) as { txt?: string; chaptername?: string }
          r.alive = res.status === 200 && typeof j.txt === 'string' && j.txt.length > 100
          r.sample = `chaptername=${j.chaptername} txtLen=${j.txt?.length}`
        } catch { /* 非 JSON = 盾页/错误页 */ }
      }
    } catch (e: any) {
      r.sample = `网络异常: ${String(e?.message || e).slice(0, 100)}`
    }
    r.ms = Date.now() - t0
    results.push(r)
    console.log(`[${domain}] token=${r.tokenOk ? 'OK' : 'FAIL'} HTTP=${r.http || '-'} alive=${r.alive ? 'YES' : 'no'} ${r.ms}ms — ${r.sample}`)
    if (domain !== DOMAINS[DOMAINS.length - 1]) await sleep(2000)
  }
  const aliveCount = results.filter((r) => r.alive).length
  console.log(`\n存活: ${aliveCount}/3 (${results.filter((r) => r.alive).map((r) => r.domain).join(',') || '无'})`)
  console.log(`判定: ${aliveCount >= 2 ? '≥2 活 → seed 落置 mirrorDomains 三域' : aliveCount === 1 ? '仅 1 活 → 引擎能力留置, 规则暂不配置(死镜像徒增失败延迟)' : '全死 → 规则暂不配置, 引擎能力留置'}`)
}

main().catch((e: unknown) => {
  console.error('probe-dd-b-bqg-mirrors 异常:', (e as Error)?.message || e)
  process.exit(1)
})
