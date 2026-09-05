// ============================================================
// dd-d 任务A 引擎级探针 — ybswo.com CF 盾实测
// ① engine=http(移动UA): CF Managed Challenge 状态码/字节数/blocked 判定
// ② engine=browser: Obscura stealth 真渲染 → 挑战形态记录(turnstile/5s盾/challenge-platform JS)
// ③ 附加: 源站 38.34.172.127 /list/ 路径移动 UA 复测(1 发, 补齐 origin 故事)
// 运行: bun scripts/probe-dd-d-ybswo-engine.ts (末尾显式 exit(0), obscura 单例不释放事件循环)
// ============================================================
export {}

// 根 tsconfig 无 @types/bun(cc-d2 裁定), Bun 全局用最小类型面(verify-dd-b-mirror.ts 同款 shim)
declare const Bun: { write(path: string, data: string): Promise<void> }

import { fetchPage } from '../src/lib/crawl/fetcher'

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'

function challengeForm(html: string): string[] {
  const marks: Array<[string, RegExp]> = [
    ['title=Just-a-moment', /<title>Just a moment/i],
    ['turnstile-widget', /turnstile|cf-turnstile/i],
    ['challenge-platform-js', /challenge-platform\/(scripts|h)/i],
    ['__cf_chl_opt', /__cf_chl_opt|window\._cf_chl/i],
    ['cf-chl-bypass', /cf-chl-bypass/i],
    ['enable-js-cookies-text', /Enable JavaScript and cookies to continue/i],
    ['verify-you-are-human', /Verify you are human|verify you are human/i],
    ['ray-id', /Ray ID/i],
    ['night-companion(真实站内容)', /夜伴书屋/],
    ['media-title(列表结构)', /media-title/],
    ['all-chapter(目录结构)', /all-chapter/],
  ]
  const hits: string[] = []
  for (const [name, re] of marks) if (re.test(html)) hits.push(name)
  return hits
}

function excerpt(html: string, re: RegExp, span = 160): string {
  const m = html.match(re)
  return m ? JSON.stringify(m[0].slice(0, span)) : '(no match)'
}

async function main() {
  console.log('===== ① engine=http ybswo / 移动UA =====')
  const t1 = Date.now()
  try {
    const r = await fetchPage('https://www.ybswo.com/', {
      engine: 'http',
      uaMode: 'custom',
      customUa: MOBILE_UA,
      timeout: 20000,
      retries: 1,
    })
    console.log(`http引擎: engine=${r.engine} blocked=${r.blocked} htmlLen=${r.html.length} ${Date.now() - t1}ms`)
    console.log(`  挑战形态: ${challengeForm(r.html).join(',') || '(none)'}`)
    console.log(`  title 附近: ${excerpt(r.html, /<title>[^<]*<\/title>/)}`)
  } catch (e) {
    console.log(`http引擎 ERROR ${Date.now() - t1}ms — ${e instanceof Error ? e.message : e}`)
  }

  await new Promise((r) => setTimeout(r, 1500))

  console.log('===== ② engine=browser ybswo / 真渲染 =====')
  const t2 = Date.now()
  try {
    const r = await fetchPage('https://www.ybswo.com/', {
      engine: 'browser',
      timeout: 90000,
      waitMs: 5000,
    })
    console.log(`browser引擎: engine=${r.engine} blocked=${r.blocked} htmlLen=${r.html.length} ${Date.now() - t2}ms`)
    console.log(`  挑战形态: ${challengeForm(r.html).join(',') || '(none)'}`)
    console.log(`  title: ${excerpt(r.html, /<title>[^<]*<\/title>/)}`)
    if (r.blocked || challengeForm(r.html).some((x) => x !== 'night-companion(真实站内容)')) {
      console.log(`  body 文本抽样: ${excerpt(r.html, /<body[\s\S]{0,600}/, 600)}`)
    } else {
      console.log(`  开头: ${JSON.stringify(r.html.slice(0, 200))}`)
      // 真实内容 → 存样本
      await Bun.write('/home/z/my-project/tmp/dd-d/ybswo-browser-pass.html', r.html)
      console.log('  (样本已存 tmp/dd-d/ybswo-browser-pass.html)')
    }
  } catch (e) {
    console.log(`browser引擎 ERROR ${Date.now() - t2}ms — ${e instanceof Error ? e.message : e}`)
  }

  await new Promise((r) => setTimeout(r, 1500))

  console.log('===== ③ 附加: 源站 /list/ 移动UA(1发) =====')
  const t3 = Date.now()
  try {
    const res = await fetch('http://38.34.172.127/list/dushi1.html', {
      redirect: 'manual',
      headers: { 'User-Agent': MOBILE_UA, Host: 'www.yybsw.com' },
      signal: AbortSignal.timeout(15000),
    })
    const buf = new Uint8Array(await res.arrayBuffer())
    const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, 3000))
    console.log(`origin /list/dushi1.html mobile: ${res.status} ${buf.length}B ${Date.now() - t3}ms 夜伴=${/夜伴书屋/.test(head)} media-title=${/media-title/.test(head)}`)
  } catch (e) {
    console.log(`origin /list/ ERROR — ${e instanceof Error ? e.message : e}`)
  }
}

await main()
process.exit(0)
