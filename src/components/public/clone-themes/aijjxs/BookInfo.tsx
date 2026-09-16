<<<<<<< HEAD
// ============================================================
// clone-themes/aijjxs BookInfo — 久久小说书籍详情页 1:1 克隆
// 实测 probe-html2/probe-aijjxs-book.html:
//   <article class="panel"><h3>《书名》</h3><div class="body detail">
//     <div class="pic"><img/><a class="copy-btn">加入收藏</a></div>
//     <div class="kv"><p><strong>书籍作者：</strong>...<p>...</div>
//   </div></article>
//   <article class="panel intro-panel"><h3>内容简介</h3><div class="body"><div class="desc">...</div></div></article>
//   <article class="panel"><h3>下载与说明</h3><div class="body"><a class="download-btn">...</a></div></article>
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#e5dccd'
const BRAND = '#0f766e'
const BRAND_DARK = '#115e59'
const ACCENT = '#b45309'
const PAPER = '#fffdf8'
const SHADOW = '0 10px 30px rgba(17, 24, 39, 0.08)'
const RADIUS = '14px'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <section style={{ fontFamily: FONT_STACK }} aria-label="书籍信息" data-clone-aijjxs-book>
      <article className="panel" style={{ border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW }}>
        <h3 style={{ margin: 0, borderBottom: '1px solid rgba(255,214,224,0.28)', fontSize: '18px', color: INK, padding: '10px 14px' }}>
          《{book.name}》
        </h3>
        <div className="body detail" style={{ padding: '12px 14px', display: 'grid', gridTemplateColumns: '122px minmax(0,1fr)', gap: '14px', alignItems: 'start' }}>
          <div className="pic" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '7px' }}>
            <BookCover name={book.name} cover={book.cover} className="book-cover" />
            <a className="copy-btn" href="javascript:;" style={{ fontSize: '12px', color: BRAND_DARK, padding: '4px 8px', border: `1px solid ${LINE}`, borderRadius: '6px', textDecoration: 'none' }}>加入收藏</a>
          </div>
          <div className="kv" style={{ minWidth: 0 }}>
            <p style={{ margin: '0 0 4px 4px', fontSize: '14px', color: INK }}>
              <strong style={{ color: MUTED }}>书籍作者：</strong>
              <a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: BRAND_DARK, textDecoration: 'none' }}>{book.author}</a>
            </p>
            <p style={{ margin: '0 0 4px 4px', fontSize: '14px', color: INK }}>
              <strong style={{ color: MUTED }}>书籍分类：</strong>
              {book.categoryId ? (
                <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: ACCENT, fontSize: '14px' }}>{book.category}</button>
              ) : <span style={{ color: ACCENT }}>{book.category}</span>}
            </p>
            <p style={{ margin: '0 0 4px 4px', fontSize: '14px', color: INK }}>
              <strong style={{ color: MUTED }}>书籍大小：</strong>{formatWords(book.wordCount)}
            </p>
            <p style={{ margin: '0 0 4px 4px', fontSize: '14px', color: INK }}>
              <strong style={{ color: MUTED }}>写作进度：</strong><span className="sfwj" style={{ background: '#09B295', borderRadius: '9px', color: '#fff', padding: '1px 8px 3px 6px' }}><StatusBadge status={book.status} small /></span>
            </p>
            <p style={{ margin: '0 0 4px 4px', fontSize: '14px', color: INK }}>
              <strong style={{ color: MUTED }}>上传时间：</strong>{fmtDate(book.updatedAt) || ''}
            </p>
            <p style={{ margin: '0 0 4px 4px', fontSize: '14px', color: INK }}>
              <strong style={{ color: MUTED }}>下载方式：</strong>全本免费
            </p>
          </div>
        </div>
      </article>

      <article className="panel intro-panel" style={{ marginTop: '14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW }}>
        <h3 style={{ margin: 0, borderBottom: '1px solid rgba(255,214,224,0.28)', fontSize: '18px', color: INK, padding: '10px 14px' }}>内容简介</h3>
        <div className="body" style={{ padding: '12px 14px' }}>
          <div className="desc" style={{ fontSize: '15px', color: INK, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {book.intro || '暂无简介'}
          </div>
        </div>
      </article>

      <article className="panel" style={{ marginTop: '14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW }}>
        <h3 style={{ margin: 0, borderBottom: '1px solid rgba(255,214,224,0.28)', fontSize: '18px', color: INK, padding: '10px 14px' }}>下载与说明</h3>
        <div className="body" style={{ padding: '12px 14px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
            {savedPos?.chapterId && (
              <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '11px 16px', borderRadius: '12px', border: `1px solid ${BRAND}`, color: BRAND, background: 'transparent', cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>
                继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
              </button>
            )}
            <button type="button" onClick={onScrollToc} style={{ padding: '11px 16px', borderRadius: '12px', border: `1px solid ${LINE}`, color: INK, background: PAPER, cursor: 'pointer', fontSize: '14px', fontWeight: 700 }}>目录</button>
            <a href={`/api/public/download?book=${book.id}`} style={{ padding: '11px 16px', borderRadius: '12px', border: `1px solid ${ACCENT}80`, color: ACCENT, background: PAPER, textDecoration: 'none', fontSize: '14px', fontWeight: 700 }}>TXT 下载</a>
            <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
          </div>
          <div className="tips" style={{ position: 'relative', marginTop: '12px', padding: '12px 14px 12px 44px', border: '2px dashed #efd3bb', borderRadius: '10px', background: 'linear-gradient(180deg,#fffdf9 0%,#fff8f1 100%)', color: '#8b4a22', fontSize: '13px', lineHeight: 1.8 }}>
            只有会员才可以下载电子书，不想注册账号可以在线阅读TXT全文内容。
          </div>
        </div>
      </article>
    </section>
=======
'use client'
// aijjxs.com 书籍详情页 1:1 克隆
import type { BookInfoProps } from '../shared'
export function BookInfo({ book }: BookInfoProps) {
  if (!book) return null
  return (
    <div className="wrap" style={{ maxWidth: 1220, margin: '0 auto', padding: '18px 14px 36px' }}>
      <article className="panel" style={{ background: 'rgba(255,253,248,.9)', border: '1px solid #e5dccd', borderRadius: 14, padding: 24 }}>
        <h3 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', margin: '0 0 16px' }}>《{book.name}》</h3>
        <div className="kv" style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
          <div className="pic" style={{ width: 120, height: 160, overflow: 'hidden', borderRadius: 8, border: '1px solid #e5dccd' }}>
            {book.cover && <img src={book.cover} alt={book.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
          </div>
          <div style={{ flex: 1, fontSize: 14, color: '#1f2937', lineHeight: 2 }}>
            <p><strong>书籍作者：</strong>{book.author}</p>
            <p><strong>书籍分类：</strong><span style={{ color: '#b45309' }}>{book.category}</span></p>
            <p><strong>写作进度：</strong>{book.status === 'completed' ? '已完结' : book.status === 'ongoing' ? '连载中' : '未知'}</p>
            <p><strong>字数：</strong>{(book.wordCount / 10000).toFixed(1)}万字</p>
            <p><strong>最新章节：</strong>{book.latestChapter || '暂无'}</p>
          </div>
        </div>
        <div className="desc" style={{ padding: '12px 0', borderTop: '1px dashed #e5dccd', fontSize: 14, color: '#6b7280', lineHeight: 1.8 }}>
          <strong style={{ color: '#1f2937' }}>内容简介：</strong><br />
          {book.intro || '暂无简介'}
        </div>
      </article>
    </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
  )
}
