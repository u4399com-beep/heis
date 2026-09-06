// ============================================================
// ee-a 任务 侦察探针(原始网络层, 不走引擎) — wanbenshenzhan.com 可达性边界
// 主控侦察: 桌面UA 307→/WAF/VERIFY/CAPTCHA(GoEdge WAF图形验证码) / 移动UA 403 296B
// 本探针: 多形态复测(移动/桌面UA、m./www.域、深路径、HTTP1.1、Referer、http scheme)
// 预算: ≤9 发 HTTP, 全程串行+间隔≥1.1s (纪律: 克制抓取)
// 运行: bun scripts/probe-ee-a-wanben-recon.ts
// ============================================================
export {}

import { promises as dns } from 'node:dns'

// 根 tsconfig 无 @types/bun(cc-d2 裁定), Bun 全局用最小类型面(verify-dd-b-mirror.ts 同款 shim)
declare const Bun: {
  write(path: string, data: string | ArrayBufferView | ArrayBuffer): Promise<number>
  spawn(cmds: string[], options?: Record<string, unknown>): { stdout: ReadableStream; exited: Promise<number> }
}

// Legado 书源钉的移动 UA(与后续 seed fetch.customUa 同值)
export const WB_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function markersOf(html: string): string[] {
  const marks: Array<[string, RegExp]> = [
    ['GoEdge-CAPTCHA(图形验证码页)', /GOEDGE_WAF_CAPTCHA_ID|Verify Yourself/i],
    ['GoEdge-403(边缘拒绝页)', /403 Forbidden/i],
    ['wanben-content(真实站)', /完本神站|chapter-content|book-info-detail/],
    ['cloudflare', /cloudflare|Just a moment/i],
  ]
  const hits: string[] = []
  for (const [name, re] of marks) if (re.test(html)) hits.push(name)
  return hits
}

function pickHeaders(res: Response): string[] {
  const hs: string[] = []
  res.headers.forEach((v, k) => {
    if (/server|cf-ray|cf-mitigated|set-cookie|location|content-type|connection/i.test(k))
      hs.push(`${k}=${v.slice(0, 140)}`)
  })
  return hs
}

interface GetOpts {
  headers?: Record<string, string>
  save?: string
}

async function get(url: string, ua: string, label: string, opts: GetOpts = {}): Promise<void> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 20000)
  const started = Date.now()
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: ac.signal,
      headers: {
        'User-Agent': ua,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...opts.headers,
      },
    })
    const ms = Date.now() - started
    const buf = new Uint8Array(await res.arrayBuffer())
    const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 8000))
    console.log(`[${label}] ${res.status} ${buf.length}B ${ms}ms hdr=[${pickHeaders(res).join(' | ')}]`)
    console.log(`   markers: ${markersOf(head).join(',') || '(none)'}`)
    if (head.length > 0 && markersOf(head).length > 0 && !/wanben-content/.test(markersOf(head).join())) {
      console.log(`   head160: ${JSON.stringify(head.slice(0, 160))}`)
    }
    if (opts.save && buf.length > 0) {
      await Bun.write(opts.save, Buffer.from(buf))
      console.log(`   (样本已存 ${opts.save})`)
    }
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
  console.log('===== DNS =====')
  console.log('www.wanbenshenzhan.com:', await dnsOf('www.wanbenshenzhan.com'))
  console.log('m.wanbenshenzhan.com:', await dnsOf('m.wanbenshenzhan.com'))
  console.log('wanbenshenzhan.com:', await dnsOf('wanbenshenzhan.com'))
  await sleep(800)

  console.log('===== ① 基线复测(主控情报) =====')
  await get('https://www.wanbenshenzhan.com/', DESKTOP_UA, 'www / desktop-UA', {
    save: '/home/z/my-project/tmp/ee/probe-www-desktop.html',
  })
  await sleep(1100)
  await get('https://www.wanbenshenzhan.com/', WB_MOBILE_UA, 'www / mobile-UA(书源同款)')
  await sleep(1100)

  console.log('===== ② 域/形态边界 =====')
  await get('https://m.wanbenshenzhan.com/', WB_MOBILE_UA, 'm / mobile-UA')
  await sleep(1100)
  await get('https://m.wanbenshenzhan.com/', DESKTOP_UA, 'm / desktop-UA')
  await sleep(1100)

  console.log('===== ③ 深路径(书库列表/书籍页, 书源 explore/bookUrlPattern 形态) =====')
  await get('https://www.wanbenshenzhan.com/all/0_lastupdate_0_0_1.html', WB_MOBILE_UA, 'www /all/ 列表页 mobile-UA')
  await sleep(1100)
  await get('https://www.wanbenshenzhan.com/1/', WB_MOBILE_UA, 'www /1/ 书籍页 mobile-UA')
  await sleep(1100)

  console.log('===== ④ 指纹变体(HTTP1.1 / 全套浏览器头 / http scheme) =====')
  // curl --http1.1: bun fetch 走 HTTP/1.1, 补 curl http2 强制对照? 预算内先 HTTP1.1(经 curl 路径)
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 20000)
  try {
    const p = Bun.spawn(
      [
        'curl',
        '-s',
        '-o',
        '/dev/null',
        '-w',
        '%{http_code} %{size_download}B http_ver=%{http_version}',
        '--http1.1',
        '-A',
        WB_MOBILE_UA,
        '-H',
        'Accept: text/html,application/xhtml+xml,*/*;q=0.8',
        '-H',
        'Accept-Language: zh-CN,zh;q=0.9',
        '--max-time',
        '18',
        'https://www.wanbenshenzhan.com/',
      ],
      { stdout: 'pipe' }
    )
    const out = await new Response(p.stdout).text()
    await p.exited
    console.log(`[curl --http1.1 / mobile-UA] ${out.trim()}`)
  } catch (e) {
    console.log(`[curl --http1.1] ERROR — ${e instanceof Error ? e.message : e}`)
  } finally {
    clearTimeout(t)
  }
  await sleep(1100)
  await get('https://www.wanbenshenzhan.com/', WB_MOBILE_UA, 'www / mobile-UA+Referer+全头', {
    headers: {
      Referer: 'https://www.google.com/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Upgrade-Insecure-Requests': '1',
    },
  })
  await sleep(1100)
  await get('http://www.wanbenshenzhan.com/', WB_MOBILE_UA, 'http scheme / mobile-UA')

  console.log('===== 完成(共 8 发 HTTP, 串行+≥1.1s 间隔) =====')
  process.exit(0)
}

await main()
