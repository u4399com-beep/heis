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
        </div>
      </div>
    </div>
  )
}
