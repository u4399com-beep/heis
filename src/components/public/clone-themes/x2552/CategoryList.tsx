<<<<<<< HEAD
// ============================================================
// clone-themes/x2552 CategoryList — 吾爱文学分类页 1:1 克隆
// 实测 heibing 模板: #centeri .block .ultop 网格
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { formatWords } from '../../seo'
import { StatusBadge } from '../../bits'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", "宋体", Verdana, Arial, sans-serif'
const INK = '#333333'
const MUTED = '#666666'
const LINK = '#2f468f'
const BORDER = '#E4E4E4'
const HEADER_BG = '#f5f5dc'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, maxWidth: '960px', margin: '0 auto' }}>
      <div className="block" style={{ border: `1px solid ${BORDER}`, marginTop: '8px' }}>
        <div className="blocktitle" style={{ height: '40px', lineHeight: '40px', fontSize: '14px', background: HEADER_BG, padding: '0 10px' }}>
          <span style={{ fontWeight: 700, color: INK }}>{label}列表</span>
        </div>
        <div className="blockcontent">
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: MUTED, fontSize: '12px' }}>加载中...</div>
          ) : !books.length ? (
            <div style={{ padding: '24px', textAlign: 'center', color: MUTED, fontSize: '12px' }}>没有找到相关书籍</div>
          ) : (
            <ul className="ultop" style={{ margin: 0, padding: '5px', listStyle: 'none' }}>
              {books.map((b) => (
                <li key={b.id} style={{ borderBottom: '1px dotted #F2F2F2', padding: '0 3px', listStyle: 'decimal inside', fontSize: '12px', lineHeight: '25px' }}>
                  <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: LINK, textDecoration: 'none' }}>{b.name}</a>
                  <span style={{ color: MUTED, marginLeft: '4px' }}>/ {b.author} · {formatWords(b.wordCount)} · <StatusBadge status={b.status} small /></span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '10px 0' }}>
            {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '4px 10px', border: `1px solid ${BORDER}`, background: '#fff', color: LINK, textDecoration: 'none', fontSize: '12px' }}>上一页</a>}
            <span style={{ padding: '4px 10px', background: LINK, color: '#fff', fontSize: '12px' }}>{page}</span>
            <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '4px 10px', border: `1px solid ${BORDER}`, background: '#fff', color: LINK, textDecoration: 'none', fontSize: '12px' }}>下一页</a>
            <span style={{ padding: '4px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
          </div>
=======
'use client'
// x2552 (吾爱文学网) 分类列表页 1:1 克隆 — heibing 模板
// 源站 DOM: .main(#centeri .block .blocktitle 标签 + table.grid 表格) + #right(分类侧栏) + .pagelink
// 实测颜色: a #2f468f / table border #E4E4E4 / .pagelink bg #F2F2F2 / .pagelink strong color #ff6600
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { site, navigate } = usePublic()

  if (loading) {
    return (
      <div style={{ color: '#666', background: '#fff', font: '12px/120% "Microsoft YaHei", Arial, Verdana, sans-serif', minHeight: '100%' }}>
        <div className="main" style={{ width: 960, maxWidth: '100%', margin: '40px auto', padding: '40px 0', textAlign: 'center' }}>加载中...</div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div style={{ color: '#666', background: '#fff', font: '12px/120% "Microsoft YaHei", Arial, Verdana, sans-serif', minHeight: '100%' }}>
        <div className="main" style={{ width: 960, maxWidth: '100%', margin: '40px auto', padding: '40px 0', textAlign: 'center' }}>没有找到相关小说</div>
      </div>
    )
  }

  // 侧栏分类
  const SIDE_CATS = ['玄幻魔法', '武侠修真', '都市言情', '历史军事', '侦探推理', '网游动漫', '科幻小说', '恐怖灵异', '文学名著', '其他', '全本']

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

      {/* 中心区域 .main */}
      <div className="main" style={{ width: 960, maxWidth: '100%', margin: '8px auto 0' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {/* #centeri 书籍列表表格 */}
          <div id="centeri" style={{ flex: '1 1 760px', minWidth: 320 }}>
            <div className="block" style={{ border: '1px solid #E4E4E4', marginTop: 8, background: '#fff' }}>
              <div className="blocktitle" style={{ height: 40, lineHeight: '40px', fontSize: 14, background: '#2f468f', color: '#fff', padding: '0 12px' }}>
                {label}小说列表
              </div>
              <div className="blockcontent">
                <table className="grid" style={{ border: '1px solid #E4E4E4', margin: '10px', width: 'calc(100% - 20px)', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#F2F2F2' }}>
                      <th style={{ borderBottom: '1px dotted #E4E4E4', padding: '6px 8px', textAlign: 'left', color: '#333', fontWeight: 700 }}>类别</th>
                      <th style={{ borderBottom: '1px dotted #E4E4E4', padding: '6px 8px', textAlign: 'left', color: '#333', fontWeight: 700 }}>书名 / 最新章节</th>
                      <th style={{ borderBottom: '1px dotted #E4E4E4', padding: '6px 8px', textAlign: 'left', color: '#333', fontWeight: 700 }}>作者</th>
                      <th style={{ borderBottom: '1px dotted #E4E4E4', padding: '6px 8px', textAlign: 'right', color: '#333', fontWeight: 700 }}>更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {books.map((b) => (
                      <tr key={b.id}>
                        <td style={{ borderBottom: '1px dotted #E4E4E4', padding: '6px 8px', whiteSpace: 'nowrap' }}>
                          <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'category', cat: b.categoryId || '' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>[{b.category}]</a>
                        </td>
                        <td style={{ borderBottom: '1px dotted #E4E4E4', padding: '6px 8px' }}>
                          <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} target="_blank" style={{ color: '#2f468f', textDecoration: 'none', fontWeight: 700 }}>
                            《{b.name}》
                          </a>
                          <span style={{ color: '#888', marginLeft: 6 }}>{b.latestChapter || '暂无章节'}</span>
                        </td>
                        <td style={{ borderBottom: '1px dotted #E4E4E4', padding: '6px 8px', color: '#888', whiteSpace: 'nowrap' }}>{b.author}</td>
                        <td style={{ borderBottom: '1px dotted #E4E4E4', padding: '6px 8px', textAlign: 'right', color: '#888', whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* 分页 .pagelink */}
                {total > size && (
                  <div className="pagelink" style={{ border: '1px solid #E4E4E4', float: 'right', background: '#F2F2F2', margin: '0 10px 10px', display: 'flex', alignItems: 'center', clear: 'both' }}>
                    {page > 1 && (
                      <a href="#" onClick={(e) => { e.preventDefault(); onPage(page - 1) }} style={{ float: 'left', display: 'inline', padding: '0 6px', color: '#2f468f', textDecoration: 'none', height: 30, lineHeight: '30px' }}>上一页</a>
                    )}
                    <strong style={{ float: 'left', display: 'inline', padding: '0 6px', fontWeight: 700, color: '#ff6600', background: '#F2F2F2', height: 30, lineHeight: '30px' }}>{page}</strong>
                    <span style={{ float: 'left', display: 'inline', padding: '0 6px', color: '#666', height: 30, lineHeight: '30px' }}>/ {Math.ceil(total / size)} 页</span>
                    {page * size < total && (
                      <a href="#" onClick={(e) => { e.preventDefault(); onPage(page + 1) }} style={{ float: 'left', display: 'inline', padding: '0 6px', color: '#2f468f', textDecoration: 'none', height: 30, lineHeight: '30px' }}>下一页</a>
                    )}
                  </div>
                )}
                <div className="cl" style={{ clear: 'both' }} />
              </div>
            </div>
          </div>

          {/* #right 分类侧栏 */}
          <div id="right" style={{ flex: '0 0 190px', minWidth: 160 }}>
            <div className="block" style={{ border: '1px solid #E4E4E4', marginTop: 8 }}>
              <div className="blocktitle" style={{ height: 40, lineHeight: '40px', fontSize: 14, background: '#2f468f', color: '#fff', padding: '0 12px' }}>小说分类</div>
              <div className="blockcontent">
                <ul className="ultop" style={{ lineHeight: '25px', padding: 5, listStyle: 'decimal inside', margin: 0 }}>
                  {SIDE_CATS.map((c) => (
                    <li key={c} style={{ borderBottom: '1px dotted #F2F2F2', padding: '0 3px', fontSize: 12 }}>
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>
                        {c}{c === label ? ' ←' : ''}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 源站 .main.footer */}
      <div className="main footer" style={{ width: 960, maxWidth: '100%', margin: '8px auto 0', background: '#f7faff', border: '1px solid #E4E4E4' }}>
        <div className="ftc" style={{ padding: '10px 12px', lineHeight: '22px', textAlign: 'center', fontSize: 12, color: '#666' }}>
          Copyright © {new Date().getFullYear()} <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>{site.name}</a>({site.domain}) · 共 {formatWords(total)} 本
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
        </div>
      </div>
    </div>
  )
}
