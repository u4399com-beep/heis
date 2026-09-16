'use client'
// trxsw (同人小说网, 域名已过期) 书籍详情页 1:1 克隆 — 现代简洁模板
// 源站 DOM 反查: .detail (flex 封面+meta) + .intro (简介) + .headline (章节列表入口)
// 实测颜色: --bg #f5f7fa / --surface #fff / --primary #2c7be5 / --muted #888 / --border #e0e6ed / --radius 4px
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { site, navigate } = usePublic()
  if (!book) return null

  return (
    <div style={{ background: '#f5f7fa', color: '#333', fontFamily: '"Microsoft YaHei", Arial, sans-serif', fontSize: 14, lineHeight: 1.6, minHeight: '100%' }}>
      {/* 源站 .header */}
      <header style={{ background: '#fff', borderBottom: '1px solid #e0e6ed' }}>
        <div className="container" style={{ maxWidth: 1100, margin: '0 auto', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} className="logo" style={{ fontSize: 22, fontWeight: 700, color: '#2c7be5', textDecoration: 'none' }}>
            {site.name}
          </a>
          <nav style={{ flex: 1, display: 'flex', gap: 4, minWidth: 200, flexWrap: 'wrap' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ padding: '6px 12px', color: '#fff', background: '#2c7be5', borderRadius: 4, textDecoration: 'none', fontSize: 14 }}>首页</a>
            <a href="#" style={{ padding: '6px 12px', color: '#333', textDecoration: 'none', fontSize: 14 }}>书库</a>
            <a href="#" style={{ padding: '6px 12px', color: '#333', textDecoration: 'none', fontSize: 14 }}>排行</a>
          </nav>
        </div>
      </header>

      <div className="container" style={{ maxWidth: 1100, margin: '0 auto', padding: '16px' }}>
        {/* 面包屑 */}
        <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2c7be5', textDecoration: 'none' }}>首页</a>
          <span style={{ margin: '0 6px' }}>/</span>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'category', cat: book.categoryId || '' }) }} style={{ color: '#2c7be5', textDecoration: 'none' }}>{book.category}</a>
          <span style={{ margin: '0 6px' }}>/</span>
          <span>{book.name}</span>
        </div>

        {/* 源站 .detail — 封面 + 信息 */}
        <div className="detail" style={{ display: 'flex', gap: 20, padding: 20, background: '#fff', borderRadius: 4, border: '1px solid #e0e6ed', flexWrap: 'wrap' }}>
          <BookCover name={book.name} cover={book.cover} className="w-[120px] h-[160px]" style={{ borderRadius: 4, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="name" style={{ fontSize: 22, fontWeight: 700, color: '#333', marginBottom: 12, lineHeight: 1.4 }}>{book.name}</div>
            <div className="author" style={{ fontSize: 14, color: '#888', marginBottom: 12 }}>
              作者：<a href="#" style={{ color: '#2c7be5', textDecoration: 'none' }}>{book.author}</a>
              <span style={{ marginLeft: 12 }}>分类：<a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'category', cat: book.categoryId || '' }) }} style={{ color: '#2c7be5', textDecoration: 'none' }}>{book.category}</a></span>
              <span style={{ marginLeft: 12 }}>状态：<span style={{ color: book.status === 'completed' ? '#888' : '#2c7be5' }}>{statusLabel(book.status)}</span></span>
            </div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16, lineHeight: 1.8 }}>
              字数：{formatWords(book.wordCount)} · 更新：{fmtDate(book.updatedAt) || '—'}
              <br />
              最新章节：{book.latestChapter || '暂无'}
            </div>

            {/* 行动按钮 */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {firstChapterId && (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                  style={{ padding: '8px 20px', background: '#2c7be5', color: '#fff', borderRadius: 4, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
                >
                  立即阅读
                </a>
              )}
              <button
                type="button"
                onClick={onScrollToc}
                style={{ padding: '8px 20px', background: '#fff', color: '#2c7be5', border: '1px solid #2c7be5', borderRadius: 4, fontSize: 14, cursor: 'pointer' }}
              >
                章节目录
              </button>
              <a
                href={`/api/public/download?book=${book.id}`}
                style={{ padding: '8px 20px', background: '#fff', color: '#666', border: '1px solid #e0e6ed', borderRadius: 4, fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                TXT 下载
              </a>
            </div>
          </div>
        </div>

        {/* 源站 .intro — 内容简介 */}
        <div className="intro" style={{ marginTop: 16, padding: 16, lineHeight: 1.8, color: '#888', background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4 }}>
          <h3 className="headline" style={{ display: 'flex', alignItems: 'center', fontSize: 16, fontWeight: 700, color: '#333', margin: '0 0 12px', padding: '0 0 8px', borderBottom: '2px solid #2c7be5' }}>
            <span style={{ display: 'inline-block', width: 4, height: 16, background: '#2c7be5', marginRight: 8, borderRadius: 2 }} />
            内容简介
          </h3>
          <p style={{ margin: 0, color: '#555', fontSize: 14, textIndent: '2em' }}>
            {book.intro || '暂无简介'}
          </p>
        </div>

        {/* 章节目录入口 */}
        <div style={{ marginTop: 16, padding: 16, background: '#fff', border: '1px solid #e0e6ed', borderRadius: 4 }}>
          <h3 className="headline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 16, fontWeight: 700, color: '#333', margin: '0 0 12px', padding: '0 0 8px', borderBottom: '2px solid #2c7be5' }}>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ display: 'inline-block', width: 4, height: 16, background: '#2c7be5', marginRight: 8, borderRadius: 2 }} />
              章节目录
            </span>
            <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#2c7be5', cursor: 'pointer', fontSize: 13, padding: '4px 8px' }}>
              查看全部 →
            </button>
          </h3>
          <p style={{ textAlign: 'center', color: '#888', padding: '24px 0', margin: 0, fontSize: 14 }}>
            点击 <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#2c7be5', cursor: 'pointer', fontSize: 14, padding: 0 }}>章节目录</button> 查看完整章节列表
          </p>
        </div>
      </div>

      {/* 源站 .footer */}
      <footer style={{ background: '#fff', borderTop: '1px solid #e0e6ed', padding: '20px 16px', textAlign: 'center', color: '#888', fontSize: 12, marginTop: 24 }}>
        <p style={{ margin: 0 }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2c7be5', textDecoration: 'none' }}>{site.name}</a>
          &nbsp;·&nbsp;Copyright © {new Date().getFullYear()} {site.name}({site.domain})
        </p>
      </footer>
    </div>
  )
}
