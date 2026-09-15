// ============================================================
// 首页视图 — 随机下拉词 + 6 分类图文卡 + 排序切换 + 按 theme.layout 分发 10 种 clone-* 布局
// (全主题去分页, 一次拉 48 本)
// R10-1A: 废弃 theme-matrix 1728 组合 + 17 旧 preset; 改为 9 套精仿 clone-* 布局
// R11-1B: 扩充至 10 套 (新增 clone-trxsw 天人小说)
// R12-1: 删除 clone-trxsw, 重写 9 套 preset 基于真实抓取的 CSS 变量
// R13-1B: 重新克隆 10 个站点主题 (含 trxsw): 恢复 clone-trxsw 基于 AiraBrowser 反查 DOM
// ============================================================
'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowDownWideNarrow, Flame, Hash, Home } from 'lucide-react'
import { fetchBooks, type BooksData } from './data'
import { usePublic } from './ctx'
import { siteKeywordList, useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { EmptyState, ErrorState, SuggestTagCloud, TagCloud, BookGridSkeleton } from './bits'
import { CategoryShowcase } from './CategoryShowcase'
// R10-1A: 10 个精仿真实小说站点首页布局, 懒加载分包 (R13-1B 含 clone-trxsw)
// R13-1B: 第 10 个 clone-trxsw 天人小说 (AiraBrowser 反查 DOM)
const HomeCloneAijjxs = dynamic(() => import('./layouts/HomeCloneAijjxs').then((m) => m.HomeCloneAijjxs))
const HomeCloneDdyueshu = dynamic(() => import('./layouts/HomeCloneDdyueshu').then((m) => m.HomeCloneDdyueshu))
const HomeClonePilishuwu = dynamic(() => import('./layouts/HomeClonePilishuwu').then((m) => m.HomeClonePilishuwu))
const HomeClone23qb = dynamic(() => import('./layouts/HomeClone23qb').then((m) => m.HomeClone23qb))
const HomeClone101kks = dynamic(() => import('./layouts/HomeClone101kks').then((m) => m.HomeClone101kks))
const HomeCloneHuangjinwu = dynamic(() => import('./layouts/HomeCloneHuangjinwu').then((m) => m.HomeCloneHuangjinwu))
const HomeCloneGgd66 = dynamic(() => import('./layouts/HomeCloneGgd66').then((m) => m.HomeCloneGgd66))
const HomeCloneShipsay = dynamic(() => import('./layouts/HomeCloneShipsay').then((m) => m.HomeCloneShipsay))
const HomeCloneX2552 = dynamic(() => import('./layouts/HomeCloneX2552').then((m) => m.HomeCloneX2552))
const HomeCloneTrxsw = dynamic(() => import('./layouts/HomeCloneTrxsw').then((m) => m.HomeCloneTrxsw))
import type { BookItem } from './types'

interface FetchState {
  key: string
  data?: BooksData
  error?: string
}

export function HomeView({ page, cat }: { page: number; cat?: string }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [sort, setSort] = useState<'latest' | 'words'>('latest')
  const [state, setState] = useState<FetchState | null>(null)

  const key = `${site.id}|${cat || ''}|${sort}|${page}`

  useEffect(() => {
    let alive = true
    fetchBooks({ site: site.id, cat, sort, page, size: 48 })
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
  }, [key, site.id, cat, sort, page])

  const loading = !state || state.key !== key
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''

  const catName = cat ? data?.books[0]?.category || '当前分类' : ''

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  useSiteSEO({
    title: site.title || generateTitle({ siteName: site.name, category: catName || undefined }),
    description: site.description || generateMetaDescription({ siteName: site.name, category: catName || undefined, intro: '精品小说在线阅读' }),
    keywords: site.keywords || generateKeywords({ siteName: site.name, category: catName || undefined }),
    canonicalPath: cat ? `/?cat=${cat}&site=${site.id}` : `/?site=${site.id}`,
    site,
    jsonLd: useMemo(
      () => [
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: site.name,
          url: `${origin}/`,
          description: site.description,
          inLanguage: 'zh-CN',
          potentialAction: {
            '@type': 'SearchAction',
            target: `${origin}/?view=search&q={search_term_string}&site=${site.id}`,
            'query-input': 'required name=search_term_string',
          },
        },
      ],
      [origin, site.id, site.name, site.description],
    ),
  })

  const books: BookItem[] = data?.books || []

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* 页头区: 随机下拉词(全站搜索热词) + 换一批 */}
      <section className="mb-5" aria-label="搜索热词">
        <SuggestTagCloud count={16} refresh />
      </section>

      {/* 6 分类图文卡(代表书封面) */}
      <div className="mb-6">
        <CategoryShowcase />
      </div>

      {/* 排序切换 + 分类筛选提示 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSort('latest')
              navigate({ view: 'home', cat, page: 1 })
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              background: sort === 'latest' ? v.primary : v.surface,
              color: sort === 'latest' ? v.primaryText : v.text,
              border: `1px solid ${sort === 'latest' ? v.primary : v.border}`,
              borderRadius: v.radius,
            }}
            aria-pressed={sort === 'latest'}
          >
            <Home className="h-3.5 w-3.5" aria-hidden />
            最新更新
          </button>
          <button
            type="button"
            onClick={() => {
              setSort('words')
              navigate({ view: 'home', cat, page: 1 })
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              background: sort === 'words' ? v.primary : v.surface,
              color: sort === 'words' ? v.primaryText : v.text,
              border: `1px solid ${sort === 'words' ? v.primary : v.border}`,
              borderRadius: v.radius,
            }}
            aria-pressed={sort === 'words'}
          >
            <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />
            字数最多
          </button>
        </div>
        {cat && (
          <button
            type="button"
            onClick={() => navigate({ view: 'home' })}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
            style={{ background: withAlpha(v.accent, 0.14), color: v.accent, border: `1px solid ${withAlpha(v.accent, 0.4)}` }}
            aria-label="清除分类筛选"
          >
            分类：{catName} · 点击清除
          </button>
        )}
      </div>

      {error ? (
        <ErrorState message="书籍列表加载失败" detail={error} />
      ) : !loading && !books.length && !data ? (
        <EmptyState />
      ) : !loading && !books.length ? (
        <EmptyState text="本页暂无书籍" hint="换个分类或翻页看看" />
      ) : (
        <>
          {/* R10-1A: 9 个精仿真实小说站点首页布局分发; R11-1B: 扩充至 10 个; R13-1B: 恢复 clone-trxsw */}
          {theme.layout === 'clone-aijjxs' && <HomeCloneAijjxs books={books} loading={loading} />}
          {theme.layout === 'clone-ddyueshu' && <HomeCloneDdyueshu books={books} loading={loading} />}
          {theme.layout === 'clone-pilishuwu' && <HomeClonePilishuwu books={books} loading={loading} />}
          {theme.layout === 'clone-23qb' && <HomeClone23qb books={books} loading={loading} />}
          {theme.layout === 'clone-101kks' && <HomeClone101kks books={books} loading={loading} />}
          {theme.layout === 'clone-huangjinwu' && <HomeCloneHuangjinwu books={books} loading={loading} />}
          {theme.layout === 'clone-ggd66' && <HomeCloneGgd66 books={books} loading={loading} />}
          {theme.layout === 'clone-shipsay' && <HomeCloneShipsay books={books} loading={loading} />}
          {theme.layout === 'clone-x2552' && <HomeCloneX2552 books={books} loading={loading} />}
          {theme.layout === 'clone-trxsw' && <HomeCloneTrxsw books={books} loading={loading} />}
          {/* feat-round-7 B3: 防御性兜底 — 未知布局/loading 期无任何布局命中时用 BookGridSkeleton */}
          {!['clone-aijjxs', 'clone-ddyueshu', 'clone-pilishuwu', 'clone-23qb', 'clone-101kks', 'clone-huangjinwu', 'clone-ggd66', 'clone-shipsay', 'clone-x2552', 'clone-trxsw'].includes(theme.layout) && loading && (
            <BookGridSkeleton count={12} />
          )}
        </>
      )}

      {/* 热门标签云 */}
      {!loading && books.length > 0 && (
        <section className="pt-8" aria-label="热门标签">
          <div className="mb-3 flex items-center gap-2">
            <Hash className="h-4 w-4" style={{ color: v.primary }} aria-hidden />
            <h2 className="text-sm font-bold tracking-widest" style={{ color: v.text }}>热门标签</h2>
            <Flame className="h-3.5 w-3.5" style={{ color: v.accent }} aria-hidden />
          </div>
          <TagCloud tags={siteKeywordList(site)} />
        </section>
      )}
    </div>
  )
}
