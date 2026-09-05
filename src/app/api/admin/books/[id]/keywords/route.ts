// 书籍下拉关键词(搜索引擎suggest聚合) — 刷新/查看
import { readBody, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { fetchSuggestKeywords, mergeSuggestWords } from '@/lib/crawl/suggest'
import { withGuard, str, clampInt } from '../../../../_lib/http'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const book = await db.book.findUnique({ where: { id }, select: { id: true } })
    if (!book) return fail('书籍不存在', 404)
    const tags = await db.bookTag.findMany({ where: { bookId: id }, orderBy: { hits: 'desc' } })
    return ok(tags)
  })
}

// POST: 重新抓取搜索引擎下拉词
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const book = await db.book.findUnique({ where: { id } })
    if (!book) return fail('书籍不存在', 404)

    // 关键词: 自定义词优先, 回退书名; 去LIKE通配符无必要(非DB模糊查询)但需截断
    const kw = str(body?.keyword, 100).trim() || book.name.trim().slice(0, 100)
    if (!kw) return fail('缺少关键词且书籍名为空, 无法抓取下拉词')
    const limit = clampInt(body?.limit, 25, 1, 100)

    let results
    try {
      results = await fetchSuggestKeywords(kw)
    } catch {
      return fail('下拉词抓取失败(引擎均不可达), 请稍后重试', 502)
    }
    const words = mergeSuggestWords(kw, results, limit)

    let added = 0
    let updated = 0
    for (const w of words) {
      const tag = str(w, 60).trim()
      if (!tag) continue
      // upsert 原子化: 原 findUnique→create 两步在并发刷新(双端同时点刷新/重试)下
      // 双双判"不存在"后各 create 一次, 后者撞 (bookId,tag) 唯一约束 P2003 裸 500 且部分写入
      const row = await db.bookTag.upsert({
        where: { bookId_tag: { bookId: id, tag } },
        create: { bookId: id, tag, source: 'suggest' },
        update: { hits: { increment: 1 } },
      })
      // create 分支 hits 保持默认 0; update 分支命中后 hits ≥ 1 → 以此区分新增/更新
      if (row.hits === 0) added++
      else updated++
    }
    // 附加手动标签: 逐项字符串化+截断
    if (Array.isArray(body?.manualTags)) {
      // tt-b: 元素类型窄化 — 非字符串元素(对象/数字)原被 String() 化成 "[object Object]"
      // 等垃圾入库为标签, 仅接受字符串项
      const manualTags = body.manualTags.filter((t: unknown) => typeof t === 'string').slice(0, 50)
      for (const t of manualTags) {
        const tag = str(t, 60).trim()
        if (!tag) continue
        await db.bookTag.upsert({
          where: { bookId_tag: { bookId: id, tag } },
          create: { bookId: id, tag, source: 'manual' },
          update: {},
        })
      }
    }
    const okEngines = results.filter((r) => r.ok).map((r) => r.engine)
    return ok({ added, updated, words, engines: okEngines, engineDetail: results })
  })
}

// DELETE ?tag= 移除标签
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const url = new URL(req.url)
    const tag = str(url.searchParams.get('tag'), 100).trim()
    if (!tag) return fail('缺少tag参数')
    await db.bookTag.deleteMany({ where: { bookId: id, tag } })
    return ok()
  })
}
