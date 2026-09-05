// ============================================================
// verify-rr-c3-redos.ts — rr-c3 真bug#4 修复断言(ReDoS 校验器: 分支前缀歧义形态)
// 背景: hasNestedQuantifier 修前仅认显式嵌套量词((a+)+), 漏 OWASP 经典分支歧义
//   ((a|aa)+); 生产引擎运行时 node/V8 无 JSC 式回溯预算 → 用户规则可挂死事件循环。
//   修复: 组带无界量词时追加 branchesHavePrefixAmbiguity(字面量分支互为前缀即报警,
//   保守口径: 含元字符的分支不参与判定, 有界量词不报警)。
// 运行: bun scripts/verify-rr-c3-redos.ts (全绿=exit 0)
// ============================================================

import { hasNestedQuantifier, validateRegexSafety, collectRegexIssues } from '../src/lib/crawl/types'

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}

console.log('== ① 分支前缀歧义: 灾难形态拒绝(rr-c3 bug#4 修复面) ==')
for (const evil of ['(a|aa)+$', '(a|aaa)+', '(ab|abc)+', '(a|aa|aaa)+', '(a|aa){2,}', '^(a|aa)+$', '(ab|abc)*x', '(a|aa)+?']) {
  const r = validateRegexSafety(evil)
  assert(`灾难 "${evil}" → 拒绝`, !r.ok, r.ok ? '被放行!' : `拒绝(${r.reason})`)
}
assert('hasNestedQuantifier("(a|aa)+")=true', hasNestedQuantifier('(a|aa)+') === true)

console.log('== ② 显式嵌套量词: 原有拒绝面不回归 ==')
for (const evil of ['(a+)+', '(\\w*)*', '(?:\\d+)+', '(a+|b)+', '(a{2,})+', '(a+){2,3}', '((a+)+)+', '(a*)*x', '(x|y*)+z']) {
  const r = validateRegexSafety(evil)
  assert(`灾难 "${evil}" → 拒绝`, !r.ok, r.ok ? '被放行!' : `拒绝(${r.reason})`)
}

console.log('== ③ 合法模式放行(保守口径不误伤) ==')
for (const good of [
  '(a|b)+',            // 等长字面量分支, 无前缀关系
  '(a|b|c)+d',
  '(ab|cd)+',          // 无前缀关系
  '(a|aa){3}',         // 有界外层量词: 不构成无界循环
  '(a|aa)',            // 组无外层量词: 无回溯循环面
  '(a?b)+',            // 分支含元字符 → 保守不判定(gg-a 原有合法形态)
  '(a+b)+c',           // gg-a 原有合法形态
  '(ab)+',             // 单字面量分支无配对
  '(\\d+\\.)+',        // 类缩写分支 → 保守不判定
  '(?<year>\\d{4})-(?<month>\\d{2})',
  '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?', // 规则库在用形态
  '(https?://)?[\\w.-]+',
]) {
  const r = validateRegexSafety(good, 'gi')
  assert(`合法 "${good.slice(0, 48)}${good.length > 48 ? '…' : ''}" → 放行`, r.ok, r.ok ? '' : `被误伤(${r.reason})`)
}

console.log('== ④ collectRegexIssues 端到端(四入口接线) ==')
{
  const adCfg = { clean: { adPatterns: ['ok-pattern', '(a|aa)+'] } }
  assert('adPatterns 歧义形态定位', collectRegexIssues(adCfg).some((i) => i.field.startsWith('clean.adPatterns[')), JSON.stringify(collectRegexIssues(adCfg)))
  const rfCfg = { book: { enabled: true, fields: { intro: { type: 'css', expression: '.intro', replaceFrom: '(a|aa)+' } } } }
  assert('replaceFrom 歧义形态定位', collectRegexIssues(rfCfg).some((i) => i.field === 'book.fields.intro.replaceFrom'))
  const rxCfg = { toc: { enabled: true, fields: { url: { type: 'regex', expression: '(a|aa)+', flags: 'gi' } } } }
  assert('regex 型 expression 歧义形态定位', collectRegexIssues(rxCfg).some((i) => i.field === 'toc.fields.url.expression'))
  const tpCfg = { fetch: { tokenPattern: 'regex:(a|aa)+' } }
  assert('tokenPattern regex: 形态定位', collectRegexIssues(tpCfg).some((i) => i.field === 'fetch.tokenPattern'))
  assert('干净配置零报警', collectRegexIssues({ clean: { adPatterns: ['ok-pattern'] } }).length === 0)
}

console.log('== ⑤ 400 文案兼容(gg-a API 断言依赖"嵌套量词"子串) ==')
{
  const r = validateRegexSafety('(a|aa)+')
  assert('reason 含"嵌套量词"子串', !r.ok && !!r.reason?.includes('嵌套量词'), r.reason)
  assert('reason 含分支歧义示例', !r.ok && !!r.reason?.includes('(a|aa)+'), r.reason)
}

console.log(`\n===== verify-rr-c3-redos: ${pass} pass / ${fail} fail =====`)
process.exit(fail === 0 ? 0 : 1)
