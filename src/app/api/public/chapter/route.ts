// 前台章节内容(阅读页)
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { readChapterTxt } from '@/lib/crawl/storage'
import { withGuard, str } from '../../_lib/http'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const id = str(url.searchParams.get('id'), 64).trim()
    if (!id) return fail('缺少id')

    const ch = await db.chapter.findUnique({
      where: { id },
      include: { book: { select: { id: true, name: true, author: true, status: true, keywords: true } } },
    })
    if (!ch) return fail('章节不存在', 404)

    let content = ch.content || ''
    if (ch.storage === 'txt' && ch.filePath) {
      const raw = await readChapterTxt(ch.filePath)
      if (raw) {
        content = raw.split('\n').slice(1).join('\n').trim()
        // 修复(存储型注入面): txt 文件内容是 htmlToPlainText 产物 —— 实体已解码, 源站
        // "&lt;img src=x onerror=…&gt;" 这类实体编码载荷在落盘时还原成标签字面量;
        // 此处按空行切段后 <p>${p}</p> 直拼, 前台 ReadView 检测到内容含 <p> 会原样
        // 放行 dangerouslySetInnerHTML → 字面量成为活动节点。段落内容先转义 & < >
        // 再包 <p>(与 ReadView 对无标签纯文本的转义分支同语义)
        content = content
          .split(/\n{2,}/)
          .map((p) => `<p>${p.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
          .join('')
      }
    }

    const [prev, next] = await Promise.all([
      db.chapter.findFirst({ where: { bookId: ch.bookId, idx: { lt: ch.idx } }, orderBy: { idx: 'desc' }, select: { id: true, title: true } }),
      db.chapter.findFirst({ where: { bookId: ch.bookId, idx: { gt: ch.idx } }, orderBy: { idx: 'asc' }, select: { id: true, title: true } }),
    ])

    return ok({
      chapter: {
        id: ch.id,
        idx: ch.idx,
        title: ch.title,
        content,
        wordCount: ch.wordCount,
        storage: ch.storage,
      },
      book: ch.book,
      prev,
      next,
    })
  })
}
