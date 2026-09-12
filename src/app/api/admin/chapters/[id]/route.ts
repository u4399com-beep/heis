// 章节管理(查看/编辑正文/删除)
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { readChapterTxt, DATA_ROOT, NOVELS_DIR } from '@/lib/crawl/storage'
import { promises as fs } from 'fs'
import path from 'path'
import { withGuard, str, safeJoin } from '../../../_lib/http'
import { decodeEntitiesOnce, cleanContentHtml } from '@/lib/crawl/cleaner'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const ch = await db.chapter.findUnique({ where: { id } })
    if (!ch) return fail('章节不存在', 404)
    let content = ch.content || ''
    if (ch.storage === 'txt' && ch.filePath) {
      content = (await readChapterTxt(ch.filePath)) || ''
      // 去掉首行标题(API-22: slice(1) 后保留的空行也清掉, 否则返回正文开头会出现 \n\n)
      content = content.split('\n').slice(1).join('\n').replace(/^\n+/, '')
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
      // R3-34: 后台编辑保存的正文必须经清洗消毒后再落库 —— 管理员/导入流程可能直接粘贴
      // 含 <img onerror=...>/<script> 等载荷的 HTML, 前台 ReadView 以 dangerouslySetInnerHTML
      // 渲染章节正文, 存储型 XSS 会影响所有读者。cleanContentHtml 内已剥 script/iframe/on*/javascript:
      // 与白名单外的标签, 仅保留 p/br/b/em/a(href http(s))/img(src http(s)+alt)。wordCount
      // 同样基于清洗后的内容统计, 与入库内容自洽
      const content: string = cleanContentHtml(body.content)
      newContent = content
      data.content = content
      // API-16: 先剥标签再解实体统计字数 —— 原实现把 &nbsp;/&lt; 等 HTML 实体当 4~6 字符计入字数, 高估
      data.wordCount = decodeEntitiesOnce(content.replace(/<[^>]+>/g, '')).length
    }
    if (data.title === undefined && data.content === undefined) {
      return fail('没有需要保存的内容')
    }

    // txt 存储的章节: 正文以文件为准, 必须同步回写文件(否则编辑保存后读取仍是旧文)
    if (exist.storage === 'txt' && exist.filePath) {
      const full = safeJoin(DATA_ROOT, exist.filePath)
      // API-10: 加 path.sep 边界 —— 单纯 startsWith(NOVELS_DIR) 会放行 /data/novelsevil/... 类前缀碰撞
      if (!full || !full.startsWith(NOVELS_DIR + path.sep)) return fail('章节文件路径非法, 拒绝写入', 500)
      const title = newTitle ?? exist.title
      let bodyText: string
      if (newContent !== null) {
        // API-4: 正确的 HTML→文本转换 —— 块级闭合标签先转 \n, 否则 <p>aaa</p><p>bbb</p> 会被
        // 压成 aaabbb(段落粘连); br 单独处理; 最后剥剩余 inline 标签并规范连续空行
        bodyText = newContent
          .replace(/<\s*br\s*\/?>/gi, '\n')
          .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      } else {
        // 仅改标题(正文未提供)时必须保留文件原有正文(跳过首行标题取余下部分):
        // 原实现落 (newContent ?? '') 会把整个章节正文清空 —— 保存一次即不可逆丢数据
        const raw = await readChapterTxt(exist.filePath)
        bodyText = raw ? raw.split('\n').slice(1).join('\n') : ''
      }
      // agent-AA(R6-5 复检): 原子写 —— 先 .tmp 落盘, rename 到 full, 与 admin/books/batch
      // t2s 路径同款。修前直接 fs.writeFile(full, ...) 与后续 db.chapter.update 之间存在窗口:
      // DB update 抛错(并发级联删除 P2025 等)后, 文件已被改写但 DB 还指着旧标题/旧正文,
      // 下次 GET 读到的就是新正文 + 旧标题(不一致状态)。原子 rename 在同分区是 POSIX 原子操作,
      // 失败回滚 .tmp 即可。
      const tmp = `${full}.tmp-${exist.id}-${Date.now()}`
      try {
        await fs.writeFile(tmp, `${title}\n\n${bodyText}\n`, 'utf-8')
      } catch {
        try { await fs.rm(tmp, { force: true }) } catch { /* ignore */ }
        return fail('章节文件写入失败', 500)
      }
      try {
        await fs.rename(tmp, full)
      } catch {
        // rename 失败极罕见(同分区权限/磁盘故障), 视为本次写失败但 DB 未更新, 清理 .tmp 后报错
        try { await fs.rm(tmp, { force: true }) } catch { /* ignore */ }
        return fail('章节文件写入失败(原子改名失败)', 500)
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
      // API-10: 加 path.sep 边界 —— 单纯 startsWith(NOVELS_DIR) 会放行 /data/novelsevil/... 类前缀碰撞
      if (full && full.startsWith(NOVELS_DIR + path.sep)) {
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
