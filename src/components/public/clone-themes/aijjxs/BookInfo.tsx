'use client'
// ============================================================
// clone-aijjxs BookInfo — 1:1 精仿 aijjxs.com 书籍详情页 (body.page-info)
// 参考: agent-ctx/probe-html2/probe-aijjxs-book.html (源站真实 DOM)
// 复刻: .wrap > .top (logo+搜索) / .layout > section (.panel 书名详情
//       .detail / .panel.intro-panel 内容简介 .desc / .panel 下载与说明
//       download-btn+tips / .panel 猜您喜欢 .grid2 .book) + aside (.panel.rank
//       热门X类小说下载 book_r+lines / .panel 上下部翻页)
// CSS 由 CloneCSSLoader 加载 public/clone-css/aijjxs.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { statusLabel } from '../../seo'
import type { BookInfoProps } from '../shared'
import { cloneNavHandlers, useCloneCategories } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

// 源站 top-float 16 个分类(同首页, 用于书籍未提供 categoryId 时的分类链接)
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

export function BookInfo({ book, onScrollToc, onContinueRead, onGoCategory, initialCategories }: BookInfoProps) {
  const { site, navigate } = usePublic()
  // R28-1A: 复用 useCloneCategories (SSR initialCategories 优先 + 空时 fetch + DEFAULT_NAV 兜底)
  const cats = useCloneCategories(initialCategories, DEFAULT_NAV)
  const [related, setRelated] = useState<BookItem[]>([])

  // 拉"猜您喜欢": 同分类前 4 本(排除当前书)
  useEffect(() => {
    if (!book?.id) return
    let aborted = false
    const cat = book.categoryId || ''
    const sp = new URLSearchParams({ size: '8', sort: 'latest' })
    if (cat) sp.set('cat', cat)
    if (site?.id) sp.set('site', site.id)
    fetch(`/api/public/books?${sp.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const list: BookItem[] = (d?.data?.books || d?.books || []).filter((b: BookItem) => b.id !== book.id).slice(0, 4)
        setRelated(list)
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [book?.id, book?.categoryId, site?.id])

  if (!book) return null

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 15)
  // 热门同类小说下载榜: 取前 12 本 (book_r 占第 1, lines 占 2-12)
  const rankTop = related[0]
  const rankList = related.slice(1, 12)

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    if (onGoCategory && catId) onGoCategory(catId)
    else navigate({ view: 'category', cat: catId })
  }
  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'keyboard')

  const fmtDate = (s?: string) => s ? new Date(s).toISOString().slice(0, 10) : ''
  const fmtSize = (n?: number) => {
    if (!n) return '0 KB'
    // 估算: 字数 ÷ 2 = 字节数(中文 UTF-8 3字节, 简化用 1.5 倍)
    const kb = Math.max(1, Math.round(n * 1.5 / 1024))
    return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'
  }

  return (
    <>
      {/* 顶部固定分类导航条 */}
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
        {/* 顶部搜索区 */}
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
          <section>
            {/* 书名 + 详情 */}
            <article className="panel">
              <h3>《{book.name}》</h3>
              <div className="body detail">
                <div className="pic">
                  <BookCover name={book.name} cover={book.cover} style={{ width: 112, height: 148, borderRadius: 0, border: '1px solid #d1d5db', padding: 1, background: '#fff' }} />
                  <a className="copy-btn fav-btn" href="javascript:;" onClick={(e) => e.preventDefault()}>加入收藏</a>
                </div>
                <div className="kv">
                  <p><strong>书籍作者：</strong><a href="javascript:;" title={book.author} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }}>{book.author}</a></p>
                  <p><strong>书籍分类：</strong>
                    {book.categoryId ? (
                      <a href={`/txt/${book.categoryId}/`} onClick={(e) => goCat(e, book.categoryId!)}>{book.category || '小说'}</a>
                    ) : (
                      <span>{book.category || '小说'}</span>
                    )}
                  </p>
                  <p><strong>书籍大小：</strong>{fmtSize(book.wordCount)}</p>
                  <p><strong>写作进度：</strong><span className="sfwj">{statusLabel(book.status)}</span></p>
                  <p><strong>上传时间：</strong>{fmtDate(book.updatedAt)}</p>
                  <p><strong>下载方式：</strong>全本免费</p>
                </div>
              </div>
            </article>

            {/* 内容简介 */}
            <article className="panel intro-panel" style={{ marginTop: 14 }}>
              <h3>内容简介</h3>
              <div className="body">
                <div className="desc">{book.intro || '暂无简介'}</div>
              </div>
            </article>

            {/* 下载与说明 */}
            <article className="panel" style={{ marginTop: 14 }}>
              <h3>下载与说明</h3>
              <div className="body">
                <a className="download-btn" href="javascript:;" onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}>在线阅读全文</a>
                <a className="download-btn" href="javascript:;" onClick={(e) => { e.preventDefault(); onScrollToc() }}>查看目录</a>
                <div className="tips">本站所有小说电子书均系网友上传，仅供书友之间免费下载预览！</div>
              </div>
            </article>

            {/* 猜您喜欢 */}
            {related.length > 0 && (
              <article className="panel" style={{ marginTop: 14 }}>
                <h3>猜您喜欢</h3>
                <div className="body grid2">
                  {related.map(b => {
                    const dateStr = b.updatedAt ? new Date(b.updatedAt).toISOString().slice(5, 10) : ''
                    return (
                      <div className="book" key={b.id}>
                        <a {...bookNavProps(navigate, b.id)} style={{ display: 'inline-block', width: 88, height: 122, marginRight: 10, float: 'left' }}>
                          <BookCover name={b.name} cover={b.cover} style={{ width: 88, height: 122, borderRadius: 8 }} />
                        </a>
                        <h4><span className="badge">新</span><a href={`/txt/${b.id}.html`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a></h4>
                        <div className="meta">{b.author} · {b.category || '小说'} · {fmtSize(b.wordCount)} · {dateStr}</div>
                        <div className="desc">{b.intro || '暂无简介'}</div>
                      </div>
                    )
                  })}
                </div>
              </article>
            )}
          </section>

          <aside>
            {/* 热门同类小说下载 */}
            <article className="panel rank">
              <h3>热门{book.category || ''}小说下载</h3>
              <div className="body">
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
                      <span className="no">{i + 1}</span>
                      <a href={`/txt/${b.id}.html`} title={b.name} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                      <span className="date">{b.author}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>

            {/* 上下部翻页 */}
            <article className="panel" style={{ marginTop: 14 }}>
              <h3>上下部翻页</h3>
              <div className="body">
                <ul className="lines">
                  <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'category', cat: book.categoryId || undefined }) }}>返回列表</a></li>
                  <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); onScrollToc() }}>查看目录</a></li>
                </ul>
              </div>
            </article>
          </aside>
        </main>
      </div>
    </>
  )
}
