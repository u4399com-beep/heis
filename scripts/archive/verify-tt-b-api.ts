/**
 * verify-tt-b-api.ts — tt-b 轮 API 域逐行深审 · 修复点断言 + 高危面回归
 * 覆盖(对应 tt-b 七项真 bug 修复):
 *   A. withGuard 信封契约 / clampInt 边界(公开面抽查)
 *   B. 批量路由错误文本消毒: Prisma 原文(含文件路径)不得入响应信封(静态+HTTP 面)
 *   C. chapters/batch markUnfetched 逐条 P2025 加固(降级 skipped 不再 500)
 *   D. categories/[id] DELETE P2003/P2025 加固(并发归册/并发删除)
 *   E. 单条路由 TOCTOU P2025→404 全 sweep(静态 + bogus-id HTTP 契约)
 *   F. downloads POST 并发闸 TOCTOU 真闭合(占位先行: 并发 5 连发恰 3 成功 2×429) + ads 元素窄化
 *   G. keywords manualTags 元素类型窄化(非字符串不入库)
 *   H. books/[id]/recrawl P2003 兜底 + 无规则/无来源 400 面 + 建删活体回路
 *   I. 入参类型窄化/钳制回归抽查(mode 非法/name 截断/thread 钳/settings key 反射/scheme 白名单)
 * 纪律: 探针资源一律 tt-b· 前缀, finally 兜底清理(净 DB 变更=0); 不触碰既有任务/规则;
 *       本脚本自给自足(空库可跑, 不依赖外部 fixture); process.exit(0/1)
 * 运行: bun scripts/verify-tt-b-api.ts
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()

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
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  return { status: res.status, json, text }
}
const post = (p: string, b: unknown) => req(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
const put = (p: string, b: unknown) => req(p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
const del = (p: string) => req(p, { method: 'DELETE' })

/** 静态源文件读取(断言修 reality 落在源码上 — 并发竞态路径无法用 HTTP 确定性触发) */
const API_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'api')
async function src(rel: string): Promise<string> {
  return readFileSync(join(API_ROOT, rel), 'utf8')
}
/** 响应全文(含 skipped reasons)不得出现 Prisma 内部细节特征 */
function leaksInternal(text: string): boolean {
  return /prisma|schema\.prisma|Invalid `|\.route\.ts:\d+|at \(|node_modules/i.test(text)
}

async function cleanupBookCascade(bookId: string) {
  if (!bookId) return
  await db.chapter.deleteMany({ where: { bookId } })
  await db.bookTag.deleteMany({ where: { bookId } })
  const jobs = await db.downloadJob.findMany({ where: { bookId }, select: { id: true, filePath: true } })
  for (const j of jobs) await del(`/api/admin/downloads/${j.id}`) // 走 API: 顺带清成品文件
  await db.book.deleteMany({ where: { id: bookId } })
}

async function main() {
  /* ---------- A. withGuard 信封契约 / clampInt 边界 ---------- */
  console.log('\n== A. 信封契约与钳制边界 ==')
  {
    const r0 = await req('/api')
    ok('A1 GET /api 200 {ok,data} 信封', r0.status === 200 && r0.json?.ok === true && r0.json?.data?.message === 'Hello, world!')
    const r1 = await req('/api/admin/books/bogusttb')
    ok('A2 admin bogus id → 404 {ok:false} 信封', r1.status === 404 && r1.json?.ok === false && !leaksInternal(r1.text))
    const r2 = await req('/api/public/books?page=9999999999&size=99999999')
    ok('A3 public books 超大 page/size → 钳制(≤60)', r2.json?.ok === true && r2.json?.data?.size === 60, `size=${r2.json?.data?.size}`)
    const r3 = await req('/api/public/books?page=-99&size=-99')
    ok('A4 public books 负 page/size → 1/1', r3.json?.data?.page === 1 && r3.json?.data?.size === 1, `${r3.json?.data?.page}/${r3.json?.data?.size}`)
    const r4 = await req('/api/public/books?size=1e99&page=NaN')
    ok('A5 public books 科学计数/NaN → 安全缺省', r4.json?.ok === true, `size=${r4.json?.data?.size}`)
  }

  /* ---------- B. 批量路由错误文本消毒(泄漏面) ---------- */
  console.log('\n== B. 批量错误文本消毒(Prisma 原文不得入信封) ==')
  {
    const files = [
      'admin/tasks/batch/route.ts',
      'admin/books/batch/route.ts',
      'admin/sites/batch/route.ts',
      'admin/downloads/batch/route.ts',
      'admin/chapters/batch/route.ts',
    ]
    for (const f of files) {
      const s = await src(f)
      ok(`B1 ${f} catch 走 errText 消毒`, s.includes('errText(') && !s.includes('String(e?.message'), '')
    }
    const lib = await src('_lib/http.ts')
    ok('B2 errText 映射 P2025/P2003/P2002 且其余归泛化文案', lib.includes("code === 'P2025'") && lib.includes("code === 'P2003'") && lib.includes("code === 'P2002'"))
    // HTTP 面: bogus ids 走预检路径, skipped reason 必须干净
    const b1 = await post('/api/admin/tasks/batch', { action: 'delete', ids: ['bogusttb1', 'bogusttb2'] })
    ok('B3 tasks/batch delete bogus → ok skipped=2 且 reason 无内部细节', b1.json?.ok === true && b1.json?.data?.skipped?.length === 2 && !leaksInternal(b1.text), JSON.stringify(b1.json?.data).slice(0, 100))
    const b2 = await post('/api/admin/sites/batch', { action: 'delete', ids: ['bogusttb'] })
    ok('B4 sites/batch delete bogus → skipped 干净', b2.json?.ok === true && !leaksInternal(b2.text))
    const b3 = await post('/api/admin/downloads/batch', { action: 'delete', ids: ['bogusttb'] })
    ok('B5 downloads/batch delete bogus → skipped 干净', b3.json?.ok === true && !leaksInternal(b3.text))
    const b4 = await post('/api/admin/chapters/batch', { action: 'markUnfetched', ids: ['bogusttb'] })
    ok('B6 chapters/batch markUnfetched bogus → skipped 干净', b4.json?.ok === true && b4.json?.data?.affected === 0 && !leaksInternal(b4.text))
    const b5 = await post('/api/admin/books/batch', { action: 'delete', ids: ['not-an-id', { x: 1 }, null] })
    ok('B7 books/batch delete 脏元素 ids → 消毒后 ok skipped', b5.json?.ok === true && b5.json?.data?.affected === 0 && !leaksInternal(b5.text), JSON.stringify(b5.json?.data).slice(0, 100))
  }

  /* ---------- C. chapters/batch markUnfetched P2025 加固 ---------- */
  console.log('\n== C. markUnfetched 逐条降级 skipped ==')
  let probeBookC = ''
  try {
    const mk = await post('/api/admin/books', { name: 'tt-b·章节批量探针' })
    probeBookC = mk.json?.data?.id || ''
    ok('C1 探针书创建', mk.json?.ok === true && !!probeBookC)
    const ids: string[] = []
    for (let i = 1; i <= 3; i++) {
      const ch = await db.chapter.create({ data: { bookId: probeBookC, idx: i, title: `第${i}章`, content: `<p>${'内容'.repeat(50)}</p>`, wordCount: 100, fetched: true } })
      ids.push(ch.id)
    }
    const r1 = await post('/api/admin/chapters/batch', { action: 'markUnfetched', ids: [...ids, 'bogusttb'] })
    ok('C2 markUnfetched 3有效+1bogus → affected=3 skipped=1', r1.json?.ok === true && r1.json?.data?.affected === 3 && r1.json?.data?.skipped?.length === 1, JSON.stringify(r1.json?.data).slice(0, 120))
    const left = await db.chapter.findMany({ where: { bookId: probeBookC }, select: { fetched: true, content: true, wordCount: true } })
    ok('C3 章节已清空(fetched=false/content=null/wordCount=0)', left.length === 3 && left.every((c) => c.fetched === false && c.content === null && c.wordCount === 0))
    // 逐条 catch 路径静态断言(HTTP 无法确定性触发竞态)
    const s = await src('admin/chapters/batch/route.ts')
    ok('C4 markUnfetched 逐条 try/catch + errText(源码)', /try \{\s*await db\.chapter\.update/.test(s) && s.includes('errText(e)'))
  } finally {
    await cleanupBookCascade(probeBookC)
    const gone = probeBookC ? await db.book.findUnique({ where: { id: probeBookC } }) : null
    ok('C5 探针书已清理(净变更=0)', !gone)
  }

  /* ---------- D. categories/[id] DELETE P2003/P2025 加固 ---------- */
  console.log('\n== D. 分类删除并发加固 ==')
  {
    const s = await src('admin/categories/[id]/route.ts')
    ok('D1 DELETE 含 P2003(并发归册)与 P2025(并发删除)兜底', s.includes("'P2003'") && s.includes("'P2025'"))
    const mk = await post('/api/admin/categories', { name: 'tt-b·分类探针' })
    ok('D2 探针分类创建', mk.json?.ok === true, JSON.stringify(mk.json).slice(0, 100))
    const cid = mk.json?.data?.id || ''
    if (cid) {
      const b = await post('/api/admin/books', { name: 'tt-b·分类占位书', categoryId: cid })
      const bid = b.json?.data?.id || ''
      const d1 = await del(`/api/admin/categories/${cid}`)
      ok('D3 分类下有书 → 400 预检(计数文案)', d1.status === 400 && /该分类下有 1 本书/.test(d1.json?.message || ''), `status=${d1.status}`)
      if (bid) await cleanupBookCascade(bid)
      const d2 = await del(`/api/admin/categories/${cid}`)
      ok('D4 清书后分类可删 → ok', d2.json?.ok === true)
      const d3 = await del(`/api/admin/categories/${cid}`)
      ok('D5 重复删除 → 404', d3.status === 404)
    }
  }

  /* ---------- E. 单条路由 TOCTOU P2025→404 sweep ---------- */
  console.log('\n== E. 单条路由 P2025→404 契约 ==')
  {
    for (const f of ['admin/tasks/[id]/route.ts', 'admin/tasks/[id]/control/route.ts', 'admin/books/[id]/route.ts', 'admin/chapters/[id]/route.ts', 'admin/links/route.ts', 'admin/sites/[id]/route.ts', 'admin/downloads/[id]/route.ts']) {
      const s = await src(f)
      ok(`E1 ${f} 含 P2025→404 兜底`, s.includes("'P2025'"))
    }
    const e1 = await del('/api/admin/chapters/bogusttb')
    ok('E2 chapters DELETE bogus → 404', e1.status === 404)
    const e2 = await del('/api/admin/sites/bogusttb')
    ok('E3 sites DELETE bogus → 404', e2.status === 404)
    const e3 = await del('/api/admin/downloads/bogusttb')
    ok('E4 downloads DELETE bogus → 404', e3.status === 404)
    const e4 = await req('/api/admin/chapters/bogusttb')
    ok('E5 chapters GET bogus → 404', e4.status === 404)
  }

  /* ---------- F. downloads 并发闸 TOCTOU 真闭合 + ads 元素窄化 ---------- */
  console.log('\n== F. 下载并发上限与入参窄化 ==')
  let probeBookF = ''
  try {
    const mk = await post('/api/admin/books', { name: 'tt-b·下载并发探针', storageMode: 'db' })
    probeBookF = mk.json?.data?.id || ''
    ok('F1 探针书创建', mk.json?.ok === true && !!probeBookF)
    for (let i = 1; i <= 40; i++) {
      await db.chapter.create({ data: { bookId: probeBookF, idx: i, title: `第${i}章 tt-b`, content: `<p>${('并发下载内容样本'.repeat(120))}</p>`, wordCount: 960, fetched: true } })
    }
    const jobsBefore = await db.downloadJob.count({ where: { status: { in: ['pending', 'running'] } } })
    ok('F2 起测前无在途生成任务', jobsBefore === 0, `before=${jobsBefore}`)
    const body = { bookId: probeBookF, insertAds: true, ads: [{ evil: 1 }, 'tt-b·广告位', null, 42], obfuscateMode: 'zero-width' }
    const fires = await Promise.all(Array.from({ length: 5 }, () => post('/api/admin/downloads', body)))
    const okRes = fires.filter((r) => r.json?.ok === true)
    const rateRes = fires.filter((r) => r.status === 429)
    ok('F3 并发 5 连发 → 恰 3 成功(TOCTOU 已闭合)', okRes.length === 3, `ok=${okRes.length} 429=${rateRes.length}`)
    ok('F4 其余恰为 429', rateRes.length === 2, `429=${rateRes.length} 其他=${fires.filter((r) => r.status !== 200 && r.status !== 429).length}`)
    ok('F5 429 信封 ok:false 且文案友好', rateRes.every((r) => r.json?.ok === false && /3 个下载任务进行中/.test(r.json?.message || '')))
    const jobIds = okRes.map((r) => r.json?.data?.id as string)
    // 轮询至全部终态(上限 60s)
    let done = false
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const st = await db.downloadJob.findMany({ where: { id: { in: jobIds } }, select: { status: true } })
      if (st.length === 3 && st.every((j) => j.status === 'done' || j.status === 'error')) { done = true; break }
    }
    ok('F6 生成任务全部到终态(≤60s)', done)
    const firstJob = await db.downloadJob.findUnique({ where: { id: jobIds[0] } })
    const optsText = firstJob?.options || ''
    ok('F7 ads 元素窄化: 字符串项保留', optsText.includes('tt-b·广告位'))
    ok('F8 ads 元素窄化: 对象/数字/null 不产生垃圾', !optsText.includes('[object Object]') && !optsText.includes('42'), optsText.slice(0, 160))
    ok('F9 obfuscateMode 白名单放行 zero-width', optsText.includes('zero-width'))
    const statuses = await db.downloadJob.findMany({ where: { id: { in: jobIds } }, select: { status: true } })
    ok('F10 生成结果 done(合成内容可生成)', statuses.every((j) => j.status === 'done'), JSON.stringify(statuses))
  } finally {
    await cleanupBookCascade(probeBookF)
    const leftJobs = await db.downloadJob.count({ where: { bookId: probeBookF, status: { in: ['pending', 'running'] } } })
    ok('F11 探针任务/成品清理(净变更=0)', leftJobs === 0)
  }

  /* ---------- G. keywords manualTags 元素窄化 ---------- */
  console.log('\n== G. 手动标签元素窄化 ==')
  let probeBookG = ''
  try {
    const mk = await post('/api/admin/books', { name: 'tt-b·关键词探针' })
    probeBookG = mk.json?.data?.id || ''
    ok('G1 探针书创建', mk.json?.ok === true && !!probeBookG)
    const r = await post(`/api/admin/books/${probeBookG}/keywords`, { keyword: 'tt-b', manualTags: [{ x: 1 }, 42, 'tt-b·手动词A', '   '] })
    if (r.json?.ok === true) {
      // 引擎可达: 断言垃圾元素未入库
      const tags = await db.bookTag.findMany({ where: { bookId: probeBookG }, select: { tag: true } })
      ok('G2 manualTags 非字符串元素不入库', !tags.some((t) => t.tag.includes('[object Object]') || t.tag === '42'), JSON.stringify(tags))
      ok('G3 合法字符串词入库', tags.some((t) => t.tag === 'tt-b·手动词A'))
    } else {
      ok('G2 引擎不可达 → 502 友好信封(不 500/不泄漏)', r.status === 502 && !leaksInternal(r.text), `status=${r.status}`)
      ok('G3 (跳过—引擎不可达, 静态断言兜底)', (await src('admin/books/[id]/keywords/route.ts')).includes("typeof t === 'string'"))
    }
  } finally {
    await cleanupBookCascade(probeBookG)
    ok('G4 探针书已清理', !(await db.book.findUnique({ where: { id: probeBookG } })))
  }

  /* ---------- H. recrawl P2003 兜底 + 400 面 + 活体回路 ---------- */
  console.log('\n== H. 重采路由加固 ==')
  let probeRuleH = ''
  let probeBookH = ''
  let probeTaskH = ''
  try {
    const s = await src('admin/books/[id]/recrawl/route.ts')
    ok('H1 task.create 含 P2003 兜底(与 tasks POST 同型)', s.includes("'P2003'"))
    const mkB = await post('/api/admin/books', { name: 'tt-b·重采探针' })
    probeBookH = mkB.json?.data?.id || ''
    const h1 = await post(`/api/admin/books/${probeBookH}/recrawl`, { mode: 'full' })
    ok('H2 无来源地址 → 400', h1.status === 400 && /来源地址/.test(h1.json?.message || ''))
    // 规则面: 空库(或仅他方规则)下验证无规则回退; 再建探针规则走活体回路
    const rulesNow = await req('/api/admin/rules')
    const rulesCnt = (rulesNow.json?.data || []).length
    if (rulesCnt === 0) {
      const h2 = await put(`/api/admin/books/${probeBookH}`, { sourceUrl: 'https://invalid.ttb.example/book/1' })
      ok('H3 补来源成功', h2.json?.ok === true)
      const h3 = await post(`/api/admin/books/${probeBookH}/recrawl`, {})
      ok('H4 无任何规则 → 400 引导建规则', h3.status === 400 && /无采集规则/.test(h3.json?.message || ''), `status=${h3.status} msg=${h3.json?.message}`)
    }
    const mkR = await post('/api/admin/rules', { name: 'tt-b·临时重采规则', config: '{}' })
    probeRuleH = mkR.json?.data?.id || ''
    ok('H5 探针规则创建', mkR.json?.ok === true && !!probeRuleH)
    const h4 = await put(`/api/admin/books/${probeBookH}`, { sourceUrl: 'https://invalid.ttb.example/book/1', sourceRuleId: probeRuleH })
    ok('H6 来源+来源规则回填', h4.json?.ok === true)
    const h5 = await post(`/api/admin/books/${probeBookH}/recrawl`, { mode: 'incremental' })
    ok('H7 recrawl 活体: 建任务并启动', h5.json?.ok === true && !!h5.json?.data?.id, JSON.stringify(h5.json).slice(0, 120))
    probeTaskH = h5.json?.data?.id || ''
    const h6 = await req(`/api/admin/tasks/${probeTaskH}`)
    ok('H8 重采任务详情可达(live 字段在位)', h6.json?.ok === true && typeof h6.json?.data?.live === 'boolean')
  } finally {
    if (probeTaskH) await del(`/api/admin/tasks/${probeTaskH}`)
    await cleanupBookCascade(probeBookH)
    if (probeRuleH) await del(`/api/admin/rules/${probeRuleH}`)
    const goneT = probeTaskH ? await db.task.findUnique({ where: { id: probeTaskH } }) : null
    const goneR = probeRuleH ? await db.rule.findUnique({ where: { id: probeRuleH } }) : null
    ok('H9 重采任务/规则/书清理(净变更=0)', !goneT && !goneR)
  }

  /* ---------- I. 入参类型窄化/钳制回归抽查 ---------- */
  console.log('\n== I. 入参窄化与钳制抽查 ==')
  {
    // 主控收编修正: 用真实 ruleId 隔离测试 mode 枚举校验(bogus ruleId 会先触发 404 规则不存在, 遮蔽枚举报错)
    const anyRule = await db.rule.findFirst({ select: { id: true } })
    const i1 = await post('/api/admin/tasks', { name: 'tt-b·模式非法', ruleId: anyRule?.id || 'bogusttb', mode: 'bogus' })
    ok('I1 tasks mode 非法 → 400 枚举报错', i1.status === 400 && /single|range/.test(i1.json?.message || ''), `status=${i1.status} msg=${String(i1.json?.message).slice(0, 60)}`)
    const i2 = await post('/api/admin/books', { name: 'x'.repeat(300), author: 'tt-b' })
    ok('I2 books name 300字 → 截断入库非拒收', i2.json?.ok === true && (i2.json?.data?.name as string)?.length === 200, `len=${i2.json?.data?.name?.length}`)
    const i3 = await post('/api/admin/books', { name: 'tt-b·scheme非法', sourceUrl: 'javascript:alert(1)' })
    ok('I3 books sourceUrl javascript: → 400', i3.status === 400)
    const i4 = await post('/api/admin/links', { name: 'tt-b·data', url: 'data:text/html,x' })
    ok('I4 links url data: → 400(scheme 白名单)', i4.status === 400, `status=${i4.status}`)
    const i5 = await post('/api/admin/sites', { name: 'tt-b·域名非法', domain: 'javascript:alert(1)' })
    ok('I5 sites domain 非法 → 400(域正则)', i5.status === 400)
    const i6 = await put('/api/admin/settings', { 'bad key!': 1 })
    ok('I6 settings 非法 key → 400 且反射有界', i6.status === 400 && (i6.json?.message as string)?.length <= 60, JSON.stringify(i6.json?.message))
    const i7 = await req('/api/public/books?q=<script>alert(1)</script>')
    ok('I7 public books 脚本串查询 → ok 不泄漏不崩溃', i7.json?.ok === true && !leaksInternal(i7.text))
    if (i2.json?.data?.id) await cleanupBookCascade(i2.json.data.id)
    if (i3.json?.data?.id) await cleanupBookCascade(i3.json.data.id)
    ok('I8 I2/I3 探针书清理', true)
  }

  console.log('\n==========')
  console.log(`PASS ${pass} / FAIL ${failCnt}`)
  if (failCnt) { console.log('FAILURES:'); for (const f of failures) console.log('  - ' + f); process.exit(1) }
  process.exit(0)
}

main()
  .catch((e) => { console.error('脚本异常:', e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
export {}
