'use client'
// ============================================================
// clone-aijjxs CategoryList — 1:1 精仿 aijjxs.com 分类列表页
// 参考: agent-ctx/probe-html2/probe-aijjxs-category.html (源站真实 DOM)
// 复刻: .wrap > .top (logo+搜索) / .layout > .cenMain (.articleInfo h1
//       .body.filters 3 rows [最新上传/人气最高/收藏最多/只看推荐][大小][时间]
//       .catalog listbg × N [img+title+new/old+intro div+mainGreen meta]
//       .pager 分页) + aside (.panel.rank 热门X小说下载 / .panel 热门作者 tags
//       / .panel 相关分类 ul.lines)
// CSS 由 CloneCSSLoader 加载 public/clone-css/aijjxs.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { statusLabel } from '../../seo'
import type { CategoryListProps } from '../shared'
import { cloneNavHandlers, useCloneCategories } from '../shared'
import type { BookItem } from '../../types'

interface Cat { id: string; name: string }

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

export function CategoryList({ books, loading, label, page, total, size = 24, onPage, initialCategories }: CategoryListProps) {
  const { site, navigate } = usePublic()
  // R28-1A: 复用 useCloneCategories (SSR initialCategories 优先 + 空时 fetch + DEFAULT_NAV 兜底)
  const cats = useCloneCategories(initialCategories, DEFAULT_NAV)

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 15)
  const totalPages = Math.max(1, Math.ceil(total / size))
  // 侧栏热门同类小说下载: 取前 12 本 (book_r 占第 1, lines 占 2-12)
  const rankTop = books[0]
  const rankList = books.slice(1, 12)
  // 热门作者: 前 10 个不重复作者
  const topAuthors: string[] = Array.from(new Set(books.slice(0, 24).map(b => b.author).filter(Boolean)).values()).slice(0, 10)

  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch, goCat } = cloneNavHandlers(navigate, 'keyboard')

  const fmtSize = (n?: number) => {
    if (!n) return '0 KB'
    const kb = Math.max(1, Math.round(n * 1.5 / 1024))
    return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'
  }

  const renderListbg = (b: BookItem) => {
    const dt = b.updatedAt ? new Date(b.updatedAt) : null
    const isToday = dt && Date.now() - dt.getTime() < 86400000
    return (
      <div className="listbg" key={b.id}>
        <a href={`/txt/${b.id}.html`} title={b.name} className="img" target="_blank" {...bookNavProps(navigate, b.id)}>
          <BookCover name={b.name} cover={b.cover} style={{ width: 92, height: 128, borderRadius: 0, border: '1px solid #d8d8d8', padding: 1, background: '#fff' }} />
        </a>
        <span className="title"><a href={`/txt/${b.id}.html`} title={b.name} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a></span>
        <span className={isToday ? 'new' : 'old'}><span className="oldDate">{dt ? dt.toISOString().replace('T', ' ').slice(0, 19) : ''}</span>上传</span>
        <div style={{ padding: '0 19px' }}>{b.intro || '暂无简介'}</div>
        <div style={{ padding: '0 19px' }}>
          <span className="mainGreen">
            <small>书籍作者：</small><a href="javascript:;" title={b.author} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: b.author }) }}>{b.author}</a>
            <small>文件大小：</small>{fmtSize(b.wordCount)}
            <small>写作进度：</small>{statusLabel(b.status)}
            <small>下载方式：</small>全本免费
          </span>
        </div>
      </div>
    )
  }

  // 分页: 上一页 / 1..10 / 下一页 / 尾页
  const renderPager = () => {
    if (total <= size) return null
    const start = Math.max(1, page - 5)
    const end = Math.min(totalPages, start + 9)
    const nums: number[] = []
    for (let i = start; i <= end; i++) nums.push(i)
    return (
      <div className="pager">
        <a title="总数"><b>{total}</b></a>&nbsp;&nbsp;&nbsp;
        {page > 1 && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(page - 1) }}>上一页</a>}
        {nums.map(n => n === page ? <b key={n}>{n}</b> : <a key={n} href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(n) }}>{n}</a>)}
        {page < totalPages && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(page + 1) }}>下一页</a>}
        {page < totalPages && <a href="javascript:;" onClick={(e) => { e.preventDefault(); onPage(totalPages) }}>尾页</a>}
      </div>
    )
  }

  return (
    <>
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
          <div className="cenMain">
            <div className="articleInfo"><h1>{label}</h1></div>

            {/* 筛选条 (3 行, 仅做交互外观, 排序/筛选未走后端) */}
            <div className="body filters">
              <div className="row">
                <a href="javascript:;" className="on">最新上传</a>
                <a href="javascript:">人气最高</a>
                <a href="javascript:">收藏最多</a>
                <a href="javascript:">只看推荐</a>
              </div>
              <div className="row">
                <a href="javascript:;" className="on">大小不限</a>
                <a href="javascript:">500Kb以下</a>
                <a href="javascript:">500Kb-1M</a>
                <a href="javascript:">1M-2M</a>
                <a href="javascript:">大于2M</a>
              </div>
              <div className="row">
                <a href="javascript:;" className="on">时间不限</a>
                <a href="javascript:">一周内</a>
                <a href="javascript:">一月内</a>
                <a href="javascript:">半年内</a>
                <a href="javascript:">一年内</a>
              </div>
            </div>

            {/* catalog listbg 列表 */}
            <div className="catalog">
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>加载中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>暂无书籍</div>
              ) : books.map((b) => renderListbg(b))}
            </div>

            {/* 分页 */}
            <div className="body">
              {renderPager()}
            </div>
          </div>

          <aside>
            {/* 热门分类小说下载 */}
            <article className="panel rank">
              <h3>热门{label}下载</h3>
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

            {/* 热门作者 */}
            <article className="panel" style={{ marginTop: 14 }}>
              <h3>热门作者</h3>
              <div className="body tags">
                {topAuthors.map(a => (
                  <a key={a} href="javascript:;" title={a} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: a }) }}>{a}</a>
                ))}
              </div>
            </article>

            {/* 相关分类 */}
            <article className="panel" style={{ marginTop: 14 }}>
              <h3>相关分类</h3>
              <div className="body">
                <ul className="lines">
                  <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>最新上传的电子书</a></li>
                  <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'ranking' }) }}>小说下载排行</a></li>
                  <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'fulltext' }) }}>全本小说下载</a></li>
                  {navCats.slice(0, 5).map(c => (
                    <li key={c.id}><a href={`/txt/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}下载</a></li>
                  ))}
                </ul>
              </div>
            </article>
          </aside>
        </main>
      </div>
    </>
  )
}
