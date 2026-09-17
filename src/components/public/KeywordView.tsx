'use client'
import { useEffect, useState } from 'react'
import { Tag } from 'lucide-react'
import { fetchKeyword } from './data'
import type { KeywordData } from './types'
import { usePublic } from './ctx'
import { useSiteSEO, withAlpha } from './seo'
import { generateTitle, generateMetaDescription, generateKeywords } from './auto-tdk'
import { ErrorState, Sk, TagCloud } from './bits'
import { BookCover } from './BookCover'
import { formatWords } from './seo'

export function KeywordView({ tag }: { tag?: string }) {
  const { site, theme, navigate } = usePublic()
  const v = theme.vars
  const [data, setData] = useState<KeywordData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!tag) return
    let alive = true
    fetchKeyword(tag)
      .then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch((e: Error) => { if (alive) { setError(e.message); setLoading(false) } })
    return () => { alive = false }
  }, [tag, site.id])
  useSiteSEO({
    title: generateTitle({ category: tag, siteName: site.name }),
    description: generateMetaDescription({ category: tag, siteName: site.name, intro: `${tag}相关小说推荐` }),
    keywords: generateKeywords({ category: tag, siteName: site.name }),
    canonicalPath: `/?view=keyword&tag=${encodeURIComponent(tag || '')}&site=${site.id}`, site,
  })
  if (loading) return <div className="mx-auto max-w-5xl px-4 py-8"><Sk className="h-96 w-full" /></div>
  if (error) return <div className="mx-auto max-w-5xl px-4 py-8"><ErrorState message="加载失败" detail={error} /></div>
  if (!data || !data.book) return <div className="mx-auto max-w-5xl px-4 py-8 text-center" style={{ color: v.textMuted }}>暂无相关书籍</div>
  const main = data.book
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium" style={{ background: withAlpha(v.primary, 0.1), color: v.primary }}>
          <Tag className="h-3.5 w-3.5" aria-hidden /> 关键词
        </span>
        <h1 className="mt-3 text-3xl font-black" style={{ color: v.text }}>「{tag}」相关小说</h1>
      </header>
      <section className="mb-8 flex gap-5 p-5" style={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: v.radius }}>
        <div className="w-28 shrink-0 sm:w-36">
          <BookCover name={main.name} cover={main.cover} className="aspect-[3/4] w-full" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-xl font-black" style={{ color: v.text }}>
            <button onClick={() => navigate({ view: 'book', bookId: main.id })} style={{ color: 'inherit' }}>{main.name}</button>
          </h2>
          <p className="text-sm" style={{ color: v.textMuted }}>{main.author} · {main.category} · {formatWords(main.wordCount)}</p>
          <p className="text-sm line-clamp-3" style={{ color: v.textMuted }}>{main.intro}</p>
        </div>
      </section>
      {data.otherBooks.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold" style={{ color: v.text }}>其他相关书籍</h2>
          <ul className="space-y-1">
            {data.otherBooks.map((b, i) => (
              <li key={b.id}>
                <button onClick={() => navigate({ view: 'book', bookId: b.id })} className="flex w-full items-center gap-3 py-2 text-left text-sm" style={{ borderBottom: `1px solid ${withAlpha(v.border, 0.5)}` }}>
                  <span className="w-6 text-xs tabular-nums" style={{ color: v.textMuted }}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 truncate font-medium">{b.name}</span>
                  <span className="text-xs" style={{ color: v.textMuted }}>{b.author}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.related.length > 0 && (
        <section className="pt-4">
          <h2 className="mb-3 text-sm font-bold" style={{ color: v.text }}>相关关键词</h2>
          <TagCloud tags={data.related} />
        </section>
      )}
    </div>
  )
}
