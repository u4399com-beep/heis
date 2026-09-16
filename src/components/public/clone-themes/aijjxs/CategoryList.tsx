// ============================================================
// clone-themes/aijjxs CategoryList — 久久小说分类页 1:1 克隆
// 实测 probe-html2/probe-aijjxs-category.html:
//   <div class="articleInfo"><h1>言情小说电子书下载</h1></div>
//   <div class="body filters">分类/排序/字数/时间筛选</div>
//   <div class="catalog"><div class="listbg">封面+书名+作者+简介+meta</div>...</div>
//   <div class="body"><div class="pager">总数+页码+上下页</div></div>
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { CategoryListProps } from '../shared-props'

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#e5dccd'
const BRAND = '#0f766e'
const BRAND_DARK = '#115e59'
const PAPER = '#fffdf8'
const SHADOW = '0 10px 30px rgba(17, 24, 39, 0.08)'
const RADIUS = '14px'

const FILTER_ROWS = [
  { label: '排序', items: [{ name: '最新上传', on: true }, { name: '人气最高' }, { name: '收藏最多' }, { name: '只看推荐' }] },
  { label: '大小', items: [{ name: '大小不限', on: true }, { name: '500Kb以下' }, { name: '500Kb-1M' }, { name: '1M-2M' }, { name: '大于2M' }] },
  { label: '时间', items: [{ name: '时间不限', on: true }, { name: '一周内' }, { name: '一月内' }, { name: '半年内' }, { name: '一年内' }] },
]

export function CategoryList({ books, loading, label, page, total, onPage }: CategoryListProps) {
  const { navigate } = usePublic()
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, color: INK }}>
        <div style={{ padding: '24px', textAlign: 'center', color: MUTED }}>加载中...</div>
      </div>
    )
  }
  if (!books.length) {
    return <div style={{ fontFamily: FONT_STACK, color: MUTED, padding: '24px', textAlign: 'center' }}>没有找到相关书籍</div>
  }
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }}>
      <div className="articleInfo" style={{ marginBottom: '14px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: INK, margin: 0 }}>{label}电子书下载</h1>
      </div>
      <div className="body filters" style={{ padding: '8px 0', marginBottom: '8px' }}>
        {FILTER_ROWS.map((r) => (
          <div key={r.label} className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
            {r.items.map((it) => (
              <a key={it.name} href="javascript:;" style={{ border: `1px solid ${LINE}`, borderRadius: '999px', padding: '5px 10px', fontSize: '13px', background: it.on ? BRAND : '#fff', color: it.on ? '#fff' : INK, textDecoration: 'none' }}>{it.name}</a>
            ))}
          </div>
        ))}
      </div>
      <div className="catalog">
        {books.map((b) => (
          <div key={b.id} className="listbg" style={{ marginBottom: '14px', padding: '14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW, display: 'flex', gap: '14px' }}>
            <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} title={b.name} className="img" style={{ flexShrink: 0 }}>
              <BookCover name={b.name} cover={b.cover} className="book-cover" />
            </a>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="title" style={{ display: 'block', marginBottom: '4px' }}>
                <a href={`/?view=book&id=${b.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} title={b.name} style={{ color: INK, fontSize: '16px', fontWeight: 700, textDecoration: 'none' }}>{b.name}</a>
              </span>
              <span className="new" style={{ display: 'block', marginBottom: '6px', color: MUTED, fontSize: '12px' }}><span className="oldDate" style={{ color: '#9a3412' }}>{fmtDate(b.updatedAt) || '今天'}</span>上传</span>
              <div style={{ color: MUTED, fontSize: '13px', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{b.intro}</div>
              <div style={{ marginTop: '8px' }}>
                <span className="mainGreen" style={{ color: BRAND_DARK, fontSize: '13px' }}>
                  <small style={{ color: MUTED }}>书籍类别：</small>{b.category}
                  <small style={{ color: MUTED, marginLeft: '8px' }}>文件大小：</small>{formatWords(b.wordCount)}
                  <small style={{ color: MUTED, marginLeft: '8px' }}>写作进度：</small><StatusBadge status={b.status} small />
                  <small style={{ color: MUTED, marginLeft: '8px' }}>下载方式：</small>全本免费
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="body" style={{ padding: '12px 0' }}>
        <div className="pager" style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {page > 1 && <a href="javascript:;" onClick={() => onPage(page - 1)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '34px', borderRadius: '8px', border: `1px solid ${LINE}`, background: '#fff', padding: '4px 8px', height: '30px', textDecoration: 'none', color: INK }}>上一页</a>}
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '34px', borderRadius: '8px', border: `1px solid ${BRAND}`, background: BRAND, color: '#fff', padding: '5px 9px', height: '30px', fontWeight: 700 }}>{page}</span>
          <a href="javascript:;" onClick={() => onPage(page + 1)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '34px', borderRadius: '8px', border: `1px solid ${LINE}`, background: '#fff', padding: '4px 8px', height: '30px', textDecoration: 'none', color: INK }}>下一页</a>
          <span style={{ display: 'inline-flex', alignItems: 'center', color: MUTED, fontSize: '12px', padding: '0 8px' }}>共 {total} 本</span>
        </div>
      </div>
    </div>
  )
}
