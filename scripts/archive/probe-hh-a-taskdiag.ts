// hh-a 诊断: 复跑单本小任务并抓取任务日志(目录页 tocLink URL/字节数) + DB 章节序核对
// 用法: bun run scripts/probe-hh-a-taskdiag.ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'http://localhost:3000'
const SITE = {
  ruleName: '久久小说网 (aijjxs.com)',
  bookUrl: 'https://www.aijjxs.com/txt/57196.html',
  bookName: '我可以兑换悟性',
} as const

interface Envelope<T = any> { ok: boolean; data?: T; message?: string }

async function api<T = any>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return (await res.json()) as Envelope<T>
}

async function main() {
  const rules = await api<any>('/api/admin/rules?take=100')
  const arr = Array.isArray(rules?.data) ? rules.data : []
  const ruleId = arr.find((x: any) => x.name === SITE.ruleName)?.id
  if (!ruleId) throw new Error('规则未找到')

  const created = await api<any>('/api/admin/tasks', {
    method: 'POST',
    body: JSON.stringify({
      name: 'hh-a-diag-tocorder',
      mode: 'single',
      bookUrl: SITE.bookUrl,
      ruleId,
      recrawlMode: 'full',
      storageMode: 'db',
      threadMin: 1,
      threadMax: 3,
      intervalMin: 300,
      intervalMax: 600,
    }),
  })
  if (!created.ok) throw new Error('建任务失败: ' + created.message)
  const taskId = created.data.id as string
  console.log('任务:', taskId)
  let bookId: string | null = null
  try {
    await api(`/api/admin/tasks/${taskId}/control`, { method: 'POST', body: JSON.stringify({ action: 'start' }) })
    for (let i = 0; i < 20; i++) {
      await sleep(2000)
      const logs = await api<any>(`/api/admin/tasks/${taskId}/logs?size=50`)
      const lines: any = logs?.data?.logs || logs?.data || [] // any 化: 数组/信封双形态, else 分支 .items 合法
      const arr2 = Array.isArray(lines) ? lines : lines?.items || []
      for (const l of arr2) {
        const msg = typeof l === 'string' ? l : l.message || JSON.stringify(l)
        if (/目录|toc|列表|书籍|发现/.test(msg)) console.log(`  [log] ${msg.slice(0, 160)}`)
      }
      if (!bookId) {
        const r = await api<any>(`/api/admin/books?q=${encodeURIComponent(SITE.bookName)}&size=5`)
        const list = r?.data?.books || r?.data?.items || r?.data
        const barr = Array.isArray(list) ? list : []
        bookId = barr.find((b: any) => b.name === SITE.bookName)?.id ?? null
      }
      if (bookId) {
        const toc = await api<any>(`/api/admin/books/${bookId}/toc?size=20`)
        const chapters = toc?.data?.chapters || []
        const total = toc?.data?.total
        const head = (Array.isArray(chapters) ? chapters : []).slice(0, 8).map((c: any) => `${c.idx}:${c.title}`)
        process.stdout.write(`t+${(i + 1) * 2}s toc=${total} 首8=[${head.join(' | ')}]\n`)
        if (total >= 800) {
          // 核对 DB 前 8 章的 URL 与标题
          const tocAll = await api<any>(`/api/admin/books/${bookId}/toc?size=20`)
          const ch8 = (tocAll?.data?.chapters || []).slice(0, 8) as any[]
          for (const c of ch8) console.log(`  DB idx=${c.idx} title=${JSON.stringify(c.title)} url=${c.url}`)
          break
        }
      }
    }
    await api(`/api/admin/tasks/${taskId}/control`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
    for (let i = 0; i < 30; i++) {
      await sleep(1000)
      const t = await api<any>(`/api/admin/tasks/${taskId}`)
      if (t?.data && !t.data.live) break
    }
  } finally {
    await sleep(1500)
    if (bookId) await api(`/api/admin/books/${bookId}`, { method: 'DELETE' })
    const del = await api(`/api/admin/tasks/${taskId}`, { method: 'DELETE' })
    console.log('清理: task=' + del.ok, 'book=' + (bookId ? '已删' : '无'))
    const books = await api<any>(`/api/admin/books?q=${encodeURIComponent(SITE.bookName)}&size=20`)
    const bl = books?.data?.books || books?.data?.items || books?.data
    const bArr = Array.isArray(bl) ? bl : []
    const tasks = await api<any>(`/api/admin/tasks?take=100`)
    const tArr = Array.isArray(tasks?.data) ? tasks.data : tasks?.data?.tasks || []
    console.log(`残余: 书=${bArr.filter((b: any) => b.name === SITE.bookName).length} 任务=${tArr.filter((t: any) => t.name === 'hh-a-diag-tocorder').length}`)
  }
}

main().catch((e) => { console.error('diag ERROR', e); process.exit(1) })

export {}
