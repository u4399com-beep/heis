// ============================================================
// Task ii-a 修复证据脚本 (Bun, HTTP+模块级; DB 净变更=0: 有效POST建行→删除还原)
// A) admin/downloads POST: inFlightGenerations 在入参校验前占位, 校验失败路径
//    (obfuscateMode 非法 / siteUrl 非法)直接 return 不回收 → 每次失败请求永久烧掉
//    1/3 并发额度, 3 次后所有生成请求 429 直至进程重启(gg-a 引入的回归缺口)。
//    断言: 连续 4 次非法 POST 全 400(第 4 次修前=429)+ 1 次有效 POST 200(修前=429)
//    + 任务删除还原 downloads 计数与 data/downloads 目录。
// B) public/data.ts fetchFooterLinks: in-flight 去重无视 siteId —— 换站瞬间新站
//    复用旧站的在途 Promise, 链轮数据按"旧站排除旧站"计算, 可能出现指向当前站的
//    链接(违反 links.ts「永不指向当前站」不变量)且持续到下次换站。
//    断言: 并发两次不同 siteId 必须各自发起请求(URL 各带自己的 site 参数);
//    同 siteId 并发仍去重(语义保持)。
// 运行: bun scripts/verify-ii-a-fixes.ts
// ============================================================
export {}

const BASE = 'http://localhost:3000'
let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!ok) failures++
}

async function apiPost(path: string, body: unknown): Promise<{ status: number; json: { ok?: boolean; message?: string; data?: unknown } }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; data?: unknown }
  return { status: res.status, json }
}

async function main(): Promise<void> {
  /* ---------------- A. downloads 并发额度泄漏 ---------------- */
  console.log('\n--- A. downloads POST 入参校验失败路径的并发额度占用 ---')
  const booksRaw = await fetch(`${BASE}/api/admin/books?page=1&size=50`)
  const booksJson = (await booksRaw.json()) as { ok?: boolean; data?: { books?: { id: string; name: string; _count?: { chapters: number } }[] } }
  const books = booksJson?.data?.books || []
  const withChapters = books.filter((b) => (b._count?.chapters || 0) > 0)
  if (!withChapters.length) {
    console.log('❌ 库内无带章节书籍, A 段无法执行')
    failures++
  } else {
    // 选章节最少的书(有效 POST 生成最快, 便于清理还原)
    const smallest = [...withChapters].sort((a, b) => (a._count?.chapters || 0) - (b._count?.chapters || 0))[0]
    const bookId = smallest.id
    console.log(`探针书: 《${smallest.name}》 chapters=${smallest._count?.chapters} id=${bookId}`)

    const stats0 = (await (await fetch(`${BASE}/api/admin/stats`)).json()) as { data?: { downloads: number } }
    const downloadsBefore = stats0.data?.downloads ?? -1

    // 3 次非法 POST(obfuscateMode 非法) — 走"占位后校验失败"路径
    const r1 = await apiPost('/api/admin/downloads', { bookId, obfuscateMode: 'ii-a-bogus' })
    const r2 = await apiPost('/api/admin/downloads', { bookId, obfuscateMode: 'ii-a-bogus' })
    const r3 = await apiPost('/api/admin/downloads', { bookId, siteUrl: 'not a url at all' })
    check('非法 POST ×3 各自 400(不建任务)', r1.status === 400 && r2.status === 400 && r3.status === 400, `${r1.status}/${r2.status}/${r3.status} ${r1.json.message || ''}`)

    // 第 4 次非法 POST: 修复后仍应 400(额度未被烧); 修前 429(3 个额度已全部漏光)
    const r4 = await apiPost('/api/admin/downloads', { bookId, obfuscateMode: 'ii-a-bogus' })
    check('第 4 次非法 POST 仍 400(额度未泄漏)', r4.status === 400, `status=${r4.status} ${r4.json.message || ''}`)

    // 有效 POST: 修复后应 200(容量完好); 修前 429
    const rv = await apiPost('/api/admin/downloads', { bookId, siteInfo: false, insertAds: false, obfuscate: false })
    check('有效 POST 200(并发容量完好)', rv.status === 200 && rv.json.ok === true, `status=${rv.status} ${rv.json.message || ''}`)

    if (rv.status === 200 && rv.json.ok) {
      const job = rv.json.data as { id: string; status: string }
      // 等待生成终态(避免删中途任务留孤儿成品文件), 上限 90s
      let finalStatus = job.status
      for (let i = 0; i < 90 && (finalStatus === 'pending' || finalStatus === 'running'); i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const jr = (await (await fetch(`${BASE}/api/admin/downloads/${job.id}`)).json()) as { data?: { status: string } }
        finalStatus = jr?.data?.status || 'gone'
      }
      const del = await fetch(`${BASE}/api/admin/downloads/${job.id}`, { method: 'DELETE' })
      check('探针任务已删除还原', del.status === 200, `生成终态=${finalStatus}`)
    }

    const stats1 = (await (await fetch(`${BASE}/api/admin/stats`)).json()) as { data?: { downloads: number } }
    check('downloads 计数还原', (stats1.data?.downloads ?? -1) === downloadsBefore, `before=${downloadsBefore} after=${stats1.data?.downloads}`)
  }

  /* ---------------- B. fetchFooterLinks in-flight 去重无视 siteId ---------------- */
  console.log('\n--- B. fetchFooterLinks 换站竞态(in-flight 按 siteId 分键) ---')
  const calls: string[] = []
  const realFetch = globalThis.fetch
  // 测试注入 mock fetch(模块在调用时才消费 fetch, import 顺序无碍)
  globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push(url)
    const body = JSON.stringify({ ok: true, data: { friend: [], wheel: [{ text: 'x', url: 'https://x.example/' }], wheelEnabled: true, mode: 'home', count: 1 } })
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const { fetchFooterLinks } = await import('../src/components/public/data')
    const p1 = fetchFooterLinks(false, 'site-aaa')
    const p2 = fetchFooterLinks(false, 'site-bbb')
    const [d1, d2] = await Promise.all([p1, p2])
    check('不同 siteId 并发各发请求(共 2 次)', calls.length === 2, `calls=${calls.length} [${calls.join(' | ')}]`)
    check('第 2 次请求携带自己的 site=site-bbb', calls[1]?.includes('site=site-bbb') === true, calls[1] || '-')
    check('两次调用都拿到数据', d1 !== null && d2 !== null, `d1=${d1 ? 'ok' : 'null'} d2=${d2 ? 'ok' : 'null'}`)

    // 同 siteId 并发仍去重(既有语义保持)
    calls.length = 0
    // ii-c 收尾修: 用 holder 对象传闭包赋值 —— 直接 let releaseC: (() => void) | null 会被
    // TS 控制流分析 narrow 成 null, 后续 releaseC?.() 报 never 调用
    const holder: { release: (() => void) | null } = { release: null }
    globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push(url)
      await new Promise<void>((r) => (holder.release = r))
      return new Response(JSON.stringify({ ok: true, data: { friend: [], wheel: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const pc1 = fetchFooterLinks(false, 'site-ccc')
    const pc2 = fetchFooterLinks(false, 'site-ccc')
    await new Promise((r) => setTimeout(r, 30))
    holder.release?.()
    const dc = await Promise.all([pc1, pc2])
    check('同 siteId 并发仍去重(共 1 次请求)', calls.length === 1, `calls=${calls.length}`)
    check('同站并发两调用共享同一结果', dc[0] !== null && dc[1] !== null)
  } finally {
    globalThis.fetch = realFetch
  }

  console.log(`\n===== verify-ii-a-fixes: ${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} =====`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify crashed:', e)
  process.exit(1)
})
