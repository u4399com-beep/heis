'use client'
// ============================================================
// clone-aijjxs SearchView — 1:1 精仿 aijjxs.com 搜索结果页
// 参考: agent-ctx/probe-html2/probe-aijjxs-category.html 的 .cenMain + .catalog listbg
// 复刻: .top-float / .wrap > .top (logo+搜索) / .layout > .cenMain
//       (.articleInfo h1 搜索:关键词 + .body.filters 排序切换
//       + .catalog listbg × N + .pager 分页) + aside (.panel.rank 热门搜索下载
//       / .panel 热门作者 / .panel 相关搜索)
// CSS 由 CloneCSSLoader 加载 public/clone-css/aijjxs.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { statusLabel } from '../../seo'
import type { SearchViewProps } from '../shared'
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

export function SearchView({ q, books, loading, initialCategories }: SearchViewProps) {
  const { site, navigate } = usePublic()
  // R28-1A: 复用 useCloneCategories (SSR initialCategories 优先 + 空时 fetch + DEFAULT_NAV 兜底)
  const cats = useCloneCategories(initialCategories, DEFAULT_NAV)

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 15)
  const rankTop = books[0]
  const rankList = books.slice(1, 10)
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
    return (
      <div className="listbg" key={b.id}>
        <a href={`/txt/${b.id}.html`} title={b.name} className="img" target="_blank" {...bookNavProps(navigate, b.id)}>
          <BookCover name={b.name} cover={b.cover} style={{ width: 92, height: 128, borderRadius: 0, border: '1px solid #d8d8d8', padding: 1, background: '#fff' }} />
        </a>
        <span className="title"><a href={`/txt/${b.id}.html`} title={b.name} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a></span>
        <span className="old"><span className="oldDate">{dt ? dt.toISOString().slice(0, 10) : ''}</span>上传</span>
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
            <input type="text" name="keyboard" placeholder="请输入书名或作者关键字" defaultValue={q || ''} autoComplete="off" />
            <button type="submit">搜索全站</button>
          </form>
        </header>

        <main className="layout">
          <div className="cenMain">
            <div className="articleInfo"><h1>搜索：{q || ''}</h1></div>

            <div className="body filters">
              <div className="row">
                <a href="javascript:;" className="on">最新上传</a>
                <a href="javascript:">人气最高</a>
                <a href="javascript:">收藏最多</a>
                <a href="javascript:">只看推荐</a>
              </div>
            </div>

            <div className="catalog">
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>搜索中...</div>
              ) : !books.length ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
                  未找到与「{q}」相关的书籍，换个关键词试试吧。
                </div>
              ) : books.map(b => renderListbg(b))}
            </div>
          </div>

          <aside>
            {/* 热门搜索下载 */}
            <article className="panel rank">
              <h3>热门搜索下载</h3>
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
            {topAuthors.length > 0 && (
              <article className="panel" style={{ marginTop: 14 }}>
                <h3>热门作者</h3>
                <div className="body tags">
                  {topAuthors.map(a => (
                    <a key={a} href="javascript:;" title={a} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: a }) }}>{a}</a>
                  ))}
                </div>
              </article>
            )}

            {/* 相关分类 */}
            <article className="panel" style={{ marginTop: 14 }}>
              <h3>相关分类</h3>
              <div className="body">
                <ul className="lines">
                  <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>最新上传的电子书</a></li>
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
