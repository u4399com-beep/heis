// ============================================================
// Task ff-c 验证脚本 — 非crawl区三修复 (修前失败/修后通过)
// A. 前台书籍页 TXT 下载死链: /api/public/download?book=<bookId> 修前 404/缺少id, 修后 200
//    (?id=<jobId> 语义保持不变 — 管理端下载按钮兼容)
// B. 分类重名 PUT 裸 500 → 修后 400 友好消息
// C. 书籍删除遗留孤儿封面文件 → 修后: 独占封面随删, 共享封面保留, 全删才清
// 运行: bun scripts/verify-ff-c-fixes.ts (全程自建数据, 结束自清理)
// ============================================================
export {}

// 根 tsconfig 无 @types/bun(cc-d2 裁定), Bun 全局用最小类型面(probe-ee-a-wanben-recon 同款 shim)
declare const Bun: {
  write(path: string, data: string | ArrayBufferView | ArrayBuffer): Promise<number>
  file(path: string): { exists(): Promise<boolean> }
}

const BASE = 'http://localhost:3000'
const DATA_COVERS = `${process.cwd()}/data/covers`

let failures = 0
function check(name: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` | ${extra}` : ''}`)
  if (!ok) failures++
}

async function req(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: { ok?: boolean; message?: string; data?: unknown } | null }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let json: { ok?: boolean; message?: string; data?: unknown } | null = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}

async function existsFile(p: string): Promise<boolean> {
  try {
    const f = await Bun.file(p).exists()
    return f
  } catch {
    return false
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('== ff-c 三修复验证 ==')

  /* ================= A. 公共下载接口按书取成品 ================= */
  console.log('\n-- A. /api/public/download?book=<bookId> --')
  // 选一本章节最少的书生成成品(联剑风云录 41 章)
  const booksRes = await req('GET', '/api/admin/books?size=50')
  const books = ((booksRes.json?.data as { books?: { id: string; name: string; _count?: { chapters: number } }[] })?.books) || []
  const target = books.filter((b) => (b._count?.chapters || 0) > 0).sort((a, b) => (a._count?.chapters || 0) - (b._count?.chapters || 0))[0]
  if (!target) {
    check('A0 前置: 存在带章节书籍', false)
    process.exit(1)
  }
  console.log(`目标书: ${target.name.slice(0, 16)}(${target._count?.chapters}章) ${target.id}`)
  const created = await req('POST', '/api/admin/downloads', { bookId: target.id, siteInfo: false, insertAds: false, obfuscate: false })
  const job = (created.json?.data ?? null) as { id?: string } | null
  check('A0 前置: 生成任务创建', created.status === 200 && !!job?.id, `status=${created.status}`)
  let jobId = job?.id || ''
  // 等待完成(小书通常<5s, 上限 60s)
  let done = false
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const st = await req('GET', `/api/admin/downloads/${jobId}`)
    const j = (st.json?.data ?? null) as { status?: string; size?: number } | null
    if (j?.status === 'done') {
      done = true
      break
    }
    if (j?.status === 'error') break
  }
  check('A0 前置: 成品生成完成', done, `job=${jobId}`)
  if (done) {
    // 修前: ?book= 未实现 → 缺少id/404; 修后: 200 且 Content-Length>0
    const byBook = await fetch(`${BASE}/api/public/download?book=${target.id}`)
    const buf = byBook.status === 200 ? await byBook.arrayBuffer() : null
    check('A1 按书下载 200', byBook.status === 200, `status=${byBook.status}`)
    check('A2 按书下载内容非空', (buf?.byteLength || 0) > 1000, `bytes=${buf?.byteLength}`)
    check('A3 Content-Disposition 存在', byBook.headers.get('content-disposition')?.includes('attachment') === true)
    // ?id=<jobId> 语义不变(管理端路径)
    const byJob = await fetch(`${BASE}/api/public/download?id=${jobId}`)
    check('A4 按任务id下载仍 200(兼容)', byJob.status === 200, `status=${byJob.status}`)
    // 无成品书 → 404
    const noJob = books.find((b) => b.id !== target.id && (b._count?.chapters || 0) > 0)
    if (noJob) {
      const absent = await fetch(`${BASE}/api/public/download?book=${noJob.id}`)
      check('A5 无成品书 404', absent.status === 404, `status=${absent.status}`)
    }
  }

  /* ================= B. 分类重名 PUT ================= */
  console.log('\n-- B. categories PUT 重名 → 400 (修前 500) --')
  const catsRes = await req('GET', '/api/admin/categories')
  const cats = ((catsRes.json?.data ?? []) as { id: string; name: string }[]) || []
  const other = cats.find((c) => c.name !== 'ff-c-临时分类')
  const mk = await req('POST', '/api/admin/categories', { name: 'ff-c-临时分类' })
  const tempCat = (mk.json?.data ?? null) as { id?: string } | null
  check('B0 前置: 临时分类创建', mk.status === 200 && !!tempCat?.id)
  if (tempCat?.id && other) {
    const dup = await req('PUT', `/api/admin/categories/${tempCat.id}`, { name: other.name })
    check('B1 重名改名为 400', dup.status === 400, `status=${dup.status} msg=${dup.json?.message?.slice(0, 40)}`)
    check('B2 返回 ok=false 信封', dup.json?.ok === false)
    const normal = await req('PUT', `/api/admin/categories/${tempCat.id}`, { name: 'ff-c-临时分类2' })
    check('B3 正常改名仍 200', normal.status === 200, `status=${normal.status}`)
  }

  /* ================= C. 封面孤儿清理 ================= */
  console.log('\n-- C. 书籍删除清理本地封面文件 --')
  const coverRel = 'covers/ff-c-test-cover.webp'
  const coverAbs = `${DATA_COVERS}/ff-c-test-cover.webp`
  await Bun.write(coverAbs, new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0])) // RIFF 魔数假体
  check('C0 前置: 假封面文件已写入', await existsFile(coverAbs))
  const mk1 = await req('POST', '/api/admin/books', { name: 'ff-c封面清理测试书1', cover: coverRel })
  const b1 = (mk1.json?.data ?? null) as { id?: string } | null
  check('C1 前置: 书1创建(独占封面)', mk1.status === 200 && !!b1?.id)
  if (b1?.id) {
    const del = await req('DELETE', `/api/admin/books/${b1.id}`)
    check('C2 书1删除 200', del.status === 200, `status=${del.status}`)
    await sleep(300)
    check('C3 独占封面文件随删', !(await existsFile(coverAbs)))
  }
  // 共享封面: 两本书同一封面 → 删一本文件保留
  await Bun.write(coverAbs, new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]))
  const mk2 = await req('POST', '/api/admin/books', { name: 'ff-c封面清理测试书2', cover: coverRel })
  const mk3 = await req('POST', '/api/admin/books', { name: 'ff-c封面清理测试书3', cover: coverRel })
  const b2 = (mk2.json?.data ?? null) as { id?: string } | null
  const b3 = (mk3.json?.data ?? null) as { id?: string } | null
  check('C4 前置: 书2/书3创建(共享封面)', mk2.status === 200 && mk3.status === 200 && !!b2?.id && !!b3?.id)
  if (b2?.id && b3?.id) {
    await req('DELETE', `/api/admin/books/${b2.id}`)
    await sleep(300)
    check('C5 仍被书3引用 → 文件保留', await existsFile(coverAbs))
    await req('DELETE', `/api/admin/books/${b3.id}`)
    await sleep(300)
    check('C6 全部引用删除 → 文件清理', !(await existsFile(coverAbs)))
  }
  // 外链封面: 删除不应触碰文件系统
  const mk4 = await req('POST', '/api/admin/books', { name: 'ff-c外链封面书', cover: 'https://example.com/x.webp' })
  const b4 = (mk4.json?.data ?? null) as { id?: string } | null
  if (b4?.id) {
    const del = await req('DELETE', `/api/admin/books/${b4.id}`)
    check('C7 外链封面书删除 200(无文件操作)', del.status === 200)
  }

  /* ================= 清理 ================= */
  console.log('\n-- 清理测试数据 --')
  if (tempCat?.id) {
    const d = await req('DELETE', `/api/admin/categories/${tempCat.id}`)
    check('清理: 临时分类删除', d.status === 200, `status=${d.status}`)
  }
  if (jobId) {
    const d = await req('DELETE', `/api/admin/downloads/${jobId}`)
    check('清理: 测试下载任务+成品删除', d.status === 200, `status=${d.status}`)
  }
  const list = await req('GET', '/api/admin/books?size=50')
  const remain = (((list.json?.data as { books?: { id: string; name: string }[] })?.books) || []).filter((b) => b.name.startsWith('ff-c'))
  check('清理: 无 ff-c 残留书籍', remain.length === 0, remain.map((b) => b.name).join(','))

  console.log(`\n== ff-c 汇总: 失败项 = ${failures} ==`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('verify crashed:', e)
  process.exit(1)
})
