// ============================================================
// clone-themes/x2552 — 吾爱文学 x2552.com 1:1 真克隆
// 实测 probe-html2/probe-x2552.{html,css} (heibing 模板, GBK 编码, 10.7KB CSS)
// 硬编码源站实际 CSS 变量值 (不用 theme.vars):
//   * { margin:0; padding:0; list-style:none; }
//   a, a:visited { color:#2f468f; text-decoration:none; }
//   a:hover { color:#ff6600; left:1px; position:relative; top:1px; }
//   body { color:#666; background:transparent; font:12px/120% 微软雅黑,宋体,Verdana,Arial,sans-serif; }
//   .main { width:960px; margin:0 auto; clear:both; }
//   .m_head { height:60px; margin-top:10px; }
//   .h_logo { width:180px; } / .h_body { width:780px; line-height:20px; }
//   .searchbox { width:415px; padding-top:10px; }
//   .m_menu { height:40px; margin-top:5px; background-position:0 -89px; background-repeat:repeat-x; }
//   .m_menu li { float:left; font-size:14px; padding-left:12px; font-weight:bold; line-height:39px; }
//   .board { margin-top:8px; height:263px; }
//   .board dd img { border:1px solid #E4E4E4; padding:5px; width:120px; height:150px; }
//   #centeri, #right, #left { float:left; display:inline; }
//   #centeri { width:760px; } / #right, #left { width:190px; }
//   .block { border:1px solid #E4E4E4; margin-top:8px; height:1%; }
//   .blocktitle { height:40px; line-height:40px; font-size:14px; background-position:0 -129px; }
//   .blocktitle span { width:80px; height:30px; margin:10px 0 0 10px; line-height:30px; text-align:center; font-size:12px; }
//   #centeri .update { line-height:30px; padding:10px; }
//   .update li { border-bottom:1px dotted #E4E4E4; padding:0 10px; text-align:right; font-size:12px; }
//   .update p { float:left; text-align:left; text-overflow:ellipsis; overflow:hidden; }
//   .update .ul1 { width:250px; } / .update .ul2 { width:340px; }
//   .ultop, .ulcenter, .ulitem { line-height:25px; padding:5px; }
//   .ultop li, .ulitem li { border-bottom:1px dotted #F2F2F2; padding:0 3px; list-style:decimal inside; font-size:11px; }
//   table { border:1px solid #E4E4E4; margin:10px; width:98%; }
//   td, th { border-bottom:1px dotted #E4E4E4; padding:0 3px; }
//   .footer { height:70px; background-position:0 -500px; background-repeat:repeat-x; text-align:center; }
//   .footer .ftc { padding-top:10px; line-height:22px; }
// DOM 结构 (heibing 模板):
//   .main.m_head (h_logo + h_body 上线条 + searchbox + loginbox)
//   .main.m_menu (12 分类: 吾爱首页/玄幻魔法/武侠修真/都市言情/历史军事/侦探推理/网游动漫/科幻小说/恐怖灵异/文学名著/其他/全本)
//   .main.board (滑动排行榜)
//   .main > #centeri (block 最近更新 ul.update) + #right (block 吾爱总推荐榜 + 吾爱最新小说)
//   .main.footer
// ============================================================
'use client'

import { usePublic } from '../../ctx'
import { BookGridSkeleton } from '../../bits'
import { fmtDate } from '../../seo'
import type { HomeCloneProps } from '../shared-props'
import type { ReactNode } from 'react'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", "宋体", Verdana, Arial, sans-serif'
const BG = '#fafafa'
const INK = '#333333'
const MUTED = '#666666'
const LINK = '#2f468f'
const BORDER = '#E4E4E4'
const HEADER_BG = '#f5f5dc'

const NAV_ITEMS = ['吾爱首页', '玄幻魔法', '武侠修真', '都市言情', '历史军事', '侦探推理', '网游动漫', '科幻小说', '恐怖灵异', '文学名著', '其他', '全本']

function MHead() {
  return (
    <div className="main m_head" style={{ width: '100%', maxWidth: '960px', margin: '10px auto 0', height: '60px', fontFamily: FONT_STACK, display: 'flex', alignItems: 'center', gap: '14px' }}>
      <div className="h_logo fl" style={{ width: '180px' }}>
        <a href="/" style={{ color: LINK, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>吾爱文学网</a>
      </div>
      <div className="h_body fl" style={{ flex: 1, lineHeight: '20px' }}>
        <p style={{ fontSize: '12px', color: MUTED, margin: '0 0 6px', textAlign: 'right' }}>
          <a href="javascript:;" style={{ color: LINK, textDecoration: 'none' }}>简体版</a> | <a href="javascript:;" style={{ color: LINK, textDecoration: 'none' }}>繁体版</a> | <a href="javascript:;" style={{ color: LINK, textDecoration: 'none' }}>设为首页</a> | <a href="mailto:admin@2552.com" style={{ color: LINK, textDecoration: 'none' }}>联系我们</a> | <a href="javascript:;" style={{ color: LINK, textDecoration: 'none' }}>加入收藏</a>
        </p>
        <dl className="fl searchbox" style={{ width: '100%', maxWidth: '415px', margin: 0, display: 'flex', gap: '6px' }}>
          <dd style={{ flex: 1, margin: 0 }}>
            <input type="text" placeholder="搜索小说/作者" style={{ width: '100%', height: '28px', padding: '0 8px', border: `1px solid ${BORDER}`, fontSize: '12px' }} />
          </dd>
          <dd style={{ margin: 0 }}><button type="submit" style={{ background: LINK, color: '#fff', border: 'none', padding: '0 12px', height: '28px', cursor: 'pointer', fontSize: '12px' }}>搜索</button></dd>
        </dl>
      </div>
    </div>
  )
}

function MMenu() {
  const { navigate } = usePublic()
  return (
    <div className="main m_menu" style={{ width: '100%', maxWidth: '960px', margin: '5px auto 0', height: '40px', background: LINK, fontFamily: FONT_STACK }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {NAV_ITEMS.map((n, i) => (
          <li key={n} style={{ float: 'left', fontSize: '14px', padding: '0 12px', fontWeight: 700, lineHeight: '39px' }}>
            <a href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: '#fff', textDecoration: 'none' }}>{n}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function UpdateItem({ book }: { book: { id: string; name: string; author: string; latestChapter?: string; category: string; updatedAt?: string } }) {
  const { navigate } = usePublic()
  return (
    <li style={{ borderBottom: '1px dotted #E4E4E4', padding: '0 10px', textAlign: 'right', fontSize: '12px', lineHeight: '30px', listStyle: 'none', display: 'flex', alignItems: 'center' }}>
      <p className="ul1" style={{ float: 'left', width: '250px', textAlign: 'left', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', margin: 0 }}>
        <a href="javascript:;" style={{ color: MUTED, textDecoration: 'none' }}>[{book.category}]</a>
        《<a className="poptext" href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} target="_blank" style={{ color: LINK, textDecoration: 'none' }}>{book.name}</a>》
      </p>
      <p className="ul2" style={{ width: '340px', textAlign: 'left', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', margin: 0, flex: 1 }}>
        <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} target="_blank" style={{ color: MUTED, textDecoration: 'none' }}>{book.latestChapter || '最新章节'}</a>
      </p>
      <p style={{ margin: 0, color: MUTED, width: '120px', textAlign: 'right' }}>{book.author} {fmtDate(book.updatedAt) || '今天'}</p>
    </li>
  )
}

function TopListItem({ book }: { book: { id: string; name: string; author: string } }) {
  const { navigate } = usePublic()
  return (
    <li style={{ borderBottom: '1px dotted #F2F2F2', padding: '0 3px', listStyle: 'decimal inside', fontSize: '12px', lineHeight: '25px' }}>
      <a href={`/?view=book&id=${book.id}`} onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: book.id }) }} target="_blank" style={{ color: LINK, textDecoration: 'none' }}>{book.name}</a>
      <span style={{ color: MUTED, marginLeft: '4px' }}>/ {book.author}</span>
    </li>
  )
}

export function HomeClone({ books, loading }: HomeCloneProps): ReactNode {
  if (loading) {
    return (
      <div style={{ fontFamily: FONT_STACK, background: BG, minHeight: '100vh' }}>
        <MHead />
        <MMenu />
        <div style={{ maxWidth: '960px', margin: '14px auto', padding: '14px' }}>
          <BookGridSkeleton count={8} />
        </div>
      </div>
    )
  }

  const updates = books.slice(0, 20)
  const rank = books.slice(0, 12)
  const recent = books.slice(12, 24)

  return (
    <div style={{ fontFamily: FONT_STACK, background: BG, color: INK, minHeight: '100vh' }}>
      <MHead />
      <MMenu />
      <div className="main" style={{ width: '100%', maxWidth: '960px', margin: '8px auto 0', clear: 'both' }}>
        <div id="centeri" style={{ float: 'left', display: 'inline', width: '760px' }}>
          <div className="block" style={{ border: `1px solid ${BORDER}`, marginTop: '8px' }}>
            <div className="blocktitle" style={{ height: '40px', lineHeight: '40px', fontSize: '14px', background: HEADER_BG, padding: '0 10px' }}>
              <i style={{ display: 'inline-block', width: '6px', height: '6px', background: LINK, marginRight: '6px', verticalAlign: 'middle' }} />
              <span style={{ fontWeight: 700, color: INK }}>吾爱小说网最近更新</span>
            </div>
            <div className="blockcontent">
              <ul className="update" style={{ margin: 0, padding: '10px', listStyle: 'none' }}>
                {updates.map((b) => <UpdateItem key={b.id} book={b} />)}
              </ul>
            </div>
          </div>
        </div>
        <div id="right" style={{ float: 'right', display: 'inline', width: '190px' }}>
          <div className="block" style={{ border: `1px solid ${BORDER}`, marginTop: '8px' }}>
            <div className="blocktitle" style={{ height: '40px', lineHeight: '40px', fontSize: '14px', background: HEADER_BG, padding: '0 10px' }}>
              <span style={{ fontWeight: 700, color: INK }}>吾爱总推荐榜</span>
            </div>
            <div className="blockcontent">
              <ul className="ultop" style={{ margin: 0, padding: '5px', listStyle: 'none' }}>
                {rank.map((b) => <TopListItem key={b.id} book={b} />)}
                <li style={{ listStyle: 'none', textAlign: 'right', border: 'none', padding: '6px 3px', fontSize: '12px' }}>
                  <a href="javascript:;" style={{ color: LINK, textDecoration: 'none' }}>更多...</a>
                </li>
              </ul>
            </div>
          </div>
          <div className="block" style={{ border: `1px solid ${BORDER}`, marginTop: '8px' }}>
            <div className="blocktitle" style={{ height: '40px', lineHeight: '40px', fontSize: '14px', background: HEADER_BG, padding: '0 10px' }}>
              <span style={{ fontWeight: 700, color: INK }}>吾爱最新小说</span>
            </div>
            <div className="blockcontent">
              <ul className="ultop" style={{ margin: 0, padding: '5px', listStyle: 'none' }}>
                {recent.map((b) => <TopListItem key={b.id} book={b} />)}
              </ul>
            </div>
          </div>
        </div>
        <div style={{ clear: 'both' }} />
      </div>
      <div className="main footer" style={{ width: '100%', maxWidth: '960px', margin: '14px auto 0', height: '70px', background: HEADER_BG, textAlign: 'center', fontFamily: FONT_STACK }}>
        <div className="ftc" style={{ paddingTop: '10px', lineHeight: '22px', fontSize: '12px', color: MUTED }}>
          吾爱文学网无弹窗小说网承诺没有弹窗广告，吾读小说网所有小说都能免费阅读。<br />
          Copyright © 2012 <a href="javascript:;" style={{ color: LINK, textDecoration: 'none' }}>吾爱文学网</a>(www.x2552.com) All Rights Reserved.
        </div>
      </div>
    </div>
  )
}
