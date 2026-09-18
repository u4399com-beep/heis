'use client'
// ============================================================
// clone-ddyueshu CategoryList — 1:1 精仿 www.ddyueshu.cc 分类列表页
// 参考: agent-ctx/probe-html2/probe-ddyueshu.html (首页 .novelslist 模式) + ddyueshu.css
// 源站 CSS 提取: .novellist (margin 10px auto width 968px) + li float left width 20% (visited red color)
//                .novelslist (border 3px #A6D3E8 padding 3px bg #FEF9EF width 968px) + h2 (bg #F6F8FE 30px line-height)
// 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  if (loading) {
    return (
      <div id="main">
        <div className="novelslist">
          <h2>{label}</h2>
          <ul><li style={{ padding: 40, textAlign: 'center' }}>加载中...</li></ul>
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div id="main">
        <div className="novelslist">
          <h2>{label}</h2>
          <ul><li style={{ padding: 40, textAlign: 'center' }}>暂无书籍</li></ul>
        </div>
      </div>
    )
  }

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }

  const totalPages = Math.ceil(total / size)
  const hasPrev = page > 1
  const hasNext = page * size < total

  return (
    <div id="main">
      <div className="novelslist">
        <h2>{label}</h2>
        <div style={{ padding: '10px' }}>
          {/* 源站 .novelslist .content ul li 是 155px float left 文字列表; 分类页扩展为含封面的混合列表 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
            {books.map((b, i) => (
              <div
                key={b.id}
                {...bookNavProps(navigate, b.id)}
                className="novellist-item"
                style={{
                  width: '20%',
                  padding: '5px',
                  float: 'left',
                  display: 'inline-block',
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                  verticalAlign: 'top',
                }}
              >
                <div className="image" style={{ width: 67, height: 82, margin: '0 auto', overflow: 'hidden', border: '1px solid #DDD', padding: 1, background: '#fff' }}>
                  <BookCover name={b.name} cover={b.cover} style={{ width: 67, height: 82 }} />
                </div>
                <div style={{ padding: '5px 0', textAlign: 'center', overflow: 'hidden' }}>
                  <a style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#6F78A7', fontSize: 13 }}>{b.name}</a>
                  <span style={{ color: '#B3B3B3', fontSize: 12 }}>
                    {b.author} / {formatWords(b.wordCount)}
                  </span>
                </div>
                {/* 索引序号 (源站 visited red 色, 此处仅装饰) */}
                <span style={{ display: 'none' }}>{i + 1}</span>
              </div>
            ))}
          </div>
          <div className="clear" />
        </div>

        {/* 分页: 源站风格简单 "上一页/下一页" 链接 */}
        {total > size && (
          <div className="bottem1" style={{ clear: 'both', textAlign: 'center', width: '100%', padding: '10px 0' }}>
            {hasPrev && (
              <a
                role="button"
                tabIndex={0}
                onClick={() => onPage(page - 1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onPage(page - 1)
                  }
                }}
                style={{ margin: '0 10px', cursor: 'pointer', color: '#085308', fontSize: 14 }}
              >
                上一页
              </a>
            )}
            <span style={{ color: '#B3B3B3', fontSize: 12 }}>第 {page} 页 / 共 {totalPages} 页 ({total} 本)</span>
            {hasNext && (
              <a
                role="button"
                tabIndex={0}
                onClick={() => onPage(page + 1)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onPage(page + 1)
                  }
                }}
                style={{ margin: '0 10px', cursor: 'pointer', color: '#085308', fontSize: 14 }}
              >
                下一页
              </a>
            )}
          </div>
        )}
      </div>

      {/* 友情链接 + footer (保持源站页面底部结构一致) */}
      <div id="firendlink">
        友情链接：
        <a href="/" onClick={goHome}>首页</a>
      </div>
    </div>
  )
}
