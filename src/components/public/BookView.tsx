// ============================================================
// 书籍详情视图 — 封面/信息/状态徽章/简介/目录(分页)/标签云
// R12-1: 清理 pili/aurora/paper/mango/bamboo/rose/magazine/theater 旧主题分支
//        clone-* 9 套主题统一走默认渲染分支 + 通用 EpisodeListSkeleton
// R14-1A: 信息区 DOM 按 theme.layout 区分 10 套精仿结构 (BookInfoLayout 组件)
//         章节正文 contentSelector 由 theme 透传给 ReadView (复刻原站 DOM)
// R15-1B: BookInfoLayout 已废弃, 改为按 theme.layout 直接 lookup clone-themes/<site>/BookInfo 渲染
// ============================================================
'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Clock, FileText, Hash, ListTree, Search, Sparkles, Type } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchBook, fetchBookPSEOKeywords, fetchChapter, type BookDetailData } from './data'
import { usePublic } from './ctx'
import { coverSrc, formatWords, useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { BookCover } from './BookCover'
// R15-1B: 改为按 theme.layout 动态选择 clone-themes 的 BookInfo 组件 (硬编码颜色, 不用 theme.vars)
import { EmptyState, ErrorState, SecTitle, Sk, TagCloud, ChapterListSkeleton } from './bits'
import type { BookItem, BookTagHit, TocChapter } from './types'
import { getReadPos } from './read-layouts/reading-memory'

  const BookInfoComponent = ({ book, theme, onScrollToc }: any) => {
    const v = theme.vars
    if (!book) return null
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
        <div style={{ display: 'flex', gap: 20, background: v.surface, border: '1px solid ' + v.border, borderRadius: v.radius, padding: 24 }}>
          <div style={{ width: 120, height: 160, overflow: 'hidden', borderRadius: v.radius, border: '1px solid ' + v.border, flexShrink: 0 }}>
            {book.cover && <img src={book.cover} alt={book.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: v.text, margin: '0 0 12px' }}>{book.name}</h1>
            <p style={{ color: v.textMuted, fontSize: 14, lineHeight: 2 }}>作者: {book.author} | 分类: {book.category} | 字数: {(book.wordCount/10000).toFixed(1)}万字 | 状态: {book.status}</p>
            <p style={{ color: v.textMuted, fontSize: 13, lineHeight: 1.8, marginTop: 8 }}>{book.intro}</p>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={() => onScrollToc()} style={{ padding: '6px 16px', background: v.primary, color: v.primaryText, border: 'none', borderRadius: v.radius, cursor: 'pointer', fontSize: 14 }}>开始阅读</button>
              <button onClick={() => onScrollToc()} style={{ padding: '6px 16px', background: v.surface, color: v.text, border: '1px solid ' + v.border, borderRadius: v.radius, cursor: 'pointer', fontSize: 14 }}>目录</button>
            </div>
          </div>
        </div>
      </div>
    )
  }


function TocSkeleton({ themeId }: { themeId: string }) {
  // R12-1: 简化为通用 ChapterListSkeleton (旧 pili/aurora/mango 分支已随主题 ID 退役移除)
  void themeId
  return <ChapterListSkeleton count={10} />
}

/* ---------- feat-round-5 A2: 章节预览 tooltip (hover 300ms debounce + cache) ---------- */

/** 把章节正文 HTML 截成纯文本预览 (去标签 + 实体解码 + 取前 N 字) */
function htmlToPreview(html: string, max = 100): string {
  if (!html) return ''
  // 容错: 没有 DOMParser 时直接 strip 标签
  if (typeof document === 'undefined') {
    return html
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  }
  try {
    // R3-42: 用 DOMParser 代替 createElement('div') + innerHTML —— 后者会把 <img>/<script>/
    // <iframe> 等 HTML 节点真正物化为活动节点, 触发资源加载(<img src> 异步请求外部图, <script>
    // 在 ssr/hydration 后可能执行)。DOMParser.parseFromString 解析结果是不挂载到 document 的
    // 静态 Document 实例, 不触发任何资源加载/脚本执行, 仅作字符串解析。原实现虽只取 textContent,
    // 但副作用路径(innerHTML 物化 → <img> 加载)在慢网络/存在外链时已造成实际泄漏
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim()
    return text.slice(0, max)
  } catch {
    return ''
  }
}

interface PreviewState {
  text: string
  loading: boolean
}

function TocChapterButton({
  ch,
  current,
  cache,
  onClick,
  className,
  style,
  ariaLabel,
  children,
}: {
  ch: TocChapter
  current: boolean
  cache: React.MutableRefObject<Map<string, string>>
  onClick: () => void
  className?: string
  style?: CSSProperties
  ariaLabel?: string
  children: ReactNode
}) {
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const timerRef = useRef<number>(0)

  // P2 fix (R13-1C): 组件卸载时清理挂起的 hover 定时器。修前 onLeave 漏触达(用户点击
  // 导航跳转/组件 unmount 期间)时定时器继续在 pending, 300ms 后 fire 调 setPreview
  // 在已卸载组件上 setState. React 18+ 不再 warn, 但仍是内存/计时器泄漏(尤其目录长
  // 列表多次悬停切换时累积); useEffect cleanup 在 unmount 时 clearTimeout 兜底
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  const onEnter = () => {
    if (cache.current.has(ch.id)) {
      setPreview({ text: cache.current.get(ch.id)!, loading: false })
      return
    }
    setPreview({ text: '', loading: true })
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      fetchChapter(ch.id)
        .then((d) => {
          const text = htmlToPreview(d.chapter.content, 100)
          cache.current.set(ch.id, text)
          setPreview({ text, loading: false })
        })
        .catch(() => setPreview({ text: '', loading: false }))
    }, 300)
  }

  const onLeave = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
  }

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onFocus={onEnter}
          onBlur={onLeave}
          className={className}
          style={style}
          aria-label={ariaLabel}
          aria-current={current ? 'true' : undefined}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        sideOffset={4}
        className="max-w-xs border p-3 shadow-xl"
        style={{ background: 'var(--popover, #fff)', color: 'var(--popover-foreground, #1a1a1a)', borderColor: 'var(--border, #e5e7eb)' }}
      >
        {preview?.loading ? (
          <div className="space-y-1.5" aria-live="polite">
            <Skeleton className="h-3 w-56" />
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-3 w-40" />
          </div>
        ) : (
          <p className="line-clamp-3 text-xs leading-relaxed">{preview?.text || '暂无预览'}</p>
        )}
        <p className="mt-2 border-t pt-1.5 text-[10px] opacity-70" style={{ borderColor: 'var(--border, #e5e7eb)' }}>
          {ch.wordCount.toLocaleString()} 字 · 点击阅读
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

/* ---------- feat-round-5 A3: 阅读统计条 ---------- */

function BookStatsBar({ chapters, wordCount }: { chapters: number; wordCount: number }) {
  const { theme } = usePublic()
  const v = theme.vars
  const avg = chapters > 0 ? Math.round(wordCount / chapters) : 0
  // 300 字/分钟 → 分钟, 转小时 + 分钟
  const mins = wordCount > 0 ? Math.round(wordCount / 300) : 0
  const hh = Math.floor(mins / 60)
  const mm = mins % 60
  const readTimeStr = mins <= 0 ? '—' : hh > 0 ? `${hh} 小时${mm > 0 ? ` ${mm} 分` : ''}` : `${mm} 分钟`

  const chipBase =
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] tabular-nums'
  const chipStyle: CSSProperties = {
    background: withAlpha(v.primary, theme.dark ? 0.14 : 0.08),
    color: v.text,
    border: `1px solid ${withAlpha(v.border, 0.6)}`,
  }
  const muted: CSSProperties = { color: v.textMuted }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={chipBase} style={chipStyle}>
        <FileText className="h-3 w-3" style={{ color: v.primary }} aria-hidden />
        <span style={muted}>章节</span>
        <span className="font-semibold">{chapters.toLocaleString()}</span>
      </span>
      <span className={chipBase} style={chipStyle}>
        <Type className="h-3 w-3" style={{ color: v.primary }} aria-hidden />
        <span style={muted}>总字数</span>
        <span className="font-semibold">{formatWords(wordCount)}</span>
      </span>
      <span className={chipBase} style={chipStyle}>
        <Sparkles className="h-3 w-3" style={{ color: v.primary }} aria-hidden />
        <span style={muted}>平均</span>
        <span className="font-semibold">{avg.toLocaleString()}</span>
        <span style={muted}>字/章</span>
      </span>
      <span className={chipBase} style={chipStyle}>
        <Clock className="h-3 w-3" style={{ color: v.primary }} aria-hidden />
        <span style={muted}>约</span>
        <span className="font-semibold">{readTimeStr}</span>
        <span style={muted}>阅读</span>
      </span>
    </div>
  )
}

/* ---------- feat-round-5 A1: 相关推荐 ---------- */

function RelatedBooks({ bookId, siteId }: { bookId: string; siteId: string }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const [books, setBooks] = useState<BookItem[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch(`/api/public/related?id=${encodeURIComponent(bookId)}&site=${encodeURIComponent(siteId)}&limit=6`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: { books?: BookItem[] } }) => {
        if (!alive) return
        if (j?.ok && Array.isArray(j.data?.books)) setBooks(j.data!.books!)
        else setBooks([])
      })
      .catch(() => alive && setBooks([]))
    return () => {
      alive = false
    }
  }, [bookId, siteId])

  if (books === null) {
    return (
      <section className="pt-8" aria-label="相关推荐">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
          <h2 className="text-sm font-bold tracking-widest" style={{ color: v.text }}>相关推荐</h2>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Sk className="aspect-[3/4] w-full" />
              <Sk className="h-3 w-full" />
              <Sk className="h-2.5 w-2/3" />
            </div>
          ))}
        </div>
      </section>
    )
  }
  if (books.length === 0) return null

  return (
    <section className="pt-8" aria-label="相关推荐">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
        <h2 className="text-sm font-bold tracking-widest" style={{ color: v.text }}>相关推荐</h2>
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {books.map((b) => (
          <article
            key={b.id}
            role="button"
            tabIndex={0}
            onClick={() => navigate({ view: 'book', bookId: b.id })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                navigate({ view: 'book', bookId: b.id })
              }
            }}
            className="group cursor-pointer overflow-hidden transition-transform duration-200 hover:-translate-y-0.5"
            style={{
              background: v.surface,
              border: `1px solid ${withAlpha(v.border, 0.7)}`,
              borderRadius: v.radius,
            }}
            aria-label={`查看《${b.name}》详情`}
          >
            <BookCover name={b.name} cover={b.cover} className="aspect-[3/4] w-full" />
            <div className="space-y-0.5 p-1.5">
              <h3 className="line-clamp-1 text-xs font-semibold" style={{ color: v.text }}>{b.name}</h3>
              <p className="line-clamp-1 text-[10px]" style={{ color: v.textMuted }}>{b.author}</p>
              <p className="text-[10px] tabular-nums" style={{ color: v.primary }}>{formatWords(b.wordCount)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------- R13-1A: PSEO 相关搜索词区块 (底部, dofollow 链向 KeywordView 落地页) ---------- */

function PSEOKeywordsSection({ bookId, siteId }: { bookId: string; siteId: string }) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  const [keywords, setKeywords] = useState<{ keyword: string; source: string; score: number }[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    fetchBookPSEOKeywords(bookId)
      .then((d) => {
        if (!alive) return
        if (d?.book && Array.isArray(d.pseoKeywords)) {
          // 过滤与书名重复的纯词(留扩展长尾词)
          const bookName = d.book.name
          const filtered = d.pseoKeywords.filter((k) => k.keyword !== bookName).slice(0, 10)
          setKeywords(filtered)
        } else {
          setKeywords([])
        }
      })
      .catch(() => {
        if (!alive) return
        setFailed(true)
        setKeywords([])
      })
    return () => {
      alive = false
    }
  }, [bookId])

  // 静默降级: 拉取失败时不渲染整个区块(不阻塞页面其他内容)
  if (failed) return null
  if (keywords === null) {
    return (
      <section className="pt-8" aria-label="相关搜索词">
        <div className="mb-4 flex items-center gap-2">
          <Search className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
          <h2 className="text-sm font-bold tracking-widest" style={{ color: v.text }}>相关搜索词</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Sk key={i} className="h-7 w-20" style={{ borderRadius: v.radius }} />
          ))}
        </div>
      </section>
    )
  }
  if (keywords.length === 0) return null

  const goKeyword = (kw: string) => navigate({ view: 'keyword', tag: kw, site: siteId })

  return (
    <section className="pt-8" aria-label="相关搜索词">
      <div className="mb-4 flex items-center gap-2">
        <Search className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
        <h2 className="text-sm font-bold tracking-widest" style={{ color: v.text }}>相关搜索词</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {keywords.map((k, i) => (
          <a
            key={`${k.keyword}-${i}`}
            href={`/?view=keyword&tag=${encodeURIComponent(k.keyword)}&site=${encodeURIComponent(siteId)}`}
            onClick={(e) => {
              // 左键点击走客户端路由(不整页跳转); Ctrl/Cmd+点击保留默认浏览器行为(新标签打开)
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
              e.preventDefault()
              goKeyword(k.keyword)
            }}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08),
              color: v.primary,
              border: `1px solid ${withAlpha(v.primary, 0.3)}`,
              borderRadius: v.radius,
            }}
            // R13-1A: dofollow(不传 rel="nofollow") — 传递权重到 KeywordView 落地页;
            // 目标页 KeywordView 自身已 robots=noindex,follow, 不收录重复页面
            aria-label={`查看"${k.keyword}"相关小说推荐`}
            title={`${k.keyword} · 来源:${k.source}`}
          >
            <Search className="h-3 w-3" aria-hidden />
            {k.keyword}
          </a>
        ))}
      </div>
    </section>
  )
}

interface FetchState {
  key: string
  data?: BookDetailData
  error?: string
}

export function BookView({ bookId, tocPage }: { bookId?: string; tocPage: number }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [state, setState] = useState<FetchState | null>(null)
  const tocRef = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  // feat-round-5 A2: 章节预览缓存 (跨翻页共享, 同 BookView 生命周期内复用)
  const previewCacheRef = useRef<Map<string, string>>(new Map())
  // feat-round-5 S2: 当前章节高亮 — 来自 URL ?chapter=<id> (读者跳回详情页时)
  const [currentChapterId, setCurrentChapterId] = useState<string | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    return new URLSearchParams(window.location.search).get('chapter') || undefined
  })
  // feat-a D: 上次阅读位置 + 累计阅读时长徽章 (localStorage, 数据加载时读一次)
  // 使用 render-time 检测 bookId 变化模式 (与 ReadView 的 prevCh 同款), 避免 effect 内同步 setState
  const [savedPos, setSavedPos] = useState<ReturnType<typeof getReadPos> | null>(null)
  const [prevBookId, setPrevBookId] = useState(bookId)
  if (prevBookId !== bookId) {
    setPrevBookId(bookId)
    setSavedPos(bookId ? getReadPos(bookId) : null)
    if (typeof window !== 'undefined') {
      setCurrentChapterId(new URLSearchParams(window.location.search).get('chapter') || undefined)
    }
  }
  // feat-round-5 A2: 切书时清空预览缓存 (在 effect 内执行, 避免在 render 阶段写 ref)
  useEffect(() => {
    if (!bookId) return
    previewCacheRef.current = new Map()
  }, [bookId])

  const key = `${bookId || ''}|${tocPage}|${site.id}`

  useEffect(() => {
    if (!bookId) return
    let alive = true
    fetchBook(bookId, tocPage, 100, site.id)
      .then((d) => {
        if (!alive) return
        setState({ key, data: d })
      })
      .catch((e: Error) => {
        if (!alive) return
        setState({ key, error: e.message })
      })
    return () => {
      alive = false
    }
  }, [key, bookId, tocPage, site.id])

  const loading = !state || state.key !== key
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''

  // 目录翻页时滚动到目录区
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    tocRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [tocPage])

  const book = data?.book
  const tags: BookTagHit[] = data?.tags || []
  const chapters: TocChapter[] = data?.chapters || []

  // R10-1C: SEO 模板渲染(同 ReadView renderSeoTemplate, 兼容 site.chapterSeoAuto 开关)
  // auto=true(默认): 走 generateTDK 自动模式; auto=false: 走 site.chapterSeo*Template 模板
  const seoCtx = {
    bookName: book?.name || '',
    chapterTitle: book?.latestChapter || '',
    page: 1,
    totalPages: 1,
    siteName: site.name,
  }
  const renderSeoTemplate = (template: string, ctx: typeof seoCtx): string => {
    if (!template) return ''
    return template
      .replace(/\{bookName\}/g, ctx.bookName)
      .replace(/\{chapterTitle\}/g, ctx.chapterTitle)
      .replace(/\{page\}/g, String(ctx.page))
      .replace(/\{totalPages\}/g, String(ctx.totalPages))
      .replace(/\{siteName\}/g, ctx.siteName)
  }
  const seoTitle = book
    ? (data?.seo && !data.seo.auto && data.seo.titleTemplate
        ? renderSeoTemplate(data.seo.titleTemplate, seoCtx)
        : generateTitle({ bookName: book.name, author: book.author, category: book.category, siteName: site.name }))
    : `书籍详情 - ${site.name}`
  const seoDescription = book
    ? (data?.seo && !data.seo.auto && data.seo.descTemplate
        ? renderSeoTemplate(data.seo.descTemplate, seoCtx)
        : generateMetaDescription({ bookName: book.name, author: book.author, category: book.category, intro: book.intro, wordCount: book.wordCount, siteName: site.name }))
    : undefined
  const seoKeywords = book
    ? (data?.seo && !data.seo.auto && data.seo.keywordsTemplate
        ? renderSeoTemplate(data.seo.keywordsTemplate, seoCtx)
        : generateKeywords({ bookName: book.name, author: book.author, category: book.category, existingKeywords: book.keywords, content: book.intro, siteName: site.name }))
    : undefined

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const coverAbs = (p: string | null): string | undefined => {
    if (!p) return undefined
    if (/^https?:\/\//i.test(p)) return p
    return `${origin}${p}`
  }
  // BreadcrumbList：无 categoryId 时跳过分类层，避免 item 指向空 cat 的无效地址
  const crumbs: Record<string, unknown>[] = [
    { '@type': 'ListItem', position: 1, name: '首页', item: `${origin}/?site=${site.id}` },
  ]
  if (book?.categoryId) {
    crumbs.push({
      '@type': 'ListItem',
      position: crumbs.length + 1,
      name: book.category,
      item: `${origin}/?view=category&cat=${book.categoryId}&site=${site.id}`,
    })
  }
  if (book) {
    crumbs.push({
      '@type': 'ListItem',
      position: crumbs.length + 1,
      name: book.name,
      item: `${origin}/?view=book&id=${book.id}&site=${site.id}`,
    })
  }
  useSiteSEO({
    title: seoTitle,
    description: seoDescription,
    keywords: seoKeywords,
    canonicalPath: book ? `/?view=book&id=${book.id}&site=${site.id}` : undefined,
    site,
    jsonLd: book
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'Book',
            name: book.name,
            author: { '@type': 'Person', name: book.author },
            description: book.intro.slice(0, 200),
            image: coverAbs(coverSrc(book.cover)),
            inLanguage: 'zh-CN',
            genre: book.category,
            url: `${origin}/?view=book&id=${book.id}&site=${site.id}`,
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: crumbs,
          },
        ]
      : [],
  })

  if (!bookId) return <ErrorState message="缺少书籍参数" />
  if (error) return <ErrorState message="书籍不存在" detail={error} />

  /* ---------- 目录面板（clone-* 9 套主题统一走默认 3 列剧集列表） ---------- */
  const renderToc = () => {
    if (loading) return <TocSkeleton themeId={theme.id} />
    if (!chapters.length) return <EmptyState text="暂无章节" />
    // R7-20 GG: pass bookId so pseudostatic read URLs (/read/{bid}/{cid}.html etc.) build correctly;
    //   without bookId, buildViewUrl falls back to /book/.html (broken) for non-query styles.
    const go = (ch: TocChapter) => navigate({ view: 'read', bookId: book?.id || bookId, chapterId: ch.id })

    /** 主题统一章节列表渲染 (R12-1: 移除 pili/aurora/paper/mango/bamboo/rose 旧主题分支
     *  9 套 clone-* 主题统一走默认 3 列剧集列表 + EP 编号 + 字数, 移动端 1 列, 平板 2 列, 桌面 3 列) */
    const renderChapterList = (list: TocChapter[]) => {
      // clone-* 9 套主题统一 — 剧集列表 3 列
      return (
        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((ch) => (
            <TocChapterButton
              key={ch.id}
              ch={ch}
              current={ch.id === currentChapterId}
              cache={previewCacheRef}
              onClick={() => go(ch)}
              className="flex w-full items-center gap-3 border-b py-2.5 text-left transition-colors hover:bg-white/5"
              style={{ borderColor: withAlpha(v.border, 0.7), background: ch.id === currentChapterId ? withAlpha(v.primary, theme.dark ? 0.18 : 0.1) : undefined }}
            >
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                style={{ background: withAlpha(v.primary, 0.18), color: v.primary }}
              >
                EP{String(ch.idx).padStart(2, '0')}
              </span>
              <span className="line-clamp-1 flex-1 text-sm" style={{ color: ch.id === currentChapterId ? v.primary : v.text }}>{ch.title}</span>
              <span className="shrink-0 text-[10px] tabular-nums" style={{ color: v.textMuted }}>{formatWords(ch.wordCount)}</span>
            </TocChapterButton>
          ))}
        </div>
      )
    }

    // 分卷分组(kk-a): 仅当目录出现卷名才启用(连续相同 volume 一组, 空卷归「正文」);
    // 旧书全空卷 → volGroups=null → 渲染与改前完全一致(零回归)
    const hasVolumes = chapters.some((c) => c.volume)
    const volGroups: { volume: string; chapters: TocChapter[] }[] | null = hasVolumes
      ? (() => {
          const gs: { volume: string; chapters: TocChapter[] }[] = []
          for (const c of chapters) {
            const vol = c.volume || ''
            const last = gs[gs.length - 1]
            if (last && last.volume === vol) last.chapters.push(c)
            else gs.push({ volume: vol, chapters: [c] })
          }
          return gs
        })()
      : null

    if (volGroups) {
      return (
        <div className="space-y-6">
          {volGroups.map((g, gi) => (
            <div key={`vol-${gi}-${g.volume}`}>
              <div data-vol-head className="mb-3 flex items-center gap-2.5">
                <span className="min-w-0 break-all text-xs font-bold tracking-[0.2em]" style={{ color: v.primary, fontFamily: v.titleFont }}>
                  {g.volume || '正文'}
                </span>
                <span className="h-px flex-1" style={{ background: withAlpha(v.border, 0.9) }} aria-hidden />
                <span className="text-[10px] tabular-nums" style={{ color: v.textMuted }}>{g.chapters.length} 章</span>
              </div>
              {renderChapterList(g.chapters)}
            </div>
          ))}
        </div>
      )
    }
    return renderChapterList(chapters)
  }

  /* ---------- 信息区封面尺寸/面板（按主题差异化） ---------- */
  // R15-1B: 信息区 DOM 由 clone-themes/<site>/BookInfo 按 theme.layout 选择对应组件渲染,
  //         不再用 BookInfoLayout 中转 (旧 9 套 clone-* 统一渲染分支已废弃)
  const coverW = 'w-32 sm:w-40'


  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {loading || !book ? (
        <div className="space-y-6">
          <div className="flex gap-6">
            <Sk className={`${coverW} aspect-[3/4] shrink-0`} />
            <div className="flex-1 space-y-3 py-2">
              <Sk className="h-8 w-2/3" />
              <Sk className="h-4 w-1/3" />
              <Sk className="h-4 w-full" />
              <Sk className="h-4 w-5/6" />
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* R15-1B: 信息区按 theme.layout 区分 10 套 DOM (clone-themes/<site>/BookInfo) */}
          <BookInfoComponent
            book={book}
            theme={theme}
            savedPos={savedPos}
            firstChapterId={chapters[0]?.id}
            onScrollToc={() => tocRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            onGoCategory={(categoryId) => navigate({ view: 'category', cat: categoryId })}
          />

          {/* feat-round-5 A3: 阅读统计条 */}
          <div className="mt-4">
            <BookStatsBar chapters={data?.tocTotal || chapters.length || 0} wordCount={book.wordCount} />
          </div>

          {/* feat-round-5 S2: 分隔线 */}
          <div aria-hidden className="mt-6 h-px" style={{ background: withAlpha(v.border, 0.45) }} />

          {/* R12-1: 标签云 (移除 theme.id !== 'pili' 条件, 9 套 clone-* 主题统一渲染) */}
          {tags.length > 0 && (
            <section className="pt-6" aria-label="本书标签">
              <div className="mb-3 flex items-center gap-2">
                <Hash className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
                <h2 className="text-sm font-bold tracking-widest" style={{ color: v.text }}>本书标签</h2>
              </div>
              <TagCloud tags={tags.slice(0, 16).map((t) => t.tag)} />
            </section>
          )}

          {/* feat-round-5 S2: 分隔线 */}
          <div aria-hidden className="mt-6 h-px" style={{ background: withAlpha(v.border, 0.45) }} />

          {/* 目录 */}
          <section ref={tocRef} className="scroll-mt-6 pt-8" aria-label="章节目录">
            {/* R12-1: 移除 pili 橙色 tab 头分支, 9 套 clone-* 主题统一走 SecTitle */}
            <SecTitle
              icon={<ListTree className="h-4 w-4" aria-hidden />}
              right={
                <span className="text-xs tabular-nums" style={{ color: v.textMuted }}>
                  共 {data?.tocTotal || 0} 章 · 第 {data?.tocPage || tocPage}/{data?.tocTotalPages || 1} 页
                </span>
              }
            >
              章节目录
            </SecTitle>
            {renderToc()}
            {/* 目录分页 */}
            {(data?.tocTotalPages || 1) > 1 && (
              <div className="mt-5 flex items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={tocPage <= 1}
                  onClick={() => navigate({ view: 'book', bookId: book.id, page: tocPage - 1 })}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: v.surfaceAlt, border: `1px solid ${v.border}`, color: v.text, borderRadius: v.radius }}
                  aria-label="上一页目录"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                  上一页
                </button>
                <span className="text-xs tabular-nums" style={{ color: v.textMuted }}>
                  {tocPage} / {data?.tocTotalPages || 1}
                </span>
                <button
                  type="button"
                  disabled={tocPage >= (data?.tocTotalPages || 1)}
                  onClick={() => navigate({ view: 'book', bookId: book.id, page: tocPage + 1 })}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: v.surfaceAlt, border: `1px solid ${v.border}`, color: v.text, borderRadius: v.radius }}
                  aria-label="下一页目录"
                >
                  下一页
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            )}
          </section>

          {/* feat-round-5 S2: 分隔线 */}
          <div aria-hidden className="mt-6 h-px" style={{ background: withAlpha(v.border, 0.45) }} />

          {/* feat-round-5 A1: 相关推荐 */}
          <RelatedBooks bookId={book.id} siteId={site.id} />

          {/* R13-1A: 相关搜索词(PSEO 长尾词, 链向 KeywordView 落地页) */}
          <PSEOKeywordsSection bookId={book.id} siteId={site.id} />
        </>
      )}
    </div>
  )
}
