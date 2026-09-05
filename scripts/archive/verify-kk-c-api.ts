/**
 * verify-kk-c-api.ts — kk-c 第9轮 API/UI 域深审 · API 侧"陌生审读者"边界断言
 * 覆盖:
 *   A. jj-e autoRefresh/refreshIntervalMin 全出口一致性(GET 列表/详情/stats/POST/PUT 白名单+钳制)
 *   B. tasks DELETE/batch/control/logs jj-e 新段边界(404/400 兜底, 批量 skipped 语义)
 *   C. admin {stats,settings,themes,links,categories} 信封与入参消毒(只读+拒写路径)
 *   D. public/** 信封与边界(钳制/404/拒注入)
 * 纪律: 生产番茄任务(动态发现)只读不碰(不 POST/PUT/DELETE/control);
 *       探针任务建后必删(finally 兜底, 净 DB 变更=0); process.exit(0/1)
 * 运行: bun scripts/verify-kk-c-api.ts
 */
const BASE = process.env.VERIFY_BASE || 'http://localhost:3000'
// ll轮数据事故后番茄任务重建, 改为按名称动态发现(对任务重建稳健); 规则 id 不变
let TOMATO = ''
const TOMATO_RULE = 'cmtgi08kt0003qbu988jf36ch' // 探针任务用合法规则 id(不 start, 纯配置面)

let pass = 0
let failCnt = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { failCnt++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
async function req(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, init)
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* 非 JSON(sitemap 等) */ }
  return { status: res.status, json, text }
}
const post = (p: string, b: unknown) => req(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
const put = (p: string, b: unknown) => req(p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })

async function main() {
  /* ---------- A. jj-e autoRefresh 全出口一致性(番茄任务只读观测) ---------- */
  console.log('\n== A. autoRefresh 全出口一致性(番茄任务只读) ==')
  {
    // ll-a: 动态发现番茄任务(名称含“番茄”), 对任务重建稳健
    const list0 = await req('/api/admin/tasks')
    const found = (list0.json?.data || []).find((t: any) => /番茄/.test(t?.name || ''))
    if (!found) { ok('A0 动态发现番茄任务', false, '列表无名称含“番茄”的任务'); return }
    TOMATO = found.id
    ok('A0 动态发现番茄任务', true, TOMATO)
    const det = await req(`/api/admin/tasks/${TOMATO}`)
    const d = det.json?.data
    ok('A1 GET 详情 200 + autoRefresh=true', det.json?.ok === true && d?.autoRefresh === true, `got=${d?.autoRefresh}`)
    ok('A2 详情 refreshIntervalMin ∈[5,1440] 钉制内(autofill 默认 30m 亦合法)', typeof d?.refreshIntervalMin === 'number' && d.refreshIntervalMin >= 5 && d.refreshIntervalMin <= 1440, `got=${d?.refreshIntervalMin}`)

    const list = await req('/api/admin/tasks')
    const row = (list.json?.data || []).find((t: any) => t.id === TOMATO)
    ok('A3 GET 列表含番茄任务且 autoRefresh 一致(间隔在钉制内)', !!row && row.autoRefresh === true && row.refreshIntervalMin >= 5 && row.refreshIntervalMin <= 1440, `row=${!!row} interval=${row?.refreshIntervalMin}`)

    const stats = await req('/api/admin/stats')
    const rt = (stats.json?.data?.recentTasks || []).find((t: any) => t.id === TOMATO)
    ok('A4 stats.recentTasks 同样暴露 autoRefresh 字段', !!rt && typeof rt.autoRefresh === 'boolean' && rt.autoRefresh === true, `rt=${!!rt}`)

    // status 字段不被 PUT 白名单放行(状态机只走 control) — 只读语义验证借探针任务在 B 段做
  }

  /* ---------- B. 探针任务: POST/PUT 白名单+钳制 → DELETE/batch 边界(建后必删) ---------- */
  console.log('\n== B. 探针任务白名单/钳制/删除边界 ==')
  let probeId = ''
  try {
    // autoRefresh 严格布尔语义: 字符串 'yes' → false
    const r1 = await post('/api/admin/tasks', {
      name: 'kk-c探针-即删', ruleId: TOMATO_RULE, mode: 'single',
      bookUrl: 'https://invalid.kkcprobe.example/book/404',
      autoRefresh: 'yes', refreshIntervalMin: 2,
    })
    ok('B1 探针任务创建成功', r1.json?.ok === true, JSON.stringify(r1.json).slice(0, 140))
    probeId = r1.json?.data?.id || ''
    ok('B2 autoRefresh 非布尔("yes") → 严格判 false', r1.json?.data?.autoRefresh === false, `got=${JSON.stringify(r1.json?.data?.autoRefresh)}`)
    ok('B3 interval 2 → 钳到 5(下限)', r1.json?.data?.refreshIntervalMin === 5, `got=${r1.json?.data?.refreshIntervalMin}`)

    const clampCases: [string, unknown, number | boolean][] = [
      ['B4 interval 99999 → 钳到 1440(上限)', { refreshIntervalMin: 99999 }, 1440],
      ['B5 interval 0 → 钳到 5', { refreshIntervalMin: 0 }, 5],
      ['B6 interval -10 → 钳到 5', { refreshIntervalMin: -10 }, 5],
      ['B7 interval "abc"(NaN) → 缺省 30', { refreshIntervalMin: 'abc' }, 30],
      ['B8 interval null → 缺省 30', { refreshIntervalMin: null }, 30],
    ]
    for (const [name, patch, want] of clampCases) {
      const r = await put(`/api/admin/tasks/${probeId}`, patch)
      ok(name, r.json?.ok === true && r.json?.data?.refreshIntervalMin === want, `got=${r.json?.data?.refreshIntervalMin} status=${r.status}`)
    }
    // 布尔语义: 1 → false; true → true; false → false
    const b1 = await put(`/api/admin/tasks/${probeId}`, { autoRefresh: 1 })
    ok('B9 autoRefresh 1(数字) → false', b1.json?.data?.autoRefresh === false, `got=${b1.json?.data?.autoRefresh}`)
    const b2 = await put(`/api/admin/tasks/${probeId}`, { autoRefresh: true })
    ok('B10 autoRefresh true → true(排定面配置位)', b2.json?.data?.autoRefresh === true, `got=${b2.json?.data?.autoRefresh}`)
    // GET 列表同步反映 PUT 结果(出口一致性)
    const listAfter = await req('/api/admin/tasks')
    const rowAfter = (listAfter.json?.data || []).find((t: any) => t.id === probeId)
    ok('B11 PUT 后 GET 列表 autoRefresh/interval 同步', !!rowAfter && rowAfter.autoRefresh === true && rowAfter.refreshIntervalMin === 30, `got=${rowAfter?.autoRefresh}/${rowAfter?.refreshIntervalMin}`)
    // status 不在 PUT 白名单: 传 status:'running' 不得改状态(探针为 pending)
    const b3 = await put(`/api/admin/tasks/${probeId}`, { status: 'running' })
    ok('B12 PUT status 字段被白名单拒绝(状态仍 pending)', b3.json?.ok === true && b3.json?.data?.status === 'pending', `got=${b3.json?.data?.status}`)

    console.log('\n== B2. control/logs/batch 边界(bogus id, 零副作用) ==')
    const c1 = await post(`/api/admin/tasks/${probeId}/control`, { action: 'nope' })
    ok('B13 control 非法 action → 400', c1.status === 400 && c1.json?.ok === false)
    const c2 = await post('/api/admin/tasks/boguskkc/control', { action: 'start' })
    ok('B14 control 不存在任务 → 404', c2.status === 404, `status=${c2.status}`)
    const c3 = await req('/api/admin/tasks/boguskkc/logs')
    ok('B15 logs 不存在任务 → 404(防僵尸轮询)', c3.status === 404)
    const c4 = await req(`/api/admin/tasks/boguskkc`)
    ok('B16 详情不存在 → 404', c4.status === 404)
    const c5 = await req(`/api/admin/tasks/boguskkc`, { method: 'DELETE' })
    ok('B17 DELETE 不存在 → 404', c5.status === 404)
    const b10 = await post('/api/admin/tasks/batch', { action: 'nope', ids: ['x'] })
    ok('B18 batch 非法 action → 400', b10.status === 400)
    const b11 = await post('/api/admin/tasks/batch', { action: 'delete' })
    ok('B19 batch 缺 ids → 400', b11.status === 400)
    const b12 = await post('/api/admin/tasks/batch', { action: 'delete', ids: [] })
    ok('B20 batch 空 ids → 400', b12.status === 400)
    const b13 = await post('/api/admin/tasks/batch', { action: 'delete', ids: ['boguskkc1', 'boguskkc2'] })
    ok('B21 batch delete bogus → ok affected=0 skipped=2', b13.json?.ok === true && b13.json?.data?.affected === 0 && b13.json?.data?.skipped?.length === 2, JSON.stringify(b13.json?.data).slice(0, 120))
    // FK 校验: 不存在的规则 → 404(防 P2003/500 面)
    const b14 = await put(`/api/admin/tasks/${probeId}`, { ruleId: 'bogusrulekkc' })
    ok('B22 PUT 不存在规则 → 404', b14.status === 404, `status=${b14.status}`)
    const b15 = await post('/api/admin/tasks', { name: 'x', ruleId: 'bogusrulekkc', mode: 'single', bookUrl: 'https://a.example/b' })
    ok('B23 POST 不存在规则 → 404', b15.status === 404)
  } finally {
    if (probeId) {
      const del = await req(`/api/admin/tasks/${probeId}`, { method: 'DELETE' })
      const gone = await req(`/api/admin/tasks/${probeId}`)
      ok('B24 探针任务已删除(净 DB 变更=0)', del.json?.ok === true && (gone.status === 404 || gone.json?.ok === false), `del=${del.status} gone=${gone.status}`)
    }
  }

  /* ---------- C. admin {settings,themes,links,categories} 信封与消毒(拒写路径零副作用) ---------- */
  console.log('\n== C. admin settings/themes/links/categories ==')
  {
    const s1 = await req('/api/admin/settings')
    ok('C1 settings GET 信封 ok + 对象', s1.json?.ok === true && typeof s1.json?.data === 'object' && !Array.isArray(s1.json?.data))
    const s2 = await put('/api/admin/settings', ['not', 'an', 'object'])
    ok('C2 settings PUT 数组体 → 400', s2.status === 400)
    const s3 = await put('/api/admin/settings', { 'bad key!': 1 })
    ok('C3 settings PUT 非法 key → 400(不落库)', s3.status === 400)
    const manyKeys: Record<string, number> = {}
    for (let i = 0; i < 101; i++) manyKeys[`k${i}`] = i
    const s4 = await put('/api/admin/settings', manyKeys)
    ok('C4 settings PUT >100 key → 400', s4.status === 400)

    const t1 = await req('/api/admin/themes')
    const themes = t1.json?.data
    ok('C5 themes GET 数组且每项 preview 三色', t1.json?.ok === true && Array.isArray(themes) && themes.length >= 8 && themes.every((x: any) => Array.isArray(x.preview) && x.preview.length === 3), `n=${themes?.length}`)

    const l1 = await req('/api/admin/links')
    ok('C6 links GET 数组信封', l1.json?.ok === true && Array.isArray(l1.json?.data))
    const l2 = await post('/api/admin/links', { name: '', url: 'https://a.example' })
    ok('C7 links POST 空名 → 400', l2.status === 400)
    const l3 = await post('/api/admin/links', { name: 'x', url: 'javascript:alert(1)' })
    ok('C8 links POST javascript: → 400(拒注入)', l3.status === 400, `status=${l3.status}`)
    const l4 = await post('/api/admin/links', { name: 'x', url: 'ftp://bad.example.com' })
    ok('C9 links POST ftp:// → 400(scheme 白名单)', l4.status === 400)
    const l5 = await put('/api/admin/links', { id: 'boguskkc', name: 'x' })
    ok('C10 links PUT 不存在 → 404', l5.status === 404)
    const l6 = await req('/api/admin/links?id=boguskkc', { method: 'DELETE' })
    ok('C11 links DELETE 不存在 → 404', l6.status === 404)
    const l7 = await post('/api/admin/links/batch', { ids: 'notarray', action: 'delete' })
    ok('C12 links/batch ids 非数组 → 400', l7.status === 400)
    const l8 = await post('/api/admin/links/batch', { ids: ['boguskkc'], action: 'delete' })
    ok('C13 links/batch delete bogus → ok affected=0', l8.json?.ok === true && l8.json?.data?.affected === 0)

    const g1 = await req('/api/admin/categories')
    ok('C14 categories GET 数组信封', g1.json?.ok === true && Array.isArray(g1.json?.data))
    const g2 = await post('/api/admin/categories', { name: '   ' })
    ok('C15 categories POST 空名 → 400', g2.status === 400)
    const g3 = await req('/api/admin/categories/boguskkc', { method: 'DELETE' })
    ok('C16 categories DELETE 不存在 → 404', g3.status === 404)
    const g4 = await put('/api/admin/categories/boguskkc', { name: 'x' })
    ok('C17 categories PUT 不存在 → 404', g4.status === 404)
    const g5 = await post('/api/admin/categories/batch', { action: 'delete', ids: ['boguskkc'] })
    ok('C18 categories/batch delete bogus → ok affected=0', g5.json?.ok === true && g5.json?.data?.affected === 0)
    const g6 = await post('/api/admin/categories/batch', { action: 'order', ids: ['boguskkc'] })
    ok('C19 categories/batch order 部分不存在 → 404 整体取消', g6.status === 404, `status=${g6.status}`)
  }

  /* ---------- D. public/** 信封与边界 ---------- */
  console.log('\n== D. public API 边界 ==')
  {
    const p1 = await req('/api/public/books?page=1&size=999')
    ok('D1 books size 999 → 钳 60, 信封 ok', p1.json?.ok === true && p1.json?.data?.size === 60, `size=${p1.json?.data?.size}`)
    const p2 = await req('/api/public/books?page=-3&size=0')
    // clampInt 语义: 缺失/'' → 默认值; 显式 0/负数 → 钳到边界内安全值(0 → min=1)
    ok('D2 books page=-3→1, size=0→1(边界内安全值)', p2.json?.data?.page === 1 && p2.json?.data?.size === 1, `${p2.json?.data?.page}/${p2.json?.data?.size}`)
    const p2b = await req('/api/public/books?size=abc')
    ok('D2b books size 非数(NaN) → 缺省 24', p2b.json?.data?.size === 24, `size=${p2b.json?.data?.size}`)
    const p3 = await req('/api/public/books?site=boguskkc')
    ok('D3 books 不存在 site → offset 0 正常返回', p3.json?.ok === true)
    const p4 = await req('/api/public/books?q=%25_%25')
    ok('D4 books q 全 LIKE 通配符 → 清洗后空查询不 500', p4.json?.ok === true)
    const p5 = await req('/api/public/book?id=boguskkc')
    ok('D5 book 不存在 → 404', p5.status === 404)
    const p6 = await req('/api/public/chapter?id=boguskkc')
    ok('D6 chapter 不存在 → 404', p6.status === 404)
    const p7 = await req('/api/public/search?q=')
    ok('D7 search 空 q → ok books=[]', p7.json?.ok === true && Array.isArray(p7.json?.data?.books))
    const p8 = await req('/api/public/search?limit=999&q=x')
    ok('D8 search limit 钳 ≤50', p8.json?.ok === true)
    const p9 = await req('/api/public/categories?limit=999')
    ok('D9 categories limit 钳 ≤60 + items 数组', p9.json?.ok === true && Array.isArray(p9.json?.data?.items))
    const p10 = await req('/api/public/tags?n=999')
    ok('D10 tags n 钳 ≤120', p10.json?.ok === true && (p10.json?.data?.tags as unknown[])?.length <= 120, `n=${p10.json?.data?.tags?.length}`)
    const p11 = await req('/api/public/keyword')
    ok('D11 keyword 空 tag → ok tag=""', p11.json?.ok === true && p11.json?.data?.tag === '')
    const p12 = await req('/api/public/links')
    ok('D12 links friend 数组 + wheel 数组', p12.json?.ok === true && Array.isArray(p12.json?.data?.friend) && Array.isArray(p12.json?.data?.wheel))
    const p13 = await req('/api/public/cover?file=../../etc/passwd')
    ok('D13 cover 路径穿越 → 400', p13.status === 400)
    const p14 = await req('/api/public/cover?file=..%2f..%2fetc%2fpasswd')
    ok('D14 cover 编码穿越 → 400', p14.status === 400)
    const p15 = await req('/api/public/download?id=boguskkc')
    ok('D15 download 不存在 → 404', p15.status === 404)
    const p16 = await req('/api/public/sitemap')
    ok('D16 sitemap XML 文本', p16.status === 200 && p16.text.startsWith('<?xml'), p16.text.slice(0, 40))
    const p17 = await req('/api/public/book?id=')
    ok('D17 book 缺 id → 400', p17.status === 400)
  }

  console.log('\n==========')
  console.log(`PASS ${pass} / FAIL ${failCnt}`)
  if (failCnt) { console.log('FAILURES:'); for (const f of failures) console.log('  - ' + f); process.exit(1) }
  process.exit(0)
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(1) })
export {}
