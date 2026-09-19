'use client'
// ============================================================
// clone-ggd66 HomeClone — 1:1 精仿 ggd66.com (格格党) 首页
// 参考: agent-ctx/probe-html2/probe-ggd66.html (源站真实 DOM)
// 复刻: .header > .container (.header-left .logo + .header-right 阅读历史/登录/注册 +
//       .header-nav 首页/书库/全本/搜索) + .clear
//       / .container > .content × 2 (content 1: #fengtui 6 .item image+dl dt span+a+
//       dd 简介 / #fengyou .search form input+button + h2 阅读排行榜 + ul li × 13
//       content 2: #zuixin h2 最新小说 + ul li × N / #gengxin h2 最近更新 + ul li
//       含 .s1 [分类] .s2 a 书名 .s3 a 最新章节 .s5 时间 .s4 作者)
//       / .content.tuijian 友情链接 / .footer p × 2
// CSS 由 CloneCSSLoader 加载 public/clone-css/ggd66.css
//   (薄荷绿头 #56ccb5 + 青绿链 #00886d + 橙红 hover #f50, 4px 圆角)
// 全部用源站真实 class 名, 不用 inline style 换配色
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { addFavoriteSite, useTraditionalChinese } from '../tools'
import type { HomeCloneProps } from '../shared'
import { cloneNavHandlers, useCloneCategories } from '../shared'
import type { BookItem } from '../../types'

interface Cat { id: string; name: string }

// 源站默认 9 个分类 (与 probe [s1] 标签一致, fetch 失败兜底)
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

// 源站 .header-nav 4 项 (与 probe 一致)
const TOP_NAV: { id: string; name: string; view: 'home' | 'category' | 'fulltext' | 'search' }[] = [
  { id: 'home', name: '首 页', view: 'home' },
  { id: 'sort', name: '书 库', view: 'category' },
  { id: 'quanben', name: '全本', view: 'fulltext' },
  { id: 'search', name: '搜索', view: 'search' },
]

// 简繁切换按钮 — ggd66 风格 (.header-right 内文字链接, 与"|"分隔)
function TcToggleGgd66() {
  const { isTc, mounted, toggleTc } = useTraditionalChinese()
  const label = mounted && isTc ? '简体' : '繁體'
  return (
    <a
      href="#tc-toggle"
      title="简繁切换"
      onClick={(e) => { e.preventDefault(); toggleTc() }}
    >
      {label}
    </a>
  )
}

export function HomeClone({ books, loading, homeModuleLimit = 20, initialCategories }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  // R28-1A: 复用 useCloneCategories (SSR initialCategories 优先 + 空时 fetch + DEFAULT_NAV 兜底)
  const cats = useCloneCategories(initialCategories, DEFAULT_NAV)

  // 拉分类列表用于 .class (分类网格) + .tuijian (友链分类)

  if (loading) return <div className="container" style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
  if (!books.length) return <div className="container" style={{ padding: 40, textAlign: 'center' }}>暂无内容</div>

  // —— 数据切片 (与源站各模块对齐) ——
  // #fengtui 热门小说推荐: 字数最多前 6 本 (源站 .item image 120x150 + dl dt span+a + dd 简介)
  const fengtuiBooks = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 6)
  // #fengyou 阅读排行榜: 前 13 本 (源站 ul li [女生] 书名 span 作者)
  const fengyouList = books.slice(0, 13)
  // #zuixin 最新小说: 前 homeModuleLimit 本 (源站 ul li [女生] 书名 span 作者)
  const zuixinList = books.slice(0, Math.max(homeModuleLimit, 20))
  // #gengxin 最近更新: 前 homeModuleLimit 本 (源站 ul li 含 s1/s2/s3/s4/s5 spans)
  const gengxinList = books.slice(0, Math.max(homeModuleLimit, 20))

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'searchkey')
  const goRanking = (e: React.MouseEvent) => {
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
  const goSearchView = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'search' })
  }
  const fmtDate = (s?: string) => s ? new Date(s).toISOString().slice(5, 10) : ''
  const catName = (b: BookItem) => b.category || '小说'

  return (
    <>
      {/* ============ header ============ */}
      <div className="header">
        <div className="container">
          <div className="header-left">
            <a href="/" title={site.name} className="logo" onClick={goHome}>{site.name}</a>
          </div>
          <div className="header-right">
            <a href="/history.html" onClick={goHistory}>阅读历史</a>
            {' | '}
            <a href="/login/" onClick={(e) => e.preventDefault()}>登录</a>
            {' | '}
            <a href="/register" onClick={(e) => e.preventDefault()}>注册</a>
            {' | '}
            <a href="#favorite" title="收藏本站 (Ctrl+D)" onClick={(e) => addFavoriteSite(e)}>收藏本站</a>
            {' | '}
            <TcToggleGgd66 />
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
        {/* 第一段 content: fengtui + fengyou */}
        <div className="content">
          <div className="content-left" id="fengtui">
            <h2>热门小说推荐</h2>
            {fengtuiBooks.map(b => (
              <div className="item" key={b.id}>
                <div className="image">
                  <a href={`/qu/${b.id}/`} {...bookNavProps(navigate, b.id)}>
                    <BookCover name={b.name} cover={b.cover} style={{ width: 120, height: 150 }} />
                  </a>
                </div>
                <dl>
                  <dt>
                    <span>{b.author}</span>
                    <a href={`/qu/${b.id}/`} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                  </dt>
                  <dd>{b.intro || '暂无简介'}</dd>
                </dl>
                <div className="clear"></div>
              </div>
            ))}
          </div>

          <div className="content-right" id="fengyou">
            <div className="search hidden-xs">
              <form name="articlesearch" method="post" action="/search/" onSubmit={goSearch}>
                <input name="searchkey" type="text" className="text" id="searchkey" size={10} maxLength={50} placeholder="搜索从这里开始..." autoComplete="off" />
                <button type="submit" name="submit">搜  索</button>
              </form>
            </div>
            <h2 className="visible-xs">阅读排行榜</h2>
            <ul>
              {fengyouList.map(b => (
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

        {/* 第二段 content: zuixin (右) + gengxin (左) */}
        <div className="content">
          <div className="content-right" id="zuixin">
            <h2>最新小说</h2>
            <ul>
              {zuixinList.map(b => (
                <li key={b.id}>
                  [{catName(b)}]{' '}
                  <a href={`/qu/${b.id}/`} {...bookNavProps(navigate, b.id)}>{b.name}</a>
                  <span>{b.author}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="content-left" id="gengxin">
            <h2>最近更新</h2>
            <ul>
              {gengxinList.map(b => (
                <li key={b.id}>
                  <span className="s1">[{catName(b)}]</span>
                  <span className="s2"><a href={`/qu/${b.id}/`} target="_blank" rel="noopener" {...bookNavProps(navigate, b.id)}>{b.name}</a></span>
                  <span className="s3"><a href={`/qu/${b.id}/latest.html`} target="_blank" rel="noopener" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}>{b.latestChapter || '查看目录'}</a></span>
                  <span className="s5">{fmtDate(b.updatedAt)}</span>
                  <span className="s4">{b.author}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="clear"></div>
        </div>

        {/* 友情链接 .tuijian (含分类导航网格 .class) */}
        <div className="content tuijian hidden-xs">
          友情链接：
          <div className="class">
            <ul>
              <li>
                <a href="/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>书库</a>
              </li>
              <li>
                <a href="/quanben/sort/" onClick={goFulltext}>全本</a>
              </li>
              <li>
                <a href="/top/rank/" onClick={goRanking}>排行榜</a>
              </li>
              <li>
                <a href="/search/" onClick={goSearchView}>搜索</a>
              </li>
              {cats.slice(0, 9).map(c => (
                <li key={c.id}>
                  <a href={`/sort/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
                </li>
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
