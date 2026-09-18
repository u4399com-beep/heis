'use client'
// ============================================================
// clone-101kks CategoryList — 1:1 精仿 101kks.com 101看書 分类列表页 (/novels/class/xx_1.html, /newtag/xxx/1)
// 参考: agent-ctx/probe-html2/probe-101kks-category.html (源站真实 DOM, 繁体)
// 复刻:
//   <header><div class="headbox clearfix">
//   <div class="main"><div class="container"><div class="mybox"><ul class="row"><li class="col-88">
//     <h3 class="mytitle">標籤<b class="hottext">{label}</b>類小說列表
//     <div class="newbox"><ul id="article_list_content">
//       <li> a.imgbox (封面) + .newnav (h3 + .labelbox + ol.ellipsis_2 + .zxzj) + .newright (.piaos + .btn-tp + .btn-jrsj)
//     <div class="pages"><div class="pagelink"> (a.pgroup + strong + a 2..10 + a.next + a.ngroup)
//   <div class="foot">
// CSS 由 CloneCSSLoader 加载 public/clone-css/101kks.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import type { CategoryListProps } from '../shared'
import type { BookItem } from '../../types'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { site, navigate } = usePublic()

  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goCat = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'category' }) }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  // 分页区间: 当前页 ± 2, 最少 5 页 (源站 .pagelink 显示 1..10 + pgroup + next + ngroup)
  const totalPages = Math.max(1, Math.ceil(total / size))
  const start = Math.max(1, page - 2)
  const end = Math.min(totalPages, start + 9)
  const pageNums: number[] = []
  for (let i = start; i <= end; i++) pageNums.push(i)

  // 渲染列表项 (源站 .newbox li: imgbox + newnav + newright)
  const renderListItem = (b: BookItem) => {
    const dateStr = b.updatedAt ? new Date(b.updatedAt).toISOString().slice(5, 10) : ''
    return (
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
          <span style={{ display: 'none' }}>{dateStr}</span>
        </div>
        <div className="newright">
          <div className="piaos"><span></span><label></label></div>
          <a className="btn btn-tp" {...bookNavProps(navigate, b.id)}>點擊閱讀</a>
          <a className="btn btn-jrsj" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}>加入書架</a>
        </div>
      </li>
    )
  }

  return (
    <>
      {/* 顶部 header */}
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
              <li><a href="/novels/class" onClick={goCat}><i className="iconfont icon-list1"></i> 分類</a></li>
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
                  <h3 className="mytitle">標籤<b className="hottext">{label}</b>類小說列表</h3>
                </div>

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
                      {books.map(b => renderListItem(b))}
                    </ul>
                  )}
                </div>

                {/* 分页 (源站 .pages .pagelink: a.pgroup + strong 当前 + a 各页 + a.next + a.ngroup) */}
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
