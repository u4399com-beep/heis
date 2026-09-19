'use client'
// ============================================================
// clone-ddyueshu RankingView — 1:1 精仿 www.ddyueshu.cc 排行榜页 (/paihangbang/)
// 参考: agent-ctx/probe-html2/probe-ddyueshu.html (无 ranking probe, 从 .novelslist/#newscontent 模式推断)
// 源站 CSS 提取:
//   .novelslist (border 3px #A6D3E8 padding 3px bg #FEF9EF width 968px)
//   .novelslist h2 (bg #F6F8FE border-bottom 1px #DDD font 14px bold height 30px line-height 30px padding 0 0 0 10px)
//   .novelslist li (padding 5px 0 0 0 border-bottom 1px #DDD height 25px line-height 25px overflow hidden)
//   .novelslist li span (float left display inline-block)
//   .novelslist li .s1 (width 10%)
//   .novelslist li .s2 (width 20%)
//   .novelslist li .s3 (width 49%)
//   .novelslist li .s4 (color #B3B3B3 width 15% text-align right)
//   .novelslist li .s5 (color #B3B3B3 float right text-align right)
// CSS 由 CloneCSSLoader 加载 public/clone-css/ddyueshu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { RankingViewProps } from '../shared'
import { cloneNavHandlers } from '../shared'

const TABS = [
  { id: 'allvisit', name: '总点击榜' },
  { id: 'allvote', name: '总推荐榜' },
  { id: 'size', name: '字数榜' },
  { id: 'lastupdate', name: '最近更新' },
]

export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage }: RankingViewProps) {
  const { navigate } = usePublic()

  // R28-1A: 复用 cloneNavHandlers (goHome 共享, 本页无搜索表单)
  const { goHome } = cloneNavHandlers(navigate, 'searchkey')

  const totalPages = Math.ceil(total / size)
  const hasPrev = page > 1
  const hasNext = page * size < total

  return (
    <div id="main">
      <div className="novelslist">
        <h2>小说排行榜</h2>

        {/* Tab 切换: 源站风格简单链接按钮组 */}
        <div style={{ padding: '10px', borderBottom: '1px solid #A6D3E8' }}>
          {TABS.map(t => (
            <a
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => onTabChange(t.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onTabChange(t.id)
                }
              }}
              style={{
                display: 'inline-block',
                padding: '4px 12px',
                margin: '0 4px 4px 0',
                cursor: 'pointer',
                color: tab === t.id ? '#fff' : '#6F78A7',
                background: tab === t.id ? '#88C6E5' : 'transparent',
                border: '1px solid ' + (tab === t.id ? '#88C6E5' : '#A6D3E8'),
                borderRadius: 0,
                fontSize: 14,
                fontWeight: tab === t.id ? 700 : 400,
              }}
            >
              {t.name}
            </a>
          ))}
        </div>

        {/* 列表: 源站 .novelslist li 5 列布局 (.s1 排名/.s2 书名/.s3 最新章节/.s4 作者/.s5 字数) */}
        {loading ? (
          <ul><li style={{ padding: 40, textAlign: 'center' }}>加载中...</li></ul>
        ) : !books.length ? (
          <ul><li style={{ padding: 40, textAlign: 'center' }}>暂无上榜书籍</li></ul>
        ) : (
          <ul style={{ padding: 10 }}>
            {books.map((b, i) => {
              const rank = (page - 1) * size + i + 1
              return (
                <li key={b.id}>
                  <span className="s1" style={{ color: rank <= 3 ? '#085308' : '#B3B3B3', fontWeight: rank <= 3 ? 700 : 400 }}>
                    {rank}
                  </span>
                  <span className="s2"><a {...bookNavProps(navigate, b.id)}>{b.name}</a></span>
                  <span className="s3"><a {...bookNavProps(navigate, b.id)}>{b.latestChapter || '最新章节'}</a></span>
                  <span className="s4">{b.author}</span>
                  <span className="s5">{formatWords(b.wordCount)}</span>
                  <div className="clear" />
                </li>
              )
            })}
          </ul>
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
            <span style={{ color: '#B3B3B3', fontSize: 12 }}>第 {page} 页 / 共 {totalPages} 页</span>
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
