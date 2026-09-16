// ============================================================
// clone-themes/pilishuwu CategoryList — 霹雳书屋分类页 1:1 克隆
// 实测 probe-html2/probe-pilishuwu-category.html (wmcms-web 模板):
//   .sort .warp .sub_sort_title (h1 + 筛选)
//   .bk-list (左封面 + 右书名/作者/简介)
//   .page 分页
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { StatusBadge } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif'
const INK = '#333333'
const MUTED = '#888888'
const PRIMARY = '#fd8929'
const BORDER = '#ffe4c4'

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }}>
      <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: '2px', padding: '14px', marginBottom: '14px' }}>
        <h1 style={{ margin: '0 0 10px', fontSize: '22px', fontWeight: 700, color: INK }}>{label}</h1>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['全部', '玄幻', '武侠', '都市', '历史', '科幻', '游戏', '女生'].map((n, i) => (
            <a key={n} href="javascript:;" style={{ padding: '4px 10px', fontSize: '13px', border: `1px solid ${BORDER}`, borderRadius: '2px', background: i === 0 ? PRIMARY : '#fff', color: i === 0 ? '#fff' : INK, textDecoration: 'none' }}>{n}</a>
          ))}
        </div>
      </div>
      <div className="bk-list">
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>加载中...</div>
        ) : !books.length ? (
          <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>没有找到相关书籍</div>
        ) : (
          books.map((b) => (
            <div key={b.id} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: '2px', padding: '12px', marginBottom: '10px', display: 'flex', gap: '12px' }}>
              <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ flexShrink: 0 }}>
                <BookCover name={b.name} cover={b.cover} className="book-cover" />
              </a>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: 700 }}>
                  <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: INK, textDecoration: 'none' }}>{b.name}</a>
                </h3>
                <p style={{ margin: '2px 0', fontSize: '12px', color: MUTED }}>{b.author} · {b.category} · {formatWords(b.wordCount)} · <StatusBadge status={b.status} small /></p>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: MUTED, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.intro}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', padding: '12px 0' }}>
        {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', fontSize: '13px' }}>上一页</a>}
        <span style={{ padding: '4px 12px', background: PRIMARY, color: '#fff' }}>{page}</span>
        <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, background: '#fff', color: INK, textDecoration: 'none', fontSize: '13px' }}>下一页</a>
        <span style={{ padding: '4px 10px', color: MUTED, fontSize: '12px' }}>共 {total} 本</span>
      </div>
    </div>
  )
}
