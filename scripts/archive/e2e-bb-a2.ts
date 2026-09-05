// bb-a2 端到端验证: 夜伴书屋(yybsw.com) 单本 3 章小任务(3 线程, 间隔 300~600ms)
// → 正文质量检查 → 清理还原 DB
// 用法: bun run scripts/e2e-bb-a2.ts
// 流程: 按规则名找 ruleId → 建任务 → start → 轮询(已采章节≥3 即 stop) → 等停 →
//       质量检查(章节字数/正文干净度/\u0000/广告残留) → 删任务+删书
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'http://localhost:3000'
const RULE_NAME = '夜伴书屋 (yybsw.com)'
const BOOK_URL = 'https://www.yybsw.com/book/27714/'
const BOOK_NAME = '死遁的亡夫们都回来了'

interface Envelope<T = any> { ok: boolean; data?: T; message?: string }

async function api<T = any>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return (await res.json()) as Envelope<T>
}

async function main() {
  // 0) 找规则
  const rulesRes = await api<any[]>('/api/admin/rules?take=100')
  const rules = Array.isArray(rulesRes.data) ? rulesRes.data : (rulesRes.data as any)?.rules || []
  const hit = rules.find((r: any) => r.name === RULE_NAME)
  if (!hit) { console.error('未找到规则:', RULE_NAME); process.exit(1) }
  const ruleId = hit.id as string
  console.log('规则:', ruleId)

  // 1) 建任务(单本, 3 线程上限, 间隔 300~600ms)
  const created = await api<any>('/api/admin/tasks', {
    method: 'POST',
    body: JSON.stringify({
      name: 'bb-a2-e2e-yybsw',
      mode: 'single',
      bookUrl: BOOK_URL,
      ruleId,
      recrawlMode: 'full',
      storageMode: 'db',
      threadMin: 1,
      threadMax: 3,
      intervalMin: 300,
      intervalMax: 600,
    }),
  })
  if (!created.ok) { console.error('建任务失败:', created.message); process.exit(1) }
  const taskId = created.data.id as string
  console.log('任务已建:', taskId)

  // 2) 启动
  const started = await api(`/api/admin/tasks/${taskId}/control`, { method: 'POST', body: JSON.stringify({ action: 'start' }) })
  console.log('start:', started.ok ? 'OK' : started.message)
  const t0 = Date.now()

  // 3) 轮询: 已采(fetched=true)章节 ≥3 即停
  let bookId: string | null = null
  let fetchedCount = 0
  for (let i = 0; i < 60; i++) {
    await sleep(3000)
    if (!bookId) {
      const r = await api<any>(`/api/admin/books?q=${encodeURIComponent(BOOK_NAME)}&size=5`)
      const list = r?.data?.books || r?.data?.items || r?.data
      const arr = Array.isArray(list) ? list : []
      bookId = arr.find((b: any) => b.name === BOOK_NAME)?.id ?? null
    }
    if (bookId) {
      const toc = await api<any>(`/api/admin/books/${bookId}/toc?size=200`)
      const chapters = toc?.data?.chapters || []
      fetchedCount = (Array.isArray(chapters) ? chapters : []).filter((c: any) => c.fetched).length
      const task = await api<any>(`/api/admin/tasks/${taskId}`)
      process.stdout.write(`t+${Math.round((Date.now() - t0) / 1000)}s 书籍=${bookId} toc=${toc?.data?.total} fetched=${fetchedCount} 任务状态=${task?.data?.status}\n`)
      if (fetchedCount >= 3) break
    } else {
      process.stdout.write(`t+${Math.round((Date.now() - t0) / 1000)}s 等待书籍入库...\n`)
    }
  }
  if (fetchedCount < 3) console.log(`!! 180s 内未采满 3 章(实际 ${fetchedCount}), 继续停止流程检查现场`)

  // 4) 停止并等任务停转
  await api(`/api/admin/tasks/${taskId}/control`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    const t = await api<any>(`/api/admin/tasks/${taskId}`)
    if (t?.data && !t.data.live) break
  }
  await sleep(2000) // 收尾落库余量

  // 5) 质量检查
  if (bookId) {
    const toc = await api<any>(`/api/admin/books/${bookId}/toc?size=200`)
    const items = (toc?.data?.chapters || []).filter((c: any) => c.fetched)
    console.log(`已采章节终数=${items.length}`)
    const book = await api<any>(`/api/admin/books/${bookId}`)
    const b = book?.data || {}
    console.log(`书籍: name=${b.name} author=${b.author} status=${b.status} wordCount=${b.wordCount} intro=${(b.intro || '').slice(0, 40)}...`)
    let qualityOk = true
    for (const c of items.slice(0, 5)) {
      const r = await api<any>(`/api/public/chapter?id=${c.id}`)
      const html: string = r?.data?.chapter?.content || ''
      const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      const junk = ['夜伴书屋', 'yybsw', 'ybswo', '广告', 'window.location', 'http://'].filter((k) => text.includes(k))
      const nullChars = (html.match(/\u0000/g) || []).length
      const head = text.slice(0, 60).replace(/\s+/g, ' ')
      const okLen = text.length >= 300
      const okJunk = junk.length === 0 && nullChars === 0
      if (!okLen || !okJunk) qualityOk = false
      console.log(`  第${c.idx}章 [${c.title}] wordCount=${c.wordCount} 文本=${text.length} junk=${JSON.stringify(junk)} null=${nullChars} 开头=${JSON.stringify(head)}`)
    }
    console.log(qualityOk ? '✅ 正文质量检查通过' : '❌ 正文质量检查未过')

    // 6) 清理: 删任务 + 删书(章节级联)
    const delTask = await api(`/api/admin/tasks/${taskId}`, { method: 'DELETE' })
    const delBook = await api(`/api/admin/books/${bookId}`, { method: 'DELETE' })
    console.log(`清理: task=${delTask.ok} book=${delBook.ok}`)
  } else {
    console.log('!! 未找到书籍, 手动清理任务')
    await api(`/api/admin/tasks/${taskId}`, { method: 'DELETE' })
  }
}

main().catch((e) => { console.error('e2e ERROR', e); process.exit(1) })

export {}
