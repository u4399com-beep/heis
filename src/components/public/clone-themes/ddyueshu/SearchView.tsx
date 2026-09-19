'use client'
// ============================================================
// clone-ddyueshu SearchView — 1:1 精仿 www.ddyueshu.cc 搜索结果页
// 参考: agent-ctx/probe-html2/probe-ddyueshu.html (无 search probe, 从 #newscontent .l 列表模式推断)
// 源站 CSS 提取:
//   #newscontent .l (border 3px #88C6E5 float left width 695px bg #E1ECED)
//   #newscontent h2 (margin 0 padding 0 0 0 10px bg #A6D3E8 height 30px line-height 30px font 14px bold border-bottom 1px #DDD)
//   #newscontent .l ul (padding 10px)
//   #newscontent .l li (padding 5px 0 0 0 border-bottom 1px #DDD height 25px line-height 25px overflow hidden)
//   #newscontent .l li span (float left display inline-block)
//   #newscontent .l li .s1 (width 75px)
//   #newscontent .l li .s2 (width 165px)
//   #newscontent .l li .s3 (width 300px)
//   #newscontent .l li .s4 (color #B3B3B3 width 90px text-align right)
//   #newscontent .l li .s5 (color #B3B3B3 float right text-align right)
// CSS 由 CloneCSSLoader 加载 public/clone-css/ddyueshu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { SearchViewProps } from '../shared'
import { cloneNavHandlers } from '../shared'

export function SearchView({ q, books, loading }: SearchViewProps) {
  const { navigate } = usePublic()

  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch } = cloneNavHandlers(navigate, 'searchkey')

  return (
    <div id="main">
      <div id="newscontent">
        <div className="l">
          <h2>搜索 "{q}" 的小说</h2>

          {/* 搜索框: 源站风格简洁 form */}
          <div style={{ padding: 10, borderBottom: '1px solid #A6D3E8', background: '#E1ECED' }}>
            <form onSubmit={goSearch}>
              <input
                name="searchkey"
                type="text"
                defaultValue={q || ''}
                placeholder="可搜索书名或作者"
                style={{ width: 390, height: 24, padding: '3px 5px', border: '1px solid #A6D3E8', fontSize: 14 }}
              />
              <button type="submit" style={{ background: '#88C6E5', border: 'none', color: '#fff', fontSize: 14, height: 30, padding: '0 15px', cursor: 'pointer', marginLeft: 5 }}>搜索</button>
            </form>
          </div>

          {loading ? (
            <ul><li style={{ padding: 40, textAlign: 'center' }}>搜索中...</li></ul>
          ) : !books.length ? (
            <ul><li style={{ padding: 40, textAlign: 'center' }}>未找到相关书籍</li></ul>
          ) : (
            <ul>
              {books.map(b => (
                <li key={b.id}>
                  <span className="s1">[{b.category || '小说'}]</span>
                  <span className="s2"><a {...bookNavProps(navigate, b.id)}>{b.name}</a></span>
                  <span className="s3"><a {...bookNavProps(navigate, b.id)}>{b.latestChapter || '最新章节'}</a></span>
                  <span className="s4">{b.author}</span>
                  <span className="s5">{formatWords(b.wordCount)}</span>
                  <div className="clear" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 右栏热门: 简单复用源站 #newscontent .r 结构, 列出最多 15 本相关书 */}
        <div className="r">
          <h2>相关小说推荐</h2>
          <ul>
            {books.slice(0, 15).map(b => (
              <li key={b.id}>
                <span className="s1">[{b.category || '小说'}]</span>
                <span className="s2"><a {...bookNavProps(navigate, b.id)}>{b.name}</a></span>
                <span className="s5">{b.author}</span>
                <div className="clear" />
              </li>
            ))}
          </ul>
        </div>

        <div className="clear" />
      </div>

      <div id="firendlink">
        友情链接：
        <a href="/" onClick={goHome}>首页</a>
      </div>
    </div>
  )
}
