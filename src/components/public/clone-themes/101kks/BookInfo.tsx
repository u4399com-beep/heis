'use client'
// ============================================================
// clone-101kks BookInfo — 1:1 精仿 101kks.com 101看書 书籍详情页 (/book/xxx.html)
// 参考: agent-ctx/probe-html2/probe-101kks-chapter.html (源站真实 DOM, 繁体)
//   注: probe-101kks-chapter.html 实为书页 (og:url=/book/20224.html), 含 bookbox/bookimg2/booknav2/addbtn/infotag/tabs/tabsnav/qustime/infolist/ranking
// 复刻:
//   <header><div class="headbox clearfix"> (logo+search+menu1)
//   <div class="main"><div class="container"><ul class="row">
//     <li class="col-8"><div class="mybox">
//       <h3 class="mytitle shuye"><div class="bread"> 面包屑
//       <div class="bookbox">
//         .bookimg2 (img + .status0)
//         .booknav2 (h1 + p 作者/分類/字數|狀態/更新)
//         .addbtn (a.btn 開始閱讀/加入書架/投推薦票)
//       .infotag.clearfix (h3.tagtitle + ul.tagul)
//       <ul class="tabs clearfix"> (目錄/簡介/書評 tab)
//       .tabsnav (#tab_info: ul.infolist + .navtxt p)
//       <a class="btn more-btn"> 完整目錄
//     <li class="col-4"><div class="mybox"> 本周最強
//       <ul class="tabs tabshot clearfix"> 熱門/完本 tab
//       .tabsnav > .ranking > ul > li (.rank_left/.rank_right)
//   <div class="foot">
// CSS 由 CloneCSSLoader 加载 public/clone-css/101kks.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords, statusLabel } from '../../seo'
import type { BookInfoProps } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

export function BookInfo({ book, onScrollToc, onContinueRead, onGoCategory }: BookInfoProps) {
  const { site, navigate } = usePublic()
  const [related, setRelated] = useState<BookItem[]>([])

  // 拉"本周最強"侧栏: 同分类前 12 本 (排除当前书)
  useEffect(() => {
    if (!book?.id) return
    let aborted = false
    const sp = new URLSearchParams({ size: '12', sort: 'hot' })
    if (book.categoryId) sp.set('cat', book.categoryId)
    if (site?.id) sp.set('site', site.id)
    fetch(`/api/public/books?${sp.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const arr: BookItem[] = Array.isArray(d) ? d : (d.data?.items || d.data?.books || d.items || d.books || [])
        setRelated(arr.filter(b => b.id !== book.id).slice(0, 12))
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [book?.id, book?.categoryId, site?.id])

  if (!book) return null

  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goCat = (e: React.MouseEvent) => {
    e.preventDefault()
    if (onGoCategory) onGoCategory(book.categoryId || book.category)
    else navigate({ view: 'category', cat: book.categoryId || book.category })
  }
  const goRead = (e: React.MouseEvent) => {
    e.preventDefault()
    if (onContinueRead) onContinueRead()
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  // 拆分 keywords (源站 .tagul li a, 每个标签可跳 keyword 落地页)
  const keywords: string[] = (book.keywords || '').split(/[,，;；\s]+/).filter(Boolean)

  // 源站 .bookimg2 .status0/.status1 表示连载/完结徽章
  const isCompleted = book.status === 'completed'
  const statusMark = isCompleted ? 'status1' : 'status0'
  const dateStr = book.updatedAt ? new Date(book.updatedAt).toISOString().slice(0, 10) : ''

  // 本周最強 top1 (大封面 .rank_left + .rank_right), 其余简化 .rank_left only
  const rankTop = related[0]
  const rankList = related.slice(1, 12)

  return (
    <>
      {/* 顶部 header (简版: logo+search+menu1) */}
      <header>
        <div className="headbox clearfix">
          <div className="menubtn pull-left"><i className="iconfont icon-menu"></i></div>
          <div className="logo pull-left">
            <div className="logoimg"></div>
            <a href="/" onClick={goHome}>{site.name}</a>
          </div>
          <form action="/search" method="post" onSubmit={goSearch}>
            <div className="search pull-left">
              <i className="iconfont icon-search"></i>
              <div className="inputbox">
                <i className="iconfont icon-ArrowLeft"></i>
                <input type="text" name="searchkey" placeholder="請輸入搜索內容！" autoComplete="off" />
                <input type="hidden" name="searchtype" value="all" />
              </div>
            </div>
          </form>
          <div className="user1 pull-right"><img className="user_touxiang" src="/images/user.png" alt="" /></div>
          <div className="lang pull-right">
            <a href="javascript:;" className="textsel">繁體</a>
            <ul>
              <li><a href="javascript:;" className="zh_click" onClick={(e) => e.preventDefault()}>簡體</a></li>
              <li><a href="javascript:;" className="zh_click" onClick={(e) => e.preventDefault()}>繁體</a></li>
            </ul>
          </div>
          <div className="menu1 pull-right">
            <ul>
              <li><a href="/" onClick={goHome}> 首頁</a></li>
              <li><a href="/novels/hot" onClick={(e) => { e.preventDefault(); navigate({ view: 'ranking' }) }}><i className="iconfont icon-chart"></i> 排行</a></li>
              <li><a href="/novels/full" onClick={(e) => { e.preventDefault(); navigate({ view: 'fulltext' }) }}><i className="iconfont icon-ai-book"></i> 完本</a></li>
              <li><a href="/novels/class" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}><i className="iconfont icon-list1"></i> 分類</a></li>
              <li><a href="/bookcase" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}><i className="iconfont icon-library"></i> 我的書架</a></li>
              <li><a href="/history" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}><i className="iconfont icon-yuedujilu"></i> 閱讀記錄</a></li>
            </ul>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <div className="main">
        <div className="container">
          <ul className="row">
            {/* 左栏 col-8: 书籍信息 + 简介 + 目录 */}
            <li className="col-8">
              <div className="mybox">
                {/* 面包屑 (源站 .mytitle.shuye .bread) */}
                <h3 className="mytitle shuye">
                  <div className="bread">
                    <a href="/" onClick={goHome}>首頁</a> &gt;{' '}
                    <a href="/" onClick={goCat}>{book.category || '小說'}</a> &gt;{' '}
                    <a {...bookNavProps(navigate, book.id)}>{book.name}</a>
                  </div>
                </h3>

                {/* .bookbox: 封面 + 信息 + 按钮 */}
                <div className="bookbox">
                  <div className="bookimg2">
                    <span className={statusMark}></span>
                    <a {...bookNavProps(navigate, book.id)}>
                      <BookCover name={book.name} cover={book.cover} style={{ width: 120, height: 160 }} />
                    </a>
                  </div>

                  <div className="booknav2">
                    <h1><a {...bookNavProps(navigate, book.id)}>{book.name}</a></h1>
                    <p>作者：<a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} title={book.author}>{book.author}</a></p>
                    <p>分類：<a href="/" onClick={goCat} title={book.category}>{book.category || '小說'}</a></p>
                    <p>{formatWords(book.wordCount)} | {statusLabel(book.status)}</p>
                    <p>更新：{dateStr}</p>
                    <div className="sharebtn"></div>
                  </div>

                  <div className="addbtn">
                    <a className="btn" href="/" onClick={goRead}>開始閱讀</a>
                    <a className="btn" href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}>加入書架</a>
                    <a className="btn" href="javascript:;" onClick={(e) => e.preventDefault()}>投推薦票</a>
                  </div>
                  <div id="vote_result" style={{ clear: 'both', padding: '10px 10px 0 10px', color: '#f00', fontSize: 14 }}></div>
                </div>
                <div className="txtcenter1"></div>
              </div>

              <div className="mybox">
                {/* 标签 */}
                <div className="infotag clearfix" id="infotag">
                  <h3 className="tagtitle">標籤</h3>
                  <ul className="tagul" id="tagul">
                    {keywords.length ? keywords.map(k => (
                      <li key={k}><a href={`/newtag/${k}/`} onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: k }) }}>{k}</a></li>
                    )) : <li><a>暫無標籤</a></li>}
                  </ul>
                </div>

                {/* tabs: 簡介 (active by default) */}
                <ul className="tabs clearfix">
                  <li><a><i className="iconfont icon-list"></i>目錄</a></li>
                  <li className="active"><a><i className="iconfont icon-Info"></i>簡介</a></li>
                  <li><a><i className="iconfont icon-chat"></i>書評</a></li>
                </ul>

                <div className="tabsnav">
                  {/* 簡介 tab (active) */}
                  <div id="tab_info">
                    <ul className="infolist">
                      <li>{formatWords(book.wordCount)}<span>字數</span></li>
                      <li>{book.latestChapter ? '最新章節' : '連載'}<span>狀態</span></li>
                    </ul>
                    <div className="navtxt">
                      <p>{book.intro || '暫無簡介'}</p>
                      <p>小說關鍵詞：{book.name}無彈窗,{book.name}無亂序,{book.name}小說,{book.name}{book.author},{book.name}101,{book.name}最新章節閱讀</p>
                    </div>
                  </div>
                </div>

                {/* 完整目錄按钮 */}
                <a className="btn more-btn" href="/" onClick={(e) => { e.preventDefault(); if (onScrollToc) onScrollToc() }}>完整目錄</a>
              </div>
            </li>

            {/* 右栏 col-4: 本周最強 */}
            <li className="col-4">
              <div className="mybox">
                <h3 className="mytitle">本周最強</h3>
                <ul className="tabs tabshot clearfix">
                  <li className="active"><a><i className="iconfont icon-hot"></i>熱門</a></li>
                  <li><a><i className="iconfont icon-hot"></i>完本</a></li>
                </ul>
                <div className="tabsnav">
                  <div className="ranking">
                    <ul>
                      {rankTop && (
                        <li className="active">
                          <a {...bookNavProps(navigate, rankTop.id)}>
                            <div className="rank_left">
                              <h3 className="ranktit ellipsis_1"><span></span>{rankTop.name}</h3>
                              <h4>本周最強</h4>
                              <p>{rankTop.category || '小說'}.{rankTop.author}</p>
                            </div>
                            <div className="rank_right">
                              <div className="imgbox2">
                                <BookCover name={rankTop.name} cover={rankTop.cover} style={{ width: 60, height: 80 }} />
                              </div>
                              <span>{rankTop.status === 'completed' ? '全本' : '連載'}</span>
                            </div>
                          </a>
                        </li>
                      )}
                      {rankList.map(b => (
                        <li key={b.id}>
                          <a {...bookNavProps(navigate, b.id)}>
                            <div className="rank_left">
                              <h3 className="ranktit ellipsis_1"><span></span>{b.name}</h3>
                            </div>
                            <div className="rank_right">
                              <span>{b.status === 'completed' ? '全本' : '連載'}</span>
                            </div>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>

      {/* 页脚 */}
      <div className="foot">
        <div className="copyright">
          <div>
            <a href="/novels/hot" onClick={(e) => { e.preventDefault(); navigate({ view: 'ranking' }) }}>排行榜</a>
            <a href="/last" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>最新更新</a>
            <a href="/all.html" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>全部小說</a>
            <a href="/newtags" onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: '系統' }) }}>熱門標籤</a>
          </div>
          <p>Copyright 2023 <a href="/" onClick={goHome}>Powered by © {site.name}（https://{site.domain || '101kks.com'}）</a></p>
          <div>
            友情連結：<a href="/" onClick={goHome} title={site.name}>{site.name}</a>|
            <a href="/privacy_policy.html" onClick={(e) => e.preventDefault()}>Cookies Policy</a>|
            <a href="/DMCA.html" onClick={(e) => e.preventDefault()}>DMCA</a>
            <div className="clear"></div>
          </div>
        </div>
      </div>
    </>
  )
}
