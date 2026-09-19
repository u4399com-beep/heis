'use client'
// ============================================================
// clone-ddyueshu KeywordView — 1:1 精仿 www.ddyueshu.cc 标签关键词落地页
// 参考: agent-ctx/probe-html2/probe-ddyueshu.html (无 keyword probe, 从 .novelslist .content 模式推断)
// 源站 CSS 提取:
//   .novelslist (margin 2px auto border 3px #A6D3E8 width 968px padding 3px bg #FEF9EF)
//   .novelslist .content (border-right dotted 1px #A6D3E8 padding 0 3px float left width 315px)
//   .novelslist .content h2 (border-bottom solid 1px #A6D3E8 font 14px bold padding-left 5px line-height 25px height 25px overflow hidden margin 0)
//   .novelslist .content .image (padding 10px 0 0 5px float left width 71px)
//   .novelslist .content .image img (width 67 height 82 border 1px #DDD padding 1px bg white)
//   .novelslist .content dl (padding 10px 0 0 0 float right width 219px)
//   .novelslist .content dl dt (height 25px line-height 25px overflow hidden font-weight bold)
//   .novelslist .content dl dd (line-height 20px height 60px overflow hidden)
//   .novelslist .content ul (padding 10px 0 0 0)
//   .novelslist .content ul li (color #B3B3B3 height 20px line-height 20px font 12px overflow hidden float left width 155px)
// CSS 由 CloneCSSLoader 加载 public/clone-css/ddyueshu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import type { KeywordViewProps } from '../shared'
import { cloneNavHandlers } from '../shared'

export function KeywordView({ tag, books, loading }: KeywordViewProps) {
  const { navigate } = usePublic()

  // R28-1A: 复用 cloneNavHandlers (goHome 共享, 本页无搜索表单)
  const { goHome } = cloneNavHandlers(navigate, 'searchkey')
  const goKeyword = (kw: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'keyword', tag: kw })
  }

  // 把 books 切成 3 列 × N 行 (源站 .novelslist 3 .content 横排)
  const cols: typeof books[] = [[], [], []]
  books.forEach((b, i) => cols[i % 3].push(b))

  return (
    <div id="main">
      <div className="novelslist">
        <h2 style={{ background: '#F6F8FE', borderBottom: '1px solid #A6D3E8', fontSize: 14, fontWeight: 700, height: 30, lineHeight: '30px', overflow: 'hidden', padding: '0 0 0 10px', margin: 0 }}>
          "{tag}" 相关小说
        </h2>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
        ) : !books.length ? (
          <div style={{ padding: 40, textAlign: 'center' }}>暂无相关小说</div>
        ) : (
          <div style={{ padding: '5px 3px', background: '#FEF9EF' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
              {/* 源站 3 个 .content 列 (315px each) */}
              {cols.map((col, ci) => (
                <div key={ci} className="content" style={{ borderRight: ci < 2 ? 'dotted 1px #A6D3E8' : 'none', padding: '0 3px', float: 'left', width: '33.33%', boxSizing: 'border-box', verticalAlign: 'top' }}>
                  <h2 style={{ borderBottom: 'solid 1px #A6D3E8', fontSize: 14, fontWeight: 700, paddingLeft: 5, lineHeight: '25px', height: 25, overflow: 'hidden', margin: 0 }}>
                    {tag} 推荐 {ci + 1}
                  </h2>
                  {/* 第 1 本大封面 + 简介 (源站 .top 模式) */}
                  {col[0] && (
                    <div className="top" style={{ padding: '5px 0 0 0' }}>
                      <div className="image" style={{ display: 'inline-block', verticalAlign: 'top', padding: '5px 0 0 5px', width: 71 }}>
                        <a {...bookNavProps(navigate, col[0].id)}>
                          <BookCover name={col[0].name} cover={col[0].cover} style={{ width: 67, height: 82 }} />
                        </a>
                      </div>
                      <dl style={{ display: 'inline-block', verticalAlign: 'top', width: '60%', padding: '10px 0 0 0' }}>
                        <dt style={{ height: 25, lineHeight: '25px', overflow: 'hidden', fontWeight: 700 }}>
                          <a {...bookNavProps(navigate, col[0].id)}>{col[0].name}</a>
                        </dt>
                        <dd style={{ lineHeight: '20px', height: 60, overflow: 'hidden', color: '#9E9E9E', fontSize: 12 }}>
                          {col[0].intro || '暂无简介'}
                        </dd>
                      </dl>
                      <div className="clear" />
                    </div>
                  )}
                  {/* 其余文字列表 (源站 ul li float left width 155px 模式) */}
                  <ul style={{ padding: '10px 0 0 0' }}>
                    {col.slice(1).map(b => (
                      <li key={b.id} style={{ color: '#B3B3B3', height: 20, lineHeight: '20px', fontSize: 12, overflow: 'hidden', float: 'left', width: '48%', display: 'inline-block', padding: '3px 0 0 0', borderBottom: '1px solid #EEEEEE', boxSizing: 'border-box' }}>
                        <a {...bookNavProps(navigate, b.id)} style={{ fontSize: 13 }}>{b.name}</a>
                        <span style={{ marginLeft: 4 }}>/ {b.author}</span>
                      </li>
                    ))}
                    <div className="clear" />
                  </ul>
                  <div className="clear" />
                </div>
              ))}
            </div>
            <div className="clear" />
          </div>
        )}
      </div>

      {/* 相关关键词 (源站 #firendlink 风格) */}
      <div id="firendlink">
        相关关键词：
        <a href="/" onClick={goKeyword(tag)}>{tag}</a>
        <a href="/" onClick={goKeyword('完本小说')}>完本小说</a>
        <a href="/" onClick={goKeyword('免费小说')}>免费小说</a>
        <a href="/" onClick={goHome}>返回首页</a>
      </div>
    </div>
  )
}
