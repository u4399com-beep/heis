/** mm 轮: 本地重演四页 → 摘广告浮层 → 本地截图(视觉基准) */
import { chromium } from 'playwright'
import { readdirSync } from 'node:fs'

const ROOT = '/home/z/my-project/tmp/mm'
const files = new Set(readdirSync(`${ROOT}/assets`))
for (const f of ['pili-home.html', 'pili-cat1.html', 'pili-book-info.html', 'pili-read.html']) {
  let t = await Bun.file(`${ROOT}/${f}`).text()
  t = t.replace(/(src|href)="\/(templates|files|upload)\/([^"?]+)(\?[^"]*)?"/g, (_m, attr, a, rest) => {
    const base = `_${a}_${rest}`.replace(/\//g, '_')
    return files.has(base) ? `${attr}="assets/${base}"` : _m
  })
  // 摘广告/统计脚本(防浮层盖屏)
  t = t.replace(/<script[^>]*(pemsrv|exoclick|cloudflareinsights|challenge-platform)[^>]*>[\s\S]*?<\/script>/gi, '')
  t = t.replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
  await Bun.write(`${ROOT}/${f}.local.html`, t)
}
const b = await chromium.launch()
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } })
for (const f of ['pili-home', 'pili-cat1', 'pili-book-info', 'pili-read']) {
  await pg.goto(`file://${ROOT}/${f}.local.html`, { waitUntil: 'load', timeout: 20000 }).catch(() => {})
  await pg.waitForTimeout(1500)
  // 摘残留浮层: fixed/absolute 且面积大或 z-index 高的层
  await pg.evaluate(() => {
    for (const el of [...document.querySelectorAll<HTMLElement>('body *')]) {
      const s = getComputedStyle(el)
      if ((s.position === 'fixed' || s.position === 'absolute') && (parseInt(s.zIndex) > 50 || el.tagName === 'INS')) {
        el.style.display = 'none'
      }
    }
  })
  await pg.screenshot({ path: `${ROOT}/${f}.png` })
  console.log('shot:', f)
}
await b.close()

// mm-theme: 补 Bun 最小类型面(根 tsconfig 无 @types/bun, cc-d2 裁定)
declare const Bun: { write(path: string, data: string | Blob): Promise<number>; file(path: string): { text(): Promise<string> } }
