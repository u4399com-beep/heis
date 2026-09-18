'use client'
// ============================================================
// clone-101kks RankingView — 1:1 精仿 101kks.com 101看書 排行榜页 (/novels/hot)
// 参考: agent-ctx/probe-html2/probe-101kks.html (源站首页含 menu1 排行链接) +
//       probe-101kks-chapter.html (源站 .col-4 .ranking ul li .rank_left/.rank_right)
// 复刻:
//   <header><div class="headbox clearfix">
//   <div class="main"><div class="container"><div class="mybox"><ul class="row"><li class="col-88">
//     <h3 class="mytitle">排行榜
//     <ul class="tabs2 clearfix"> (總點擊/總推薦/字數榜/最近更新 tab)
//     <div class="newbox"><ul id="article_list_content"> (列表项同 CategoryList)
//     <div class="pages"><div class="pagelink"> (分页)
//   <div class="foot">
// CSS 由 CloneCSSLoader 加载 public/clone-css/101kks.css
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import type { RankingViewProps } from '../shared'
import type { BookItem } from '../../types'

const TABS = [
  { id: 'allvisit', name: '總點擊榜' },
  { id: 'allvote', name: '總推薦榜' },
  { id: 'size', name: '字數榜' },
  { id: 'lastupdate', name: '最近更新' },
]

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage }: RankingViewProps) {
  const { site, navigate } = usePublic()

  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  // 分页区间: 当前页 ± 2, 最少 5 页 (源站 .pagelink 1..10 + pgroup/next/ngroup)
  const totalPages = Math.max(1, Math.ceil(total / size))
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, start + 9)
  const pageNums: number[] = []
  for (let i = start; i <= end; i++) pageNums.push(i)

  // 渲染列表项 (同 CategoryList .newbox li 结构, 用排名序号填充 .piaos label)
  const renderListItem = (b: BookItem, idx: number) => (
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
        <div className="piaos"><span></span><label>{idx + 1 + (page - 1) * size}</label></div>
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

      <div className="main">
        <div className="container">
          <div className="mybox">
            <ul className="row">
              <li className="col-88">
                <div>
                  <h3 className="mytitle">小說<b className="hottext">排行榜</b></h3>
                </div>

                {/* Tab 切换 (源站 .tabs2 clearfix li.active) */}
                <ul className="tabs2 clearfix">
                  {TABS.map(t => (
                    <li key={t.id} className={tab === t.id ? 'active' : ''}>
                      <a
                        role="button"
                        tabIndex={0}
                        onClick={() => onTabChange(t.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTabChange(t.id) } }}
                      >
                        {t.name}
                      </a>
                    </li>
                  ))}
                </ul>

                <div className="newbox">
                  {loading ? (
                    <ul id="article_list_content">
                      <li style={{ padding: 40, textAlign: 'center' }}>載入中...</li>
                    </ul>
                  ) : !books.length ? (
                    <ul id="article_list_content">
                      <li style={{ padding: 40, textAlign: 'center' }}>暫無書籍</li>
                    </ul>
                  ) : (
                    <ul id="article_list_content">
                      {books.map((b, i) => renderListItem(b, i))}
                    </ul>
                  )}
                </div>

                {total > size && (
                  <div className="pages">
                    <div className="pagelink" id="pagelink">
                      {page > 1 && (
                        <>
                          <a className="pgroup" onClick={() => onPage(1)} style={{ cursor: 'pointer' }}>&lt;&lt;</a>
                          <a className="prev" onClick={() => onPage(page - 1)} style={{ cursor: 'pointer' }}>&lt;</a>
                        </>
                      )}
                      {pageNums.map(n => (
                        n === page ? (
                          <strong key={n}>{n}</strong>
                        ) : (
                          <a key={n} onClick={() => onPage(n)} style={{ cursor: 'pointer' }}>{n}</a>
                        )
                      ))}
                      {page < totalPages && (
                        <>
                          <a className="next" onClick={() => onPage(page + 1)} style={{ cursor: 'pointer' }}>&gt;</a>
                          <a className="ngroup" onClick={() => onPage(totalPages)} style={{ cursor: 'pointer' }}>&gt;&gt;</a>
                        </>
                      )}
                    </div>
                  </div>
                )}
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
