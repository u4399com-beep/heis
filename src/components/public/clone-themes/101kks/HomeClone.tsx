'use client'
// ============================================================
// clone-101kks HomeClone — 1:1 精仿 101kks.com 101看書 首页
// 参考: agent-ctx/probe-html2/probe-101kks.html (源站真实 DOM, 繁体)
// 复刻:
//   .leftmenu (左侧抽屉静态, CSS left:-300px 隐藏, 同源站默认态)
//   <header><div class="headbox clearfix"> .menubtn/.logo/.search/.user1/.lang/.menu1
//   <div class="main"><div class="container">
//     .adbanner.mybox > .headerad (公告条)
//     <ul class="row"><li class="col-xinindex"><div class="mybox">
//       .xinlogo / .error-text.searchBox (form) / .indexdaohang (4 li)
//       <h3 class="mytitle">熱門書單推薦
//       .booklist-block > .booklist-grid > .booklist-card × N (大封面书单卡)
//       <h3 class="mytitle">最新更新
//       .newbox > ul#article_list_content > li × N (含 .imgbox/.newnav/.newright)
//       .tag (热门标签 a /newtag/xxx/)
//   <div class="foot"><div class="copyright">
// CSS 由 CloneCSSLoader 加载 public/clone-css/101kks.css (84KB cdnshu 框架)
// 全部用源站真实 class 名, 让 CSS 选择器自动生效
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { HomeCloneProps } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

// 源站 .menu1 顶部固定 6 个导航项 (与 probe-101kks.html 顺序一致)
const TOP_NAV: { id: string; name: string; view: 'home' | 'ranking' | 'fulltext' | 'history' | 'category' }[] = [
  { id: 'home', name: '首頁', view: 'home' },
  { id: 'hot', name: '排行', view: 'ranking' },
  { id: 'full', name: '完本', view: 'fulltext' },
  { id: 'class', name: '分類', view: 'category' },
  { id: 'bookcase', name: '我的書架', view: 'history' },
  { id: 'history', name: '閱讀記錄', view: 'history' },
]

// 热门标签静态池 (源站 .tag 区 100+ 关键词, 取 50 个保证视觉密度)
const HOT_TAGS = ['系統', '穿越', '重生', '空間', '同人衍生', '多女主', '種田', '系統流', '無敵', '修仙',
  '金手指', '娛樂圈', '斗羅大陸', '爽文', '科技', '遊戲', '殺伐果斷', '末世', '簽到', '諸天流',
  '斗羅', '天才流', '直播', '反派', '武道', '異能', '求生', '魔法', '無敵流', '生活',
  '搞笑', '都市', '輕鬆', '綜漫', '火影', '進化', '無限流', '娛樂', '女主', '升級',
  '明星', '年代文', '單女主', '時代', '職業', '大佬', '快穿', '遊戲異界', '靈氣復甦', '星際']

export function HomeClone({ books, loading, homeModuleLimit = 20 }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])

  // 拉分类列表用于 .menu1 分類链接 + 备用书单标题
  useEffect(() => {
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
  }, [])

  if (loading) return <div className="main"><div className="container"><div className="mybox" style={{ padding: 40, textAlign: 'center' }}>載入中...</div></div></div>
  if (!books.length) return <div className="main"><div className="container"><div className="mybox" style={{ padding: 40, textAlign: 'center' }}>暫無內容</div></div></div>

  // 熱門書單: 取前 6 本, 每本作为一张 booklist-card (cover-stack 用本封面 + 2 个其它书的封面堆叠)
  const featured = books.slice(0, 6)
  // 最新更新: 取前 homeModuleLimit 本作为 .newbox #article_list_content 列表
  const latest = books.slice(0, homeModuleLimit)

  const goHome = (e: React.MouseEvent) => { e.preventDefault(); navigate({ view: 'home' }) }
  const goView = (view: 'home' | 'ranking' | 'fulltext' | 'history' | 'category') => (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view })
  }
  const goCat = (catId?: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  // 渲染 .booklist-card (熱門書單推薦区, 每张含 3 个封面堆叠)
  const renderBooklistCard = (b: BookItem, idx: number) => {
    // 取本封面 + 2 个相邻书的封面做 cover-stack (源站真实结构是 3 个封面堆叠 + "+" 数量徽章)
    const stack = [b, books[(idx + 1) % books.length], books[(idx + 2) % books.length]]
    return (
      <div className="booklist-card" key={b.id}>
        <a className="booklist-card-link" {...bookNavProps(navigate, b.id)}>
          <div className="booklist-card-content">
            <div className="booklist-cover-section">
              <div className="booklist-cover-stack">
                {stack.map((s, i) => (
                  <div className="cover-main" key={i}>
                    <BookCover name={s.name} cover={s.cover} className="cover-image" style={{ width: 60, height: 80 }} />
                  </div>
                ))}
                <div className="cover-count"><span>+</span></div>
              </div>
            </div>
            <div className="booklist-info-section">
              <h3 className="booklist-title">{b.name}</h3>
              <div className="booklist-meta">
                <div className="meta-item"><i className="iconfont icon-chart"></i><span>{formatWords(b.wordCount)}</span></div>
                <div className="meta-item"><i className="iconfont icon-library"></i><span>{b.category || '小說'}</span></div>
                <div className="meta-item"><i className="iconfont icon-shoujihao"></i><span>{b.author}</span></div>
              </div>
              <div className="booklist-desc">
                <p>{b.intro || '暫無簡介'}</p>
              </div>
            </div>
          </div>
        </a>
      </div>
    )
  }

  // 渲染 .newbox #article_list_content li (源站列表项: imgbox + newnav + newright)
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
          <label>{b.status === 'completed' ? '已完結' : '連載中'}</label>
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
      {/* 左侧抽屉 .leftmenu (源站 CSS left:-300px 默认隐藏, 仅静态复刻结构) */}
      <div className="leftmenu">
        <div className="menu_close_btn"><i className="iconfont icon-close"></i></div>
        <div className="headuser">
          <div className="headimg"><img className="user_touxiang" src="/images/user.png" alt="" /></div>
          <span>游客</span>
        </div>
        <div className="register">
          <a href="/register.php" rel="nofollow" onClick={(e) => e.preventDefault()}>註冊</a>
          <a href="/login.php" rel="nofollow" onClick={(e) => e.preventDefault()}>登錄</a>
          <a href="/getpass.php" rel="nofollow" onClick={(e) => e.preventDefault()}>忘記密碼</a>
        </div>
        <div className="menu2">
          <ul>
            <li><a href="/" onClick={goHome}><i className="iconfont icon-home"></i>首頁</a></li>
            <li><a href="/novels/hot" onClick={goView('ranking')}><i className="iconfont icon-chart"></i>排行榜</a></li>
            <li><a href="/novels/full" onClick={goView('fulltext')}><i className="iconfont icon-ai-book"></i>完本小說</a></li>
            <li><a href="/novels/class" onClick={goView('category')}><i className="iconfont icon-list1"></i>小說分類</a></li>
            <li><a href="/bookcase" onClick={goView('history')}><i className="iconfont icon-library"></i>我的書架</a></li>
            <li><a href="/history" onClick={goView('history')}><i className="iconfont icon-yuedujilu"></i>閱讀記錄</a></li>
          </ul>
        </div>
      </div>
      <div className="modbg"></div>

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
              <li><a href="javascript:;" className="zh_click" id="zh_click_s" onClick={(e) => e.preventDefault()}>簡體</a></li>
              <li><a href="javascript:;" className="zh_click" id="zh_click_t" onClick={(e) => e.preventDefault()}>繁體</a></li>
            </ul>
          </div>
          <div className="menu1 pull-right">
            <ul>
              {TOP_NAV.map(n => (
                <li key={n.id}>
                  <a href="/" onClick={goView(n.view)}>
                    {n.id !== 'home' && <i className={`iconfont ${n.id === 'hot' ? 'icon-chart' : n.id === 'full' ? 'icon-ai-book' : n.id === 'class' ? 'icon-list1' : 'icon-library'}`}></i>}
                    {' '}{n.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <div className="main">
        <div className="container">
          {/* 公告条 */}
          <div className="adbanner mybox" style={{ marginBottom: 0 }}>
            <div className="headerad">請記住我們的域名：{site.domain || '101kks.com'}</div>
          </div>

          <ul className="row">
            <li className="col-xinindex">
              <div className="mybox">
                {/* Logo */}
                <div className="xinlogo">
                  <img src="/images/logo_index.png" alt={site.name} />
                </div>

                {/* 搜索框 */}
                <div className="error-text searchBox">
                  <form name="articlesearch" method="post" action="/search" onSubmit={goSearch}>
                    <input id="searchkey" className="searchinput" autoComplete="off" type="text" name="searchkey" placeholder="請輸入書名或作者" />
                    <button type="submit" id="searchbtn" name="submit" value="Search"><i className="iconfont icon-search" style={{ fontSize: 25 }}></i></button>
                  </form>
                </div>

                {/* 快速入口 4 个 */}
                <div className="indexdaohang">
                  <ul>
                    <li><a href="/bookcase" onClick={goView('history')}><h3 className="ellipsis_1">我的書架</h3></a></li>
                    <li><a href="/history" onClick={goView('history')}><h3 className="ellipsis_1">閱讀記錄</h3></a></li>
                    <li><a href="/novels/hot" onClick={goView('ranking')}><h3 className="ellipsis_1">排行榜</h3></a></li>
                    <li><a href="/novels/full" onClick={goView('fulltext')}><h3 className="ellipsis_1">完本小說</h3></a></li>
                  </ul>
                </div>

                {/* 熱門書單推薦 */}
                <div>
                  <h3 className="mytitle">熱門書單推薦</h3>
                  <div className="booklist-block">
                    <div className="booklist-grid">
                      {featured.map((b, i) => renderBooklistCard(b, i))}
                    </div>
                  </div>
                </div>

                {/* 最新更新 (源站 .newbox #article_list_content 列表) */}
                <div>
                  <h3 className="mytitle">最新更新</h3>
                  <div className="newbox">
                    <ul id="article_list_content">
                      {latest.map(b => renderListItem(b))}
                    </ul>
                  </div>
                </div>

                {/* 分类区块 (源站 menu1 6 项 + 分类 API 多项) */}
                {cats.length > 0 && (
                  <div>
                    <h3 className="mytitle">小說分類</h3>
                    <div className="newbox" style={{ padding: 10 }}>
                      <div className="tag">
                        <ul>
                          {cats.map(c => (
                            <a key={c.id} href={`/novels/class/${c.id}_1.html`} onClick={goCat(c.id)}>{c.name}</a>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* 热门标签 */}
                <div className="tag">
                  <h3 className="mytitle">熱門標籤</h3>
                  <ul>
                    {HOT_TAGS.map(t => (
                      <a key={t} href={`/newtag/${t}/`} onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: t }) }}>{t}</a>
                    ))}
                  </ul>
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
            <a href="/novels/hot" onClick={goView('ranking')}>排行榜</a>
            <a href="/last" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>最新更新</a>
            <a href="/booklist/index/all/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>書單推薦</a>
            <a href="/reviews/all/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>熱門書評</a>
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
