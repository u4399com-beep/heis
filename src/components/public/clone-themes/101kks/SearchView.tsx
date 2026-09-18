'use client'
// ============================================================
// clone-101kks SearchView — 1:1 精仿 101kks.com 101看書 搜索结果页 (/search)
// 参考: agent-ctx/probe-html2/probe-101kks.html (源站搜索 form action=/search) +
//       probe-101kks-category.html (列表结构 .newbox #article_list_content)
// 复刻: 与 CategoryList 同结构, 标题改 "搜索 {q} 的結果列表", 搜索框预填 q
//   <header><div class="headbox clearfix"> (搜索框 defaultValue={q})
//   <div class="main"><div class="container"><div class="mybox"><ul class="row"><li class="col-88">
//     <h3 class="mytitle">搜索<b class="hottext">{q}</b>的結果列表</h3>
//     <div class="newbox"><ul id="article_list_content">
//     <div class="hot-text"> 共 {books.length} 本
//   <div class="foot">
// CSS 由 CloneCSSLoader 加载 public/clone-css/101kks.css
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import type { SearchViewProps } from '../shared'
import type { BookItem } from '../../types'

export function SearchView({ q, books, loading }: SearchViewProps) {
  const { site, navigate } = usePublic()

  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const kw = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (kw) navigate({ view: 'search', q: kw })
  }

  const renderListItem = (b: BookItem) => (
    <li key={b.id}>
      <a className="imgbox" {...bookNavProps(navigate, b.id)}>
        <BookCover name={b.name} cover={b.cover} style={{ width: 100, height: 130 }} />
      </a>
      <div className="newnav">
        <h3><a {...bookNavProps(navigate, b.id)}>{b.name}</a></h3>
        <div className="labelbox">
          <label>{b.author || '佚名'}</label>
          <label>{b.category || '其他類型'}</label>
          <label>{b.status === 'completed' ? '已完結' : '連載'}</label>
        </div>
        <ol className="ellipsis_2">{b.intro || '暫無簡介'}</ol>
        <div className="zxzj">
          <p><span>最近章節</span><a {...bookNavProps(navigate, b.id)}>{b.latestChapter || '最新章節'}</a></p>
        </div>
      </div>
      <div className="newright">
        <div className="piaos"><span></span><label></label></div>
        <a className="btn btn-tp" {...bookNavProps(navigate, b.id)}>點擊閱讀</a>
        <a className="btn btn-jrsj" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}>加入書架</a>
      </div>
    </li>
  )

  return (
    <>
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
                <input type="text" name="searchkey" defaultValue={q || ''} placeholder="請輸入搜索內容！" autoComplete="off" />
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

      <div className="main">
        <div className="container">
          <div className="mybox">
            <ul className="row">
              <li className="col-88">
                <div>
                  <h3 className="mytitle">搜索<b className="hottext">{q}</b>的結果列表</h3>
                  <span style={{ marginLeft: 10, fontSize: 13, color: '#999' }}>共 {books.length} 本相關小說</span>
                </div>

                <div className="newbox">
                  {loading ? (
                    <ul id="article_list_content">
                      <li style={{ padding: 40, textAlign: 'center' }}>搜索中...</li>
                    </ul>
                  ) : !books.length ? (
                    <ul id="article_list_content">
                      <li style={{ padding: 40, textAlign: 'center' }}>未找到相關書籍, 請嘗試其他關鍵詞</li>
                    </ul>
                  ) : (
                    <ul id="article_list_content">
                      {books.map(b => renderListItem(b))}
                    </ul>
                  )}
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

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
