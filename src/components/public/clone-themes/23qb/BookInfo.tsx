'use client'
// ============================================================
// clone-23qb BookInfo — 1:1 精仿 www.23qb.net 书籍详情页
// 参考: 23qb.css (probe-23qb-book.html 被 CF 拦截, 故按源站 CSS class 结构复刻)
// 复刻: header(简版) / main#main.wrapper > .content > .box > .module-search-item
//   ( .novel-cover (封面) + .novel-info (.novel-info-header h3 + .novel-info-aux 标签
//     + .novel-info-main .novel-info-items (作者/分类/状态/字数/最新章节/更新时间)
//     + .novel-info-content 简介 + .novel-info-footer 开始阅读按钮) )
// ============================================================
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords, fmtDate, statusLabel } from '../../seo'

export function BookInfo({ book, onScrollToc, onContinueRead, onGoCategory }: BookInfoProps) {
  const { site, navigate } = usePublic()
  if (!book) return null

  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goCat = (e: React.MouseEvent, cat?: string) => {
    e.preventDefault()
    if (onGoCategory && book.categoryId) onGoCategory(book.categoryId)
    else navigate({ view: 'category', cat: cat || book.categoryId || book.category })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  // 标签: book.keywords 拆分
  const tags = (book.keywords || '').split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 12)

  return (
    <>
      {/* header (简版) */}
      <header id="header" className="wrapper">
        <div className="header-content">
          <div className="banyundog-com">
            <div className="header-logo">
              <h1 className="slogan">{site.name}</h1>
              <div className="fixed-logo">
                <a href="/" className="logo" title={site.name} onClick={goHome}><span>{site.name}</span></a>
              </div>
            </div>
          </div>
          <div className="nav-search">
            <form action="/search.html" className="search-dh" onSubmit={goSearch} />
          </div>
          <div className="header-module">
            <ul className="nav-menu-items">
              <li className="nav-menu-item"><a href="/" title="首页" onClick={goHome}><span>首页</span></a></li>
              <li className="nav-menu-item"><a href="/book/" title="书库" onClick={(e) => goCat(e)}><span>书库</span></a></li>
            </ul>
          </div>
        </div>
        <div id="search-content">
          <form action="/search.html" onSubmit={goSearch}>
            <div className="search-main">
              <div className="search-box">
                <input className="search-input ac_wd" id="txtKeywords" type="search" name="searchkey" autoComplete="off" placeholder="搜索喜欢的小说、作者、标签" />
                <a href="/book/" className="search-btn search-cupfox" title="书库" onClick={(e) => goCat(e)}>书库</a>
                <button className="search-btn search-go" type="submit"><i className="icon-search" /></button>
                <button className="cancel-btn" type="button">取消</button>
              </div>
            </div>
          </form>
        </div>
      </header>

      {/* main */}
      <main id="main" className="wrapper">
        <div className="content">
          <div className="list">
            <div className="box">
              <div className="module-search-item">
                {/* 封面 */}
                <div className="novel-cover">
                  <div className="module-item-cover">
                    <div className="module-item-pic">
                      <a {...bookNavProps(navigate, book.id)} title={book.name} />
                      <BookCover name={book.name} cover={book.cover} className="lazy lazyloaded" style={{ width: '100%', height: '100%' }} />
                      <div className="loading" />
                    </div>
                    <div className="module-item-caption">
                      <span>{book.category || '小说'} {book.author}</span>
                    </div>
                  </div>
                </div>

                {/* 信息 */}
                <div className="novel-info">
                  <div className="novel-info-header">
                    <h3>{book.name}</h3>
                  </div>

                  {/* 标签 */}
                  {tags.length > 0 && (
                    <div className="novel-info-aux">
                      {tags.map((t, i) => (
                        <span key={t} className={i === 0 ? 'tag-link' : 'tag-link'}>
                          <a title={t} onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: t }) }}>{t}</a>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 元数据 */}
                  <div className="novel-info-main">
                    <div className="novel-info-items">
                      <div className="novel-info-itemtitle">作者</div>
                      <div className="novel-info-actor">{book.author}</div>
                    </div>
                    <div className="novel-info-items">
                      <div className="novel-info-itemtitle">分类</div>
                      <div className="novel-info-actor">
                        <a title={book.category} onClick={(e) => goCat(e)}>{book.category || '小说'}</a>
                      </div>
                    </div>
                    <div className="novel-info-items">
                      <div className="novel-info-itemtitle">状态</div>
                      <div className="novel-info-actor">{statusLabel(book.status)}</div>
                    </div>
                    <div className="novel-info-items">
                      <div className="novel-info-itemtitle">字数</div>
                      <div className="novel-info-actor">{formatWords(book.wordCount)}</div>
                    </div>
                    {book.latestChapter && (
                      <div className="novel-info-items">
                        <div className="novel-info-itemtitle">最新章节</div>
                        <div className="novel-info-actor">
                          <a {...bookNavProps(navigate, book.id)}>{book.latestChapter}</a>
                        </div>
                      </div>
                    )}
                    {book.updatedAt && (
                      <div className="novel-info-items">
                        <div className="novel-info-itemtitle">更新时间</div>
                        <div className="novel-info-actor">{fmtDate(book.updatedAt)}</div>
                      </div>
                    )}
                  </div>

                  {/* 简介 */}
                  <div className="novel-info-content">
                    <div className="novel-info-itemtitle">内容简介</div>
                    <p>{book.intro || '暂无简介'}</p>
                  </div>

                  {/* 操作 */}
                  <div className="novel-info-footer">
                    <button
                      type="button"
                      className="btn-important"
                      onClick={() => { if (onContinueRead) onContinueRead(); else onScrollToc() }}
                    >
                      <i className="icon-play" />开始阅读
                    </button>
                    <button
                      type="button"
                      className="btn-base"
                      onClick={onScrollToc}
                    >
                      <i className="icon-list" />查看目录
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* footer */}
      <footer id="footer" className="wrapper pd60">
        <p className="sitemap">
          <span>{site.name}</span>
          <a href="/" onClick={goHome}>RSS</a>
          <span className="space-line-bold" />
          <a href="/" onClick={goHome}>Google</a>
          <span className="space-line-bold" />
          <a href="/" onClick={goHome}>Bing</a>
        </p>
        <p>{site.title || site.name}</p>
      </footer>
    </>
  )
}
