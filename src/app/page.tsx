// ============================================================
// 小说管理系统 — 主入口 (唯一路由, server component)
// 通过查询串/伪静态路径在 后台管理 / 前台站群站点 之间切换:
//   /                          → 后台管理
//   /?view=home|book|read|...  → 前台站点(查询串模式)
//   /book/123.html             → 前台书籍页(伪静态模式, 需 rewrite 配合)
//   /?admin=1                  → 强制后台
// 站群: /?view=...&site=<siteId> 或 /book/123.html?site=<siteId>
//
// R24: 改 server component — server 端 fetch site + sites + books + categories 数据传给 PublicSite,
// 让 SSR 时就有 site/theme (避免 SSR sites=[] → theme=THEMES[0]非 clone → skeleton)
// R25: 按 view 类型 fetch 对应数据 — book/chapter/category/ranking/fulltext/search/keyword,
// 让 SSR 时就有完整数据 (clone-* 组件渲染源站 DOM + 数据, 不只是"加载中")
// ============================================================
import { db } from '@/lib/db'
import AdminApp from '@/components/admin/AdminApp'
import PublicSite from '@/components/public/PublicSite'
import { LoginGate } from '@/components/admin/LoginGate'
import { parseViewPath, PSEUDO_PRESETS, type PseudoStaticStyle } from '@/lib/pseudostatic'
import { headers } from 'next/headers'
import type { SiteInfo } from '@/components/public/types'
import { readChapterTxt } from '@/lib/crawl/storage'

// R26: 去掉 force-dynamic — Next.js 16 用 searchParams 的 route 自动 dynamic;
// force-dynamic 导致响应头 Cache-Control: no-store, 预览面板可能因此不断 reload (后台一闪一闪)
// export const dynamic = 'force-dynamic'

type PublicViewObj = {
  view: 'home' | 'book' | 'read' | 'search' | 'keyword' | 'category' | 'history' | 'ranking' | 'fulltext'
  bookId?: string
  chapterId?: string
  q?: string
  tag?: string
  cat?: string
  site?: string
  page?: number
  theme?: string
}

// R34-1A: module-level cache for stable lookups (60s TTL, 与 trafilatura 同款)
// - categories: 所有页型 navigation 都用 (header/nav 渲染), 每次请求都查 DB 浪费
// - sites (status:true): 站点选择器 + 站群导航用, 增删频率低, 60s 缓存可接受
// 内存开销: categories ~60 行 + sites ~数十行, 极小; 命中率: 高 (95%+ 请求是浏览)
// 失效: 自动 TTL 60s + 下次 admin 改完 site/category 60s 内会自然刷新
type CachedRow = { data: any; ts: number }
let categoriesCache: CachedRow | null = null
let sitesCache: CachedRow | null = null
const LOOKUP_CACHE_TTL_MS = 60_000

async function getCachedCategories(): Promise<{ id: string; name: string }[]> {
  if (categoriesCache && Date.now() - categoriesCache.ts < LOOKUP_CACHE_TTL_MS) {
    return categoriesCache.data as { id: string; name: string }[]
  }
  const rows = await db.category.findMany({ orderBy: { sortOrder: 'asc' }, take: 60 })
  const data = rows.map((c: any) => ({ id: c.id, name: c.name }))
  categoriesCache = { data, ts: Date.now() }
  return data
}

async function getCachedSites() {
  if (sitesCache && Date.now() - sitesCache.ts < LOOKUP_CACHE_TTL_MS) {
    return sitesCache.data
  }
  const data = await db.site.findMany({ where: { status: true } })
  sitesCache = { data, ts: Date.now() }
  return data
}

/** 复用 books API 的 SORT_MAP (避免书籍排序注入) — server 端只允许白名单字段 */
const SORT_MAP: Record<string, Record<string, 'asc' | 'desc'>> = {
  latest: { updatedAt: 'desc' },
  words: { wordCount: 'desc' },
  allvisit: { updatedAt: 'desc' },
  allvote: { wordCount: 'desc' },
  goodnum: { updatedAt: 'desc' },
  size: { wordCount: 'desc' },
  lastupdate: { updatedAt: 'desc' },
  postdate: { createdAt: 'desc' },
  fulltext: { updatedAt: 'desc' },
}

/** 段落切分 (复用 chapter API 的 paginate 逻辑用于 SSR initialChapter) */
function splitParagraphs(html: string): string[] {
  const s = (html || '').trim()
  if (!s) return []
  if (/<\s*p\b[^>]*>/i.test(s)) {
    const parts = s
      .split(/<\/\s*p\s*>/i)
      .map((p) => p.replace(/<\s*p\b[^>]*>/i, '').trim())
      .filter(Boolean)
    if (parts.length > 0) return parts.map((p) => `<p>${p}</p>`)
  }
  return s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p}</p>`)
}
function paginateByWords(paragraphs: string[], wordsPerPage: number): string[] {
  if (paragraphs.length === 0) return []
  const pages: string[] = []
  let cur = ''
  let curLen = 0
  for (const p of paragraphs) {
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
function paginateByPages(paragraphs: string[], totalPages: number): string[] {
  if (paragraphs.length === 0) return []
  const n = Math.max(1, totalPages)
  const per = Math.max(1, Math.ceil(paragraphs.length / n))
  const pages: string[] = []
  for (let i = 0; i < paragraphs.length; i += per) {
    pages.push(paragraphs.slice(i, i + per).join(''))
    if (pages.length >= n) {
      if (i + per < paragraphs.length) {
        pages[pages.length - 1] += paragraphs.slice(i + per).join('')
      }
      break
    }
  }
  return pages
}

export default async function Home({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams
  const view = typeof sp.view === 'string' ? sp.view : undefined
  const forceAdmin = sp.admin === '1'

  let publicView: PublicViewObj | undefined = undefined
  if (!forceAdmin && view) {
    publicView = {
      view: view as PublicViewObj['view'],
      bookId: sp.id as string | undefined,
      chapterId: sp.chapter as string | undefined,
      q: sp.q as string | undefined,
      tag: sp.tag as string | undefined,
      cat: sp.cat as string | undefined,
      site: sp.site as string | undefined,
      page: sp.page ? Number(sp.page) : undefined,
      theme: sp.theme as string | undefined,
    }
  } else if (!forceAdmin) {
    const h = await headers()
    const pathname = h.get('x-invoke-path') || h.get('x-pathname') || '/'
    const searchStr = h.get('x-invoke-query') || ''
    if (pathname && pathname !== '/') {
      for (const preset of PSEUDO_PRESETS) {
        const parsed = parseViewPath(pathname, searchStr, preset.id as PseudoStaticStyle)
        if (parsed.view !== 'home' || parsed.bookId || parsed.chapterId || parsed.cat || parsed.tag) {
          publicView = parsed as PublicViewObj
          break
        }
      }
    }
  }

  const isSite = !!publicView && !forceAdmin

  if (isSite && publicView) {
    // R25: server 端 fetch site + sites + (categories always; books always when home/category/ranking/fulltext)
    // + 按 view 类型 fetch 对应数据 (book detail / chapter content / search / keyword)
    // R34-1A: sites + categories 走 module-level 60s TTL 缓存, 减少每次请求 DB round-trip
    const siteId = publicView.site
    const [site, sites, categories] = await Promise.all([
      siteId
        ? db.site.findUnique({ where: { id: siteId } })
        : db.site.findFirst({ where: { isDefault: true } }),
      getCachedSites(),
      getCachedCategories(),
    ])
    const offset = (site as any)?.offset || 0
    const themeId = (site as any)?.themeId || 'aurora'

    // 视图相关数据按 view 类型 fetch
    let initialBooks: any[] | undefined
    let initialBook: any | undefined
    let initialChapter: any | undefined
    let initialSearch: any | undefined
    let initialKeyword: any | undefined

    const v = publicView.view
    const curPage = publicView.page || 1

    if (v === 'home') {
      // 复用 books API 的 offset wrap-around 逻辑 (R24 修复)
      const total0 = await db.book.count({})
      const wrapOffset = total0 > 0 ? offset % total0 : 0
      const books0 = await db.book.findMany({
        orderBy: { updatedAt: 'desc' },
        skip: wrapOffset,
        take: 48,
        include: { category: true },
      })
      initialBooks = books0.map((b: any) => ({
        id: b.id, name: b.name, author: b.author,
        intro: (b.intro || '').slice(0, 120), cover: b.cover, status: b.status,
        wordCount: b.wordCount, latestChapter: b.latestChapter,
        category: b.category?.name || '未分类', categoryId: b.categoryId, updatedAt: b.updatedAt,
      }))
    } else if (v === 'category') {
      // 复用 books API 的 cat 过滤逻辑 (不带 offset wrap, hasFilter=true → effectiveOffset=0)
      const where: Record<string, unknown> = {}
      if (publicView.cat) where.categoryId = publicView.cat
      const size = 24
      const skip = Math.min((curPage - 1) * size, 10000)
      const [total, books0] = await Promise.all([
        db.book.count({ where }),
        db.book.findMany({ where, orderBy: { updatedAt: 'desc' }, skip, take: size, include: { category: true } }),
      ])
      initialBooks = books0.map((b: any) => ({
        id: b.id, name: b.name, author: b.author,
        intro: (b.intro || '').slice(0, 120), cover: b.cover, status: b.status,
        wordCount: b.wordCount, latestChapter: b.latestChapter,
        category: b.category?.name || '未分类', categoryId: b.categoryId, updatedAt: b.updatedAt,
      }))
      // 包成 BooksData 形态让 CategoryView 直接消费
      initialBooks = {
        books: initialBooks,
        total: Math.max(0, total - 0),
        page: curPage,
        size,
      } as any
    } else if (v === 'ranking') {
      // 复用 books API 的 sort=allvisit (R17 暂用 updatedAt) + offset wrap
      const sort = 'allvisit'
      const orderBy = SORT_MAP[sort] || { updatedAt: 'desc' as const }
      const size = 30
      const total0 = await db.book.count({})
      const wrapOffset = total0 > 0 ? offset % total0 : 0
      const skip = Math.min(wrapOffset + (curPage - 1) * size, 10000)
      const [total, books0] = await Promise.all([
        db.book.count({}),
        db.book.findMany({ orderBy, skip, take: size, include: { category: true } }),
      ])
      const list = books0.map((b: any) => ({
        id: b.id, name: b.name, author: b.author,
        intro: (b.intro || '').slice(0, 120), cover: b.cover, status: b.status,
        wordCount: b.wordCount, latestChapter: b.latestChapter,
        category: b.category?.name || '未分类', categoryId: b.categoryId, updatedAt: b.updatedAt,
      }))
      initialBooks = { books: list, total: Math.max(0, total - wrapOffset), page: curPage, size } as any
    } else if (v === 'fulltext') {
      // 复用 books API 的 sort=fulltext (status=completed) + offset wrap
      const sort = 'fulltext'
      const orderBy = SORT_MAP[sort]
      const size = 24
      const where = { status: 'completed' as const }
      const total0 = await db.book.count({ where })
      const wrapOffset = total0 > 0 ? offset % total0 : 0
      const skip = Math.min(wrapOffset + (curPage - 1) * size, 10000)
      const [total, books0] = await Promise.all([
        db.book.count({ where }),
        db.book.findMany({ where, orderBy, skip, take: size, include: { category: true } }),
      ])
      const list = books0.map((b: any) => ({
        id: b.id, name: b.name, author: b.author,
        intro: (b.intro || '').slice(0, 120), cover: b.cover, status: b.status,
        wordCount: b.wordCount, latestChapter: b.latestChapter,
        category: b.category?.name || '未分类', categoryId: b.categoryId, updatedAt: b.updatedAt,
      }))
      initialBooks = { books: list, total: Math.max(0, total - wrapOffset), page: curPage, size } as any
    } else if (v === 'book' && publicView.bookId) {
      // 复用 book API 的查询逻辑 — book detail + chapters + tags + recent + SEO
      const book = await db.book.findUnique({ where: { id: publicView.bookId }, include: { category: true } })
      if (book) {
        const tocPage = curPage
        const tocSize = 100
        const effectiveSkip = Math.min((tocPage - 1) * tocSize, 10000)
        // total 先单独 fetch, 供 recentChapters 条件分支使用 (Promise.all 内部不可引用自身解构变量)
        const total = await db.chapter.count({ where: { bookId: book.id } })
        const [tags, chapters, recentChapters] = await Promise.all([
          db.bookTag.findMany({ where: { bookId: book.id }, orderBy: { hits: 'desc' }, take: 30 }),
          db.chapter.findMany({
            where: { bookId: book.id },
            orderBy: { idx: 'asc' },
            select: { id: true, idx: true, title: true, wordCount: true, volume: true },
            skip: effectiveSkip,
            take: tocSize,
          }),
          total > 0
            ? db.chapter.findMany({
                where: { bookId: book.id },
                orderBy: { idx: 'desc' },
                select: { id: true, idx: true, title: true, wordCount: true, volume: true },
                take: 12,
              }).then(cs => cs.reverse())
            : [],
        ])
        // SEO 配置 (与 book API 同口径)
        // R34-1A: site 已在 page.tsx 顶部 fetch (含 chapterSeo* 字段), 不必再查一次 db.site
        let seoAuto = true
        let seoTitleTemplate = ''
        let seoDescTemplate = ''
        let seoKeywordsTemplate = ''
        if (siteId && site) {
          const s = site as any
          seoAuto = s.chapterSeoAuto !== false
          seoTitleTemplate = s.chapterSeoTitleTemplate || ''
          seoDescTemplate = s.chapterSeoDescTemplate || ''
          seoKeywordsTemplate = s.chapterSeoKeywordsTemplate || ''
        }
        initialBook = {
          book: {
            id: book.id, name: book.name, author: book.author, intro: book.intro,
            cover: book.cover, status: book.status, keywords: book.keywords,
            wordCount: book.wordCount, latestChapter: book.latestChapter,
            category: book.category?.name || '未分类', categoryId: book.categoryId,
            updatedAt: book.updatedAt,
          },
          tocTotal: total, tocPage, tocSize,
          tocTotalPages: Math.ceil(total / tocSize) || 1,
          chapters, recentChapters, tags,
          seo: { auto: seoAuto, titleTemplate: seoTitleTemplate, descTemplate: seoDescTemplate, keywordsTemplate: seoKeywordsTemplate },
        }
      }
    } else if (v === 'read' && publicView.chapterId) {
      // 复用 chapter API 的查询逻辑 — chapter content + book + prev/next + pagination + SEO
      const ch = await db.chapter.findUnique({
        where: { id: publicView.chapterId },
        include: { book: { include: { category: true } } },
      })
      if (ch) {
        let content = ch.content || ''
        if (ch.storage === 'txt' && ch.filePath) {
          const raw = await readChapterTxt(ch.filePath)
          if (raw) {
            content = raw.split('\n').slice(1).join('\n').trim()
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
        // 站点分页配置 (与 chapter API 同口径)
        // R34-1A: site 已在 page.tsx 顶部 fetch (含 chapterPagination*/chapterSeo* 字段), 不必再查一次 db.site
        let mode = 'off'
        let wordsPerPage = 3000
        let totalPagesTarget = 3
        let chapterSeoAuto = true
        let chapterSeoTitleTemplate = ''
        let chapterSeoDescTemplate = ''
        let chapterSeoKeywordsTemplate = ''
        if (siteId && site) {
          const s = site as any
          mode = s.chapterPaginationMode || 'off'
          wordsPerPage = s.chapterPaginationWords || 3000
          totalPagesTarget = s.chapterPaginationPages || 3
          chapterSeoAuto = s.chapterSeoAuto !== false
          chapterSeoTitleTemplate = s.chapterSeoTitleTemplate || ''
          chapterSeoDescTemplate = s.chapterSeoDescTemplate || ''
          chapterSeoKeywordsTemplate = s.chapterSeoKeywordsTemplate || ''
        }
        let renderedContent = content
        let totalPages = 1
        let currentPage = 1
        if (mode === 'byWords' || mode === 'byPages') {
          const paragraphs = splitParagraphs(content)
          const pages = mode === 'byWords' ? paginateByWords(paragraphs, wordsPerPage) : paginateByPages(paragraphs, totalPagesTarget)
          totalPages = Math.max(1, pages.length)
          currentPage = Math.min(Math.max(1, publicView.page || 1), totalPages)
          renderedContent = pages[currentPage - 1] || ''
        }
        initialChapter = {
          chapter: { id: ch.id, idx: ch.idx, title: ch.title, content: renderedContent, wordCount: ch.wordCount, storage: ch.storage },
          book: {
            id: ch.book.id, name: ch.book.name, author: ch.book.author,
            status: ch.book.status, keywords: ch.book.keywords,
            category: ch.book.category?.name || '未分类', intro: ch.book.intro,
          },
          prev, next,
          pagination: { mode, totalPages, currentPage, wordsPerPage: mode === 'byWords' ? wordsPerPage : null, pagesTarget: mode === 'byPages' ? totalPagesTarget : null },
          seo: { auto: chapterSeoAuto, titleTemplate: chapterSeoTitleTemplate, descTemplate: chapterSeoDescTemplate, keywordsTemplate: chapterSeoKeywordsTemplate },
        }
      }
    } else if (v === 'search' && publicView.q) {
      // 复用 search API 的查询逻辑
      const q = publicView.q
      const limit = 20
      const books = await db.book.findMany({
        where: {
          OR: [
            { name: { contains: q } },
            { author: { contains: q } },
            { intro: { contains: q } },
            { keywords: { contains: q } },
          ],
        },
        orderBy: { wordCount: 'desc' },
        take: limit,
        include: { category: true },
      })
      const relatedTags = await db.bookTag.findMany({
        where: { tag: { contains: q } },
        take: 12,
        include: { book: { select: { id: true, name: true } } },
      })
      initialSearch = {
        q,
        books: books.map((b) => ({
          id: b.id, name: b.name, author: b.author, intro: (b.intro || '').slice(0, 150),
          cover: b.cover, status: b.status, wordCount: b.wordCount,
          category: b.category?.name || '未分类',
        })),
        relatedTags: relatedTags.map((t) => ({ tag: t.tag, bookId: t.book.id, bookName: t.book.name })),
      }
    } else if (v === 'keyword' && publicView.tag) {
      // 复用 keyword API 的查询逻辑 (?tag= 模式, 不含 ?book= PSEO 分支)
      const tag = publicView.tag
      const hits = await db.bookTag.findMany({
        where: { tag },
        orderBy: { hits: 'desc' },
        include: { book: { include: { category: true } } },
        take: 10,
      })
      const tagSource = hits[0]?.source || 'suggest'
      const mainBook = hits[0]?.book
      let related: string[] = []
      if (mainBook) {
        const tags = await db.bookTag.findMany({
          where: { bookId: mainBook.id, tag: { not: tag } },
          orderBy: { hits: 'desc' },
          take: 16,
        })
        related = tags.map((t) => t.tag)
      }
      initialKeyword = {
        tag,
        source: tagSource,
        book: mainBook
          ? {
              id: mainBook.id, name: mainBook.name, author: mainBook.author,
              intro: (mainBook.intro || '').slice(0, 200), cover: mainBook.cover,
              status: mainBook.status, wordCount: mainBook.wordCount,
              category: mainBook.category?.name || '未分类',
            }
          : null,
        otherBooks: hits.slice(1).map((h) => ({ id: h.book.id, name: h.book.name, author: h.book.author })),
        related,
      }
    }

    // R24: server 端渲染 <link> 加载源站 CSS — server component 的 <link> 会 hoist 到 <head>
    const cssUrl = themeId.startsWith('clone-')
      ? `/clone-css/${themeId.replace('clone-', '')}.css`
      : null
    return (
      <>
        {cssUrl && <link rel="stylesheet" href={cssUrl} />}
        <PublicSite
          initialSiteId={site?.id || ''}
          initialView={publicView}
          initialSite={(site as unknown as SiteInfo) || null}
          initialSites={(sites as unknown as SiteInfo[]) || []}
          initialBooks={initialBooks as any}
          initialCategories={categories}
          initialBook={initialBook}
          initialChapter={initialChapter}
          initialSearch={initialSearch}
          initialKeyword={initialKeyword}
          embedMode
        />
      </>
    )
  }

  return (
    <LoginGate>
      <AdminApp />
    </LoginGate>
  )
}
