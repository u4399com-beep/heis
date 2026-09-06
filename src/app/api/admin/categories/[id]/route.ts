// 分类更新/删除
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, str, clampInt } from '../../../_lib/http'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const exist = await db.category.findUnique({ where: { id } })
    if (!exist) return fail('分类不存在', 404)

    const data: Record<string, unknown> = {}
    if (body?.name !== undefined) {
      const name = str(body.name, 50).trim()
      if (!name) return fail('分类名不能为空')
      data.name = name
    }
    if (body?.sortOrder !== undefined) data.sortOrder = clampInt(body.sortOrder, 0, 0, 1_000_000)
    try {
      const cat = await db.category.update({ where: { id }, data })
      return ok(cat)
    } catch (e: any) {
      // name 有唯一约束: 改成已存在的分类名原会裸 500(withGuard 吞成"服务器内部错误"), 转友好 400
      if (e?.code === 'P2002') return fail('分类名已存在, 请换一个名称')
      // tt-b: 预检与 update 间的并发删除窗口(P2025)原会裸 500 → 404 契约
      if (e?.code === 'P2025') return fail('分类不存在, 请刷新后重试', 404)
      throw e
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const exist = await db.category.findUnique({ where: { id } })
    if (!exist) return fail('分类不存在', 404)
    const count = await db.book.count({ where: { categoryId: id } })
    if (count > 0) return fail(`该分类下有 ${count} 本书, 请先移除`)
    try {
      await db.category.delete({ where: { id } })
    } catch (e: any) {
      // tt-b: 预检与 delete 间的并发变更窗口原会裸 500:
      // P2003 = 并发期间有书归入本分类(采集 smartCategory 在途) / P2025 = 分类已被并发删除
      if (e?.code === 'P2003') return fail('删除时发现分类下有书籍(并发变更), 请刷新后重试', 409)
      if (e?.code === 'P2025') return fail('分类不存在, 请刷新后重试', 404)
      throw e
    }
    return ok()
  })
}
