// ============================================================
// dd-d 任务A 侦察探针(原始网络层, 不走引擎) — 串行+间隔, 预算克制
// A1: www.ybswo.com CF 盾现状(桌面UA+移动UA) / A2: yybsw.com 老站复测
// A3: 家族域名(ybsw8/ybswa/ybsws/yeban360) DNS+HTTP 考古 / 附加: 源站 IP 内容路径复测 1 发
// 运行: bun scripts/probe-dd-d-recon.ts
// ============================================================
export {}

import { promises as dns } from 'node:dns'

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function markersOf(html: string): string[] {
  const marks: Array<[string, RegExp]> = [
    ['Just-a-moment', /Just a moment/i],
    ['cf-chl', /cf-chl/i],
    ['turnstile', /turnstile/i],
    ['challenge-platform', /challenge-platform/i],
    ['__cf_chl_opt', /__cf_chl_opt/i],
    ['cf-browser-verification', /cf-browser-verification/i],
    ['enable-js-cookies', /Enable JavaScript and cookies/i],
    ['checking-browser', /Checking your browser/i],
    ['attention-required', /Attention Required/i],
    ['night-companion(夜伴书屋)', /夜伴书屋/],
    ['perfect-library(完美书库)', /完美书库/],
    ['ybswo-ref', /ybswo/],
  ]
  const hits: string[] = []
  for (const [name, re] of marks) if (re.test(html)) hits.push(name)
  return hits
}

function pickHeaders(res: Response): string[] {
  const hs: string[] = []
  res.headers.forEach((v, k) => {
    if (/server|cf-ray|cf-mitigated|cf-cache|set-cookie|location|content-type/i.test(k)) hs.push(`${k}=${v.slice(0, 120)}`)
  })
  return hs
}

async function get(url: string, ua: string, label: string, timeoutMs = 20000): Promise<void> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  const started = Date.now()
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: ac.signal,
      headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    })
    const ms = Date.now() - started
    const buf = new Uint8Array(await res.arrayBuffer())
    const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 4000))
    console.log(`[${label}] ${res.status} ${buf.length}B ${ms}ms hdr=[${pickHeaders(res).join(' | ')}]`)
    console.log(`   markers: ${markersOf(head).join(',') || '(none)'}`)
    if (head.length > 0 && !/夜伴书屋|完美书库/.test(head)) console.log(`   head120: ${JSON.stringify(head.slice(0, 120))}`)
  } catch (e: unknown) {
    const ms = Date.now() - started
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.log(`[${label}] ERROR ${ms}ms — ${msg}`)
  } finally {
    clearTimeout(t)
  }
}

async function dnsOf(host: string): Promise<string> {
  try {
    const a = await dns.resolve4(host)
    return a.join('/')
  } catch {
    try {
      const c = await dns.resolveCname(host)
      return `CNAME→${c.join('/')}`
    } catch (e) {
      return `NXDOMAIN(${e instanceof Error ? (e as NodeJS.ErrnoException).code || e.message : '?'})`
    }
  }
}

async function main() {
  console.log('========== A1: www.ybswo.com CF 盾现状 ==========')
  console.log('DNS www.ybswo.com:', await dnsOf('www.ybswo.com'))
  await get('https://www.ybswo.com/', DESKTOP_UA, 'ybswo / desktop-UA')
  await sleep(1000)
  await get('https://www.ybswo.com/', MOBILE_UA, 'ybswo / mobile-UA')
  await sleep(1000)
  await get('https://www.ybswo.com/book/27714/', MOBILE_UA, 'ybswo /book/27714/ mobile-UA')

  console.log('========== A2: yybsw.com 老站复测 ==========')
  console.log('DNS www.yybsw.com:', await dnsOf('www.yybsw.com'))
  await get('https://www.yybsw.com/', MOBILE_UA, 'yybsw / mobile-UA')
  await sleep(1000)
  await get('https://www.yybsw.com/book/27714/', MOBILE_UA, 'yybsw /book/27714/ mobile-UA')

  console.log('========== A3: 家族域名考古 ==========')
  const family = ['www.ybsw8.com', 'www.ybswa.com', 'www.ybsws.com', 'www.yeban360.com']
  for (const h of family) {
    const ip = await dnsOf(h)
    console.log(`DNS ${h}: ${ip}`)
    if (!ip.startsWith('NXDOMAIN')) {
      await get(`https://${h}/`, MOBILE_UA, `${h} / mobile-UA`)
    }
    await sleep(1000)
  }
  for (const h of ['ybsw8.com', 'ybswa.com', 'ybsws.com', 'yeban360.com']) {
    console.log(`DNS ${h}: ${await dnsOf(h)}`)
    await sleep(300)
  }

  console.log('========== 附加: 源站 38.34.172.127 内容路径复测(1发) ==========')
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 15000)
  try {
    const res = await fetch('http://38.34.172.127/book/27714/', {
      signal: ac.signal,
      redirect: 'manual',
      headers: { 'User-Agent': MOBILE_UA, Host: 'www.yybsw.com' },
    })
    const buf = new Uint8Array(await res.arrayBuffer())
    console.log(`[origin /book/27714/ mobile-UA+Host] ${res.status} ${buf.length}B loc=${res.headers.get('location') || '-'}`)
  } catch (e) {
    console.log(`[origin] ERROR — ${e instanceof Error ? e.message : e}`)
  } finally {
    clearTimeout(t)
  }
}

await main()
