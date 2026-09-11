// 前台章节内容(阅读页)
// 支持按站点配置进行内容分页:
//   - chapterPaginationMode='off': 返回完整正文(向后兼容, totalPages=1)
//   - 'byWords': 每 N 字一页, 自动按段落边界切分(避免破段)
//   - 'byPages': 强制拆为 N 页(均分)
// 兼容 ?page=N; 越界钳到 [1, totalPages]; 不传 page 时回退为完整正文(默认 1 页)
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { readChapterTxt } from '@/lib/crawl/storage'
import { withGuard, str, clampInt, withCache } from '../../_lib/http'

/** 按段落切分章节正文(优先按 <p> 块, 退化按 \n), 返回段落数组 */
function splitParagraphs(html: string): string[] {
  const s = (html || '').trim()
  if (!s) return []
  // 已是 HTML 段落形式: 按 <p>...</p>(含自闭合/单标签) 拆段
  if (/<\s*p\b[^>]*>/i.test(s)) {
    const parts = s
      .split(/<\/\s*p\s*>/i)
      .map((p) => p.replace(/<\s*p\b[^>]*>/i, '').trim())
      .filter(Boolean)
    if (parts.length > 0) return parts.map((p) => `<p>${p}</p>`)
  }
  // 退化: 按双换行切段后包 <p>(与 storage.ts txt 装载一致)
  return s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p}</p>`)
}

/** 按字数累加切分段落: 不破段(段落整体归到当前页, 仅当累加超过阈值且至少已收 1 段才换页) */
function paginateByWords(paragraphs: string[], wordsPerPage: number): string[] {
  if (paragraphs.length === 0) return []
  const pages: string[] = []
  let cur = ''
  let curLen = 0
  for (const p of paragraphs) {
    // 字数估算: 标签 < ... > 不计, 仅中英文/标点字符计 1 字
    const len = p.replace(/<[^>]+>/g, '').length
    if (curLen > 0 && curLen + len > wordsPerPage) {
      pages.push(cur)
      cur = p
      curLen = len
    } else {
      cur += p
      curLen += len
    }
  }
  if (cur) pages.push(cur)
  return pages
}

/** 按段落数均分为 N 页(末页可短) */
function paginateByPages(paragraphs: string[], totalPages: number): string[] {
  if (paragraphs.length === 0) return []
  const n = Math.max(1, totalPages)
  const per = Math.max(1, Math.ceil(paragraphs.length / n))
  const pages: string[] = []
  for (let i = 0; i < paragraphs.length; i += per) {
    pages.push(paragraphs.slice(i, i + per).join(''))
    if (pages.length >= n) {
      // 把剩余段落全部并入最后一页
      if (i + per < paragraphs.length) {
        pages[pages.length - 1] += paragraphs.slice(i + per).join('')
      }
      break
    }
  }
  return pages
}

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const id = str(url.searchParams.get('id'), 64).trim()
    if (!id) return fail('缺少id')

    const ch = await db.chapter.findUnique({
      where: { id },
      include: {
        book: { select: { id: true, name: true, author: true, status: true, keywords: true } },
      },
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

    // 站点分页配置(从 siteId? 或查询串? 间接获取: 章节关联书籍, 书籍无 siteId 字段;
    // 站群逻辑由前台 URL ?site= 决定, 此处从查询串读取 siteId 后查 site 配置)
    const siteId = str(url.searchParams.get('site'), 64).trim()
    let mode = 'off'
    let wordsPerPage = 3000
    let totalPagesTarget = 3
    let chapterSeoAuto = true
    let chapterSeoTitleTemplate = ''
    let chapterSeoDescTemplate = ''
    let chapterSeoKeywordsTemplate = ''
    if (siteId) {
      const site = await db.site.findUnique({
        where: { id: siteId },
        select: {
          chapterPaginationMode: true,
          chapterPaginationWords: true,
          chapterPaginationPages: true,
          chapterSeoAuto: true,
          chapterSeoTitleTemplate: true,
          chapterSeoDescTemplate: true,
          chapterSeoKeywordsTemplate: true,
        },
      })
      if (site) {
        mode = site.chapterPaginationMode || 'off'
        wordsPerPage = site.chapterPaginationWords || 3000
        totalPagesTarget = site.chapterPaginationPages || 3
        chapterSeoAuto = site.chapterSeoAuto !== false
        chapterSeoTitleTemplate = site.chapterSeoTitleTemplate || ''
        chapterSeoDescTemplate = site.chapterSeoDescTemplate || ''
        chapterSeoKeywordsTemplate = site.chapterSeoKeywordsTemplate || ''
      }
    }

    // 计算分页
    let renderedContent = content
    let totalPages = 1
    if (mode === 'byWords' || mode === 'byPages') {
      const paragraphs = splitParagraphs(content)
      const pages = mode === 'byWords' ? paginateByWords(paragraphs, wordsPerPage) : paginateByPages(paragraphs, totalPagesTarget)
      totalPages = Math.max(1, pages.length)
      // page 钳到 [1, totalPages]; 不传时默认 1
      const page = clampInt(url.searchParams.get('page'), 1, 1, totalPages)
      renderedContent = pages[page - 1] || ''
    }

    const currentPage = mode === 'off' ? 1 : Math.min(Math.max(1, clampInt(url.searchParams.get('page'), 1, 1, totalPages)), totalPages)

    return withCache(ok({
      chapter: {
        id: ch.id,
        idx: ch.idx,
        title: ch.title,
        content: renderedContent,
        wordCount: ch.wordCount,
        storage: ch.storage,
      },
      book: ch.book,
      prev,
      next,
      // 分页元数据(向后兼容: off 模式 totalPages=1, currentPage=1)
      pagination: {
        mode,
        totalPages,
        currentPage,
        wordsPerPage: mode === 'byWords' ? wordsPerPage : null,
        pagesTarget: mode === 'byPages' ? totalPagesTarget : null,
      },
      // SEO 模板(前台 useSiteSEO 消费)
      seo: {
        auto: chapterSeoAuto,
        titleTemplate: chapterSeoTitleTemplate,
        descTemplate: chapterSeoDescTemplate,
        keywordsTemplate: chapterSeoKeywordsTemplate,
      },
    }), 60, 120)
  })
}
