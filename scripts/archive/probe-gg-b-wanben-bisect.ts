// ============================================================
// gg-b/A — wanben 客户端栈差异二分(r2 实录: 同代理同 URL, bun 极简头 200 /
//   dev-server curl 链 403 → 疑 curl 链头组或 TLS 指纹触发 GoEdge 拦截)
// 方法: 若 r2 活代理仍在窗口内, bun fetch+proxy 逐步叠加 dev-server 头组二分,
//   再用 curl 子进程对照(隔离 TLS 指纹变量)。全程串行+间隔≥900ms。
// 运行: bun scripts/probe-gg-b-wanben-bisect.ts
// ============================================================
export {}

declare const Bun: {
  write(path: string, data: Uint8Array | string): Promise<number>
  spawn(cmd: string[], opts?: { stdout?: string }): { stdout: ReadableStream<Uint8Array>; exited: Promise<number> }
}

import { existsSync, readFileSync } from 'node:fs'

const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const BOOK = 'https://www.wanbenshenzhan.com/95406838/'
const HOME = 'https://www.wanbenshenzhan.com/'
const GAP = 900

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 取最近一轮 hunt-result 的活代理
function lastLiveProxy(): string | null {
  for (let r = 9; r >= 1; r--) {
    const p = `tmp/gg-b/hunt-result-round${r}.json`
    if (!existsSync(p)) continue
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as { proxy?: string; bookFields?: Record<string, string> | null }
      if (j.proxy) return j.proxy
    } catch { /* 忽略 */ }
  }
  return null
}

/** dev-server fetchViaCurl 链头组复刻(buildHeaders fingerprint:true 语义, Android Chrome120) */
function curlChainHeaders(referer: string): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120", "Not:A-Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    ...(referer ? { Referer: referer } : {}),
  }
}

async function viaBun(proxy: string, url: string, headers: Record<string, string>): Promise<number> {
  try {
    const init: RequestInit & { proxy?: string } = { headers, redirect: 'manual', signal: AbortSignal.timeout(25_000) }
    init.proxy = proxy
    const res = await fetch(url, init)
    await res.text()
    return res.status
  } catch {
    return 0
  }
}

async function main() {
  const proxy = lastLiveProxy()
  if (!proxy) { console.log('无可用历史代理'); process.exit(2) }
  console.log(`== 客户端栈二分 via ${proxy} ==`)

  const steps: { tag: string; url: string; headers: Record<string, string>; fn: 'bun' | 'curl' }[] = []
  const minimal = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' }

  steps.push({ tag: '①bun+极简头(书页, 基线)', url: BOOK, headers: minimal, fn: 'bun' })
  steps.push({ tag: '②bun+curl链全头组(书页)', url: BOOK, headers: curlChainHeaders('https://www.wanbenshenzhan.com/'), fn: 'bun' })
  steps.push({ tag: '③bun+全头组无Referer(书页)', url: BOOK, headers: curlChainHeaders(''), fn: 'bun' })
  steps.push({ tag: '④bun+全头组无Cache-Control(书页)', url: BOOK, headers: { ...curlChainHeaders('https://www.wanbenshenzhan.com/'), 'Cache-Control': '' }, fn: 'bun' })
  steps.push({ tag: '⑤bun+全头组无sec-ch-ua(书页)', url: BOOK, headers: Object.fromEntries(Object.entries(curlChainHeaders('https://www.wanbenshenzhan.com/')).filter(([k]) => !k.startsWith('sec-ch-ua'))), fn: 'bun' })
  steps.push({ tag: '⑥bun+全头组无Sec-Fetch(书页)', url: BOOK, headers: Object.fromEntries(Object.entries(curlChainHeaders('https://www.wanbenshenzhan.com/')).filter(([k]) => !k.startsWith('Sec-Fetch'))), fn: 'bun' })
  steps.push({ tag: '⑦curl+极简头(书页, TLS对照)', url: BOOK, headers: minimal, fn: 'curl' })
  steps.push({ tag: '⑧curl+极简头-http1.1(书页)', url: BOOK, headers: minimal, fn: 'curl' }) // 配合 --http1.1 特判见下
  steps.push({ tag: '⑨bun+极简头(首页, 基线复核)', url: HOME, headers: minimal, fn: 'bun' })

  let alive = true
  for (const s of steps) {
    if (!alive) break
    let code: number
    if (s.fn === 'bun') code = await viaBun(proxy, s.url, s.headers)
    else {
      const args = ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '25', '-x', proxy]
      if (s.tag.includes('http1.1')) args.push('--http1.1')
      for (const [k, v] of Object.entries(s.headers)) if (v) args.push('-H', `${k}: ${v}`)
      args.push(s.url)
      const p = Bun.spawn(['curl', ...args], { stdout: 'pipe' })
      const out = await new Response(p.stdout).text()
      await p.exited
      code = Number(out.trim()) || 0
    }
    console.log(`${s.tag} → ${code === 200 ? '✅200' : code || 'ERR'}`)
    if (code === 0 && s.fn === 'bun') { alive = false; console.log('(bun 请求异常, 代理疑似已死, 停止二分)') }
    await sleep(GAP)
  }
}

main().catch((e) => { console.error('bisect ERROR', e); process.exit(1) })
