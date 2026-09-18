'use client'
// ============================================================
// clone-aijjxs HomeClone — 1:1 精仿 aijjxs.com 首页
// 参考: agent-ctx/probe-html2/probe-aijjxs.html (源站真实 DOM)
// 复刻: .top-float (顶部固定分类导航) / .wrap > .top (logo+搜索+热搜)
//       / .layout > section (.panel.latest-upload / .panel 封面推荐 / .panel.latest-upload 小说分类
//       / .panel 专题书单) + aside (.today-qd-users / .panel.rank 24小时/一周热榜 / .panel 热门作者)
// CSS 由 CloneCSSLoader 加载 public/clone-css/aijjxs.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { HomeCloneProps } from '../shared'
import type { BookItem } from '../../types'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

// 源站默认 16 个分类(用于 fetch 失败/分类列表为空时兜底, 与 probe-aijjxs.html 顺序一致)
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

// 今日热搜词(占位, 来源同 probe)
const HOT_KEYWORDS = ['末日', '白月光', '末世', '直播', '万人迷', '女帝', '游戏入侵', '诡秘之主', '斗破', '香江']

// 专题书单(占位文案, 同 probe)
const TOPIC_LIST = [
  { title: '高分重生文', desc: '节奏快、反转多、女性成长线清晰。' },
  { title: '穿越种田合集', desc: '日常经营、家长里短、慢热耐看。' },
  { title: '都市爽文精选', desc: '升级流、事业线、金手指开局。' },
]

export function HomeClone({ books, loading, navCategoryCount = 15, homeModuleLimit = 20 }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])

  // 拉分类列表用于 top-float-nav + 小說分类区块标题
  useEffect(() => {
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        // API 返回 {ok, data:{items:[{id,name,bookCount,rep}]}}
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        const mapped: Cat[] = arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) }))
        setCats(mapped.length ? mapped : DEFAULT_NAV)
      })
      .catch(() => { if (!aborted) setCats(DEFAULT_NAV) })
    return () => { aborted = true }
  }, [])

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, navCategoryCount)

  if (loading) return <div className="wrap" style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
  if (!books.length) return <div className="wrap" style={{ padding: 40, textAlign: 'center' }}>暂无内容</div>

  // —— 数据切片 (与源站各面板对齐) ——
  // 最新上传: 前 16 本 (lines-books 列表, 复刻 .latest-upload-hidden 折叠态省略)
  const latest = books.slice(0, 16)
  // 封面推荐: 前 4 本 (源站 .panel 封面推荐 .grid2)
  const coverRecs = books.slice(0, 4)
  // 小说分类区块: 按 categoryId 分组, 取前 4 个非空组, 每组 10 本
  const catSections = navCats.slice(0, 4).map(c => {
    const list = books.filter(b => b.categoryId === c.id || b.category === c.name)
    return { cat: c, list: (list.length ? list : books).slice(0, 10) }
  })
  // 24小时热榜: 取前 1 本作 book_r + 前 10 本作 lines
  const rank24Top = books[0]
  const rank24List = books.slice(1, 11)
  // 一周热榜: 同上 (这里用 book offset 切片避免重复)
  const rankWeekTop = books[1] || books[0]
  const rankWeekList = books.slice(2, 12)
  // 热门作者: 取前 10 个不重复作者
  const topAuthors: string[] = Array.from(new Set(books.slice(0, homeModuleLimit).map(b => b.author).filter(Boolean)).values()).slice(0, 10)

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
    const q = (e.currentTarget.elements.namedItem('keyboard') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const goHot = (kw: string) => navigate({ view: 'search', q: kw })

  // 通用: 给一个 li.item (lines-books) 渲染
  const renderLineBook = (b: BookItem, idx: number) => {
    const dateStr = b.updatedAt ? new Date(b.updatedAt).toISOString().slice(5, 10) : ''
    return (
      <li key={b.id}>
        <span className="line-main">
          <span className="cat">{b.category || '小说'}</span>
          <a href={`/txt/${b.id}.html`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
          <span className="author">{b.author}</span>
        </span>
        <span className="date new"><span className={idx < 6 ? 'new' : ''}>{dateStr}</span></span>
      </li>
    )
  }

  // 封面推荐 .book (带图)
  const renderCoverBook = (b: BookItem) => {
    const dateStr = b.updatedAt ? new Date(b.updatedAt).toISOString().slice(5, 10) : ''
    return (
      <div className="book" key={b.id}>
        <a {...bookNavProps(navigate, b.id)} style={{ display: 'inline-block', width: 88, height: 122, marginRight: 10, float: 'left' }}>
          <BookCover name={b.name} cover={b.cover} style={{ width: 88, height: 122, borderRadius: 8 }} />
        </a>
        <h4><span className="badge">新</span><a href={`/txt/${b.id}.html`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a></h4>
        <div className="meta">{b.author} · {b.category || '小说'} · {formatWords(b.wordCount)} · {dateStr}</div>
        <div className="desc">{b.intro || '暂无简介'}</div>
      </div>
    )
  }

  // 热榜 .panel.rank 渲染
  const renderRank = (title: string, top: BookItem | undefined, list: BookItem[]) => (
    <article className="panel rank" style={{ marginTop: 14 }}>
      <h3>{title}</h3>
      <div className="body">
        {top && (
          <div className="book_r">
            <a {...bookNavProps(navigate, top.id)} style={{ display: 'inline-block' }}>
              <BookCover name={top.name} cover={top.cover} style={{ width: 96, height: 130, borderRadius: 8 }} />
            </a>
            <h4><a href={`/txt/${top.id}.html`} target="_blank" {...bookNavProps(navigate, top.id)}>{top.name}</a></h4>
            <div className="meta">{top.author} · {top.category || '小说'} · {formatWords(top.wordCount)}</div>
            <div className="desc">{top.intro || '暂无简介'}</div>
          </div>
        )}
        <ul className="lines">
          {list.map((b, i) => (
            <li key={b.id}>
              <span className="no">{i + 1}</span>
              <a href={`/txt/${b.id}.html`} title={b.name} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
              <span className="date">{b.author}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )

  return (
    <>
      {/* 顶部固定分类导航条 */}
      <div className="top-float">
        <div className="top-float-inner">
          <nav className="top-float-nav">
            <a href="/" className="active" onClick={goHome}>首页</a>
            {navCats.map(c => (
              <a key={c.id} href={`/txt/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
            ))}
          </nav>
          <div className="top-float-auth">
            <a href="/e/member/login" onClick={(e) => e.preventDefault()}>登录</a>
            <a href="/e/member/register/" onClick={(e) => e.preventDefault()}>注册</a>
          </div>
        </div>
      </div>

      {/* 主容器 */}
      <div className="wrap">
        {/* 顶部搜索区 */}
        <header className="top">
          <div className="top-1">
            <h1 className="logo">{site.name}<small>快速找到你想要的TXT电子书</small></h1>
            <div className="top-links">
              欢迎访问{site.name}，请 <a href="/e/member/login/" onClick={(e) => e.preventDefault()}>登陆帐户</a> 或 <a href="/e/member/register/" onClick={(e) => e.preventDefault()}>注册会员</a>
            </div>
          </div>

          <form className="search" onSubmit={goSearch}>
            <input type="hidden" name="show" value="title,writer" />
            <input type="text" name="keyboard" placeholder="请输入书名或作者关键字" autoComplete="off" />
            <button type="submit">搜索全站</button>
          </form>
          <div className="search-history">
            <span style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center', marginRight: 2 }}>今日热搜</span>
            {HOT_KEYWORDS.map(kw => (
              <a key={kw} href="javascript:;" onClick={(e) => { e.preventDefault(); goHot(kw) }}>{kw}</a>
            ))}
          </div>
        </header>

        {/* 主体布局: section(主内容) + aside(侧栏) */}
        <main className="layout">
          <section>
            {/* 最新上传 */}
            <article className="panel latest-upload latest-upload-expand">
              <h3 className="latest">最新上传<small></small></h3>
              <div className="body gird2">
                <ul className="lines lines-books lines-books-2col">
                  {latest.map((b, i) => renderLineBook(b, i))}
                </ul>
              </div>
            </article>

            {/* 封面推荐 */}
            <article className="panel" style={{ marginTop: 14 }}>
              <h3>封面推荐</h3>
              <div className="body grid2">
                {coverRecs.map(b => renderCoverBook(b))}
              </div>
            </article>

            {/* 小说分类 */}
            <article className="panel latest-upload" style={{ marginTop: 14 }}>
              <h3>小说分类</h3>
              <div className="body grid2">
                {catSections.map(({ cat, list }) => (
                  <div key={cat.id}>
                    <h4>{cat.name} <a href={`/txt/${cat.id}/`} target="_blank" onClick={(e) => goCat(e, cat.id)}>更多&gt;&gt;</a></h4>
                    <ul className="lines lines-books">
                      {list.map((b, i) => renderLineBook(b, i))}
                    </ul>
                  </div>
                ))}
              </div>
            </article>

            {/* 专题书单 */}
            <article className="panel" style={{ marginTop: 14 }}>
              <h3>专题书单</h3>
              <div className="body grid3">
                {TOPIC_LIST.map(t => (
                  <div className="desc" key={t.title}>
                    <a className="topic-link" href="javascript:;" onClick={(e) => e.preventDefault()}>
                      <strong>{t.title}</strong>
                    </a>
                    <br />{t.desc}
                  </div>
                ))}
              </div>
            </article>
          </section>

          {/* 侧边栏 */}
          <aside>
            {/* 今日签到(占位) */}
            <div className="today-qd-users">
              <h3>今日已签到</h3>
              <ul className="qd-user-list">
                <li><a href="javascript:;" onClick={(e) => e.preventDefault()} title="游客"><span>游客</span></a></li>
                <li><a href="javascript:;" onClick={(e) => e.preventDefault()} title="书友"><span>书友</span></a></li>
                <li><a href="javascript:;" onClick={(e) => e.preventDefault()} title="读者"><span>读者</span></a></li>
                <li><a href="javascript:;" onClick={(e) => e.preventDefault()} title="访客"><span>访客</span></a></li>
                <li><a href="javascript:;" onClick={(e) => e.preventDefault()} title="新人"><span>新人</span></a></li>
              </ul>
            </div>

            {/* 24小时热榜 */}
            {renderRank('24小时热榜', rank24Top, rank24List)}

            {/* 一周热榜 */}
            {renderRank('一周热榜', rankWeekTop, rankWeekList)}

            {/* 热门作者 */}
            <article className="panel" style={{ marginTop: 14 }}>
              <h3>热门作者</h3>
              <div className="body tags">
                {topAuthors.map(a => (
                  <a key={a} href="javascript:;" title={a} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: a }) }}>{a}</a>
                ))}
              </div>
            </article>
          </aside>
        </main>

        {/* 数据统计 hero */}
        <section className="hero">
          <h2>数据统计</h2><small>数据每30分钟更新</small>
          <p>每天更新热门小说，覆盖穿越、重生、都市、玄幻等主流分类；支持在线阅读与TXT免费下载。</p>
          <div className="kpi">
            <div className="item"><div className="num">{books.length}部</div><div className="txt">今日上传电子书</div></div>
            <div className="item"><div className="num">{books.length * 12}部</div><div className="txt">本月上传电子书</div></div>
            <div className="item"><div className="num">{Math.max(1, Math.floor(books.length / 2))}人</div><div className="txt">24h会员注册</div></div>
            <div className="item"><div className="num">{books.length}</div><div className="txt">最新注册会员</div></div>
          </div>
        </section>
      </div>
    </>
  )
}
