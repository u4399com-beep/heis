// ============================================================
// probe-rr-c3-redos.ts — rr-c3 真bug#4 复现探针(ReDoS 校验器缺口 × V8 无回溯预算)
// 【历史】修复前(检查点2): 校验器对 (a|aa)+$ 分支前缀歧义形态放行(validateRegexSafety ok),
//   而引擎生产运行时是 node/V8(ps: next dev 以 node 运行), V8 无 JSC 式回溯预算 →
//   B1/B2 实测: (a|aa)+$ 对 'a'×41+'b' 单次 exec ~47s、'a'×53+'b' 15s 跑不完(指数外推永久挂死)。
//   前任 bb-g "~3s 封顶"定谳基于 Bun/JSC 运行时, 与生产运行时不符 → 重开审查。
// 【现状】修复(rr-c3 主控收编接线): hasNestedQuantifier 增加 ② 分支前缀歧义检查
//   (branchesHavePrefixAmbiguity, 字面量分支互为前缀即报警, 保守口径) → A1 翻转为"拒绝"。
//   本探针转为修复验证形态: A1=校验器拒绝歧义形态 / A2=引擎执行面可达(证明该形态确实被引擎
//   执行, 修前会被挂死) / B=node 运行时无预算证据(与校验器无关, 持续成立)。
// 运行: bun scripts/probe-rr-c3-redos.ts (修复验证通过=exit 0)
// ============================================================

const results: { name: string; pass: boolean; note: string }[] = []
function record(name: string, pass: boolean, note: string) {
  results.push({ name, pass, note })
  console.log(`${pass ? '✓' : '✗'} [${name}] ${note}`)
}

// A1: 校验器拒绝歧义形态(修复后翻转: 修前 ok=true 放行, 修后拒绝)
const { hasNestedQuantifier, validateRegexSafety } = await import('../src/lib/crawl/types')
const gapPatterns = ['(a|aa)+$', '(a|aaa)+$']
const nowRejected = gapPatterns.every((p) => hasNestedQuantifier(p) && !validateRegexSafety(p).ok)
record('A1 校验器拒绝歧义形态(修复验证)', nowRejected, gapPatterns.map((p) => `${p}→ok=${validateRegexSafety(p).ok}`).join(', '))

// A2: 引擎执行面可达(证明该形态确实被引擎执行 —— 修前此形态入库会挂死事件循环)
const { cleanContentHtml } = await import('../src/lib/crawl/cleaner')
const t0 = Date.now()
const out = cleanContentHtml('a'.repeat(40) + 'b', { adPatterns: ['(a|aa)+'], plainText: true })
record('A2 引擎执行面可达', out !== 'a'.repeat(40) + 'b', `cleanContentHtml 执行 (a|aa)+ 后内容长度 ${out.length}(原 41, 被啃=${out !== 'a'.repeat(40) + 'b'}, 耗时 ${Date.now() - t0}ms)`)

// B: node/V8 无回溯预算(child_process 实测, 与校验器无关的运行时事实):
//   n=36 单次 exec > 1.5s(修前实测 n=40≈47s, 每字符翻倍); n=52 15s 跑不完(超时被杀)
const nodeProbe1 = `
const t=(n)=>{const s='a'.repeat(n)+'b';const st=Date.now();try{(new RegExp('(a|aa)+$')).exec(s)}catch(e){};return Date.now()-st}
console.log(JSON.stringify({a:t(36)}));
`
const nodeProbe2 = `
const s='a'.repeat(52)+'b';(new RegExp('(a|aa)+$')).exec(s);console.log('done');
`
const { spawnSync } = await import('node:child_process')
const proc1 = spawnSync('node', ['-e', nodeProbe1], { encoding: 'utf8', timeout: 60_000 })
let a = 0
try {
  a = JSON.parse((proc1.stdout || '').trim().split('\n').filter(Boolean).pop() || '{}').a || 0
} catch { /* node 不可用 */ }
record('B1 node/V8 无预算(37字符秒级)', a > 1500, `(a|aa)+$ n=36 单次 exec ${a}ms(node 运行时, JSC 同输入毫秒级)`)
const proc2 = spawnSync('node', ['-e', nodeProbe2], { encoding: 'utf8', timeout: 15_000 })
const timedOut = proc2.status === null && !proc2.stdout?.includes('done')
record('B2 53字符输入15s跑不完', timedOut, `n=52 exec 15s 超时被杀=${timedOut}(指数外推: 更长输入=永久挂死)`)

const allPass = results.every((r) => r.pass)
console.log(`\n===== probe-rr-c3-redos: 修复验证=${allPass ? '通过' : '失败'} =====`)
process.exit(allPass ? 0 : 1)

export {}
