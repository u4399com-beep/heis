<<<<<<< HEAD
// ============================================================
// clone-themes/ddyueshu BookInfo — 得得小说书籍详情页 1:1 克隆
// 实测 biquge.css 模板 (#info h1 + .bookinfo + #fmimg + #intro + #list):
//   <div class="box_con">
//     <div class="con_top">您当前的位置: <a>首页</a> &gt; <a>书名</a></div>
//     <div id="sidebar"><div id="fmimg"><img/></div></div>
//     <div id="maininfo">
//       <div id="info"><h1>书名</h1><p>作者: ...</p>...</div>
//       <div id="intro">简介...</div>
//       <div id="list">章节列表</div>
//     </div>
//   </div>
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { ReadFirstButton } from '../../BookCard'
import { ShareMenu } from '../../ShareMenu'
import { StatusBadge } from '../../bits'
import { fmtDate, formatWords } from '../../seo'
import type { BookInfoProps } from '../shared-props'

const FONT_STACK = '"宋体", "SimSun", "Microsoft YaHei", Arial, sans-serif'
const INK = '#555555'
const LINK = '#6F78A7'
const HEAD_H2 = '#E1ECED'
const CARD_BG = '#FEF9EF'
const BORDER_NEWS = '#88C6E5'
const BORDER = '#A6D3E8'

export function BookInfo({ book, savedPos, firstChapterId, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK }} className="box_con" data-clone-ddyueshu-book>
      <div className="box_con" style={{ border: `2px solid ${BORDER_NEWS}`, overflow: 'hidden', width: '100%', maxWidth: '976px', margin: '2px auto', background: CARD_BG }}>
        <div className="con_top" style={{ borderBottom: `1px solid ${BORDER_NEWS}`, padding: '0 10px', lineHeight: '40px', height: '40px', background: HEAD_H2, fontSize: '12px' }}>
          您当前的位置：<a href="/" style={{ color: LINK, textDecoration: 'none' }}>首页</a> &gt; <a href={`/?view=book&id=${book.id}`} style={{ color: LINK, textDecoration: 'none' }}>{book.name}</a>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          <div id="sidebar" style={{ float: 'left', width: '140px', textAlign: 'left', padding: '12px' }}>
            <div id="fmimg" style={{ background: HEAD_H2, float: 'left', width: '126px', margin: 0, padding: '12px', position: 'relative' }}>
              <BookCover name={book.name} cover={book.cover} className="book-cover" />
            </div>
          </div>
          <div id="maininfo" style={{ float: 'right', width: '760px', flex: 1, minWidth: 320, padding: '12px' }}>
            <div id="info" style={{ padding: '10px', margin: 0, fontSize: '15px' }}>
              <h1 style={{ fontFamily: FONT_STACK, fontSize: '28px', fontWeight: 700, overflow: 'hidden', margin: 0, padding: '1px' }}>{book.name}</h1>
              <p style={{ height: '25px', lineHeight: '25px', padding: '2px 0 0', width: '350px', overflow: 'hidden', float: 'left', margin: 0 }}>
                作者：<a href={`/?view=search&q=${encodeURIComponent(book.author)}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }} style={{ color: LINK, textDecoration: 'none' }}>{book.author}</a>
              </p>
              <p style={{ height: '25px', lineHeight: '25px', padding: '2px 0 0', width: '350px', overflow: 'hidden', float: 'left', margin: 0 }}>
                分类：{book.categoryId ? <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: LINK, fontSize: '15px' }}>{book.category}</button> : <span style={{ color: LINK }}>{book.category}</span>}
              </p>
              <p style={{ height: '25px', lineHeight: '25px', padding: '2px 0 0', width: '350px', overflow: 'hidden', float: 'left', margin: 0 }}>
                字数：{formatWords(book.wordCount)}
              </p>
              <p style={{ height: '25px', lineHeight: '25px', padding: '2px 0 0', width: '350px', overflow: 'hidden', float: 'left', margin: 0 }}>
                状态：<StatusBadge status={book.status} small />
              </p>
              <p style={{ height: '25px', lineHeight: '25px', padding: '2px 0 0', width: '350px', overflow: 'hidden', float: 'left', margin: 0 }}>
                更新：{fmtDate(book.updatedAt) || '未知'}
              </p>
              <div style={{ clear: 'both' }} />
              <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
                {savedPos?.chapterId && (
                  <button type="button" onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })} style={{ padding: '6px 12px', border: `1px solid ${LINK}`, color: LINK, background: 'transparent', cursor: 'pointer', fontSize: '14px' }}>
                    继续阅读 {savedPos.title ? `· ${savedPos.title}` : ''}
                  </button>
                )}
                <button type="button" onClick={onScrollToc} style={{ padding: '6px 12px', border: `1px solid ${BORDER}`, color: INK, background: CARD_BG, cursor: 'pointer', fontSize: '14px' }}>查看目录</button>
                <a href={`/api/public/download?book=${book.id}`} style={{ padding: '6px 12px', border: `1px solid ${LINK}`, color: LINK, background: 'transparent', textDecoration: 'none', fontSize: '14px' }}>TXT 下载</a>
                <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
              </div>
            </div>
            <div id="intro" style={{ width: '96%', overflow: 'hidden', lineHeight: '150%', borderTop: '1px dashed #88C6E5', padding: '10px', fontSize: '13px', clear: 'both' }}>
              <p style={{ textIndent: '2em', margin: '5px 0 0' }}>{book.intro || '暂无简介'}</p>
            </div>
            <div id="list" style={{ padding: '2px', marginTop: '12px' }}>
              <div style={{ padding: '5px 10px', background: BORDER, color: INK, fontSize: '14px', marginBottom: '5px' }}><b>最新章节</b></div>
              <div style={{ padding: '0 10px', color: LINK }}>
                {book.latestChapter ? (
                  <a href="javascript:;" onClick={onScrollToc} style={{ color: LINK, textDecoration: 'none' }}>{book.latestChapter}</a>
                ) : '暂无最新章节'}
              </div>
=======
'use client'
// ddyueshu.cc 书籍详情页 1:1 克隆 — biquge.css 模板
// 源站 DOM: .box_con > .con_top > #sidebar + #maininfo(#fmimg + #info h1 + p) + #intro + #list
// 实测颜色: nav bg #88C6E5 / .l bg #FEF9EF / a #6F78A7 / #info h1 28px
import type { BookInfoProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate, statusLabel } from '../../seo'
import { BookCover } from '../../BookCover'

export function BookInfo({ book, firstChapterId, onScrollToc }: BookInfoProps) {
  const { navigate } = usePublic()
  if (!book) return null

  return (
    <div className="box_con" style={{ width: 980, maxWidth: '100%', margin: '0 auto', padding: '0 14px', background: '#E9FAFF', color: '#555', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12 }}>
      <div className="con_top" style={{ borderBottom: '1px solid #88C6E5', textAlign: 'left', padding: '0 10px', lineHeight: '40px', height: 40, background: '#E1ECED', color: '#555' }}>
        <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#6F78A7', textDecoration: 'none' }}>{'>'} {book.category}</a>
        <span style={{ color: '#B3B3B3' }}>&nbsp;&gt;&nbsp;{book.name}</span>
      </div>

      <div style={{ display: 'flex', gap: 24, padding: '16px 0', flexWrap: 'wrap' }}>
        {/* 源站 #sidebar — 左侧分类侧栏 */}
        <div id="sidebar" style={{ flex: '0 0 140px', textAlign: 'left', fontSize: 13 }}>
          <div style={{ background: '#FEF9EF', border: '1px solid #C3DFEA', borderRadius: 4, padding: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: '#1f6cb2', borderBottom: '1px dashed #A6D3E8', paddingBottom: 6 }}>本书信息</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: '24px' }}>
              <li>类别：{book.category}</li>
              <li>作者：{book.author}</li>
              <li>状态：{statusLabel(book.status)}</li>
              <li>字数：{formatWords(book.wordCount)}</li>
              <li>更新：{fmtDate(book.updatedAt) || '—'}</li>
            </ul>
          </div>
        </div>

        {/* 源站 #maininfo — 右侧主信息区 */}
        <div id="maininfo" style={{ flex: '1 1 400px', minWidth: 0, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {/* 源站 #fmimg — 封面 */}
          <div id="fmimg" style={{ flex: '0 0 120px', background: '#E1ECED', padding: 12, position: 'relative', borderRadius: 2 }}>
            <div style={{ width: 120, height: 150, border: '1px solid #DDD', background: '#fff', padding: 1 }}>
              <BookCover name={book.name} cover={book.cover} className="w-full h-full" style={{ borderRadius: 0 }} />
            </div>
          </div>

          {/* 源站 #info — 标题 + meta 行 */}
          <div id="info" style={{ flex: '1 1 280px', minWidth: 0, padding: '10px 0', fontSize: 15 }}>
            <h1 style={{ fontFamily: '"宋体"', fontSize: 28, fontWeight: 700, overflow: 'hidden', margin: 0, padding: '1px 0', color: '#333', lineHeight: 1.4 }}>
              {book.name}
            </h1>
            <p style={{ height: 25, lineHeight: '25px', paddingTop: 2, margin: 0, overflow: 'hidden', color: '#555' }}>
              作者：<a href="#" style={{ color: '#6F78A7', textDecoration: 'none' }}>{book.author}</a>
            </p>
            <p style={{ height: 25, lineHeight: '25px', paddingTop: 2, margin: 0, overflow: 'hidden', color: '#555' }}>
              分类：<span style={{ color: '#1f6cb2' }}>{book.category}</span>
            </p>
            <p style={{ height: 25, lineHeight: '25px', paddingTop: 2, margin: 0, overflow: 'hidden', color: '#555' }}>
              状态：<span style={{ color: '#e15a00' }}>{statusLabel(book.status)}</span>
              <span style={{ color: '#B3B3B3', marginLeft: 12 }}>字数：{formatWords(book.wordCount)}</span>
            </p>
            <p style={{ height: 25, lineHeight: '25px', paddingTop: 2, margin: 0, overflow: 'hidden', color: '#555' }}>
              更新时间：{fmtDate(book.updatedAt) || '—'}
            </p>
            <p style={{ height: 25, lineHeight: '25px', paddingTop: 2, margin: 0, overflow: 'hidden', color: '#555' }}>
              最新章节：<a href="#" style={{ color: '#6F78A7', textDecoration: 'none' }}>{book.latestChapter || '暂无'}</a>
            </p>

            {/* 行动按钮 */}
            <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {firstChapterId && (
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); navigate({ view: 'read', bookId: book.id, chapterId: firstChapterId }) }}
                  style={{ display: 'inline-block', padding: '8px 24px', background: '#1f6cb2', color: '#fff', borderRadius: 4, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}
                >
                  开始阅读
                </a>
              )}
              <button
                type="button"
                onClick={onScrollToc}
                style={{ padding: '8px 20px', background: '#fff', color: '#1f6cb2', border: '1px solid #88C6E5', borderRadius: 4, fontSize: 14, cursor: 'pointer' }}
              >
                章节目录
              </button>
              <a
                href={`/api/public/download?book=${book.id}`}
                style={{ padding: '8px 20px', background: '#fff', color: '#e15a00', border: '1px solid #fda85a', borderRadius: 4, fontSize: 14, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                TXT 下载
              </a>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
            </div>
          </div>
        </div>
      </div>
<<<<<<< HEAD
=======

      {/* 源站 #intro — 内容简介 */}
      <div id="intro" style={{ width: '96%', overflow: 'hidden', lineHeight: 1.5, borderTop: '1px dashed #88C6E5', padding: 10, fontSize: 13, background: '#FEF9EF', border: '1px solid #C3DFEA', borderRadius: 4, margin: '12px 0' }}>
        <strong style={{ color: '#1f6cb2' }}>内容简介：</strong>
        <p style={{ textIndent: '2em', marginTop: 8, color: '#555', margin: '8px 0 0' }}>
          {book.intro || '暂无简介'}
        </p>
      </div>

      {/* 源站 #list dt — 章节目录入口 */}
      <div id="list" style={{ padding: '8px 0' }}>
        <dl style={{ margin: 0 }}>
          <dt style={{ background: '#C3DFEA', display: 'inline-block', fontSize: 14, lineHeight: '28px', textAlign: 'center', padding: '5px 10px', width: '98%', marginBottom: 5, color: '#1f6cb2', fontWeight: 700 }}>
            章节目录
          </dt>
          <dd style={{ textAlign: 'center', padding: '6px 0', color: '#888' }}>
            <button onClick={onScrollToc} style={{ background: 'transparent', border: 'none', color: '#1f6cb2', cursor: 'pointer', fontSize: 13, padding: '6px 16px' }}>
              点击查看完整章节列表 →
            </button>
          </dd>
        </dl>
      </div>
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
    </div>
  )
}
