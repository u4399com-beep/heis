'use client'
// x2552 (吾爱文学网) 书籍详情页 1:1 克隆 — heibing 模板
// 源站 DOM: .main(#a_head .so + #a_main dt + #at 表格章节) + .btnlinks 行动按钮 + #content .intro 简介 + .footer
// 实测颜色: a #2f468f / a:hover #ff6600 / .btnlinks .read #FF6600 / #content dd padding 10px
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { site, navigate } = usePublic()
  if (!book) return null

  return (
    <div style={{ color: '#666', background: '#fff', font: '12px/120% "Microsoft YaHei", Arial, Verdana, sans-serif', minHeight: '100%' }}>
      {/* 源站 .main.m_head — 简化版 */}
      <div className="main m_head" style={{ width: 960, maxWidth: '100%', margin: '10px auto 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <div className="h_logo fl" style={{ width: 180, flexShrink: 0, textAlign: 'center' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ display: 'inline-block', fontSize: 24, fontWeight: 700, color: '#2f468f', textDecoration: 'none' }}>
            {site.name}
          </a>
        </div>
        <div className="h_body fl" style={{ flex: 1, minWidth: 280 }}>
          <form target="_blank" action="/search" method="post" name="articlesearch" id="articlesearch" style={{ margin: 0 }} onSubmit={(e) => e.preventDefault()}>
            <dl className="fl searchbox" style={{ display: 'flex', alignItems: 'center', margin: 0, padding: '10px 0 0' }}>
              <dt style={{ display: 'flex', alignItems: 'center', width: 260, height: 28, border: '1px solid #CCCCCC', background: '#fff', borderRadius: 2 }}>
                <input type="text" name="searchkey" placeholder="可搜索小说名/作者" style={{ width: 240, background: 'transparent', border: 'none', color: '#666', height: 20, padding: '4px 8px 0 8px', outline: 'none', fontSize: 12 }} />
              </dt>
              <dd style={{ paddingLeft: 4 }}>
                <a href="javascript:void(0);" className="so_book" onClick={() => navigate({ view: 'search' })} style={{ display: 'inline-block', width: 70, height: 28, lineHeight: '28px', textAlign: 'center', background: '#2f468f', color: '#fff', textDecoration: 'none', marginRight: 4 }}>搜书名</a>
              </dd>
            </dl>
          </form>
        </div>
        <div className="cl" style={{ clear: 'both' }} />
      </div>

      {/* 源站 .main.m_menu — 简化版 */}
      <div className="main m_menu" style={{ width: 960, maxWidth: '100%', margin: '5px auto 0', height: 40, background: 'linear-gradient(to bottom, #4a78c4, #2f468f)' }}>
        <ul style={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: 0, height: '100%' }}>
          <li style={{ fontSize: 14, paddingLeft: 12, fontWeight: 700, lineHeight: '39px' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fff', textDecoration: 'none' }}>吾爱首页</a>
          </li>
          <li style={{ fontSize: 14, paddingLeft: 12, fontWeight: 700, lineHeight: '39px' }}>
            <a href="#" style={{ color: '#fff', textDecoration: 'none' }}>书库</a>
          </li>
          <li style={{ fontSize: 14, paddingLeft: 12, fontWeight: 700, lineHeight: '39px' }}>
            <a href="#" style={{ color: '#fff', textDecoration: 'none' }}>全本</a>
          </li>
        </ul>
      </div>

      {/* 源站 #a_main — 书籍信息区 */}
      <div id="a_main" style={{ width: 960, maxWidth: '100%', margin: '10px auto 0' }}>
        <dl style={{ margin: 0 }}>
          <dt style={{ lineHeight: '30px', padding: '0 15px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 16 }}>
            {/* 封面 */}
            <div style={{ flexShrink: 0, width: 120, height: 160, border: '1px solid #E4E4E4', padding: 4, background: '#fff', boxSizing: 'border-box' }}>
              <BookCover name={book.name} cover={book.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
            </div>
            {/* 书名 + meta */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontSize: 22, textAlign: 'left', lineHeight: '32px', height: 'auto', margin: 0, color: '#333', fontWeight: 700, paddingBottom: 8, borderBottom: '1px solid #E4E4E4', marginBottom: 8 }}>
                {book.name}
              </h1>
              <div style={{ lineHeight: '24px', fontSize: 13, color: '#666' }}>
                <p style={{ margin: '4px 0' }}>
                  作者：<a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>{book.author}</a>
                  <span style={{ marginLeft: 16 }}>类别：<a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'category', cat: book.categoryId || '' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>{book.category}</a></span>
                </p>
                <p style={{ margin: '4px 0' }}>
                  状态：<span style={{ color: book.status === 'completed' ? '#888' : '#FF3300' }}>{statusLabel(book.status)}</span>
                  <span style={{ marginLeft: 16 }}>字数：{formatWords(book.wordCount)}</span>
                </p>
                <p style={{ margin: '4px 0' }}>
                  更新时间：{fmtDate(book.updatedAt) || '—'}
                </p>
                <p style={{ margin: '4px 0' }}>
                  最新章节：
                  {book.latestChapter ? <a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>{book.latestChapter}</a> : <span style={{ color: '#888' }}>暂无</span>}
                </p>
              </div>

              {/* 行动按钮 .btnlinks */}
              <div className="btnlinks" style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {firstChapterId && (
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                    className="read"
                    style={{ display: 'inline-block', marginRight: 10, background: '#2f468f', color: '#FF6600', width: 100, height: 30, textAlign: 'center', lineHeight: '30px', textDecoration: 'none', borderRadius: 2, fontWeight: 700 }}
                  >
                    立即阅读
                  </a>
                )}
                <button
                  type="button"
                  onClick={onScrollToc}
                  style={{ marginRight: 10, background: '#fff', color: '#666', border: '1px solid #E4E4E4', width: 100, height: 30, lineHeight: '30px', textAlign: 'center', cursor: 'pointer', borderRadius: 2 }}
                >
                  章节目录
                </button>
                <a
                  href={`/api/public/download?book=${book.id}`}
                  style={{ display: 'inline-block', background: '#fff', color: '#666', border: '1px solid #E4E4E4', width: 100, height: 30, lineHeight: '30px', textAlign: 'center', textDecoration: 'none', borderRadius: 2 }}
                >
                  TXT 下载
                </a>
              </div>
            </div>
          </dt>
        </dl>
      </div>

      {/* 源站 #content .intro — 简介 */}
      <div className="main" style={{ width: 960, maxWidth: '100%', margin: '10px auto 0' }}>
        <div className="block" style={{ border: '1px solid #E4E4E4', background: '#fff' }}>
          <div className="blocktitle" style={{ height: 40, lineHeight: '40px', fontSize: 14, background: '#2f468f', color: '#fff', padding: '0 12px' }}>
            内容简介
          </div>
          <div className="blockcontent">
            <div id="contents" style={{ padding: 25, lineHeight: '26px', fontSize: 14, color: '#666' }}>
              {book.intro || '暂无简介'}
            </div>
          </div>
        </div>
      </div>

      {/* 源站 .main.footer */}
      <div className="main footer" style={{ width: 960, maxWidth: '100%', margin: '8px auto 0', background: '#f7faff', border: '1px solid #E4E4E4' }}>
        <div className="ftc" style={{ padding: '10px 12px', lineHeight: '22px', textAlign: 'center', fontSize: 12, color: '#666' }}>
          Copyright © {new Date().getFullYear()} <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>{site.name}</a>({site.domain}) All Rights Reserved
        </div>
      </div>
    </div>
  )
}
