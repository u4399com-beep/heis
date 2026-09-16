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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
