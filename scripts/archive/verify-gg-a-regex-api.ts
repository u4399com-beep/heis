// ============================================================
// gg-a B API 入口防线验证: POST/PUT /api/admin/rules 的 regex 校验接线
// 危险/非法正则 → 400 信封并指明字段与原因; 正常配置往返无损; 自建探针规则自清理
// 运行: bun scripts/verify-gg-a-regex-api.ts
// ============================================================
export {}

import { db } from '../src/lib/db'

let pass = 0
let fail = 0
function assert(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}
const BASE = 'http://localhost:3000'
async function api(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let j: any = null
  try { j = await res.json() } catch { /* ignore */ }
  return { status: res.status, body: j }
}

const before = await db.rule.count()
console.log(`开工规则数: ${before}`)

console.log('\n== ① POST 危险正则(adPatterns 嵌套量词) → 400 ==')
{
  const r = await api('POST', '/api/admin/rules', {
    name: 'gg-a-regex-gate-probe',
    config: { list: { enabled: true, fields: {} }, clean: { adPatterns: ['(\\w*)*'] } },
  })
  assert('状态 400', r.status === 400, `got ${r.status}`)
  assert('信封 ok:false', r.body?.ok === false)
  assert('指明字段 clean.adPatterns[0]', String(r.body?.message || '').includes('clean.adPatterns[0]'), r.body?.message)
  assert('原因含嵌套量词描述', String(r.body?.message || '').includes('嵌套量词'))
}

console.log('\n== ② POST 非法正则(regex 型 expression) → 400 ==')
{
  const r = await api('POST', '/api/admin/rules', {
    name: 'gg-a-regex-gate-probe',
    config: { list: { enabled: true, fields: { name: { type: 'regex', expression: '[unclosed', flags: 'gi' } } } },
  })
  assert('状态 400', r.status === 400, `got ${r.status}`)
  assert('指明字段 list.fields.name.expression', String(r.body?.message || '').includes('list.fields.name.expression'), r.body?.message)
  assert('原因含"正则非法"', String(r.body?.message || '').includes('正则非法'))
}

console.log('\n== ③ PUT 危险正则(replaceFrom) → 400 ==')
{
  const created = await api('POST', '/api/admin/rules', { name: 'gg-a-regex-gate-probe' })
  assert('探针规则创建(默认配置无正则面) 200', created.status === 200 && !!created.body?.data?.id, `got ${created.status}`)
  const id = created.body?.data?.id
  try {
    const r = await api('PUT', `/api/admin/rules/${id}`, {
      config: { book: { enabled: true, fields: { intro: { type: 'css', expression: '.intro', replaceFrom: '(a+|b)+' } } } },
    })
    assert('PUT 嵌套量词 replaceFrom → 400', r.status === 400, `got ${r.status}`)
    assert('指明字段 book.fields.intro.replaceFrom', String(r.body?.message || '').includes('book.fields.intro.replaceFrom'), r.body?.message)
  } finally {
    if (id) await api('DELETE', `/api/admin/rules/${id}`)
  }
}

console.log('\n== ④ 正常配置(含合法正则)往返无损 ==')
{
  const created = await api('POST', '/api/admin/rules', {
    name: 'gg-a-regex-gate-probe',
    config: {
      list: { enabled: true, fields: { name: { type: 'regex', expression: '(\\d+\\.)+', flags: 'gi' } } },
      clean: { adPatterns: ['(www\\.)?[a-z0-9-]+\\.(com|net)(\\/\\S*)?'] },
      fetch: { tokenPattern: 'regex:"t":"([A-Za-z0-9]+)"' },
    },
  })
  assert('合法正则配置 POST 200(不误伤)', created.status === 200, `got ${created.status} ${JSON.stringify(created.body?.message)}`)
  const id = created.body?.data?.id
  try {
    const got = await api('GET', `/api/admin/rules/${id}`)
    const cfg = JSON.parse(got.body?.data?.config || '{}')
    assert('regex 型 expression 原样入库', cfg?.list?.fields?.name?.expression === '(\\d+\\.)+')
    assert('合法 adPatterns 原样入库', cfg?.clean?.adPatterns?.[0] === '(www\\.)?[a-z0-9-]+\\.(com|net)(\\/\\S*)?')
    assert('合法 tokenPattern regex: 原样入库', cfg?.fetch?.tokenPattern === 'regex:"t":"([A-Za-z0-9]+)"')
  } finally {
    if (id) await api('DELETE', `/api/admin/rules/${id}`)
  }
}

const after = await db.rule.count()
assert(`探针规则全清理(规则数 ${before} → ${after})`, before === after)
console.log(`\n== 结果: ${pass} pass / ${fail} fail ==`)
process.exit(fail > 0 ? 1 : 0)
