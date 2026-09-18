'use client'
// ============================================================
// clone-ddyueshu HomeClone — 1:1 精仿 www.ddyueshu.cc 首页
// 参考: agent-ctx/probe-html2/probe-ddyueshu.html (源站真实 DOM)
// 复刻: .header>.header_logo / .nav>ul / #main>#content / #hotcontent (.l 4 .item + .r 排行)
//       / .novelslist (3 .content) × 2 / #newscontent (.l 最新更新 + .r 热门推荐) / #firendlink / .footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/ddyueshu.css (源 biquge.css, 278 行)
// 全部用源站真实 class 名 (.header_logo/.nav/#hotcontent/.l/.r/.item/.image/dl/dt/dd/.novelslist/.content/.top/#newscontent/#firendlink/.footer)
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { HomeCloneProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

export function HomeClone({ books, loading, navCategoryCount = 8, initialCategories }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  // R24: SSR 首载用 page.tsx server fetch 的 initialCategories 初始化, 避免 SSR 时 cats=[] → navigation 没分类
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))

  // 拉分类列表用于 nav 导航 + novelslist 分类区块标题
  // R24: cats 为空时才 fetch, 避免覆盖 SSR initialCategories 数据
  useEffect(() => {
    if (cats.length > 0) return
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        // API 返回 {ok, data:{items:[{id,name,bookCount,rep}]}}
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        setCats(arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [cats.length])

  if (loading) return <div id="main" style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
  if (!books.length) return <div id="main" style={{ padding: 40, textAlign: 'center' }}>暂无内容</div>

  // 大神小说: 字数最多的前 4 本 → #hotcontent .l .item (大封面 120x150 + 简介)
  const topBooks = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 4)
  // 排行榜热书 → #hotcontent .r (右栏文字列表 .s1/.s2/.s5)
  const rank = books.slice(0, 8)
  // 分类区块: navCats 每个分类一个 .content (1 大封面+简介 + 11 文字列表), 6 个一组放进 .novelslist
  const navCats = cats.slice(0, navCategoryCount)
  const sections = (navCats.length ? navCats : [{ id: 'all', name: '全部小说' }]).map(c => {
    const list = books.filter(b => (b.categoryId || b.category) === c.id || b.category === c.name)
    const pool = list.length > 1 ? list : books
    return { cat: c, list: pool.slice(0, 12) }
  })
  // 最新更新列表 → #newscontent .l (.s1类别/.s2书名/.s3最新章节/.s4作者/.s5日期)
  const news = books.slice(0, 30)
  // 热门推荐 → #newscontent .r (.s1类别/.s2书名/.s5日期)
  const hot = books.slice(0, 15)

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goRank = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'ranking' })
  }
  const goFulltext = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'fulltext' })
  }
  const goHistory = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'history' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  // 将 6 个 sections 切成两行 .novelslist (每行 3 个 .content)
  const row1 = sections.slice(0, 3)
  const row2 = sections.slice(3, 6)
  // 如果分类不够 6 个, 用全量书籍兜底区块补齐到至少 1 个 novelslist
  const r1 = row1.length ? row1 : [{ cat: { id: 'all', name: '全部小说' }, list: books.slice(0, 12) }]

  return (
    <div id="wrapper">
      {/* header: header_logo + 搜索 (bqg_panel 在源站由 JS 注入用户面板, 此处用简化版) */}
      <div className="header">
        <div className="header_logo">
          <a href="/" onClick={goHome}>{site.name}</a>
        </div>
        <div className="header_search">
          <form onSubmit={goSearch}>
            <input className="text" name="searchkey" type="text" placeholder="可搜索书名或作者" autoComplete="off" />
            <input className="btn" type="submit" value="搜索" />
          </form>
        </div>
        <div className="userpanel">
          <a href="/" onClick={goHome}>返回首页</a><br />
          <a href="/modules/article/bookcase.php" onClick={goHistory}>我的书架</a>
        </div>
      </div>

      {/* nav: 首页/书架/各分类/排行榜/全本小说 */}
      <div className="nav">
        <ul>
          <li><a href="/" onClick={goHome}>首页</a></li>
          <li><a href="/modules/article/bookcase.php" onClick={goHistory}>我的书架</a></li>
          {navCats.map(c => (
            <li key={c.id}><a href={`/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a></li>
          ))}
          <li><a href="/paihangbang/" onClick={goRank}>排行榜</a></li>
          <li><a href="/xiaoshuodaquan/" onClick={goFulltext}>全本小说</a></li>
        </ul>
      </div>

      {/* #main: 双层 #main (源站真实 DOM 嵌套) */}
      <div id="main">
        <div id="content">
          <div id="main">
            {/* #hotcontent: .l 大神小说 (4 大封面 item) + .r 排行榜热书 (文字列表) */}
            <div id="hotcontent">
              <div className="l">
                {topBooks.map(b => (
                  <div key={b.id} className="item">
                    <div className="image">
                      <a {...bookNavProps(navigate, b.id)}>
                        <BookCover name={b.name} cover={b.cover} style={{ width: 120, height: 150 }} />
                      </a>
                    </div>
                    <dl>
                      <dt>
                        <span>{b.category || '小说'}</span>
                        <a {...bookNavProps(navigate, b.id)}>{b.name}</a>
                      </dt>
                      <dd>{b.intro || '暂无简介'}</dd>
                    </dl>
                    <div className="clear" />
                  </div>
                ))}
              </div>
              <div className="r">
                <h2>排行榜热书</h2>
                <ul>
                  {rank.map(b => (
                    <li key={b.id}>
                      <span className="s1">[{b.category || '小说'}]</span>
                      <span className="s2"><a {...bookNavProps(navigate, b.id)}>{b.name}</a></span>
                      <span className="s5">{b.author}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="clear" />
            </div>

            {/* .novelslist 行 1: 3 个分类区块 (每个 .content 包含 1 大封面+简介 + 11 文字列表) */}
            <div className="novelslist">
              {r1.map(({ cat, list }) => (
                <div key={cat.id} className="content">
                  <h2>{cat.name}</h2>
                  {list[0] && (
                    <div className="top">
                      <div className="image">
                        <a {...bookNavProps(navigate, list[0].id)}>
                          <BookCover name={list[0].name} cover={list[0].cover} style={{ width: 67, height: 82 }} />
                        </a>
                      </div>
                      <dl>
                        <dt><a {...bookNavProps(navigate, list[0].id)}>{list[0].name}</a></dt>
                        <dd>{list[0].intro || '暂无简介'}</dd>
                      </dl>
                      <div className="clear" />
                    </div>
                  )}
                  <ul>
                    {list.slice(1, 12).map(b => (
                      <li key={b.id}>
                        <a {...bookNavProps(navigate, b.id)}>{b.name}</a>/{b.author}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* .novelslist 行 2 (有 6+ 分类时显示) */}
            {row2.length > 0 && (
              <div className="novelslist">
                {row2.map(({ cat, list }) => (
                  <div key={cat.id} className="content">
                    <h2>{cat.name}</h2>
                    {list[0] && (
                      <div className="top">
                        <div className="image">
                          <a {...bookNavProps(navigate, list[0].id)}>
                            <BookCover name={list[0].name} cover={list[0].cover} style={{ width: 67, height: 82 }} />
                          </a>
                        </div>
                        <dl>
                          <dt><a {...bookNavProps(navigate, list[0].id)}>{list[0].name}</a></dt>
                          <dd>{list[0].intro || '暂无简介'}</dd>
                        </dl>
                        <div className="clear" />
                      </div>
                    )}
                    <ul>
                      {list.slice(1, 12).map(b => (
                        <li key={b.id}>
                          <a {...bookNavProps(navigate, b.id)}>{b.name}</a>/{b.author}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* #newscontent: .l 最新更新列表 (5 列 .s1/.s2/.s3/.s4/.s5) + .r 热门推荐 (3 列) */}
            <div id="newscontent">
              <div className="l">
                <h2>最新入库小说列表</h2>
                <ul>
                  {news.map(b => (
                    <li key={b.id}>
                      <span className="s1">[{b.category || '小说'}]</span>
                      <span className="s2"><a {...bookNavProps(navigate, b.id)}>{b.name}</a></span>
                      <span className="s3"><a {...bookNavProps(navigate, b.id)}>{b.latestChapter || '最新章节'}</a></span>
                      <span className="s4">{b.author}</span>
                      <span className="s5">{b.updatedAt ? new Date(b.updatedAt).toISOString().slice(5, 10).replace('-', '') : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="r">
                <h2>热门小说推荐</h2>
                <ul>
                  {hot.map(b => (
                    <li key={b.id}>
                      <span className="s1">[{b.category || '小说'}]</span>
                      <span className="s2"><a {...bookNavProps(navigate, b.id)}>{b.name}</a></span>
                      <span className="s5">{b.updatedAt ? new Date(b.updatedAt).toISOString().slice(5, 10).replace('-', '') : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="clear" />
            </div>
          </div>
        </div>
      </div>

      {/* #firendlink: 友情链接 */}
      <div id="firendlink">
        友情链接：
        <a href="/" onClick={goHome}>{site.name}</a>
        <a href="/paihangbang/" onClick={goRank}>小说排行榜</a>
        <a href="/xiaoshuodaquan/" onClick={goFulltext}>全本小说</a>
        (本站好书)
      </div>

      {/* .dahengfu: 源站为广告位 JS 注入, 此处保留 DOM 占位 */}
      <div className="dahengfu" />

      {/* .footer: footer_link + footer_cont */}
      <div className="footer">
        <div className="footer_link" />
        <div className="footer_cont">
          <p>{site.name} — 免费小说阅读网 · 共收录 {books.length} 本好书 · 总字数 {formatWords(books.reduce((s, b) => s + (b.wordCount || 0), 0))}</p>
        </div>
      </div>
    </div>
  )
}
