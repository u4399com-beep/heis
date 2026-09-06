/**
 * verify-qq-e2-obscura.ts — qq-e2 残作收编 obscura 域断言
 * 验收对象:
 *   1. [qq-e 原改动→qq-e2 修正] STEALTH_INIT_SCRIPTS[2] plugins/mimeTypes 集合缓存:
 *      浏览器注入脚本必须为纯 JS(修前 TS 注解 → 浏览器 SyntaxError 整段全灭);
 *      缓存语义保留(navigator.plugins === navigator.plugins)
 *   2. [真 chromium 实证] 9 段脚本+身份脚本全量注入后: plugins.length=5(伪装复活)/
 *      集合身份稳定/namedItem(MIME) 命中/instanceof PluginArray/webdriver=false
 *   3. 既有语义回归: 挑战判定边界/UA 身份解析/指纹一致性/注入脚本编译性
 * 纪律: 纯函数+源码模式+about:blank 本地 chromium; 零 DB/零外网; ALL PASS 收尾
 */
import {
  STEALTH_INIT_SCRIPTS,
  buildIdentityInitScript,
  looksLikeChallenge,
  isJsRedirectShell,
  randomFingerprint,
  parseUaIdentity,
} from '../src/lib/crawl/obscura'

let pass = 0
let failCnt = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { failCnt++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const UA_MOBILE = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2102J2SC Build/TKQ1.220829.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.0.0 Mobile Safari/537.36'

// ---------- 1. 注入脚本编译性(语法损坏=伪装静默全灭面) ----------
console.log('\n== 1. STEALTH/身份注入脚本编译性 ==')
{
  try { new Function(buildIdentityInitScript(UA_DESKTOP)); ok('identity 脚本(桌面UA)编译 OK', true) }
  catch (e: any) { ok('identity 脚本(桌面UA)编译 OK', false, e?.message) }
  try { new Function(buildIdentityInitScript(UA_MOBILE)); ok('identity 脚本(移动UA)编译 OK', true) }
  catch (e: any) { ok('identity 脚本(移动UA)编译 OK', false, e?.message) }
  STEALTH_INIT_SCRIPTS.forEach((s, i) => {
    try { new Function(s); ok(`stealth[${i}] 编译 OK`, true) }
    catch (e: any) { ok(`stealth[${i}] 编译 OK`, false, e?.message) }
  })
  ok('脚本共 9 段(hh-d2 移除 iframe 段后形态)', STEALTH_INIT_SCRIPTS.length === 9, `got=${STEALTH_INIT_SCRIPTS.length}`)
  // qq-e2 守卫: 注入字符串内不得再出现 TS 类型注解形态(冒号+类型词)
  const bad = STEALTH_INIT_SCRIPTS.map((s, i) => ({ i, hit: /:\s*(unknown|any|string|number|boolean)\b/.test(s) })).filter((x) => x.hit)
  ok('全部注入脚本零 TS 注解形态(防再犯)', bad.length === 0, JSON.stringify(bad))
  // 缓存语义在场(qq-e 原意保留)
  ok('plugins/mimeTypes 集合缓存语义在场', /let pluginsColl = null/.test(STEALTH_INIT_SCRIPTS[2]) && /let mimeColl = null/.test(STEALTH_INIT_SCRIPTS[2]))
  ok('getter 返回缓存对象(非每次新建)', /if \(!pluginsColl\) pluginsColl = makeCollection\(plugins, 'name'\); return pluginsColl;/.test(STEALTH_INIT_SCRIPTS[2]))
}

// ---------- 2. 真 chromium 全量注入实证 ----------
console.log('\n== 2. 真 chromium 伪装复活实证(修前 plugins.length=0 全灭) ==')
{
  try {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const ctx = await browser.newContext({ userAgent: UA_DESKTOP })
    for (const s of STEALTH_INIT_SCRIPTS) await ctx.addInitScript(s)
    await ctx.addInitScript(buildIdentityInitScript(UA_DESKTOP))
    const page = await ctx.newPage()
    await page.goto('about:blank')
    const r = await page.evaluate(() => {
      const nav = navigator as any
      return {
        pluginsIdentity: nav.plugins === nav.plugins,
        mimeIdentity: nav.mimeTypes === nav.mimeTypes,
        pluginsLen: nav.plugins.length,
        mimeLen: nav.mimeTypes.length,
        namedByMime: !!nav.plugins.namedItem('application/pdf'),
        pluginArray: nav.plugins instanceof window.PluginArray,
        iterable: typeof nav.plugins[Symbol.iterator] === 'function' && nav.plugins.item(0) != null,
        webdriver: nav.webdriver,
      }
    })
    ok(`plugins.length === 5(修前 0=整段全灭)`, r.pluginsLen === 5, `got=${r.pluginsLen}`)
    ok('mimeTypes.length === 5', r.mimeLen === 5, `got=${r.mimeLen}`)
    ok('plugins 集合身份稳定(===, qq-e 缓存目标)', r.pluginsIdentity === true)
    ok('mimeTypes 集合身份稳定(===)', r.mimeIdentity === true)
    ok('plugins.namedItem(MIME) 命中(hh-d2)', r.namedByMime === true)
    ok('instanceof PluginArray(hh-d2 原型挂载不受缓存影响)', r.pluginArray === true)
    ok('item(0) 可用+可迭代', r.iterable === true)
    ok('navigator.webdriver === false', r.webdriver === false)
    await browser.close()
  } catch (e: any) {
    ok('chromium 启动并完成伪装断言', false, String(e?.message || e).slice(0, 160))
  }
}

// ---------- 3. 挑战判定边界回归 ----------
console.log('\n== 3. looksLikeChallenge/isJsRedirectShell 边界 ==')
{
  ok('空串=挑战壳', looksLikeChallenge('') === true)
  ok('极短 JS 跳转壳', isJsRedirectShell('<script>location.href="/x"</script>') === true)
  ok('meta refresh 短页', isJsRedirectShell('<html><head><meta http-equiv="refresh" content="0"></head></html>') === true)
  ok('CF 强特征恒判拦', looksLikeChallenge('<html><title>x</title><body>cf_chl_opt)</body></html>') === true)
  ok('CF 中文 Turnstile 盾页', looksLikeChallenge('<html><title>请稍候</title><body>正在进行安全验证…</body></html>') === true)
  const longChapter = '<html><head><title>第2章 攻防</title></head><body>' + '<p>剧情推进, 验证码攻防情节。</p>'.repeat(80) + '</body></html>'
  ok('长正文含"验证码"豁免(≥1200+正常标题)', looksLikeChallenge(longChapter) === false)
  const jsdB = '<html><head><title>第1章</title></head><body>' + '<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'.repeat(10) + '<p>' + 'x'.repeat(1200) + '</p></body></html>'
  ok('CF JSD 探测脚本+正常内容页豁免(101kks 实测面)', looksLikeChallenge(jsdB) === false)
  ok('短内容+软词(验证码)判拦(设计偏保守: 宁误拦不存盾页)', looksLikeChallenge('<html><head><title>第1章 试炼</title></head><body><p>他输入了验证码。</p></body></html>') === true)
}

// ---------- 4. UA 身份/指纹回归(ii-c 面) ----------
console.log('\n== 4. parseUaIdentity/randomFingerprint 回归 ==')
{
  const id3 = parseUaIdentity(UA_MOBILE)
  ok('三段安卓 UA 机型解析(ii-c)', id3.model === 'M2102J2SC' && id3.chPlatform === 'Android', JSON.stringify({ model: id3.model, chPlatform: id3.chPlatform }))
  ok('brands 版本与 UA 同源', id3.brands.some((b) => b.version === '137'), JSON.stringify(id3.brands))
  const fp = randomFingerprint({ userAgent: UA_MOBILE })
  ok('移动 UA → 移动指纹一致性(hh-d2)', fp.mobile === true && fp.viewport.width <= 500)
  const fpD = randomFingerprint({ userAgent: UA_DESKTOP })
  ok('桌面 UA → 桌面指纹', fpD.mobile === false && parseUaIdentity(fpD.userAgent).os === 'windows')
  ok('GPU 按平台自洽(hh-d2)', parseUaIdentity(UA_MOBILE).gpu.renderer.includes('Adreno'))
}

console.log('\n==========')
console.log(`PASS ${pass} / FAIL ${failCnt}`)
if (failCnt) { console.log('FAILURES:'); for (const f of failures) console.log('  - ' + f); process.exit(1) }
console.log('ALL PASS')
process.exit(0)
