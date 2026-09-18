'use client'
// ============================================================
// clone-aijjxs RankingView — 1:1 精仿 aijjxs.com 排行榜页
// 参考: agent-ctx/probe-html2/probe-aijjxs.html 中的 .panel.rank 结构
//       (24小时热榜 / 一周热榜)
// 复刻: .top-float / .wrap > .top (logo+搜索) / .layout > .cenMain
//       (.articleInfo h1 排行榜 + .body.filters tabs 排序切换 + .panel.rank
//       含 book_r + ul.lines 排名列表) + aside (.panel 热门作者 / 相关分类)
// CSS 由 CloneCSSLoader 加载 public/clone-css/aijjxs.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import type { RankingViewProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: 'chuanyue', name: '穿越' }, { id: 'chongshengxiaoshuo', name: '重生' },
  { id: 'lsjs', name: '古代架空' }, { id: 'young', name: '现代言情' },
  { id: 'qinggan', name: '总裁豪门' }, { id: 'wuxia', name: '仙侠幻想' },
  { id: 'tongrenxiaoshuo', name: '同人衍生' }, { id: 'wuxianliu', name: '无限流' },
  { id: 'dmtr', name: '耽于纯美' }, { id: 'xuanhuan', name: '玄幻魔法' },
  { id: 'dushi', name: '都市异能' }, { id: 'tiexue', name: '历史军事' },
  { id: 'juben', name: '网游小说' }, { id: 'kongbu', name: '惊悚悬疑' },
  { id: 'gdmz', name: '文学名著' },
]

const TABS = [
  { id: 'allvisit', name: '总点击' },
  { id: 'allvote', name: '总推荐' },
  { id: 'goodnum', name: '总收藏' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
] as const

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage, initialCategories }: RankingViewProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))

  useEffect(() => {
    if (cats.length > 0) return
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        const mapped: Cat[] = arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) }))
        setCats(mapped.length ? mapped : DEFAULT_NAV)
      })
      .catch(() => { if (!aborted) setCats(DEFAULT_NAV) })
    return () => { aborted = true }
  }, [cats.length])

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 15)
  // 排行榜: book_r 占第 1, lines 占 2-10
  const rankTop = books[0]
  const rankList = books.slice(1, 10)
  // 热门作者
  const topAuthors: string[] = Array.from(new Set(books.slice(0, 24).map(b => b.author).filter(Boolean)).values()).slice(0, 10)
  const totalPages = Math.max(1, Math.ceil(total / size))

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('keyboard') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  const fmtSize = (n?: number) => {
    if (!n) return '0 KB'
    const kb = Math.max(1, Math.round(n * 1.5 / 1024))
    return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'
  }

  const renderPager = () => {
    if (total <= size) return null
    const start = Math.max(1, page - 5)
    const end = Math.min(totalPages, start + 9)
    const nums: number[] = []
    for (let i = start; i <= end; i++) nums.push(i)
    return (
      <div className="pager">
        <a title="总数"><b>{total}</b></a>&nbsp;&nbsp;&nbsp;
        {page > 1 && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(page - 1) }}>上一页</a>}
        {nums.map(n => n === page ? <b key={n}>{n}</b> : <a key={n} href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(n) }}>{n}</a>)}
        {page < totalPages && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(page + 1) }}>下一页</a>}
        {page < totalPages && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(totalPages) }}>尾页</a>}
      </div>
    )
  }

  return (
    <>
      <div className="top-float">
        <div className="top-float-inner">
          <nav className="top-float-nav">
            <a href="/" onClick={goHome}>首页</a>
            {navCats.map(c => (
              <a key={c.id} href={`/txt/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
            ))}
          </nav>
          <div className="top-float-auth"></div>
        </div>
      </div>

      <div className="wrap">
        <header className="top">
          <div className="top-1">
            <h1 className="logo">{site.name}<small>快速找到你想要的TXT电子书</small></h1>
            <div className="top-links"></div>
          </div>
          <form className="search" onSubmit={goSearch}>
            <input type="hidden" name="show" value="title,writer" />
            <input type="text" name="keyboard" placeholder="请输入书名或作者关键字" autoComplete="off" />
            <button type="submit">搜索全站</button>
          </form>
        </header>

        <main className="layout">
          <div className="cenMain">
            <div className="articleInfo"><h1>小说排行榜</h1></div>

            {/* 排行榜 tab 切换 */}
            <div className="body filters">
              <div className="row">
                {TABS.map(t => (
                  <a key={t.id} href="javascript:;" className={tab === t.id ? 'on' : ''} onClick={(e) => { e.preventDefault(); onTabChange(t.id) }}>{t.name}</a>
                ))}
              </div>
            </div>

            {/* 排行榜 panel.rank */}
            <article className="panel rank" style={{ marginTop: 14 }}>
              <h3>{TABS.find(t => t.id === tab)?.name || '排行榜'}</h3>
              <div className="body">
                {loading ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>加载中...</div>
                ) : !books.length ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>暂无排行数据</div>
                ) : (
                  <>
                    {rankTop && (
                      <div className="book_r">
                        <a {...bookNavProps(navigate, rankTop.id)} style={{ display: 'inline-block' }}>
                          <BookCover name={rankTop.name} cover={rankTop.cover} style={{ width: 96, height: 130, borderRadius: 8 }} />
                        </a>
                        <h4><a href={`/txt/${rankTop.id}.html`} target="_blank" {...bookNavProps(navigate, rankTop.id)}>{rankTop.name}</a></h4>
                        <div className="meta">{rankTop.author} · {rankTop.category || '小说'} · {fmtSize(rankTop.wordCount)}</div>
                        <div className="desc">{rankTop.intro || '暂无简介'}</div>
                      </div>
                    )}
                    <ul className="lines">
                      {rankList.map((b, i) => (
                        <li key={b.id}>
                          <span className="no">{i + 2}</span>
                          <a href={`/txt/${b.id}.html`} title={b.name} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                          <span className="date">{b.author}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </article>

            {/* 分页 */}
            <div className="body">{renderPager()}</div>
          </div>

          <aside>
            {/* 热门作者 */}
            <article className="panel">
              <h3>热门作者</h3>
              <div className="body tags">
                {topAuthors.map(a => (
                  <a key={a} href="javascript:;" title={a} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: a }) }}>{a}</a>
                ))}
              </div>
            </article>

            {/* 相关分类 */}
            <article className="panel" style={{ marginTop: 14 }}>
              <h3>相关分类</h3>
              <div className="body">
                <ul className="lines">
                  <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>最新上传的电子书</a></li>
                  <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'fulltext' }) }}>全本小说下载</a></li>
                  {navCats.slice(0, 8).map(c => (
                    <li key={c.id}><a href={`/txt/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}下载</a></li>
                  ))}
                </ul>
              </div>
            </article>
          </aside>
        </main>
      </div>
    </>
  )
}
