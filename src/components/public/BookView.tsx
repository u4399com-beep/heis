// ============================================================
// 书籍详情视图 — 封面/信息/状态徽章/简介/目录(分页)/标签云
// 信息排布与目录样式按 6 套主题差异化
// ============================================================
'use client'

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Bookmark, ChevronLeft, ChevronRight, Download, Hash, ListTree } from 'lucide-react'
import { fetchBook, type BookDetailData } from './data'
import { usePublic } from './ctx'
import { coverSrc, fmtDate, formatWords, statusLabel, useSiteSEO, withAlpha } from './seo'
import { BookCover } from './BookCover'
import { EmptyState, ErrorState, SecTitle, Sk, StatusBadge, TagCloud } from './bits'
import { ReadFirstButton } from './BookCard'
import type { BookTagHit, TocChapter } from './types'

function TocSkeleton({ themeId }: { themeId: string }) {
  const rows = 10
  if (themeId === 'pili') {
    // pili 四列章节网格骨架
    return (
      <div className="grid grid-cols-2 gap-x-8 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 16 }).map((_, i) => <Sk key={i} className="h-8 w-full" />)}
      </div>
    )
  }
  if (themeId === 'aurora' || themeId === 'mango') {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => <Sk key={i} className="h-9 w-full" />)}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => <Sk key={i} className="h-4 w-full" />)}
    </div>
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

  const key = `${bookId || ''}|${tocPage}|${site.id}`

  useEffect(() => {
    if (!bookId) return
    let alive = true
    fetchBook(bookId, tocPage, 100)
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
  }, [key, bookId, tocPage])

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
    title: book ? `${book.name} - ${site.name}` : `书籍详情 - ${site.name}`,
    description: book ? book.intro.slice(0, 150) : undefined,
    keywords: book ? [book.keywords, ...tags.map((t) => t.tag)].filter(Boolean).join(',') : undefined,
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

  /* ---------- 目录面板（按主题差异化） ---------- */
  const renderToc = () => {
    if (loading) return <TocSkeleton themeId={theme.id} />
    if (!chapters.length) return <EmptyState text="暂无章节" />
    const go = (ch: TocChapter) => navigate({ view: 'read', chapterId: ch.id })

    /** 主题差异化章节列表渲染(list 入参: 分卷模式下按组传入, 无卷整页传入 — 与改前逐节点一致) */
    const renderChapterList = (list: TocChapter[]) => {
      if (theme.id === 'pili') {
        // 四列章节网格（原站 works-chapter-item DNA: 紧凑行 + 悬停橙字）
        return (
          <div data-pili-toc className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
            {list.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => go(ch)}
                className="flex min-h-[36px] w-full items-center gap-2 border-b py-2 text-left text-[13px] transition-colors hover:text-[#fd8929]"
                style={{ borderColor: withAlpha(v.border, 0.55), color: v.text }}
                aria-label={`阅读 ${ch.title}`}
              >
                <span className="shrink-0 text-[11px] tabular-nums" style={{ color: v.textMuted }}>{ch.idx}.</span>
                <span className="line-clamp-1 flex-1">{ch.title}</span>
              </button>
            ))}
          </div>
        )
      }
      if (theme.id === 'aurora') {
        // 玻璃格子
        return (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => go(ch)}
                className="flex items-center gap-2 px-3 py-2 text-left text-sm transition-transform hover:-translate-y-0.5"
                style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, color: v.text }}
              >
                <span className="shrink-0 text-[10px] tabular-nums" style={{ color: v.accent }}>{String(ch.idx).padStart(3, '0')}</span>
                <span className="line-clamp-1 flex-1">{ch.title}</span>
              </button>
            ))}
          </div>
        )
      }
      if (theme.id === 'paper') {
        // 竖排列表（衬线 + 虚线引导）
        return (
          <ol className="mx-auto max-w-2xl">
            {list.map((ch) => (
              <li key={ch.id} style={{ borderBottom: `1px dashed ${v.border}` }}>
                <button
                  type="button"
                  onClick={() => go(ch)}
                  className="flex w-full items-baseline gap-3 py-2.5 text-left transition-colors hover:opacity-70"
                >
                  <span className="shrink-0 text-xs tabular-nums" style={{ color: v.textMuted }}>{String(ch.idx).padStart(2, '0')}</span>
                  <span className="flex-1 text-sm" style={{ color: v.text, fontFamily: v.titleFont }}>{ch.title}</span>
                  <span className="mx-1 hidden flex-1 border-b border-dotted sm:block" style={{ borderColor: v.textMuted }} aria-hidden />
                  <span className="shrink-0 text-[11px] tabular-nums" style={{ color: v.textMuted }}>{ch.wordCount}字</span>
                </button>
              </li>
            ))}
          </ol>
        )
      }
      if (theme.id === 'mango') {
        // 大圆角胶囊格子
        return (
          <div className="flex flex-wrap gap-2">
            {list.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => go(ch)}
                className="px-3.5 py-2 text-sm font-medium transition-transform hover:scale-105"
                style={{ background: v.surfaceAlt, border: `1px solid ${v.border}`, borderRadius: 999, color: v.text }}
              >
                {ch.idx}. {ch.title}
              </button>
            ))}
          </div>
        )
      }
      if (theme.id === 'bamboo') {
        // 双栏细线极简
        return (
          <div className="gap-x-12 md:columns-2">
            {list.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => go(ch)}
                className="flex w-full items-center gap-3 border-b py-2.5 text-left text-sm transition-colors hover:opacity-60"
                style={{ borderColor: withAlpha(v.border, 0.7), color: v.text, breakInside: 'avoid' }}
              >
                <span className="w-6 shrink-0 text-[10px] tabular-nums" style={{ color: v.textMuted }}>{ch.idx}</span>
                <span className="line-clamp-1 flex-1">{ch.title}</span>
                <span className="shrink-0 text-[10px] tabular-nums" style={{ color: v.textMuted }}>{ch.wordCount}</span>
              </button>
            ))}
          </div>
        )
      }
      if (theme.id === 'rose') {
        // 剧目单（金色编号 + 衬线标题）
        return (
          <ol className="divide-y" style={{ borderColor: withAlpha(v.border, 0.7) }}>
            {list.map((ch) => (
              <li key={ch.id}>
                <button
                  type="button"
                  onClick={() => go(ch)}
                  className="flex w-full items-baseline gap-3 py-2.5 text-left transition-colors hover:opacity-75"
                >
                  <span className="w-8 shrink-0 text-right text-sm font-black italic tabular-nums" style={{ color: v.accent, fontFamily: v.titleFont }}>
                    {ch.idx}
                  </span>
                  <span className="flex-1 text-sm" style={{ color: v.text, fontFamily: v.titleFont }}>{ch.title}</span>
                  <span className="shrink-0 text-[10px] tabular-nums" style={{ color: v.textMuted }}>{ch.wordCount}字</span>
                </button>
              </li>
            ))}
          </ol>
        )
      }
      // ocean — 剧集列表
      return (
        <div className="divide-y" style={{ borderColor: withAlpha(v.border, 0.7) }}>
          {list.map((ch) => (
            <button
              key={ch.id}
              type="button"
              onClick={() => go(ch)}
              className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-white/5"
            >
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                style={{ background: withAlpha(v.primary, 0.18), color: v.primary }}
              >
                EP{String(ch.idx).padStart(2, '0')}
              </span>
              <span className="line-clamp-1 flex-1 text-sm" style={{ color: v.text }}>{ch.title}</span>
              <span className="shrink-0 text-[10px] tabular-nums" style={{ color: v.textMuted }}>{formatWords(ch.wordCount)}</span>
            </button>
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
  const panelStyle: CSSProperties = {
    background: v.surface,
    border: `1px solid ${v.border}`,
    borderRadius: v.radius,
    boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
  }
  const coverW = theme.id === 'magazine' ? 'w-44 sm:w-52' : theme.id === 'theater' ? 'w-36 sm:w-44' : 'w-32 sm:w-40'

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
          {/* 信息区 */}
          {theme.id === 'pili' ? (
            /* pili 霹雳书屋详情头（原站 works-intro DNA: 左封面角标+右标题作者+简介+标签chips+橙色大按钮+统计行） */
            <section data-pili-book style={panelStyle} className="p-5 sm:p-7" aria-label="书籍信息">
              <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
                <div className="relative mx-auto w-40 shrink-0 sm:mx-0 sm:w-48">
                  <BookCover name={book.name} cover={book.cover} showAuthor={book.author} className="aspect-[3/4] w-full" />
                  {(book.status === 'completed' || book.status === 'ongoing') && (
                    <span
                      className="absolute right-0 top-0 px-2.5 py-1 text-xs font-bold"
                      style={{ background: book.status === 'completed' ? v.primary : v.accent, color: v.primaryText, borderRadius: `0 ${v.radius} 0 ${v.radius}` }}
                    >
                      {book.status === 'completed' ? '已完结' : '连载中'}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-3.5">
                  <h1 className="text-xl font-bold leading-snug sm:text-2xl" style={{ color: v.text, fontFamily: v.titleFont }}>
                    {book.name}
                    <span className="font-normal" style={{ color: v.textMuted }}>（作者：{book.author}）</span>
                  </h1>
                  <p className="text-sm leading-relaxed" style={{ color: v.textMuted }}>{book.intro || '暂无简介'}</p>
                  {tags.length > 0 && (
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span style={{ color: v.textMuted }}>标签：</span>
                      {tags.slice(0, 8).map((t) => (
                        <button
                          key={t.tag}
                          type="button"
                          onClick={() => navigate({ view: 'keyword', tag: t.tag })}
                          className="px-2.5 py-0.5 text-xs transition-colors hover:text-[#fd8929]"
                          style={{ color: v.primary, border: `1px solid ${withAlpha(v.primary, 0.45)}`, borderRadius: v.radius }}
                          aria-label={`查看标签 ${t.tag}`}
                        >
                          {t.tag}
                        </button>
                      ))}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <ReadFirstButton firstChapterId={chapters[0]?.id} label="开始阅读" />
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium transition-opacity hover:opacity-85"
                      style={{ background: v.primary, color: v.primaryText, borderRadius: v.radius }}
                      onClick={() => tocRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      aria-label="查看完整章节目录"
                    >
                      <ListTree className="h-4 w-4" aria-hidden />
                      章节目录
                    </button>
                    {/* TXT 下载（站内唯一 <a> 整页跳转，允许） */}
                    <a
                      href={`/api/public/download?book=${book.id}`}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
                      style={{ border: `1px solid ${withAlpha(v.primary, 0.5)}`, color: v.primary, borderRadius: v.radius }}
                    >
                      <Download className="h-4 w-4" aria-hidden />
                      TXT 下载
                    </a>
                  </div>
                  {/* 统计行 */}
                  <p
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs"
                    style={{ borderColor: withAlpha(v.border, 0.7), color: v.textMuted }}
                  >
                    <span>分类：<span style={{ color: v.primary }}>{book.category}</span></span>
                    <span>字数：{formatWords(book.wordCount)}</span>
                    <span>状态：{statusLabel(book.status)}</span>
                    {fmtDate(book.updatedAt) && <span>更新：{fmtDate(book.updatedAt)}</span>}
                    <span className="min-w-0">最新：{book.latestChapter || '暂无'}</span>
                  </p>
                </div>
              </div>
            </section>
          ) : (
          <section style={panelStyle} className="p-5 sm:p-7" aria-label="书籍信息">
            <div className="flex flex-col gap-5 sm:flex-row sm:gap-7">
              <div className="mx-auto shrink-0 sm:mx-0">
                <div className={coverW}>
                  <div
                    className={theme.id === 'rose' ? 'p-1' : ''}
                    style={theme.id === 'rose' ? { border: `2px solid ${v.accent}`, borderRadius: v.radius, background: v.bg } : undefined}
                  >
                    <BookCover name={book.name} cover={book.cover} showAuthor={book.author} className="aspect-[3/4] w-full" />
                  </div>
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <h1
                  className="text-2xl font-black leading-snug sm:text-3xl"
                  style={{ color: v.text, fontFamily: v.titleFont }}
                >
                  {book.name}
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: v.textMuted }}>
                  <span>{book.author}</span>
                  {book.categoryId ? (
                    <button
                      type="button"
                      className="rounded-full px-2.5 py-0.5 text-xs transition-opacity hover:opacity-75"
                      style={{ background: withAlpha(v.primary, theme.dark ? 0.18 : 0.1), color: v.primary }}
                      onClick={() => navigate({ view: 'category', cat: book.categoryId || '' })}
                      aria-label={`查看 ${book.category} 分类`}
                    >
                      {book.category}
                    </button>
                  ) : (
                    <span className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: withAlpha(v.primary, theme.dark ? 0.18 : 0.1), color: v.primary }}>
                      {book.category}
                    </span>
                  )}
                  <StatusBadge status={book.status} />
                  <span className="inline-flex items-center gap-1">
                    <Bookmark className="h-3.5 w-3.5" aria-hidden />
                    {formatWords(book.wordCount)}
                  </span>
                  {fmtDate(book.updatedAt) && <span className="text-xs">更新于 {fmtDate(book.updatedAt)}</span>}
                </div>
                {book.keywords && (
                  <p className="text-xs leading-relaxed" style={{ color: v.textMuted }}>
                    <span style={{ color: v.accent }}>关键词：</span>{book.keywords}
                  </p>
                )}
                <p className="max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>
                  {book.intro || '暂无简介'}
                </p>
                <p className="text-xs" style={{ color: v.textMuted }}>
                  最新章节：<span style={{ color: v.primary }}>{book.latestChapter || '暂无'}</span>
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <ReadFirstButton firstChapterId={chapters[0]?.id} label="开始阅读" />
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
                    style={{ border: `1px solid ${v.border}`, color: v.text, borderRadius: v.radius, background: v.surfaceAlt }}
                    onClick={() => tocRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    aria-label="滚动到章节目录"
                  >
                    <ListTree className="h-4 w-4" aria-hidden />
                    目录
                  </button>
                  {/* TXT 下载（站内唯一 <a> 整页跳转，允许）
                      book= 按书取最新已完成成品(与 /api/public/download 的 book 参数配套);
                      原先误传 book.id 走 ?id= 任务通道, 任务 id ≠ 书籍 id, 链接恒 404 死链 */}
                  <a
                    href={`/api/public/download?book=${book.id}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
                    style={{ border: `1px solid ${withAlpha(v.accent, 0.5)}`, color: v.accent, borderRadius: v.radius }}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    TXT 下载
                  </a>
                </div>
              </div>
            </div>
          </section>
          )}

          {/* 标签云 */}
          {tags.length > 0 && theme.id !== 'pili' && (
            <section className="pt-6" aria-label="本书标签">
              <div className="mb-3 flex items-center gap-2">
                <Hash className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
                <h2 className="text-sm font-bold tracking-widest" style={{ color: v.text }}>本书标签</h2>
              </div>
              <TagCloud tags={tags.slice(0, 16).map((t) => t.tag)} />
            </section>
          )}

          {/* 目录 */}
          <section ref={tocRef} className="scroll-mt-6 pt-8" aria-label="章节目录">
            {theme.id === 'pili' ? (
              /* pili 橙色 tab 头（原站 works-chapter-menu DNA） */
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <span
                  data-pili-toc-tab
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
                  style={{ background: v.primary, color: v.primaryText, borderRadius: `${v.radius} ${v.radius} 0 0` }}
                >
                  <ListTree className="h-4 w-4" aria-hidden />
                  查看完整章节目录
                </span>
                <span className="pb-1 text-xs tabular-nums" style={{ color: v.textMuted }}>
                  共 {data?.tocTotal || 0} 章 · 第 {data?.tocPage || tocPage}/{data?.tocTotalPages || 1} 页
                </span>
              </div>
            ) : (
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
            )}
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
        </>
      )}
    </div>
  )
}
