'use client'
// ============================================================
// clone-ddyueshu FulltextView — 1:1 精仿 www.ddyueshu.cc 全本小说页 (/xiaoshuodaquan/)
// 参考: agent-ctx/probe-html2/probe-ddyueshu.html (无 fulltext probe, 从 .novellist 20% grid 模式推断)
// 源站 CSS 提取:
//   .novellist (margin 10px auto width 968px padding 3px)
//   .novellist h2 (bg #F6F8FE border-bottom 1px #DDD font 14px bold height 30px line-height 30px padding 0 0 0 10px)
//   .novellist ul (padding 10px)
//   .novellist li (float left color #B3B3B3 padding 5px 0 0 0 border-bottom 1px #DDD height 25px width 20% line-height 25px overflow hidden display inline-block)
//   .novellist li a:link (color #6F78A7)
//   .novellist li a:visited (color red)
// CSS 由 CloneCSSLoader 加载 public/clone-css/ddyueshu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { FulltextViewProps } from '../shared'

export function FulltextView({ books, loading, page, total, size, onPage }: FulltextViewProps) {
  const { navigate } = usePublic()

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }

  const totalPages = Math.ceil(total / size)
  const hasPrev = page > 1
  const hasNext = page * size < total

  return (
    <div id="main">
      <div className="novellist">
        <h2>全本完本小说</h2>

        {loading ? (
          <ul><li style={{ padding: 40, textAlign: 'center' }}>加载中...</li></ul>
        ) : !books.length ? (
          <ul><li style={{ padding: 40, textAlign: 'center' }}>暂无完本小说</li></ul>
        ) : (
          <>
            <ul style={{ padding: 10 }}>
              {books.map((b) => (
                <li key={b.id}>
                  <a {...bookNavProps(navigate, b.id)}>{b.name}</a>
                  <span style={{ color: '#B3B3B3', marginLeft: 4 }}>/ {b.author} / {formatWords(b.wordCount)}</span>
                </li>
              ))}
              <div className="clear" />
            </ul>

            {/* 顶部 1 行封面预览 (前 5 本大封面, 源站 .novelslist .content 风格) */}
            <div className="novelslist" style={{ marginTop: 5 }}>
              <div className="content">
                <h2>精选完本推荐</h2>
                {books.slice(0, 5).map((b, i) => (
                  <div key={b.id} className="top" style={{ padding: '5px 0', borderBottom: i < 4 ? '1px dashed #A6D3E8' : 'none' }}>
                    <div className="image" style={{ display: 'inline-block', verticalAlign: 'top' }}>
                      <a {...bookNavProps(navigate, b.id)}>
                        <BookCover name={b.name} cover={b.cover} style={{ width: 67, height: 82 }} />
                      </a>
                    </div>
                    <dl style={{ display: 'inline-block', verticalAlign: 'top', width: '60%', padding: '0 5px' }}>
                      <dt><a {...bookNavProps(navigate, b.id)}>{b.name}</a></dt>
                      <dd style={{ color: '#9E9E9E', lineHeight: '20px', height: '40px', overflow: 'hidden', textIndent: '2em', fontSize: 12 }}>
                        {b.intro || '暂无简介'}
                      </dd>
                    </dl>
                    <div className="clear" />
                  </div>
                ))}
              </div>
              <div className="clear" />
            </div>
          </>
        )}

        {/* 分页 */}
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

      <div id="firendlink">
        友情链接：
        <a href="/" onClick={goHome}>首页</a>
      </div>
    </div>
  )
}
