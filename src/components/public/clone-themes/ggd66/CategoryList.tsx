'use client'
// ============================================================
// clone-ggd66 CategoryList — 1:1 精仿 ggd66.com 分类列表页
// 参考: agent-ctx/probe-html2/probe-ggd66.html (首页 .content-left + .class + .pages)
//       + CSS .class / .bookbox / .num / .bookinfo / .pages
// 复刻: .header > .container (.header-left .logo + .header-right + .header-nav)
//       / .container > .breadcrumb (首页 > 书库 > 分类)
//       / .container > .content > .content-left (h2 分类名 + .class 分类网格 +
//       .bookbox × N 含 .num/.bookinfo/.bookname/.author/.cat/.update) +
//       .content-right #fengyou (.search + h2 阅读排行榜 ul li) + .pages 分页
//       / .footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/ggd66.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

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

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])

  useEffect(() => {
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
  }, [])

  const totalPages = Math.max(1, Math.ceil(total / size))
  // 排行榜前 13 本作侧栏
  const rankBooks = books.slice(0, 13)

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
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const fmtDate = (s?: string) => s ? new Date(s).toISOString().slice(5, 10) : ''
  const catName = (b: BookItem) => b.category || '小说'

  // 分页器 (复刻源站 .pages / strong 当前页 / a 其他页)
  const renderPages = () => {
    if (total <= size) return null
    const start = Math.max(1, page - 4)
    const end = Math.min(totalPages, start + 8)
    const nums: number[] = []
    for (let i = start; i <= end; i++) nums.push(i)
    return (
      <div className="pages">
        {page > 1 && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(page - 1) }}>上一页</a>}
        {nums.map(n => n === page ? <strong key={n}>{n}</strong> : <a key={n} href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(n) }}>{n}</a>)}
        {page < totalPages && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(page + 1) }}>下一页</a>}
        <kbd><input type="text" defaultValue={page} readOnly /> / {totalPages}<i id="pagestats"> 共 {total} 条</i></kbd>
      </div>
    )
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
        <ul className="breadcrumb">
          <li><a href="/" onClick={goHome}>首页</a></li>
          <li><a href="/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>书库</a></li>
          <li className="active">{label}</li>
        </ul>

        <div className="content">
          <div className="content-left" id="cat-list">
            <h2>{label}</h2>

            {/* 分类切换网格 .class */}
            <div className="class">
              <ul>
                {cats.slice(0, 9).map(c => (
                  <li key={c.id}>
                    <a href={`/sort/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
                  </li>
                ))}
              </ul>
            </div>
            <div className="clear"></div>

            {/* 书籍网格 .bookbox */}
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
            ) : !books.length ? (
              <div style={{ padding: 40, textAlign: 'center' }}>暂无书籍</div>
            ) : (
              books.map((b, i) => (
                <div className="bookbox" key={b.id}>
                  <span className="num">{i + 1 + (page - 1) * size}</span>
                  <div className="p10">
                    <a href={`/qu/${b.id}/`} {...bookNavProps(navigate, b.id)} style={{ float: 'left', display: 'inline-block', marginRight: 10 }}>
                      <BookCover name={b.name} cover={b.cover} style={{ width: 80, height: 110 }} />
                    </a>
                    <div className="bookinfo">
                      <div className="bookname">
                        <a href={`/qu/${b.id}/`} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                      </div>
                      <div className="author">作者：{b.author}</div>
                      <div className="cat">分类：{catName(b)}</div>
                      <div className="update">{formatWords(b.wordCount)} / 更新于 {fmtDate(b.updatedAt)}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
            <div className="clear"></div>

            {/* 分页 */}
            {renderPages()}
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

        {/* 友情链接 */}
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
