// qq-e 探针8: 二分定位 stealth[2] 语法错误点(Chrome 视角)
import { chromium } from 'playwright'
import { STEALTH_INIT_SCRIPTS } from '../src/lib/crawl/obscura'

const src = STEALTH_INIT_SCRIPTS[2]
console.log('len =', src.length)
// 用 Bun 的 JS loader(非 TS)转译验证: bun new Function 可能放行 TS 语法
// (qq-e2 补丁: 项目 tsconfig 未装 bun 类型, 经 globalThis 取用保 tsc 干净)
try {
  const t = new ((globalThis as any).Bun.Transpiler)({ loader: 'js' })
  t.transformSync(src)
  console.log('bun js-loader 转译: OK')
} catch (e: any) {
  console.log('bun js-loader 转译: ERR', String(e?.message || e).slice(0, 300))
}
// 行级扫描: 找可疑 TS 形态(参数类型注解/返回注解)
const lines = src.split('\n')
lines.forEach((l, i) => {
  if (/\)\s*:\s*[A-Za-z]/.test(l) && !l.includes('://') && !/[\?"']/.test(l.split('):')[1]?.slice(0, 20) ?? '')) console.log(`L${i} 可疑类型注解:`, l.trim().slice(0, 120))
  if (/\bconst\b/.test(l) && /<[A-Za-z]+>/.test(l)) console.log(`L${i} 可疑泛型:`, l.trim().slice(0, 120))
})
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await (await browser.newContext()).newPage()
await page.goto('about:blank')
// 在 Chrome 里二分
const check = async (s: string): Promise<string> => await page.evaluate((code) => {
  try { new Function(code); return 'ok' } catch (e: any) { return 'ERR: ' + (e?.message || e) }
}, s)
let lo = 0, hi = lines.length
// 逐行前缀编译, 找到第一处"前缀合法但加下一行就炸"的行不适用(前缀本身不闭合)——
// 改为逐行单独包裹 try 编译该行 + 双行组合
for (let i = 0; i < lines.length; i++) {
  const r = await check('(() => { ' + lines[i] + ' })')
  if (r !== 'ok' && !r.includes('Unexpected end')) console.log(`行 ${i} 独立编译: ${r} :: ${lines[i].trim().slice(0, 100)}`)
}
await browser.close()
process.exit(0)
