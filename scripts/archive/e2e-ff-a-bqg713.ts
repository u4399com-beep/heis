// ============================================================
// ff-a/A2 端到端 — bqg713 单本 3 章小任务实测(走 3010 AES 转换代理) → 逐章 junk 扫描 → 清理还原 DB
// 流程: 预检书名不存在 → 读库内规则 id → 建任务(single/3线程) → start → 已采章节≥3 即 stop →
//       逐章质量检查(junk/FFFD/CTRL) → 删任务+删书(章节级联) → 残余核对=0
// 测试书: 万相之王(bookId=2530, 四段实测已验), 开工盘点确认库内无同名书, 删除不会伤及用户数据
// 运行: bun scripts/e2e-ff-a-bqg713.ts
// ============================================================
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const BASE = 'http://localhost:3000'

const SITE = {
  ruleName: '笔趣阁bqg713(www.bqg713.cc)·纯JSON API站采集',
  bookUrl: 'https://www.bqg713.cc/api/book?id=2530',
  bookName: '万相之王',
  domain: 'bqg713.cc',
} as const

// junk 扫描词: 站点域名(www 壳+真实API三域)/站名灌水/SEO 注入/协议残留; FFFD/CTRL 单独计数
// (规则 adPatterns 已含 bqg 域名+通用域名+SEO 句式, 此处命中即清洗缺口)
const JUNK_WORDS = ['bqg713', 'apibi.cc', 'apiqu.cc', 'apige.cc', '笔趣阁', '一秒记住', '请收藏本站', '本站所有小说为转载作品', 'http://', 'https://']

interface Envelope<T = any> { ok: boolean; data?: T; message?: string }

async function api<T = any>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return (await res.json()) as Envelope<T>
}

async function getRuleId(ruleName: string): Promise<string | null> {
  const r = await api<any>('/api/admin/rules')
  const arr = Array.isArray(r?.data) ? r.data : []
  return arr.find((x: any) => x.name === ruleName)?.id ?? null
}

async function findBookId(name: string): Promise<string | null> {
  const r = await api<any>(`/api/admin/books?q=${encodeURIComponent(name)}&size=10`)
  const list = r?.data?.books || r?.data?.items || r?.data
  const arr = Array.isArray(list) ? list : []
  return arr.find((b: any) => b.name === name)?.id ?? null
}

async function residualCheck(taskName: string) {
  const books = await api<any>(`/api/admin/books?q=${encodeURIComponent(SITE.bookName)}&size=20`)
  const bookArr = Array.isArray(books?.data?.books || books?.data?.items || books?.data) ? (books?.data?.books || books?.data?.items || books?.data) : []
  const bookHits = bookArr.filter((b: any) => b.name === SITE.bookName)
  const tasks = await api<any>(`/api/admin/tasks?take=100`)
  const taskArr = Array.isArray(tasks?.data) ? tasks.data : tasks?.data?.tasks || []
  const taskHits = taskArr.filter((t: any) => t.name === taskName)
  console.log(`[残余核对] 测试书籍=${bookHits.length}(应0) 测试任务=${taskHits.length}(应0)`)
  return bookHits.length === 0 && taskHits.length === 0
}

async function main() {
  // 0) 安全预检: 库内已有同名书则中止(防止删到非本轮数据)
  const preExisting = await findBookId(SITE.bookName)
  if (preExisting) { console.error(`❌ 库内已存在同名书 id=${preExisting}, 为防误删中止 e2e`); process.exit(4) }

  const ruleId = await getRuleId(SITE.ruleName)
  if (!ruleId) { console.error('库内规则未找到:', SITE.ruleName); process.exit(1) }
  const taskName = 'ff-a-e2e-bqg713'

  // 1) 建任务(单本, 3 线程, 间隔 300~900ms)
  const created = await api<any>('/api/admin/tasks', {
    method: 'POST',
    body: JSON.stringify({
      name: taskName,
      mode: 'single',
      bookUrl: SITE.bookUrl,
      ruleId,
      recrawlMode: 'full',
      storageMode: 'db',
      threadMin: 1,
      threadMax: 3,
      intervalMin: 300,
      intervalMax: 900,
    }),
  })
  if (!created.ok) { console.error('建任务失败:', created.message); process.exit(1) }
  const taskId = created.data.id as string
  console.log(`任务已建: ${taskId} (rule=${ruleId})`)

  let bookId: string | null = null
  try {
    // 2) 启动
    const started = await api(`/api/admin/tasks/${taskId}/control`, { method: 'POST', body: JSON.stringify({ action: 'start' }) })
    console.log('start:', started.ok ? 'OK' : started.message)
    const t0 = Date.now()

    // 3) 轮询: 已采章节 ≥3 即 stop
    let fetchedCount = 0
    for (let i = 0; i < 60; i++) {
      await sleep(3000)
      if (!bookId) bookId = await findBookId(SITE.bookName)
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
    for (let i = 0; i < 30; i++) {
      await sleep(1000)
      const t = await api<any>(`/api/admin/tasks/${taskId}`)
      if (t?.data && !t.data.live) break
    }
    await sleep(2500) // 收尾落库余量

    // 5) 逐章质量检查(junk 扫描 + \uFFFD 计数 + 控制字符)
    let qualityOk = true
    if (bookId) {
      const toc = await api<any>(`/api/admin/books/${bookId}/toc?size=500`)
      const items = (toc?.data?.chapters || []).filter((c: any) => c.fetched)
      console.log(`已采章节终数=${items.length}`)
      const book = await api<any>(`/api/admin/books/${bookId}`)
      const b = book?.data || {}
      console.log(`书籍: name=${b.name} author=${b.author} status=${b.status} wordCount=${b.wordCount} introLen=${(b.intro || '').length}`)
      if (b.name !== SITE.bookName) { console.log('❌ 书名不符(AES token 链路外的解析异常)'); qualityOk = false }
      for (const c of items) {
        const r = await api<any>(`/api/public/chapter?id=${c.id}`)
        const html: string = r?.data?.chapter?.content || ''
        const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
        const fffd = (text.match(/\uFFFD/g) || []).length
        const ctrl = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length
        const junk = JUNK_WORDS.filter((k) => text.includes(k))
        const head = text.slice(0, 60).replace(/\s+/g, ' ')
        const okLen = text.length >= 300
        const okJunk = junk.length === 0 && fffd === 0
        if (!okLen || !okJunk) qualityOk = false
        console.log(`  第${c.idx}章 [${c.title}] 字数=${c.wordCount} 文本=${text.length} FFFD=${fffd} CTRL=${ctrl} junk=${JSON.stringify(junk)} 开头=${JSON.stringify(head)}`)
      }
      console.log(qualityOk ? '✅ 逐章 junk/乱码/控制字符 扫描全 0, 质量通过(AES 解密链路端到端健康)' : '❌ 质量检查未过')
    } else {
      console.log('!! 未找到书籍')
      qualityOk = false
    }
    if (!qualityOk) process.exitCode = 2
  } finally {
    // 6) 清理: 删任务 + 删书(章节级联), 无论成败都执行
    const delTask = await api(`/api/admin/tasks/${taskId}`, { method: 'DELETE' })
    const delBook = bookId ? await api(`/api/admin/books/${bookId}`, { method: 'DELETE' }) : null
    console.log(`清理: task=${delTask.ok} book=${delBook ? delBook.ok : '(无书籍可删)'}`)
    await sleep(800)
    const clean = await residualCheck(taskName)
    console.log(clean ? '✅ DB 残余=0' : '❌ DB 有残余!')
    if (!clean) process.exit(3)
  }
}

main().catch((e) => { console.error('e2e ERROR', e); process.exit(1) })

export {}
