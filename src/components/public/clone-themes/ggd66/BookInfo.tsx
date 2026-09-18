'use client'
// ============================================================
// clone-ggd66 BookInfo — 1:1 精仿 ggd66.com 书籍详情页
// 参考: agent-ctx/probe-html2/probe-ggd66.html 中的 .content 结构
//       + CSS .book / .breadcrumb / .bookcover / .bookinfo / .booktitle /
//       .booktag (red/blue) / .bookintro / .chapterlist / #btn-All
// 复刻: .header > .container (.header-left .logo + .header-right + .header-nav)
//       / .container > .breadcrumb (首页 > 分类 > 书名)
//       / .container > .content > .content-left #book-info (.book .bookcover img +
//       .bookinfo .booktitle + .booktag tags + .bookintro 简介 + .chapterlist 章节目录 +
//       #btn-All 全部章节) + .content-right #fengyou (.search + h2 阅读排行榜 ul li)
//       / .footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/ggd66.css
// 全部用源站真实 class 名, 不用 inline style 换配色
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { BookInfoProps } from '../shared'
import type { BookItem, BookDetail } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }
interface Chapter { id: string; idx: number; title: string }

const DEFAULT_NAV: Cat[] = [
  { id: 'dushi', name: '都市言情' },
  { id: 'xuanhuan', name: '玄幻魔法' },
  { id: 'wuxia', name: '武侠修真' },
  { id: 'lishi', name: '历史军事' },
  { id: 'nvsheng', name: '女生耽美' },
  { id: 'youxi', name: '游戏竞技' },
  { id: 'kehuan', name: '科幻灵异' },
  { id: 'yanqing', name: '言情' },
  { id: 'other', name: '其它' },
]

const TOP_NAV: { id: string; name: string; view: 'home' | 'category' | 'fulltext' | 'search' }[] = [
  { id: 'home', name: '首 页', view: 'home' },
  { id: 'sort', name: '书 库', view: 'category' },
  { id: 'quanben', name: '全本', view: 'fulltext' },
  { id: 'search', name: '搜索', view: 'search' },
]

export function BookInfo({ book, onScrollToc, onContinueRead, onGoCategory, initialCategories }: BookInfoProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [showAll, setShowAll] = useState(false)
  const [rankBooks, setRankBooks] = useState<BookItem[]>([])

  // 拉分类列表
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

  // 拉书页章节目录 (/api/public/book?id=... 返回 toc + book)
  useEffect(() => {
    if (!book?.id) return
    let aborted = false
    const sp = new URLSearchParams()
    sp.set('id', book.id)
    if (site?.id) sp.set('site', site.id)
    sp.set('tocPage', '1')
    sp.set('tocSize', '999')
    fetch(`/api/public/book?${sp.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const toc = d?.data?.toc || d?.toc || []
        setChapters(toc.map((c: any) => ({ id: c.id || c.cid, idx: c.idx, title: c.title || c.name })))
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [book?.id, site?.id])

  // 拉同分类前 13 本作"阅读排行榜" (排除当前书)
  useEffect(() => {
    if (!book?.id) return
    let aborted = false
    const sp = new URLSearchParams({ size: '14', sort: 'hot' })
    if (book.categoryId) sp.set('cat', book.categoryId)
    if (site?.id) sp.set('site', site.id)
    fetch(`/api/public/books?${sp.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const list: BookItem[] = (d?.data?.books || d?.books || []).filter((b: BookItem) => b.id !== book.id).slice(0, 13)
        setRankBooks(list)
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [book?.id, book?.categoryId, site?.id])

  if (!book) return null

  const catName = (b: BookDetail | BookItem) => b.category || '小说'

  // 章节列表: 默认显示前 20 个, showAll=true 时显示全部
  const visibleChapters = showAll ? chapters : chapters.slice(0, 20)

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    if (onGoCategory && catId) onGoCategory(catId)
    else navigate({ view: 'category', cat: catId })
  }
  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const goRead = (chapterId: string) => navigate({ view: 'read', bookId: book.id, chapterId })

  const goChapterList = (e: React.MouseEvent) => {
    e.preventDefault()
    setShowAll(v => !v)
    onScrollToc()
  }
  const goContinueRead = (e: React.MouseEvent) => {
    e.preventDefault()
    if (onContinueRead) onContinueRead()
    else onScrollToc()
  }

  return (
    <>
      {/* ============ header ============ */}
      <div className="header">
        <div className="container">
          <div className="header-left">
            <a href="/" title={site.name} className="logo" onClick={goHome}>{site.name}</a>
          </div>
          <div className="header-right">
            <a href="/history.html" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}>阅读历史</a>
            {' | '}
            <a href="/login/" onClick={(e) => e.preventDefault()}>登录</a>
            {' | '}
            <a href="/register" onClick={(e) => e.preventDefault()}>注册</a>
          </div>
          <div className="header-nav">
            {TOP_NAV.map(n => (
              <a
                key={n.id}
                href={n.view === 'home' ? '/' : n.view === 'category' ? '/sort/' : n.view === 'fulltext' ? '/quanben/sort/' : '/search/'}
                title={n.name.trim()}
                onClick={(e) => {
                  e.preventDefault()
                  if (n.view === 'home') navigate({ view: 'home' })
                  else if (n.view === 'category') navigate({ view: 'category' })
                  else if (n.view === 'fulltext') navigate({ view: 'fulltext' })
                  else navigate({ view: 'search' })
                }}
              >
                {n.name}
              </a>
            ))}
          </div>
        </div>
        <div className="clear"></div>
      </div>

      {/* ============ 主容器 ============ */}
      <div className="container">
        {/* 面包屑 */}
        <ul className="breadcrumb">
          <li><a href="/" onClick={goHome}>首页</a></li>
          <li><a href="/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>书库</a></li>
          {book.categoryId && (
            <li><a href={`/sort/${book.categoryId}/`} onClick={(e) => goCat(e, book.categoryId!)}>{catName(book)}</a></li>
          )}
          <li className="active">{book.name}</li>
        </ul>

        {/* 详情主体 */}
        <div className="content">
          <div className="content-left" id="book-info">
            <div className="book">
              <div className="bookcover">
                <a href={`/qu/${book.id}/`} {...bookNavProps(navigate, book.id)}>
                  <BookCover name={book.name} cover={book.cover} style={{ width: 160, height: 220 }} />
                </a>
              </div>
              <div className="bookinfo">
                <h1 className="booktitle">{book.name}</h1>
                <div className="booktag">
                  <a href="javascript:;" className="red" onClick={(e) => { e.preventDefault(); if (book.categoryId) navigate({ view: 'category', cat: book.categoryId }) }}>{catName(book)}</a>
                  <span className="blue">{book.status === 'completed' ? '已完结' : '连载中'}</span>
                  <span className="blue">{formatWords(book.wordCount)}</span>
                  <a href="javascript:;" className="red" onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }}>{book.author}</a>
                </div>
                <div className="bookintro">{book.intro || '暂无简介'}</div>
              </div>
              <div className="clear"></div>
            </div>

            {/* 章节目录 */}
            <div className="book">
              <div className="chapterlist">
                <dl>
                  {visibleChapters.map(c => (
                    <dd key={c.id}>
                      <a href={`/qu/${book.id}/${c.id}.html`} onClick={(e) => { e.preventDefault(); goRead(c.id) }}>{c.title}</a>
                    </dd>
                  ))}
                </dl>
                <div className="clear"></div>
                {chapters.length > 20 && (
                  <a id="btn-All" href="javascript:;" onClick={goChapterList}>
                    {showAll ? '收起章节' : `查看全部 ${chapters.length} 章`}
                  </a>
                )}
              </div>
              <div className="clear"></div>
            </div>

            {/* 操作按钮 */}
            <div className="book">
              <div style={{ padding: '10px 0', textAlign: 'center' }}>
                <a
                  href="javascript:;"
                  className="btn btn-info"
                  onClick={goContinueRead}
                  style={{ display: 'inline-block', padding: '6px 24px', marginRight: 10, textDecoration: 'none' }}
                >
                  开始阅读
                </a>
                <a
                  href="javascript:;"
                  className="btn btn-default"
                  onClick={(e) => { e.preventDefault(); onScrollToc() }}
                  style={{ display: 'inline-block', padding: '6px 24px', textDecoration: 'none' }}
                >
                  查看目录
                </a>
              </div>
              <div className="clear"></div>
            </div>
          </div>

          {/* 侧栏阅读排行榜 */}
          <div className="content-right" id="fengyou">
            <div className="search hidden-xs">
              <form name="articlesearch" method="post" action="/search/" onSubmit={goSearch}>
                <input name="searchkey" type="text" className="text" id="searchkey" size={10} maxLength={50} placeholder="搜索从这里开始..." autoComplete="off" />
                <button type="submit" name="submit">搜  索</button>
              </form>
            </div>
            <h2 className="visible-xs">阅读排行榜</h2>
            <ul>
              {rankBooks.map(b => (
                <li key={b.id}>
                  [{catName(b)}]{' '}
                  <a href={`/qu/${b.id}/`} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                  <span>{b.author}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="clear"></div>
        </div>

        {/* 友情链接 .tuijian (含分类导航 .class) */}
        <div className="content tuijian hidden-xs">
          友情链接：
          <div className="class">
            <ul>
              <li><a href="/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>书库</a></li>
              <li><a href="/quanben/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'fulltext' }) }}>全本</a></li>
              {cats.slice(0, 9).map(c => (
                <li key={c.id}><a href={`/sort/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a></li>
              ))}
            </ul>
          </div>
          <div className="clear"></div>
        </div>
      </div>

      {/* ============ footer ============ */}
      <div className="footer">
        <p className="hidden-xs">本站所有小说为转载作品，所有章节均由网友上传，转载至本站只是为了宣传本书让更多读者欣赏。</p>
        <p className="hidden-xs">Copyright {new Date().getFullYear()} {site.name}({site.domain}) All Rights Reserved.</p>
        <div className="clear"></div>
      </div>
    </>
  )
}
