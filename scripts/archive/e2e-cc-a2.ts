// cc-a2 端到端验证: book4.cc(AU文学) 单本 3 章小任务(3 线程, 间隔 500~900ms, browser 引擎克制)
// → 正文质量检查(html_b/base64 片段/\u0000/站名推广残留) → 清理还原 DB
// 用法: bun run scripts/e2e-cc-a2.ts
// 流程: 按规则名找 ruleId → 建任务 → start → 轮询(已采章节≥3 即 stop) → 等停 →
//       质量检查(逐章全文 junk 扫描) → 删任务+删书(章节/tags 级联) → DB 残余核对
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'http://localhost:3000'
const RULE_NAME = 'AU文学 (book4.cc)'
const BOOK_URL = 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/411853/'
const BOOK_NAME = '从赘婿开始建立长生家族'

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

  // 1) 建任务(单本, 3 线程, 间隔 500~900ms)
  const created = await api<any>('/api/admin/tasks', {
    method: 'POST',
    body: JSON.stringify({
      name: 'cc-a2-e2e-book4',
      mode: 'single',
      bookUrl: BOOK_URL,
      ruleId,
      recrawlMode: 'full',
      storageMode: 'db',
      threadMin: 1,
      threadMax: 3,
      intervalMin: 500,
      intervalMax: 900,
    }),
  })
  if (!created.ok) { console.error('建任务失败:', created.message); process.exit(1) }
  const taskId = created.data.id as string
  console.log('任务已建:', taskId)

  // 2) 启动
  const started = await api(`/api/admin/tasks/${taskId}/control`, { method: 'POST', body: JSON.stringify({ action: 'start' }) })
  console.log('start:', started.ok ? 'OK' : started.message)
  const t0 = Date.now()

  // 3) 轮询: 已采(fetched=true)章节 ≥3 即停(browser 引擎每章 ~5s, 预算 240s)
  let bookId: string | null = null
  let fetchedCount = 0
  for (let i = 0; i < 80; i++) {
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
  if (fetchedCount < 3) console.log(`!! 240s 内未采满 3 章(实际 ${fetchedCount}), 继续停止流程检查现场`)

  // 4) 停止并等任务停转
  await api(`/api/admin/tasks/${taskId}/control`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    const t = await api<any>(`/api/admin/tasks/${taskId}`)
    if (t?.data && !t.data.live) break
  }
  await sleep(2500) // 收尾落库余量

  // 5) 质量检查(逐章全文)
  let qualityOk = true
  if (bookId) {
    const toc = await api<any>(`/api/admin/books/${bookId}/toc?size=200`)
    const items = (toc?.data?.chapters || []).filter((c: any) => c.fetched)
    console.log(`已采章节终数=${items.length}`)
    const book = await api<any>(`/api/admin/books/${bookId}`)
    const b = book?.data || {}
    console.log(`书籍: name=${b.name} author=${b.author} status=${b.status} wordCount=${b.wordCount} cover=${(b.cover || '').slice(0, 60)}`)
    if (!b.intro) { console.log('  !! intro 为空'); qualityOk = false }
    for (const c of items.slice(0, 5)) {
      const r = await api<any>(`/api/public/chapter?id=${c.id}`)
      const html: string = r?.data?.chapter?.content || ''
      const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      const junk = [
        'html_b', 'book4.cc', '请各位大哥大姐', '正在阅读《', '当前章节', '下一章节',
        'window.location', 'http://', 'AU文学',
      ].filter((k) => text.includes(k))
      const b64frag = (text.match(/[A-Za-z0-9+/]{60,}={0,2}/g) || []).length
      const nullChars = (html.match(/\u0000/g) || []).length
      const head = text.slice(0, 60).replace(/\s+/g, ' ')
      const okLen = text.length >= 300
      const okJunk = junk.length === 0 && b64frag === 0 && nullChars === 0
      if (!okLen || !okJunk) qualityOk = false
      console.log(
        `  第${c.idx}章 [${c.title}] wordCount=${c.wordCount} 文本=${text.length} ` +
        `junk=${JSON.stringify(junk)} b64片段=${b64frag} null=${nullChars} 开头=${JSON.stringify(head)}`,
      )
    }
    console.log(qualityOk ? '✅ 正文质量检查通过(无 html_b/base64 片段/\\u0000/推广残留)' : '❌ 正文质量检查未过')

    // 6) 清理: 删任务 + 删书(章节级联)
    const delTask = await api(`/api/admin/tasks/${taskId}`, { method: 'DELETE' })
    const delBook = await api(`/api/admin/books/${bookId}`, { method: 'DELETE' })
    console.log(`清理: task=${delTask.ok} book=${delBook.ok}`)
  } else {
    console.log('!! 未找到书籍, 手动清理任务')
    await api(`/api/admin/tasks/${taskId}`, { method: 'DELETE' })
    qualityOk = false
  }

  // 7) DB 残余核对(只读)
  await sleep(1500)
  const chk = await api<any>(`/api/admin/books?q=${encodeURIComponent(BOOK_NAME)}&size=5`)
  const chkList = chk?.data?.books || chk?.data?.items || chk?.data
  const chkArr = Array.isArray(chkList) ? chkList : []
  const residual = chkArr.filter((b: any) => b.name === BOOK_NAME)
  const tasksRes = await api<any>('/api/admin/tasks')
  const tasks = tasksRes?.data?.tasks || tasksRes?.data || []
  const taskArr = Array.isArray(tasks) ? tasks : []
  const residualTask = taskArr.filter((t: any) => t.id === taskId || t.name === 'cc-a2-e2e-book4')
  console.log(`DB 残余核对: 书籍=${residual.length} 任务=${residualTask.length}`)
  if (!qualityOk || residual.length > 0 || residualTask.length > 0) process.exit(2)
  console.log('✅ e2e 全流程完成, DB 已还原')
}

main().catch((e) => { console.error('e2e ERROR', e); process.exit(1) })

export {}
