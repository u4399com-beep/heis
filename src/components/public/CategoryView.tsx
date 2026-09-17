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

const CatListLookup: Record<string, any> = {
  'clone-aijjxs': CatListAijjxs,
  'clone-ddyueshu': CatListDdyueshu,
  'clone-pilishuwu': CatListPilishuwu,
  'clone-23qb': CatList23qb,
  'clone-101kks': CatList101kks,
  'clone-huangjinwu': CatListHuangjinwu,
  'clone-ggd66': CatListGgd66,
  'clone-shipsay': CatListShipsay,
  'clone-x2552': CatListX2552,
  'clone-trxsw': CatListTrxsw,
}

export function CategoryView({ cat, page }: { cat?: string; page: number }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [data, setData] = useState<BooksData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [catName, setCatName] = useState('')
  const listKey = `${site.id}|${cat || ''}|${page}`
  const [prevKey, setPrevKey] = useState(listKey)
  if (prevKey !== listKey) {
    setPrevKey(listKey)
    setData(null)
    setError('')
    setLoading(true)
    setCatName('') // 同步清除上一分类的名称，避免闪烁旧分类名
  }
  const label = !cat ? '全部分类' : catName || '分类书籍'
  useEffect(() => {
    let alive = true
    fetchBooks({ site: site.id, cat, page, size: 24 })
      .then((d) => {
        if (!alive) return
        setData(d)
        setLoading(false)
      })
      .catch((e: Error) => {
        if (!alive) return
        setError(e.message)
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [site.id, cat, page])

  useEffect(() => {
    if (!cat) return
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
  }, [cat])

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
          {/* R20-1A: 接 CatListComponent (lookup table 在文件顶部定义, fallback aijjxs) */}
          {(() => {
            const CatListComp = CatListLookup[theme.layout] || CatListAijjxs
            return (
              <CatListComp
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
