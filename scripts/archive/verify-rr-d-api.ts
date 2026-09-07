/**
 * verify-rr-d-api.ts — rr-d 第13轮 API 深审 断言脚本
 * 覆盖: ①公开面敏感字段剥离(public/book 无 sourceUrl) ②任务入参钳制边界(POST/PUT)
 *       ③fetchConfig 大小门 ④settings key 数量门 ⑤信封形状 ⑥写安全网(探针任务用完即删, 净DB=0)
 * 纪律: 探针任务名带 rr-d 前缀且 finally 删除; 生产任务/规则/书只读。
 * 运行: bun scripts/verify-rr-d-api.ts ; 结束 process.exit(0/1)
 */
import { readFileSync } from 'fs'

const BASE = process.env.VERIFY_BASE || 'http://localhost:3000'

let pass = 0
let failCnt = 0
const failures: string[] = []

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failCnt++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function req(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, init)
  let json: any = null
  try {
    json = JSON.parse(await res.text())
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json }
}

const post = (path: string, body: unknown) =>
  req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const put = (path: string, body: unknown) =>
  req(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const del = (path: string) => req(path, { method: 'DELETE' })

async function main() {
  console.log(`\n== A. 公开面敏感字段剥离(rr-d 修复①) ==`)
  {
    // 源码级: 公开详情路由不得再把 sourceUrl 塞进响应
    const src = readFileSync('src/app/api/public/book/route.ts', 'utf-8')
    ok('A1 public/book 源码不再携带 sourceUrl', !/sourceUrl:\s*book\.sourceUrl/.test(src))
    const types = readFileSync('src/components/public/types.ts', 'utf-8')
    ok('A2 前台 BookDetail 类型已同步剥离', !/sourceUrl\?/.test(types))

    // 运行时: 任取一本真实书, 断言响应 book 对象无 sourceUrl 键且核心形状完好
    const list = await req('/api/public/books?size=1')
    ok('A3 books 列表 200', list.status === 200 && list.json?.ok === true)
    const b0 = list.json?.data?.books?.[0]
    if (b0?.id) {
      const d = await req(`/api/public/book?id=${b0.id}`)
      ok('A4 public/book 200', d.status === 200 && d.json?.ok === true)
      const book = d.json?.data?.book || {}
      ok('A5 详情 book 无 sourceUrl 键', !('sourceUrl' in book), Object.keys(book).join(','))
      ok('A6 详情核心形状完好(name/cover/chapters)', typeof book.name === 'string' && Array.isArray(d.json?.data?.chapters))
      // 其余公开路由(列表/搜索/关键词/章节)一并抽查无 sourceUrl 键
      ok('A7 列表项无 sourceUrl', !('sourceUrl' in b0))
      const s = await req(`/api/public/search?q=${encodeURIComponent(String(book.name).slice(0, 2))}&limit=1`)
      const sb = s.json?.data?.books?.[0]
      ok('A8 搜索项无 sourceUrl', !sb || !('sourceUrl' in sb))
      const ch = d.json?.data?.chapters?.[0]?.id
      if (ch) {
        const c = await req(`/api/public/chapter?id=${ch}`)
        ok('A9 章节响应 book 对象无 sourceUrl', c.status === 200 && c.json?.data?.book && !('sourceUrl' in c.json.data.book))
      }
    } else {
      ok('A3 存在可探针书籍', false, '书库为空?')
    }
  }

  console.log(`\n== B. 任务入参钳制边界(探针任务 rr-d 前缀, finally 删除) ==`)
  let probeId = ''
  let tasksBefore = -1
  try {
    const list0 = await req('/api/admin/tasks')
    tasksBefore = (list0.json?.data || []).length

    const rules = await req('/api/admin/rules')
    const ruleId = rules.json?.data?.[0]?.id
    ok('B1 存在可引用规则(只读)', !!ruleId)

    if (ruleId) {
      // B2 负数/超大/NaN 全钳 + 越界交换
      const r = await post('/api/admin/tasks', {
        name: 'rr-d探针任务(用完即删)',
        ruleId,
        mode: 'single',
        bookUrl: 'https://example.com/rr-d-probe-book',
        listStart: -9,
        listEnd: 1e12,
        bookStart: -4,
        bookEnd: 2e9,
        threadMin: -3,
        threadMax: 99,
        intervalMin: -1,
        intervalMax: 7e5,
        refreshIntervalMin: 999999,
        autoRefresh: false,
        fetchConfig: 'rrd-probe-not-json-but-tolerated',
      })
      ok('B2 边界入参仍 200(钳制而非拒绝)', r.status === 200 && r.json?.ok === true, `status=${r.status} msg=${r.json?.message}`)
      const t = r.json?.data || {}
      probeId = t.id || ''
      ok('B2 listStart 钳到 1', t.listStart === 1, `got=${t.listStart}`)
      ok('B2 listEnd 钳到 100000', t.listEnd === 100000, `got=${t.listEnd}`)
      ok('B2 bookStart 钳到 0', t.bookStart === 0, `got=${t.bookStart}`)
      ok('B2 bookEnd 钳到 100000', t.bookEnd === 100000, `got=${t.bookEnd}`)
      ok('B2 threadMin 钳到 1', t.threadMin === 1, `got=${t.threadMin}`)
      ok('B2 threadMax 钳到 32', t.threadMax === 32, `got=${t.threadMax}`)
      ok('B2 intervalMin 钳到 0', t.intervalMin === 0, `got=${t.intervalMin}`)
      ok('B2 intervalMax 钳到 600000', t.intervalMax === 600000, `got=${t.intervalMax}`)
      ok('B2 refreshIntervalMin 钳到 1440', t.refreshIntervalMin === 1440, `got=${t.refreshIntervalMin}`)
      ok('B2 任务未启动(status=pending)', t.status === 'pending', `status=${t.status}`)

      // B3 PUT 增量钳制(只发 threadMin, 不得把 autoRefresh 意外翻开; ll-d 同步块零扰动)
      if (probeId) {
        const r3 = await put(`/api/admin/tasks/${probeId}`, { threadMin: -5 })
        ok('B3 PUT threadMin 负数钳到 1', r3.status === 200 && r3.json?.data?.threadMin === 1, `got=${r3.json?.data?.threadMin}`)
        ok('B3 PUT 未携带 autoRefresh → 保持 false', r3.json?.data?.autoRefresh === false)
        const det = await req(`/api/admin/tasks/${probeId}`)
        ok('B3 详情 live=false(从未运行)', det.json?.data?.live === false, `live=${det.json?.data?.live}`)
      }

      // B4 fetchConfig > 50KB → 400 拒绝
      const big = await post('/api/admin/tasks', {
        name: 'rr-d探针-超大fetchConfig(应拒)',
        ruleId,
        mode: 'single',
        bookUrl: 'https://example.com/x',
        fetchConfig: 'x'.repeat(50_001),
      })
      ok('B4 fetchConfig 超限 400', big.status === 400 && big.json?.ok === false, `status=${big.status}`)
    }

    // B5 settings key 数量门(101 keys → 400, 拒绝路径不落库)
    const many: Record<string, number> = {}
    for (let i = 0; i < 101; i++) many[`rrdKey${i}`] = i
    const s5 = await put('/api/admin/settings', many)
    ok('B5 settings 101 keys → 400', s5.status === 400 && s5.json?.ok === false, `status=${s5.status}`)

    // B6 非法来源规则 id 创建任务 → 404(不产生任务行)
    const r6 = await post('/api/admin/tasks', { name: 'rr-d探针-幽灵规则', ruleId: 'rrd-nope000000000000000000', mode: 'single', bookUrl: 'https://example.com/x' })
    ok('B6 未知 ruleId → 404', r6.status === 404 && r6.json?.ok === false, `status=${r6.status}`)
  } finally {
    // 清理探针任务(先于断言统计, 保证净DB)
    if (probeId) await del(`/api/admin/tasks/${probeId}`)
  }

  console.log(`\n== C. 写安全网(净DB=0) ==`)
  {
    const list1 = await req('/api/admin/tasks')
    const tasksAfter = (list1.json?.data || []).length
    ok('C1 探针任务已全部删除(净DB=0)', tasksBefore === tasksAfter, `before=${tasksBefore} after=${tasksAfter}`)
    const gone = await req('/api/admin/tasks')
    ok('C2 列表无 rr-d 残留', !(gone.json?.data || []).some((t: any) => String(t.name).includes('rr-d')))
  }

  console.log(`\n==========`)
  console.log(`PASS ${pass} / FAIL ${failCnt}`)
  if (failCnt) {
    console.log('FAILURES:')
    for (const f of failures) console.log('  - ' + f)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error('脚本异常:', e)
  process.exit(1)
})

export {}
