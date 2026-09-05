// 书籍详情/编辑/删除
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { deleteBookTxt } from '@/lib/crawl/storage'
import { withGuard, str, httpUrl } from '../../../_lib/http'
import { removeCoverIfOrphan } from '../_cover'

const BOOK_STATUSES = ['unknown', 'ongoing', 'completed'] as const

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const book = await db.book.findUnique({
      where: { id },
      include: {
        category: true,
        tags: { orderBy: { hits: 'desc' } },
        _count: { select: { chapters: true } },
      },
    })
    if (!book) return fail('书籍不存在', 404)
    return ok(book)
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const exist = await db.book.findUnique({ where: { id } })
    if (!exist) return fail('书籍不存在', 404)

    const data: Record<string, unknown> = {}
    if (body?.name !== undefined) {
      const name = str(body.name, 200).trim()
      if (!name) return fail('书名不能为空')
      data.name = name
    }
    if (body?.author !== undefined) data.author = str(body.author, 100).trim() || '佚名'
    if (body?.intro !== undefined) data.intro = str(body.intro, 20_000)
    if (body?.cover !== undefined) data.cover = str(body.cover, 2000)
    if (body?.status !== undefined) {
      if (!(BOOK_STATUSES as readonly string[]).includes(body.status)) return fail('无效的书籍状态')
      data.status = body.status
    }
    if (body?.keywords !== undefined) data.keywords = str(body.keywords, 500)
    if (body?.storageMode !== undefined) {
      if (!['db', 'txt'].includes(body.storageMode)) return fail('无效的存储方式')
      data.storageMode = body.storageMode
    }
    if (body?.latestChapter !== undefined) data.latestChapter = str(body.latestChapter, 200)
    // 来源URL: 有值时必须是合法 http(s), 与 POST 行为一致(防脏数据流入重采集)
    if (body?.sourceUrl !== undefined) {
      const u = httpUrl(body.sourceUrl)
      if (body.sourceUrl && !u) return fail('来源地址格式非法(需 http/https)')
      data.sourceUrl = u || ''
    }
    if (body?.sourceRuleId !== undefined) {
      const rid = str(body.sourceRuleId, 64).trim() || null
      if (rid) {
        const rule = await db.rule.findUnique({ where: { id: rid } })
        if (!rule) return fail('来源规则不存在', 404)
      }
      data.sourceRuleId = rid
    }
    if (body?.categoryId !== undefined) {
      const cid = str(body.categoryId, 64).trim() || null
      if (cid) {
        const cat = await db.category.findUnique({ where: { id: cid } })
        if (!cat) return fail('所选分类不存在', 404)
      }
      data.categoryId = cid
    }

    // FK 竞态兜底(主控z遗留项): categoryId/sourceRuleId 校验通过后目标记录被并发删除,
    // update 落外键约束 P2003 原会裸 500 → 转 409 引导刷新重试
    try {
      const book = await db.book.update({ where: { id }, data })
      return ok(book)
    } catch (e: any) {
      if (e?.code === 'P2003') return fail('所选分类或来源规则已被删除, 请刷新后重试', 409)
      // tt-b: 预检与 update 间的并发删除窗口(P2025)原会裸 500 → 404 契约
      if (e?.code === 'P2025') return fail('书籍不存在, 请刷新后重试', 404)
      throw e
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const exist = await db.book.findUnique({ where: { id } })
    if (!exist) return fail('书籍不存在', 404)
    await deleteBookTxt(id)
    // 章节/标签/下载任务均由 onDelete: Cascade 级联清理
    try {
      await db.book.delete({ where: { id } })
    } catch (e: any) {
      // tt-b: 预检与 delete 间的并发删除窗口(P2025)原会裸 500 → 404 契约
      if (e?.code === 'P2025') return fail('书籍不存在, 请刷新后重试', 404)
      throw e
    }
    // 本地独占封面文件清理(共享引用/外链不动, 尽力而为)
    await removeCoverIfOrphan(exist.cover)
    return ok()
  })
}
