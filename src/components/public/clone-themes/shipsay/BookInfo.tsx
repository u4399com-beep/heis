'use client'
// shipsay (船说CMS) 书籍详情页 1:1 克隆 — static/shipsay 模板
// 源站 DOM: .container .novel_info_main(img + .novel_info_title h1 + p span 标签 + .indent 简介) + .ulcard .act 章节列表 + .l_btn 行动按钮
// 实测颜色: .novel_info_title h1 #555 / a:hover #ed4259 / .act border-bottom #ed4259 / .l_btn bg #bf2c24 / .lastupdate bg #fff
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { site, navigate } = usePublic()
  if (!book) return null

  return (
    <div style={{ background: '#fbfbfb', color: '#1a1a1a', fontFamily: '"Microsoft YaHei", "PingFang SC", Arial, sans-serif', fontSize: 14, lineHeight: 1.5, minHeight: '100%' }}>
      {/* 源站 header > .container.head — 简化版 */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e6e6e6' }}>
        <div className="container head" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', padding: '16px 5px' }}>
          <a id="logo" href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ fontWeight: 700, textAlign: 'center', textDecoration: 'none', flexShrink: 0, marginRight: 16 }}>
            <span style={{ fontSize: '1.5em', letterSpacing: '.15em', color: '#3e3d43' }}>{site.name}</span>
            <p style={{ fontWeight: 700, color: '#bf2c24', margin: 0 }}>{site.domain}</p>
          </a>
          <form name="t_frmsearch" method="post" action="/search/" style={{ display: 'flex', alignItems: 'center', height: 36, width: 300, margin: '5px 2px' }} onSubmit={(e) => e.preventDefault()}>
            <input
              type="text"
              name="searchkey"
              className="search_input"
              placeholder="猫腻"
              autoComplete="off"
              style={{ textIndent: 10, height: '100%', border: '1px solid #e6e6e6', borderRadius: '3px 0 0 3px', borderRight: 0, flexGrow: 2, outline: 'none', fontSize: 14 }}
            />
            <button type="submit" id="search_btn" title="搜索" style={{ padding: '0 13px', height: '100%', border: 'none', borderRadius: '0 3px 3px 0', background: '#bf2c24', color: '#fbfbfb', cursor: 'pointer' }}>🔍</button>
          </form>
        </div>
      </header>

      <div className="container" style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexWrap: 'wrap' }}>
        {/* 源站 .novel_info_main — 封面 + 标题 + meta + 简介 */}
        <div className="novel_info_main" style={{ width: '100%', padding: '10px 5px 0', lineHeight: '1.5em', background: '#fff', marginTop: 10 }}>
          <BookCover
            name={book.name}
            cover={book.cover}
            className="w-[120px] h-[160px]"
            style={{ margin: '8px 20px 10px 0', boxShadow: '3px 4px 10px #999', float: 'left', borderRadius: 0 }}
          />
          <div className="novel_info_title" style={{ lineHeight: '38px' }}>
            <h1 style={{ fontWeight: 700, color: '#555', fontSize: 24, marginRight: 20, display: 'inline-block', margin: 0 }}>{book.name}</h1>
            <p style={{ display: 'flex', flexWrap: 'wrap', margin: 0 }}>
              <span style={{ padding: '0 10px', border: '1px solid #ccc', borderRadius: 3, margin: '12px 15px 8px 0', whiteSpace: 'nowrap', lineHeight: '22px', color: '#1a1a1a' }}>{book.category}</span>
              <span style={{ padding: '0 10px', border: '1px solid #ccc', borderRadius: 3, margin: '12px 15px 8px 0', whiteSpace: 'nowrap', lineHeight: '22px', color: '#1a1a1a' }}>{statusLabel(book.status)}</span>
              <span style={{ padding: '0 10px', border: '1px solid #ccc', borderRadius: 3, margin: '12px 15px 8px 0', whiteSpace: 'nowrap', lineHeight: '22px', color: '#1a1a1a' }}>{formatWords(book.wordCount)}</span>
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 8, fontSize: '1.05em', color: '#1a1a1a' }}>
              <span style={{ marginRight: 15 }}>作者：<a href="#" style={{ color: '#bf2c24', textDecoration: 'none' }}>{book.author}</a></span>
              <span style={{ marginRight: 15 }}>更新：<span style={{ color: '#888' }}>{fmtDate(book.updatedAt) || '—'}</span></span>
              {book.latestChapter && <span style={{ marginRight: 15 }}>最新：<a href="#" style={{ color: '#bf2c24', textDecoration: 'none' }}>{book.latestChapter}</a></span>}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              {firstChapterId && (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                  className="l_btn"
                  style={{ width: 108, paddingLeft: 15, lineHeight: '35px', borderRadius: 3, margin: '10px 15px 0 0', background: '#bf2c24', border: '1px solid #bf2c24', color: '#fbfbfb', textDecoration: 'none', cursor: 'pointer', display: 'inline-block', textAlign: 'center' }}
                >
                  立即阅读
                </a>
              )}
              <button
                type="button"
                onClick={onScrollToc}
                className="l_btn_0"
                style={{ width: 108, paddingLeft: 14, lineHeight: '35px', borderRadius: 3, margin: '10px 15px 0 0', background: '#fff', border: '1px solid #bf2c24', color: '#bf2c24', textDecoration: 'none', cursor: 'pointer' }}
              >
                章节目录
              </button>
              <a
                href={`/api/public/download?book=${book.id}`}
                className="l_btn_0"
                style={{ width: 108, paddingLeft: 14, lineHeight: '35px', borderRadius: 3, margin: '10px 15px 0 0', background: '#fff', border: '1px solid #bf2c24', color: '#bf2c24', textDecoration: 'none', display: 'inline-block', textAlign: 'center' }}
              >
                TXT 下载
              </a>
            </div>
          </div>

          {/* 简介 */}
          <div className="intro" style={{ textIndent: '2em', lineHeight: '1.8em', minHeight: 50, marginTop: '1em', clear: 'both', padding: '0 10px' }}>
            <p style={{ margin: '6px 0', overflow: 'hidden', color: '#666' }}>
              {book.intro || '暂无简介'}
            </p>
          </div>
        </div>

        {/* 源站 .ulcard — 章节列表入口 */}
        <div className="ulcard" style={{ width: '100%', marginTop: 30, borderBottom: '1px solid #eee', background: '#fff' }}>
          <ul style={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: 0 }}>
            <li className="act" style={{ padding: '0 20px', height: 40, fontSize: 18, color: '#ed4259', borderBottom: '2px solid #ed4259', lineHeight: '40px' }}>
              最新章节
            </li>
            <li style={{ padding: '0 20px', height: 40, fontSize: 14, color: '#888', lineHeight: '40px' }}>
              <span style={{ fontSize: 14 }}>{book.latestChapter ? `更新至：${book.latestChapter}` : '暂无章节'}</span>
            </li>
            <li style={{ marginLeft: 'auto', padding: '0 20px', height: 40, lineHeight: '40px' }}>
              <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#bf2c24', cursor: 'pointer', fontSize: 14, padding: 0 }}>
                查看完整章节 →
              </button>
            </li>
          </ul>
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
            Copyright © {new Date().getFullYear()} {site.name}({site.domain})
          </p>
        </footer>
      </div>
    </div>
  )
}
