// ============================================================
// 反馈详情 GET / 状态更新 PATCH / 删除 DELETE
// PATCH 接受 { status?, adminNote? } 局部更新
// ============================================================
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, str } from '../../../_lib/http'

export const dynamic = 'force-dynamic'

const STATUS_SET = new Set(['new', 'read', 'resolved', 'ignored'])
const ADMIN_NOTE_MAX = 1000

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const fb = await db.feedback.findUnique({ where: { id } })
    if (!fb) return fail('反馈不存在', 404)
    return ok(fb)
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody<Record<string, any>>(req)
    const exist = await db.feedback.findUnique({ where: { id } })
    if (!exist) return fail('反馈不存在', 404)

    const data: Record<string, unknown> = {}
    if (body?.status !== undefined) {
      const status = str(body.status, 20).trim()
      if (!STATUS_SET.has(status)) return fail('状态值不合法')
      data.status = status
    }
    if (body?.adminNote !== undefined) {
      // R5-17: 剥 HTML 标签 —— adminNote 字段在前端虽以 <Textarea> 纯文本呈现(无
      //  dangerouslySetInnerHTML), 但若被备份导出/邮件回执等下游 HTML 出口渲染, 含
      //  <script>/<img onerror=> 的 adminNote 会触发存储型 XSS。str() 仅截断长度不剥标签。
      const stripped = str(body.adminNote, ADMIN_NOTE_MAX).replace(/<[^>]+>/g, '')
      const note = stripped.slice(0, ADMIN_NOTE_MAX).trim()
      data.adminNote = note || null
    }

    if (Object.keys(data).length === 0) return fail('没有可更新字段')

    try {
      const updated = await db.feedback.update({ where: { id }, data })
      return ok(updated)
    } catch (e: any) {
      if (e?.code === 'P2025') return fail('反馈不存在, 请刷新后重试', 404)
      throw e
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const exist = await db.feedback.findUnique({ where: { id } })
    if (!exist) return fail('反馈不存在', 404)
    try {
      await db.feedback.delete({ where: { id } })
    } catch (e: any) {
      if (e?.code === 'P2025') return fail('反馈不存在, 请刷新后重试', 404)
      throw e
    }
    return ok()
  })
}
