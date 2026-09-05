// ============================================================
// Task bb-g 回归 — 单本 3 章小任务(重启后引擎回归): 0 死锁 + 正文质量 + DB 清理还原
// 用法: RULE_ID=xxx bun scripts/verify-bb-g-e2e.ts
// 基于 e2e-bb-b.ts 模板; 目标书 = biquge.tw /book/9002.html (异界龙神)
// ============================================================
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const BASE = 'http://localhost:3000'
const RULE_ID = process.env.RULE_ID || ''
const BOOK_URL = 'https://www.biquge.tw/book/9002.html'
const BOOK_NAME = '异界龙神'

interface Envelope<T = any> { ok: boolean; data?: T; message?: string }
async function api<T = any>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return (await res.json()) as Envelope<T>
}
async function findBookId(name: string): Promise<string | null> {
  const r = await api<any>(`/api/admin/books?q=${encodeURIComponent(name)}&size=5`)
  const list = r?.data?.books || r?.data?.items || r?.data
  const arr = Array.isArray(list) ? list : []
  return arr.find((b: any) => b.name === name)?.id ?? null
}

async function main() {
  if (!RULE_ID) { console.error('需 RULE_ID 环境变量'); process.exit(1) }

  // 1) 建任务(单本, 3 线程, 间隔 300~600ms)
  const created = await api<any>('/api/admin/tasks', {
    method: 'POST',
    body: JSON.stringify({
      name: 'bb-g-e2e-3ch', mode: 'single', bookUrl: BOOK_URL, ruleId: RULE_ID,
      recrawlMode: 'full', storageMode: 'db', threadMin: 1, threadMax: 3, intervalMin: 300, intervalMax: 600,
    }),
  })
  if (!created.ok) { console.error('建任务失败:', created.message); process.exit(1) }
  const taskId = created.data.id as string
  console.log('任务已建:', taskId)
  const t0 = Date.now()

  // 2) 启动 + 轮询 fetched>=3
  const started = await api(`/api/admin/tasks/${taskId}/control`, { method: 'POST', body: JSON.stringify({ action: 'start' }) })
  console.log('start:', started.ok ? 'OK' : started.message)
  let bookId: string | null = null
  let fetchedCount = 0
  for (let i = 0; i < 60; i++) {
    await sleep(3000)
    if (!bookId) bookId = await findBookId(BOOK_NAME)
    if (bookId) {
      const toc = await api<any>(`/api/admin/books/${bookId}/toc?size=200`)
      const chapters = toc?.data?.chapters || []
      fetchedCount = (Array.isArray(chapters) ? chapters : []).filter((c: any) => c.fetched).length
      const task = await api<any>(`/api/admin/tasks/${taskId}`)
      process.stdout.write(`t+${Math.round((Date.now() - t0) / 1000)}s 书籍=${bookId} toc=${toc?.data?.total} fetched=${fetchedCount} 状态=${task?.data?.status}\n`)
      if (fetchedCount >= 3) break
    } else {
      process.stdout.write(`t+${Math.round((Date.now() - t0) / 1000)}s 等待书籍入库...\n`)
    }
  }
  if (fetchedCount < 3) console.log(`!! 180s 内未采满 3 章(实际 ${fetchedCount})`)

  // 3) stop + 等停转(死锁检测: 30s 内必须 live=false)
  await api(`/api/admin/tasks/${taskId}/control`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
  let stoppedClean = false
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    const t = await api<any>(`/api/admin/tasks/${taskId}`)
    if (t?.data && !t.data.live) { stoppedClean = true; break }
  }
  await sleep(2000)
  console.log(`停止收尾: ${stoppedClean ? '✅ 30s 内干净停转(0 死锁)' : '❌ 30s 未停转(疑似死锁)'}`)
  const errLogs = await api<any>(`/api/admin/tasks/${taskId}/logs?level=error&size=20`).catch(() => null)
  const errs = errLogs?.data?.logs || errLogs?.data || []
  console.log(`error 级日志: ${Array.isArray(errs) ? errs.length : '未知'} 条`, Array.isArray(errs) && errs.length ? JSON.stringify(errs).slice(0, 300) : '')

  // 4) 质量检查
  let qualityOk = true
  if (bookId) {
    const toc = await api<any>(`/api/admin/books/${bookId}/toc?size=200`)
    const items = (toc?.data?.chapters || []).filter((c: any) => c.fetched)
    console.log(`已采章节终数=${items.length}`)
    for (const c of items.slice(0, 3)) {
      const r = await api<any>(`/api/public/chapter?id=${c.id}`)
      const html: string = r?.data?.chapter?.content || ''
      const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      const junk = ['biquge', 'window.location', 'http://'].filter((k) => text.includes(k))
      const ok = text.length >= 300 && junk.length === 0
      if (!ok) qualityOk = false
      console.log(`  第${c.idx}章 [${c.title}] 字数=${c.wordCount} junk=${JSON.stringify(junk)} 开头=${JSON.stringify(text.slice(0, 50).replace(/\s+/g, ' '))}`)
    }
    console.log(qualityOk ? '✅ 正文质量检查通过' : '❌ 正文质量检查未过')
  }

  // 5) 清理还原: 删任务 + 删书(章节/tags 级联)
  const delTask = await api(`/api/admin/tasks/${taskId}`, { method: 'DELETE' })
  const delBook = bookId ? await api(`/api/admin/books/${bookId}`, { method: 'DELETE' }) : null
  console.log(`清理: task=${delTask.ok} book=${delBook?.ok ?? 'n/a'}`)
  const remainBook = await findBookId(BOOK_NAME)
  console.log(`残余核对: 书籍=${remainBook ? '仍存在 ❌' : '0 ✅'}`)
  const final = stoppedClean && qualityOk && !remainBook
  console.log(final ? '\n✅ 3章小任务回归通过' : '\n❌ 回归存在失败项')
  if (!final) process.exit(2)
}
main().catch((e) => { console.error('e2e ERROR', e); process.exit(1) })

export {}
