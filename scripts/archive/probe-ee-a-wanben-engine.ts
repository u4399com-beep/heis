// ============================================================
// ee-a 任务 引擎级探针 — wanbenshenzhan.com GoEdge WAF 三链路对抗
// 原始层结论(同任务 recon 探针): 桌面UA 307→/WAF/VERIFY/CAPTCHA / 移动UA 403 297B 边缘拒绝
// ① engine=http(书源移动UA): 403 形态 + curl 兜底链记录
// ② engine=browser(移动UA): Obscura/裸 Playwright 真渲染 → CAPTCHA 是否自动放行
// ③ engine=browser(桌面UA): 真浏览器指纹下 GoEdge 是否放行(非 CAPTCHA 决策面复测)
// 预算: ≤4 发, 串行+间隔≥1.2s
// 运行: bun scripts/probe-ee-a-wanben-engine.ts (末尾显式 exit(0), obscura 单例不释放事件循环)
// ============================================================
export {}

// 根 tsconfig 无 @types/bun(cc-d2 裁定), Bun 全局用最小类型面(verify-dd-b-mirror.ts 同款 shim)
declare const Bun: { write(path: string, data: string): Promise<void> }

import { fetchPage } from '../src/lib/crawl/fetcher'

// Legado 书源钉的移动 UA(与 recon 探针同值)
const WB_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

function markersOf(html: string): string[] {
  const marks: Array<[string, RegExp]> = [
    ['GoEdge-CAPTCHA', /GOEDGE_WAF_CAPTCHA_ID|Verify Yourself|ui-captcha-image/i],
    ['GoEdge-403', /403 Forbidden/i],
    ['wanben-content(真实站)', /完本神站|chapter-content|book-info-detail/],
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
  console.log('===== ① engine=http / 书源移动UA =====')
  const t1 = Date.now()
  try {
    const r = await fetchPage('https://www.wanbenshenzhan.com/', {
      engine: 'http',
      uaMode: 'custom',
      customUa: WB_MOBILE_UA,
      timeout: 18000,
      retries: 0,
      autoCookie: true,
    })
    console.log(`http引擎: engine=${r.engine} blocked=${r.blocked} htmlLen=${r.html.length} ${Date.now() - t1}ms`)
    console.log(`  形态: ${markersOf(r.html).join(',') || '(none)'}`)
  } catch (e) {
    console.log(`http引擎 ERROR ${Date.now() - t1}ms — ${e instanceof Error ? e.message : e}`)
  }

  await new Promise((r) => setTimeout(r, 1200))

  console.log('===== ② engine=browser / 移动UA 真渲染 =====')
  const t2 = Date.now()
  try {
    const r = await fetchPage('https://www.wanbenshenzhan.com/', {
      engine: 'browser',
      uaMode: 'custom',
      customUa: WB_MOBILE_UA,
      timeout: 90000,
      waitMs: 6000,
    })
    console.log(`browser引擎: engine=${r.engine} blocked=${r.blocked} htmlLen=${r.html.length} ${Date.now() - t2}ms`)
    console.log(`  形态: ${markersOf(r.html).join(',') || '(none)'}`)
    console.log(`  title: ${excerpt(r.html, /<title>[^<]*<\/title>/)}`)
    if (markersOf(r.html).includes('wanben-content(真实站)')) {
      await Bun.write('/home/z/my-project/tmp/ee/wanben-browser-pass-mobile.html', r.html)
      console.log('  (放行! 样本已存 tmp/ee/wanben-browser-pass-mobile.html)')
    } else {
      console.log(`  body 抽样: ${excerpt(r.html, /<body[\s\S]{0,400}/, 400)}`)
    }
  } catch (e) {
    console.log(`browser引擎 ERROR ${Date.now() - t2}ms — ${e instanceof Error ? e.message : e}`)
  }

  await new Promise((r) => setTimeout(r, 1200))

  console.log('===== ③ engine=browser / 桌面UA 真渲染(指纹决策面复测) =====')
  const t3 = Date.now()
  try {
    const r = await fetchPage('https://www.wanbenshenzhan.com/', {
      engine: 'browser',
      uaMode: 'custom',
      customUa: DESKTOP_UA,
      timeout: 90000,
      waitMs: 6000,
    })
    console.log(`browser引擎: engine=${r.engine} blocked=${r.blocked} htmlLen=${r.html.length} ${Date.now() - t3}ms`)
    console.log(`  形态: ${markersOf(r.html).join(',') || '(none)'}`)
    console.log(`  title: ${excerpt(r.html, /<title>[^<]*<\/title>/)}`)
    if (markersOf(r.html).includes('wanben-content(真实站)')) {
      await Bun.write('/home/z/my-project/tmp/ee/wanben-browser-pass-desktop.html', r.html)
      console.log('  (放行! 样本已存 tmp/ee/wanben-browser-pass-desktop.html)')
    } else {
      console.log(`  body 抽样: ${excerpt(r.html, /<body[\s\S]{0,400}/, 400)}`)
    }
  } catch (e) {
    console.log(`browser引擎 ERROR ${Date.now() - t3}ms — ${e instanceof Error ? e.message : e}`)
  }

  console.log('===== 完成 =====')
  process.exit(0)
}

await main()
