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
    </div>
  )
}
