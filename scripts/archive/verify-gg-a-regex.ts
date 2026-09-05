// ============================================================
// gg-a B regex 安全校验验证
// ① 校验器单测: 非法正则/灾难嵌套量词必须拒绝; 正常模式(含规则库在用形态)必须放行
// ② 零误伤实证: 规则库全部存量规则的四个正则入口字段跑校验器, 必须全数通过
//    (接线前置条件: 存在任一误伤即不得接线)
// 运行: bun scripts/verify-gg-a-regex.ts
// ============================================================
export {}

import { validateRegexSafety, hasNestedQuantifier, collectRegexIssues, DEFAULT_CLEAN_CONFIG, DEFAULT_FETCH_CONFIG, defaultRuleConfig } from '../src/lib/crawl/types'
import { db } from '../src/lib/db'

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}

console.log('\n== ① 编译试错: 非法正则拒绝 ==')
for (const bad of ['(', '[a-', '*x', 'a)**', '(?<', '(?P<n>x)']) {
  const r = validateRegexSafety(bad)
  assert(`非法 "${bad}" → 拒绝`, !r.ok, r.ok ? '被放行!' : `拒绝(${r.reason})`)
}
{
  const r = validateRegexSafety('x', 'qss') // 非法标志位(引擎运行时 new RegExp 原样带 flags 编译, 同样会抛)
  assert('非法标志位 "qss" → 拒绝', !r.ok, r.ok ? '被放行!' : `拒绝(${r.reason})`)
  const r2 = validateRegexSafety('x{2,1}', 'u') // u 模式下 min>max 为语法错误
  assert('u 标志下 "x{2,1}" → 拒绝', !r2.ok, r2.ok ? '被放行!' : `拒绝(${r2.reason})`)
  assert('非 u 模式 "x{2,1}" 同样拒绝(V8 对 min>max 量词非 u 模式也抛语法错)', validateRegexSafety('x{2,1}').ok === false)
}

console.log('\n== ② 嵌套量词: 灾难形态拒绝 ==')
for (const evil of ['(a+)+', '(\\w*)*', '(?:\\d+)+', '(a+|b)+', '(a{2,})+', '(a+){2,3}', '^(a+)+$', '((a+)+)+', '(a*)*x', '(x|y*)+z']) {
  const r = validateRegexSafety(evil)
  assert(`灾难 "${evil}" → 拒绝`, !r.ok, r.ok ? '被放行!' : `拒绝(${r.reason})`)
}
assert('hasNestedQuantifier("(a+)+")=true', hasNestedQuantifier('(a+)+') === true)

console.log('\n== ③ 正常模式放行(规则库在用形态/常见合法写法) ==')
for (const good of [
  '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
  '本章未完.*?点击下一页继续阅读',
  '[（(]?完?本[网站站][）)]?',
  '(https?://)?[\\w.-]+',
  '(\\d+\\.)+',
  '第.{0,10}章',
  '(?<year>\\d{4})-(?<month>\\d{2})',
  '(a|b)+cd',
  '(a?b)+',
  '(.*?)',
  '(?<=第).+?章',
  '\\s*【(?:添加微信公众号|我们的YY频道|QQ群|QQ交流群|公众账号)[^】]*】|&nbsp;',
  'https?:\\/{2,3}\\d{1,8}\\/',
  '(a+b)+c',
  '(ab)+',
  '[+*]\\s*\\)\\s*[+*{]', // 字符类内的量词与括号是字面量, 不构成嵌套
]) {
  const r = validateRegexSafety(good, 'gi')
  assert(`合法 "${good.slice(0, 48)}${good.length > 48 ? '…' : ''}" → 放行`, r.ok, r.ok ? '' : `被误伤(${r.reason})`)
}
assert('空串放行(必填校验另行把关)', validateRegexSafety('').ok === true)

console.log('\n== ④ 默认配置/默认规则零报警 ==')
{
  let bad = 0
  for (const p of DEFAULT_CLEAN_CONFIG.adPatterns) {
    if (!validateRegexSafety(p, 'gi').ok) bad++
  }
  assert(`DEFAULT_CLEAN_CONFIG.adPatterns(${DEFAULT_CLEAN_CONFIG.adPatterns.length} 条)全过`, bad === 0)
  assert('DEFAULT_FETCH_CONFIG 无 regex: tokenPattern', !(DEFAULT_FETCH_CONFIG.tokenPattern || '').startsWith('regex:'))
  assert('defaultRuleConfig() collectRegexIssues 零问题', collectRegexIssues(defaultRuleConfig()).length === 0)
}

console.log('\n== ⑤ 存量规则库全量零误伤审计(四入口) ==')
{
  const rules = await db.rule.findMany({ orderBy: { updatedAt: 'desc' } })
  console.log(`  规则库共 ${rules.length} 条`)
  let totalFields = 0
  let badRules = 0
  for (const rule of rules) {
    let raw: unknown = null
    try { raw = JSON.parse(rule.config || '{}') } catch { continue }
    // 原始形态(保存接口收到/回传的即此形态)与消毒形态双口径
    const issuesRaw = collectRegexIssues(raw)
    const issuesSan = collectRegexIssues(JSON.stringify(raw))
    const issues = [...issuesRaw, ...issuesSan]
    // 统计正则面字段数(报告用)
    const cfg = raw as Record<string, unknown>
    for (const seg of ['list', 'book', 'toc', 'content']) {
      const page = cfg[seg] as Record<string, unknown> | undefined
      if (!page || typeof page !== 'object') continue
      for (const fr of Object.values((page.fields as Record<string, unknown>) || {})) {
        const f = fr as Record<string, unknown> | null
        if (!f || typeof f !== 'object') continue
        if (f.type === 'regex' && typeof f.expression === 'string') totalFields++
        if (typeof f.replaceFrom === 'string' && f.replaceFrom) totalFields++
      }
      if (page.itemSelector && typeof page.itemSelector === 'object') {
        const is = page.itemSelector as Record<string, unknown>
        if (is.type === 'regex' && typeof is.expression === 'string') totalFields++
        if (typeof is.replaceFrom === 'string' && is.replaceFrom) totalFields++
      }
    }
    const fetch = cfg.fetch as Record<string, unknown> | undefined
    if (fetch && typeof fetch.tokenPattern === 'string' && fetch.tokenPattern.startsWith('regex:')) totalFields++
    const clean = cfg.clean as Record<string, unknown> | undefined
    if (clean && Array.isArray(clean.adPatterns)) totalFields += clean.adPatterns.filter((x) => typeof x === 'string' && x).length
    if (issues.length) {
      badRules++
      console.log(`  ❌ 规则[${rule.name}](${rule.id}): ${issues.map((i) => `${i.field}: ${i.reason}`).join(' | ')}`)
    }
  }
  assert(`全部 ${rules.length} 条规则四入口零报警(正则面字段 ${totalFields} 个)`, badRules === 0)
}

console.log('\n== ⑥ collectRegexIssues 定位能力(对象/字符串双形态) ==')
{
  const evilCfg = {
    list: { enabled: true, fields: { name: { type: 'regex', expression: '(a+)+', flags: 'gi' } } },
    clean: { adPatterns: ['ok-pattern', '(\\w*)*'] },
  }
  const issues = collectRegexIssues(evilCfg)
  assert('对象形态定位 2 处(list.fields.name.expression + clean.adPatterns[1])', issues.length === 2 && issues.some((i) => i.field === 'list.fields.name.expression') && issues.some((i) => i.field === 'clean.adPatterns[1]'), JSON.stringify(issues))
  const issuesStr = collectRegexIssues(JSON.stringify(evilCfg))
  assert('JSON 字符串形态同样定位 2 处', issuesStr.length === 2)
  assert('不可解析字符串 → 零问题(运行时本就回退默认)', collectRegexIssues('{not-json').length === 0)
  const tpCfg = { fetch: { tokenPattern: 'regex:(a+)+' } }
  assert('tokenPattern regex: 形态定位', collectRegexIssues(tpCfg).some((i) => i.field === 'fetch.tokenPattern'))
  const rfCfg = { book: { enabled: true, fields: { intro: { type: 'css', expression: '.intro', replaceFrom: '(x*)*' } } } }
  assert('css 型字段的 replaceFrom 同样校验', collectRegexIssues(rfCfg).some((i) => i.field === 'book.fields.intro.replaceFrom'))
}

console.log(`\n== 结果: ${pass} pass / ${fail} fail ==`)
process.exit(fail > 0 ? 1 : 0)
