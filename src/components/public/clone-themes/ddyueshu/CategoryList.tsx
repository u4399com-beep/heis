<<<<<<< HEAD
// ============================================================
// clone-themes/ddyueshu CategoryList — 得得小说分类页 1:1 克隆
// 实测 biquge.css 模板: novellist 排版 (h2 + ul 网格)
//   .novellist { margin:10px auto; width:968px; padding:3px; }
//   .novellist h2 { background:#F6F8FE; border-bottom:1px solid #DDD; height:30px; line-height:30px; font-size:14px; }
//   .novellist ul { padding:10px; }
//   .novellist li { float:left; width:20%; height:25px; line-height:25px; border-bottom:1px solid #DDD; }
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '"宋体", "SimSun", "Microsoft YaHei", Arial, sans-serif'
const INK = '#555555'
const MUTED = '#B3B3B3'
const LINK = '#6F78A7'
const HEAD_H2 = '#E1ECED'
const CARD_BG = '#FEF9EF'
const BORDER = '#A6D3E8'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }}>
      <div className="novellist" style={{ margin: '10px auto', width: '100%', maxWidth: '968px', padding: '3px' }}>
        <h2 style={{ background: '#F6F8FE', borderBottom: '1px solid #DDD', height: '30px', lineHeight: '30px', fontSize: '14px', fontWeight: 'bold', padding: '0 0 0 10px', overflow: 'hidden', margin: 0 }}>{label}列表</h2>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>加载中...</div>
        ) : !books.length ? (
          <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>没有找到相关书籍</div>
        ) : (
          <ul style={{ padding: '10px', margin: 0, listStyle: 'none' }}>
            {books.map((b) => (
              <li key={b.id} style={{ float: 'left', color: MUTED, padding: '5px 0 0', borderBottom: '1px solid #DDD', height: '25px', width: '20%', lineHeight: '25px', overflow: 'hidden', display: 'inline-block' }}>
                <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: LINK, textDecoration: 'none' }}>{b.name}</a>
                <span style={{ color: MUTED, marginLeft: '4px' }}>/ {b.author}</span>
              </li>
            ))}
            <li style={{ clear: 'both' }} />
          </ul>
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '12px 0' }}>
        {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '4px 10px', border: `1px solid ${BORDER}`, background: CARD_BG, color: INK, textDecoration: 'none' }}>上一页</a>}
        <span style={{ padding: '4px 10px', background: HEAD_H2, color: INK }}>{page}</span>
        <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '4px 10px', border: `1px solid ${BORDER}`, background: CARD_BG, color: INK, textDecoration: 'none' }}>下一页</a>
        <span style={{ padding: '4px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
      </div>
=======
'use client'
// ddyueshu.cc 分类列表页 1:1 克隆 — biquge.css 模板
// 源站 DOM: .box_con > .con_top + table.grid + 分页
import type { CategoryListProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'

export function CategoryList({ books, loading, label, page, total, size = 24, onPage }: CategoryListProps) {
  const { navigate } = usePublic()

  if (loading) {
    return (
      <div className="box_con" style={{ width: 980, maxWidth: '100%', margin: '70px auto 16px', padding: '0 14px', background: '#E9FAFF', color: '#555', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12 }}>
        <div style={{ background: '#FEF9EF', border: '3px solid #C3DFEA', borderRadius: 4, padding: 40, textAlign: 'center', color: '#888' }}>
          加载中...
        </div>
      </div>
    )
  }
  if (!books.length) {
    return (
      <div className="box_con" style={{ width: 980, maxWidth: '100%', margin: '70px auto 16px', padding: '0 14px', background: '#E9FAFF', color: '#555', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12 }}>
        <div style={{ background: '#FEF9EF', border: '3px solid #C3DFEA', borderRadius: 4, padding: 40, textAlign: 'center', color: '#888' }}>
          没有找到相关小说
        </div>
      </div>
    )
  }

  return (
    <div className="box_con" style={{ width: 980, maxWidth: '100%', margin: '70px auto 16px', padding: '0 14px', background: '#E9FAFF', color: '#555', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12 }}>
      <div className="con_top" style={{ borderBottom: '1px solid #88C6E5', textAlign: 'left', padding: '0 10px', lineHeight: '40px', height: 40, background: '#E1ECED', marginBottom: 10 }}>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#6F78A7', textDecoration: 'none' }}>{'>'} 首页</a>
        <span style={{ color: '#B3B3B3' }}>&nbsp;&gt;&nbsp;{label}</span>
      </div>

      {/* 源站 table.grid caption */}
      <table className="grid" style={{ border: '2px solid #C3DFEA', borderCollapse: 'collapse', margin: '0 auto 12px', padding: 3, width: '100%' }}>
        <caption style={{ background: '#E1ECED', border: '2px solid #C3DFEA', borderBottom: 0, fontSize: 14, fontWeight: 700, padding: '5px 0', textAlign: 'center', verticalAlign: 'middle', color: '#1f6cb2' }}>
          {label}小说列表
        </caption>
        <thead>
          <tr style={{ background: '#F6F8FE', borderBottom: '1px solid #DDDDDD', fontSize: 14, fontWeight: 700 }}>
            <th style={{ padding: '6px 8px', textAlign: 'left', width: 80, color: '#555' }}>类别</th>
            <th style={{ padding: '6px 8px', textAlign: 'left', color: '#555' }}>书名 / 最新章节</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', width: 80, color: '#555' }}>作者</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', width: 80, color: '#555' }}>字数</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', width: 80, color: '#555' }}>更新</th>
          </tr>
        </thead>
        <tbody>
          {books.map((b) => (
            <tr key={b.id} style={{ borderTop: '1px solid #C3DFEA' }}>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4, whiteSpace: 'nowrap' }}>
                <span style={{ color: '#1f6cb2', fontSize: 12 }}>[{b.category}]</span>
              </td>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4 }}>
                <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#6F78A7', textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>
                  {b.name}
                </a>
                <span style={{ color: '#B3B3B3', marginLeft: 8, fontSize: 12 }}>{b.latestChapter || '暂无章节'}</span>
              </td>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4, textAlign: 'right', color: '#B3B3B3', fontSize: 12, whiteSpace: 'nowrap' }}>{b.author}</td>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4, textAlign: 'right', color: '#555', fontSize: 12, whiteSpace: 'nowrap' }}>{formatWords(b.wordCount)}</td>
              <td style={{ background: '#FFFFFF !important', border: '1px solid #C3DFEA', padding: 4, textAlign: 'right', color: '#B3B3B3', fontSize: 12, whiteSpace: 'nowrap' }}>{b.updatedAt ? fmtDate(b.updatedAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {total > size && (
        <div className="bottem1" style={{ clear: 'both', textAlign: 'center', margin: '8px 5px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          {page > 1 && (
            <button onClick={() => onPage(page - 1)} style={{ padding: '6px 16px', border: '1px solid #88C6E5', borderRadius: 4, background: '#fff', color: '#1f6cb2', cursor: 'pointer', fontSize: 13 }}>
              上一页
            </button>
          )}
          <span style={{ padding: '6px 12px', color: '#888', fontSize: 13 }}>第 {page} 页 / 共 {Math.ceil(total / size)} 页</span>
          {page * size < total && (
            <button onClick={() => onPage(page + 1)} style={{ padding: '6px 16px', border: '1px solid #88C6E5', borderRadius: 4, background: '#1f6cb2', color: '#fff', cursor: 'pointer', fontSize: 13 }}>
              下一页
            </button>
          )}
        </div>
      )}
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
    </div>
  )
}
