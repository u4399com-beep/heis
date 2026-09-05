// 章节管理(查看/编辑正文/删除)
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { readChapterTxt, DATA_ROOT, NOVELS_DIR } from '@/lib/crawl/storage'
import { promises as fs } from 'fs'
import { withGuard, str, safeJoin } from '../../../_lib/http'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const ch = await db.chapter.findUnique({ where: { id } })
    if (!ch) return fail('章节不存在', 404)
    let content = ch.content || ''
    if (ch.storage === 'txt' && ch.filePath) {
      content = (await readChapterTxt(ch.filePath)) || ''
      // 去掉首行标题
      content = content.split('\n').slice(1).join('\n')
    }
    return ok({ ...ch, content })
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const exist = await db.chapter.findUnique({ where: { id } })
    if (!exist) return fail('章节不存在', 404)

    const data: Record<string, unknown> = {}
    let newTitle: string | null = null
    if (body?.title !== undefined) {
      newTitle = str(body.title, 500).trim()
      if (!newTitle) return fail('章节标题不能为空')
      data.title = newTitle
    }
    let newContent: string | null = null
    if (body?.content !== undefined) {
      if (typeof body.content !== 'string') return fail('正文必须是字符串')
      // 修复(y-c): App Router route handler 无框架级 body 限制, 不鈐会被超大正文撑爆
      // SQLite 行/内存(正常章节 3k~20k 字符); 超限 400 且先于任何文件/DB 写入
      const CHAPTER_CONTENT_MAX = 500_000
      if (body.content.length > CHAPTER_CONTENT_MAX) {
        return fail(`正文超过长度上限(${CHAPTER_CONTENT_MAX} 字符)`, 400)
      }
      const content: string = body.content
      newContent = content
      data.content = content
      data.wordCount = content.replace(/<[^>]+>/g, '').length
    }
    if (data.title === undefined && data.content === undefined) {
      return fail('没有需要保存的内容')
    }

    // txt 存储的章节: 正文以文件为准, 必须同步回写文件(否则编辑保存后读取仍是旧文)
    if (exist.storage === 'txt' && exist.filePath) {
      const full = safeJoin(DATA_ROOT, exist.filePath)
      if (!full || !full.startsWith(NOVELS_DIR)) return fail('章节文件路径非法, 拒绝写入', 500)
      const title = newTitle ?? exist.title
      let bodyText: string
      if (newContent !== null) {
        bodyText = newContent.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n')
      } else {
        // 仅改标题(正文未提供)时必须保留文件原有正文(跳过首行标题取余下部分):
        // 原实现落 (newContent ?? '') 会把整个章节正文清空 —— 保存一次即不可逆丢数据
        const raw = await readChapterTxt(exist.filePath)
        bodyText = raw ? raw.split('\n').slice(1).join('\n') : ''
      }
      try {
        await fs.writeFile(full, `${title}\n\n${bodyText}\n`, 'utf-8')
      } catch {
        return fail('章节文件写入失败', 500)
      }
    }

    try {
      const ch = await db.chapter.update({ where: { id }, data })
      return ok(ch)
    } catch (e: any) {
      // tt-b: 预检与 update 间的并发删除窗口(书籍级联删章节, P2025)原会裸 500 → 404 契约
      if (e?.code === 'P2025') return fail('章节不存在, 请刷新后重试', 404)
      throw e
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const exist = await db.chapter.findUnique({ where: { id } })
    if (!exist) return fail('章节不存在', 404)
    // txt 存储时清理孤儿文件(尽力而为)
    if (exist.storage === 'txt' && exist.filePath) {
      const full = safeJoin(DATA_ROOT, exist.filePath)
      if (full && full.startsWith(NOVELS_DIR)) {
        try { await fs.rm(full, { force: true }) } catch { /* ignore */ }
      }
    }
    try {
      await db.chapter.delete({ where: { id } })
    } catch (e: any) {
      // tt-b: 预检与 delete 间的并发删除窗口(P2025)原会裸 500 → 404 契约
      if (e?.code === 'P2025') return fail('章节不存在, 请刷新后重试', 404)
      throw e
    }
    return ok()
  })
}
