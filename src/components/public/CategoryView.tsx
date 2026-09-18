// ============================================================
// 分类视图 — 分类书籍列表（复用主题化列表/卡片）+ 分页
// ============================================================
'use client'

import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { fetchBooks, fetchCategories, type BooksData } from './data'
import { usePublic } from './ctx'
import { useSiteSEO } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { ErrorState, Sk } from './bits'



import { CategoryList as CatListAijjxs } from './clone-themes/aijjxs'
import { CategoryList as CatListDdyueshu } from './clone-themes/ddyueshu'
import { CategoryList as CatListPilishuwu } from './clone-themes/pilishuwu'
import { CategoryList as CatList23qb } from './clone-themes/23qb'
import { CategoryList as CatList101kks } from './clone-themes/101kks'
import { CategoryList as CatListHuangjinwu } from './clone-themes/huangjinwu'
import { CategoryList as CatListGgd66 } from './clone-themes/ggd66'
import { CategoryList as CatListShipsay } from './clone-themes/shipsay'
import { CategoryList as CatListX2552 } from './clone-themes/x2552'
import { CategoryList as CatListTrxsw } from './clone-themes/trxsw'

// R25: CatListLookup table — clone-* 主题分发到 clone-themes/<site>/CategoryList
const CatListLookup: Record<string, any> = {
  'clone-aijjxs': CatListAijjxs, 'clone-ddyueshu': CatListDdyueshu,
  'clone-pilishuwu': CatListPilishuwu, 'clone-23qb': CatList23qb,
  'clone-101kks': CatList101kks, 'clone-huangjinwu': CatListHuangjinwu,
  'clone-ggd66': CatListGgd66, 'clone-shipsay': CatListShipsay,
  'clone-x2552': CatListX2552, 'clone-trxsw': CatListTrxsw,
}

const CatListComponent = ({ books, loading, label, page, total, size, onPage }: any) => {
    const { theme, navigate } = usePublic()
    const v = theme.vars
    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: v.textMuted }}>加载中...</div>
    if (!books.length) return <div style={{ padding: 40, textAlign: 'center', color: v.textMuted }}>暂无书籍</div>
    return (
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: v.text, marginBottom: 16 }}>{label}</h1>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {books.map((b: any) => (
            <div key={b.id} onClick={() => navigate({ view: 'book', bookId: b.id })} style={{ background: v.surface, border: '1px solid ' + v.border, borderRadius: v.radius, padding: 12, cursor: 'pointer' }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: v.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</h3>
              <p style={{ fontSize: 12, color: v.textMuted }}>{b.author}</p>
            </div>
          ))}
        </div>
        {total > size && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            {page > 1 && <button onClick={() => onPage(page - 1)} style={{ padding: '6px 16px', border: '1px solid ' + v.border, borderRadius: v.radius, background: v.surface, color: v.text, cursor: 'pointer' }}>上一页</button>}
            <span style={{ padding: '6px 12px', color: v.textMuted }}>第 {page} 页</span>
            {page * size < total && <button onClick={() => onPage(page + 1)} style={{ padding: '6px 16px', border: '1px solid ' + v.border, borderRadius: v.radius, background: v.surface, color: v.text, cursor: 'pointer' }}>下一页</button>}
          </div>
        )}
      </div>
    )
  }

export function CategoryView({ cat, page, initialBooks, initialCategories }: { cat?: string; page: number; initialBooks?: any; initialCategories?: any[] }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  // R25: SSR 首载用 page.tsx server fetch 的 initialBooks 初始化 state, 让 SSR 时 loading=false → clone CategoryList 组件渲染 books 列表
  const listKey = `${site.id}|${cat || ''}|${page}`
  const [state, setState] = useState<{ key: string; data?: BooksData; error?: string } | null>(() => {
    if (initialBooks && initialBooks.books) {
      return { key: listKey, data: { books: initialBooks.books, total: initialBooks.total || 0, page: initialBooks.page || page, size: initialBooks.size || 24 } }
    }
    return null
  })
  // R25: SSR 首载若 initialCategories 含当前 cat, 同步拿到 catName, 避免 SSR 标题闪烁
  const resolveCatNameFromInitial = (catId?: string) => {
    if (!catId || !initialCategories) return ''
    const hit = initialCategories.find((c: any) => c.id === catId)
    return hit ? (hit.name || hit.title || '') : ''
  }
  const [catName, setCatName] = useState(resolveCatNameFromInitial(cat))
  useEffect(() => {
    // initialBooks 是 server fetch 首屏数据, 首次 effect 跳过避免覆盖; cat/page 变化时重新 fetch
    if (state && state.key === listKey && (state.data || state.error)) return
    let alive = true
    fetchBooks({ site: site.id, cat, page, size: 24 })
      .then((d) => {
        if (!alive) return
        setState({ key: listKey, data: d })
      })
      .catch((e: Error) => {
        if (!alive) return
        setState({ key: listKey, error: e.message })
      })
    return () => {
      alive = false
    }
  }, [listKey, site.id, cat, page, state])
  const loading = !state || state.key !== listKey
  const data = loading ? null : state.data || null
  const error = loading ? '' : state.error || ''
  const label = !cat ? '全部分类' : catName || '分类书籍'

  useEffect(() => {
    if (!cat) return
    // SSR 首载若 initialCategories 已含 cat, 跳过避免覆盖
    if (initialCategories && initialCategories.some((c: any) => c.id === cat)) {
      setCatName(resolveCatNameFromInitial(cat))
      return
    }
    let alive = true
    fetchCategories()
      .then((list) => {
        if (!alive) return
        setCatName(list.find((c) => c.id === cat)?.name || '分类书籍')
      })
      .catch(() => {
        if (alive) setCatName('分类书籍')
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cat, initialCategories])

  useSiteSEO({
    title: generateTitle({ category: label, siteName: site.name }),
    description: generateMetaDescription({ category: label, siteName: site.name, chapterTitle: `共${data?.total ?? 0}本`, intro: `${label}分类小说列表` }),
    keywords: generateKeywords({ category: label, existingKeywords: site.keywords, siteName: site.name }),
    // 首页与 page=1 共享同一 canonical，避免重复收录
    canonicalPath: `/?view=category&cat=${encodeURIComponent(cat || '')}${page > 1 ? `&page=${page}` : ''}&site=${site.id}`,
    site,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${label} - ${site.name}`,
        url: `${typeof window !== 'undefined' ? window.location.origin : ''}/?view=category&cat=${cat || ''}&site=${site.id}`,
        isPartOf: { '@type': 'WebSite', name: site.name },
      },
    ],
  })

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex items-center gap-3">
        <span
          className="flex h-10 w-10 items-center justify-center"
          style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius, color: v.primary }}
          aria-hidden
        >
          <FolderOpen className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-black" style={{ color: v.text, fontFamily: v.titleFont }}>{label}</h1>
          <p className="text-xs" style={{ color: v.textMuted }}>
            {loading ? '加载中' : `共 ${data?.total ?? 0} 本 · 第 ${data?.page ?? page} 页`}
          </p>
        </div>
      </div>

      {error ? (
        <ErrorState message="分类列表加载失败" detail={error} />
      ) : (
        <>
          {/* R25: CategoryList lookup table 分发到 clone-themes/<site>/CategoryList, fallback 走 inline CatListComponent */}
          {(() => {
            const CloneCatList = CatListLookup[theme.layout]
            if (CloneCatList) {
              return (
                <CloneCatList
                  books={data?.books || []}
                  loading={loading}
                  label={label}
                  page={data?.page ?? page}
                  total={data?.total ?? 0}
                  onPage={(p) => navigate({ view: 'category', cat, page: p })}
                  initialCategories={initialCategories}
                />
              )
            }
            return (
              <CatListComponent
                books={data?.books || []}
                loading={loading}
                label={label}
                page={data?.page ?? page}
                total={data?.total ?? 0}
                onPage={(p) => navigate({ view: 'category', cat, page: p })}
              />
            )
          })()}
          {loading && <Sk className="mx-auto mt-4 h-9 w-64" />}
        </>
      )}
    </div>
  )
}
