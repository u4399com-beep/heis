'use client'
// shipsay (船说CMS) 分类列表页 1:1 克隆 — static/shipsay 模板
// 源站 DOM: .store > .store_left(.side_commend .lastupdate ul.odd li 类别/书名/最新章/作者) + #store_right(分类侧栏)
// 实测颜色: .store_title border #e6e6e6 / .lastupdate li border-bottom dotted #e6e6e6 / .onselect bg #bf2c24
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { site, navigate } = usePublic()

  if (loading) {
    return (
      <div style={{ background: '#fbfbfb', color: '#1a1a1a', fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 14, lineHeight: 1.5, minHeight: '100%' }}>
        <div className="container" style={{ maxWidth: 960, margin: '0 auto', padding: '40px 0', textAlign: 'center' }}>加载中...</div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div style={{ background: '#fbfbfb', color: '#1a1a1a', fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 14, lineHeight: 1.5, minHeight: '100%' }}>
        <div className="container" style={{ maxWidth: 960, margin: '0 auto', padding: '40px 0', textAlign: 'center' }}>没有找到相关小说</div>
      </div>
    )
  }

  // 侧栏分类
  const SIDE_CATS = ['玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生', '其他', '完本']

  return (
    <div style={{ background: '#fbfbfb', color: '#1a1a1a', fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 14, lineHeight: 1.5, minHeight: '100%' }}>
      {/* 源站 header — 简化版 */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e6e6e6' }}>
        <div className="container head" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', padding: '16px 5px' }}>
          <a id="logo" href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ fontWeight: 700, textAlign: 'center', textDecoration: 'none', flexShrink: 0, marginRight: 16 }}>
            <span style={{ fontSize: '1.5em', letterSpacing: '.15em', color: '#3e3d43' }}>{site.name}</span>
            <p style={{ fontWeight: 700, color: '#bf2c24', margin: 0 }}>{site.domain}</p>
          </a>
          <form name="t_frmsearch" method="post" action="/search/" style={{ display: 'flex', alignItems: 'center', height: 36, width: 300, margin: '5px 2px' }} onSubmit={(e) => e.preventDefault()}>
            <input type="text" name="searchkey" className="search_input" placeholder="猫腻" autoComplete="off" style={{ textIndent: 10, height: '100%', border: '1px solid #e6e6e6', borderRadius: '3px 0 0 3px', borderRight: 0, flexGrow: 2, outline: 'none', fontSize: 14 }} />
            <button type="submit" id="search_btn" title="搜索" style={{ padding: '0 13px', height: '100%', border: 'none', borderRadius: '0 3px 3px 0', background: '#bf2c24', color: '#fbfbfb', cursor: 'pointer' }}>🔍</button>
          </form>
        </div>
      </header>

      <div className="store" style={{ display: 'flex', flexWrap: 'wrap', maxWidth: 960, margin: '10px auto', position: 'relative', gap: 10 }}>
        {/* 左侧列表 .store_left */}
        <div className="store_left" style={{ flex: '1 1 760px', minWidth: 320 }}>
          <div className="side_commend" style={{ marginTop: 0, padding: '10px 10px 5px', background: '#fff' }}>
            <div className="store_title" style={{ borderBottom: '1px solid #e6e6e6', lineHeight: '41px', fontSize: '1.2em', textAlign: 'center', letterSpacing: '.1em', color: '#3e3d43', fontWeight: 700 }}>
              {label}小说列表
            </div>
            <ul className="odd" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {books.map((b) => (
                <li key={b.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', width: '100%', height: 41, lineHeight: '41px', overflow: 'hidden', borderBottom: '1px dotted #e6e6e6' }}>
                  <span style={{ width: '9%', marginLeft: '-1%', color: '#888' }}>「{b.category?.slice(0, 2) || '小说'}」</span>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ width: '25%', fontSize: '1.1em', color: '#1a1a1a', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</a>
                  <a className="gray" href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ width: '41%', marginLeft: '1%', color: '#666', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.latestChapter || '暂无章节'}</a>
                  <span style={{ width: '25%', textAlign: 'right', color: '#888' }}>
                    <a className="gray" href="#" style={{ color: '#666', textDecoration: 'none' }}>{b.author}</a>
                    &nbsp;&nbsp;{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 分页 .pages */}
          {total > size && (
            <div className="pages" style={{ width: '100%', padding: '10px 0', textAlign: 'center', background: '#fff', marginTop: 10 }}>
              {page > 1 && (
                <button onClick={() => onPage(page - 1)} style={{ display: 'inline-block', margin: '2px', padding: '0 2px', minWidth: 35, border: '1px solid #e6e6e6', borderRadius: 3, textAlign: 'center', textDecoration: 'none', height: 35, lineHeight: '35px', background: '#fff', color: '#1a1a1a', cursor: 'pointer' }}>
                  上一页
                </button>
              )}
              <strong style={{ display: 'inline-block', margin: '2px', padding: '0 2px', minWidth: 35, border: '1px solid #e6e6e6', borderRadius: 3, textAlign: 'center', height: 35, lineHeight: '35px', background: '#bf2c24', color: '#fff' }}>
                {page}
              </strong>
              <span style={{ display: 'inline-block', margin: '2px', padding: '0 8px', height: 35, lineHeight: '35px', color: '#888' }}>共 {Math.ceil(total / size)} 页</span>
              {page * size < total && (
                <button onClick={() => onPage(page + 1)} style={{ display: 'inline-block', margin: '2px', padding: '0 2px', minWidth: 35, border: '1px solid #e6e6e6', borderRadius: 3, textAlign: 'center', textDecoration: 'none', height: 35, lineHeight: '35px', background: '#bf2c24', color: '#fff', cursor: 'pointer' }}>
                  下一页
                </button>
              )}
            </div>
          )}
        </div>

        {/* 右侧分类侧栏 #store_right */}
        <div id="store_right" style={{ flex: '0 0 190px', minWidth: 160 }}>
          <ul style={{ background: '#fff', border: '1px solid #e6e6e6', marginBottom: 10, listStyle: 'none', padding: 0, margin: 0 }}>
            <li className="store_title" style={{ borderBottom: '1px solid #e6e6e6', lineHeight: '41px', fontSize: '1.2em', textAlign: 'center', letterSpacing: '.1em', color: '#3e3d43', fontWeight: 700 }}>分类</li>
            {SIDE_CATS.map((c) => (
              <li key={c} style={{ lineHeight: '50px', textAlign: 'center', fontSize: '1.2em', borderBottom: '1px solid #eee' }}>
                <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }} style={{ width: '100%', color: '#1a1a1a', textDecoration: 'none', display: 'block' }}>
                  {c}{c === label ? ' ←' : ''}
                </a>
              </li>
            ))}
          </ul>
          <div style={{ background: '#fff', border: '1px solid #e6e6e6', padding: 10, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-around', textAlign: 'center' }}>
            <a href="#" style={{ lineHeight: '41px', fontSize: '1.1em', width: '50%', color: '#1a1a1a', textDecoration: 'none' }}>排行</a>
            <a href="#" style={{ lineHeight: '41px', fontSize: '1.1em', width: '50%', color: '#1a1a1a', textDecoration: 'none' }}>完本</a>
            <a href="#" style={{ lineHeight: '41px', fontSize: '1.1em', width: '50%', color: '#1a1a1a', textDecoration: 'none' }}>最新</a>
            <a href="#" style={{ lineHeight: '41px', fontSize: '1.1em', width: '50%', color: '#1a1a1a', textDecoration: 'none' }}>推荐</a>
          </div>
        </div>
      </div>

      {/* 源站 #footer */}
      <div id="footer" style={{ background: '#3e3d43', marginTop: 24 }}>
        <footer className="container" style={{ maxWidth: 960, margin: '0 auto', color: '#fbfbfb', padding: '15px 0', flexFlow: 'column wrap', alignItems: 'center', fontSize: 12, lineHeight: 1.5, textAlign: 'center' }}>
          <p style={{ margin: 0, color: '#fbfbfb' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fbfbfb', textDecoration: 'none' }}>{site.name}</a>
            &nbsp;书友最值得收藏的网络小说阅读网
          </p>
          <p style={{ margin: '4px 0 0', color: '#fbfbfb' }}>
            Copyright © {new Date().getFullYear()} {site.name}({site.domain}) · 共 {formatWords(total)} 本
          </p>
        </footer>
      </div>
    </div>
  )
}
