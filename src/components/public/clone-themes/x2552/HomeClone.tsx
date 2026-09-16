<<<<<<< HEAD
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
=======
// x2552 (吾爱文学网) 首页 1:1 克隆 — 使用源站 CSS class 名, 硬编码颜色
// 源站 CSS: /clone-css/x2552.css (heibing/css/style.css)
// 源站 DOM: .main.m_head(.h_logo + .h_body .searchbox + .loginbox) + .main.m_menu(12 项 + 全本) + .main.board(排行榜轮播 6 dd) +
//   .main(#centeri .block 吾爱小说网最近更新 30 li + #right 2 个 block 总推荐榜/最新小说) + .main.links 友链 + .main.footer
// 实测颜色: body bg transparent / a #2f468f / a:hover #ff6600 / .m_menu bg image (蓝色渐变) / .bdtop bg #D9EDFF / .blocktitle span 蓝绿按钮
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'
import { BookCover } from '../../BookCover'

function Skeleton() {
  return (
    <div className="main" style={{ width: 960, maxWidth: '100%', margin: '0 auto', padding: '10px 0' }}>
      <div style={{ background: '#fff', border: '1px solid #E4E4E4', padding: 16, marginBottom: 8 }}>
        <div style={{ height: 24, background: '#f0f0f0', borderRadius: 4, marginBottom: 12 }} />
        <div style={{ height: 80, background: '#f0f0f0', borderRadius: 4 }} />
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
      </div>
    </div>
  )
}

<<<<<<< HEAD
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
=======
export function HomeClone({ books, loading, navCategoryCount = 12, homeModuleLimit = 30 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站 .m_menu 实测导航项 (从 probe-x2552.html 提取)
  const NAV_ITEMS = [
    { name: '吾爱首页', href: 'http://www.x2552.com' },
    { name: '玄幻魔法', href: '/list/1_1.html' },
    { name: '武侠修真', href: '/list/2_1.html' },
    { name: '都市言情', href: '/list/3_1.html' },
    { name: '历史军事', href: '/list/4_1.html' },
    { name: '侦探推理', href: '/list/5_1.html' },
    { name: '网游动漫', href: '/list/6_1.html' },
    { name: '科幻小说', href: '/list/7_1.html' },
    { name: '恐怖灵异', href: '/list/8_1.html' },
    { name: '文学名著', href: '/list/9_1.html' },
    { name: '其他', href: '/list/10_1.html' },
    { name: '全本', href: '/fulltxt/1_1.html' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  // 排行榜轮播 (6 卡)
  const rankBooks = books.slice(0, 6)
  // 最近更新 (homeModuleLimit 条)
  const updateBooks = books.slice(0, Math.min(homeModuleLimit, 30))
  // 总推荐榜 (15 条)
  const voteBooks = books.slice(0, 15)
  // 最新小说 (20 条)
  const recentBooks = books.slice(0, 20)

  return (
    <div style={{ color: '#666', background: '#fff', font: '12px/120% "Microsoft YaHei", Arial, Verdana, sans-serif', minHeight: '100%' }}>
      {/* 源站 .main.m_head — 60px 高, logo + 搜索框 + 登录框 */}
      <div className="main m_head" style={{ width: 960, maxWidth: '100%', margin: '10px auto 0', height: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <div className="h_logo fl" style={{ width: 180, flexShrink: 0, textAlign: 'center' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ display: 'inline-block', fontSize: 24, fontWeight: 700, color: '#2f468f', textDecoration: 'none' }}>
            {site.name}
          </a>
        </div>
        <div className="h_body fl" style={{ flex: 1, minWidth: 280, lineHeight: '20px' }}>
          <div style={{ marginBottom: 6 }}>
            <p className="fr" style={{ float: 'right', color: '#666', fontSize: 11 }}>
              <a rel="nofollow" href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>简体版</a> |
              <a rel="nofollow" href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>繁体版</a> |
              <a rel="nofollow" href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>设为首页</a> |
              <a rel="nofollow" href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>联系我们</a> |
              <a rel="nofollow" href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>加入收藏</a>
            </p>
            <span style={{ color: '#666' }}>吾爱文学网：新吾读小说网，没有弹窗广告，好看的小说免费阅读</span>
            <div className="cl" style={{ clear: 'both' }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <form target="_blank" action="/search" method="post" name="articlesearch" id="articlesearch" style={{ margin: 0 }} onSubmit={(e) => e.preventDefault()}>
              <dl className="fl searchbox" style={{ display: 'flex', alignItems: 'center', margin: 0, padding: '10px 0 0' }}>
                <dt style={{ display: 'flex', alignItems: 'center', width: 260, height: 28, border: '1px solid #CCCCCC', background: '#fff', borderRadius: 2 }}>
                  <i style={{ width: 28, height: 28, display: 'inline-block' }} />
                  <input type="text" name="searchkey" placeholder="可搜索小说名/作者" style={{ width: 228, background: 'transparent', border: 'none', color: '#666', height: 20, lineHeight: '150%', padding: '4px 0 0 0', outline: 'none', fontSize: 12 }} />
                </dt>
                <dd style={{ paddingLeft: 4 }}>
                  <a href="javascript:void(0);" className="so_book" onClick={() => navigate({ view: 'search' })} style={{ display: 'inline-block', width: 70, height: 28, lineHeight: '28px', textAlign: 'center', background: '#2f468f', color: '#fff', textDecoration: 'none', marginRight: 4 }}>搜书名</a>
                  <a href="javascript:void(0);" className="so_author" onClick={() => navigate({ view: 'search' })} style={{ display: 'inline-block', width: 70, height: 28, lineHeight: '28px', textAlign: 'center', background: '#888', color: '#fff', textDecoration: 'none' }}>搜作者</a>
                </dd>
              </dl>
            </form>
            <dl className="fr loginbox" style={{ margin: '0 0 0 auto', padding: '12px 0 0 0', textAlign: 'right', fontSize: 12 }}>
              <dd style={{ color: '#666' }}>
                欢迎您，[<a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>登录</a>]或[<a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>注册</a>]
              </dd>
            </dl>
          </div>
        </div>
        <div className="cl" style={{ clear: 'both' }} />
      </div>

      {/* 源站 .main.m_menu — 12 项分类导航 + 全本 */}
      <div className="main m_menu" style={{ width: 960, maxWidth: '100%', margin: '5px auto 0', height: 40, background: 'linear-gradient(to bottom, #4a78c4, #2f468f)', position: 'relative', overflow: 'hidden' }}>
        <ul style={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: 0 }}>
          {visibleNav.map((item, i) => (
            <li key={item.name} style={{ float: 'left', fontSize: 14, paddingLeft: 12, fontWeight: 700, lineHeight: '39px', background: 'transparent' }}>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
                style={{ color: '#fff', textDecoration: 'none', display: 'inline-block', padding: '0 4px' }}
              >
                {item.name}
              </a>
            </li>
          ))}
          <li className="m_bc" style={{ position: 'absolute', width: 100, height: 30, right: 20, lineHeight: '30px', textAlign: 'center' }}>
            <a rel="nofollow" href="#" style={{ float: 'left', display: 'inline', width: 100, height: 30, lineHeight: '30px', color: '#fff', textDecoration: 'none', background: 'rgba(255,255,255,0.15)', borderRadius: 2 }}>
              📚书架
            </a>
          </li>
        </ul>
      </div>

      {/* 公告条 */}
      <div style={{ border: '1px solid #E4E4E4', color: 'red', width: 960, maxWidth: '100%', lineHeight: '25px', margin: '5px auto', padding: '4px 8px', textAlign: 'left', fontSize: 12, background: '#fff' }}>
        &nbsp;&nbsp;&nbsp;&nbsp;1、{site.name}全面升级，<a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}><b>手机版</b></a>同时上线 欢迎新老书友前来阅读。<br />
        &nbsp;&nbsp;&nbsp;&nbsp;2、感谢大家多年支持，{site.name} 坚持无弹窗广告阅读
      </div>

      {/* 源站 .main.board — 排行榜轮播 6 卡 */}
      <div className="main board" style={{ width: 960, maxWidth: '100%', margin: '8px auto 0', height: 'auto' }}>
        <div className="bdtop" style={{ height: 2, border: '1px solid #33CCFF', background: '#D9EDFF', fontSize: 0 }} />
        <div className="bdsub" style={{ padding: 1, background: '#FFFFFF', border: '1px solid #E4E4E4' }}>
          <dl id="s_dl" style={{ background: '#f7faff', lineHeight: '30px', overflow: 'hidden', position: 'relative' }}>
            <dt style={{ background: '#2f468f', height: 30, paddingLeft: 35, fontSize: 14, color: '#fff', borderBottom: '1px solid #E4E4E4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{site.name}排行榜</span>
              <span style={{ paddingRight: 12, fontSize: 12, fontWeight: 400 }}>更多 →</span>
            </dt>
            <bdo id="s_dd" style={{ display: 'flex', flexWrap: 'wrap', padding: '8px 0' }}>
              {rankBooks.map((b) => (
                <dd key={b.id} style={{ float: 'left', display: 'inline', padding: '8px 0 8px 21px', width: 135, fontSize: 13, textAlign: 'center', boxSizing: 'border-box' }}>
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ display: 'block' }}>
                    <BookCover name={b.name} cover={b.cover} className="w-full" style={{ width: 120, height: 150, borderRadius: 0, border: '1px solid #E4E4E4', padding: 5, boxSizing: 'border-box', background: '#fff' }} />
                  </a>
                  <br />
                  <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#2f468f', textDecoration: 'none', fontSize: 13 }}>
                    {b.name}
                  </a>
                </dd>
              ))}
            </bdo>
          </dl>
        </div>
      </div>

      {/* 中心区域 .main */}
      <div className="main" style={{ width: 960, maxWidth: '100%', margin: '8px auto 0', clear: 'both' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {/* #centeri 吾爱小说网最近更新 (760px) */}
          <div id="centeri" style={{ flex: '1 1 760px', minWidth: 320 }}>
            <div className="block" style={{ border: '1px solid #E4E4E4', marginTop: 8, height: 'auto', background: '#fff' }}>
              <div className="blocktitle" style={{ height: 40, lineHeight: '40px', fontSize: 14, background: '#2f468f', color: '#fff', display: 'flex', alignItems: 'center' }}>
                <i style={{ width: 12, height: 16, margin: '12px 10px 0 15px' }} />
                <span style={{ width: 'auto', height: 'auto', background: 'transparent', margin: '0', lineHeight: '40px', textAlign: 'left', fontSize: 14, color: '#fff', padding: 0 }}>
                  吾爱小说网最近更新
                </span>
              </div>
              <div className="blockcontent">
                <ul className="update" style={{ lineHeight: '30px', padding: '10px', listStyle: 'none', margin: 0 }}>
                  {updateBooks.map((b) => (
                    <li key={b.id} style={{ borderBottom: '1px dotted #E4E4E4', padding: '0 10px', textAlign: 'right', fontSize: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                      <p className="ul1" style={{ float: 'left', display: 'inline', textAlign: 'left', textOverflow: 'ellipsis', overflow: 'hidden', width: 'auto', flex: '0 0 auto', maxWidth: 250, whiteSpace: 'nowrap', margin: 0 }}>
                        <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'category', cat: b.categoryId || '' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>[{b.category}]</a>
                        《<a className="poptext" href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} target="_blank" style={{ color: '#2f468f', textDecoration: 'none' }}>{b.name}</a>》
                      </p>
                      <p className="ul2" style={{ float: 'left', display: 'inline', textAlign: 'left', textOverflow: 'ellipsis', overflow: 'hidden', width: 'auto', flex: '1 1 200px', minWidth: 120, whiteSpace: 'nowrap', margin: 0 }}>
                        <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} target="_blank" style={{ color: '#2f468f', textDecoration: 'none' }}>
                          {b.latestChapter || '暂无章节'}
                        </a>
                      </p>
                      <p style={{ float: 'left', display: 'inline', textAlign: 'left', margin: 0, color: '#888', width: 80, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.author}</p>
                      <span style={{ color: '#999' }}>{b.updatedAt ? fmtDate(b.updatedAt) : '—'}</span>
                    </li>
                  ))}
                  <li className="more" style={{ border: 0, lineHeight: '22px', fontSize: 12, textAlign: 'right', listStyle: 'none' }}>
                    <a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>更多...</a>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* #right 吾爱总推荐榜 + 最新小说 (190px) */}
          <div id="right" style={{ flex: '0 0 190px', minWidth: 160 }}>
            <div className="block" style={{ border: '1px solid #E4E4E4', marginTop: 8 }}>
              <div className="blocktitle" style={{ height: 40, lineHeight: '40px', fontSize: 14, background: '#2f468f', color: '#fff' }}>
                <span style={{ width: 'auto', height: 'auto', background: 'transparent', margin: '0', lineHeight: '40px', textAlign: 'center', fontSize: 12, color: '#fff', padding: '0 10px', display: 'block' }}>
                  吾爱总推荐榜
                </span>
              </div>
              <div className="blockcontent">
                <ul className="ultop" style={{ lineHeight: '25px', padding: 5, listStyle: 'decimal inside', margin: 0 }}>
                  {voteBooks.map((b) => (
                    <li key={b.id} style={{ borderBottom: '1px dotted #F2F2F2', padding: '0 3px', position: 'relative', fontSize: 11 }}>
                      <p style={{ position: 'absolute', top: '-3px', right: 0, color: '#999', margin: 0 }}>{Math.floor(Math.random() * 60000) + 1000}</p>
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} target="_blank" style={{ color: '#2f468f', textDecoration: 'none', fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                        {b.name}
                      </a>
                    </li>
                  ))}
                  <li style={{ listStyle: 'none', textAlign: 'right', border: 'none' }}>
                    <a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>更多...</a>
                  </li>
                </ul>
              </div>
            </div>

            <div className="block" style={{ border: '1px solid #E4E4E4', marginTop: 8 }}>
              <div className="blocktitle" style={{ height: 40, lineHeight: '40px', fontSize: 14, background: '#2f468f', color: '#fff' }}>
                <span style={{ width: 'auto', height: 'auto', background: 'transparent', margin: '0', lineHeight: '40px', textAlign: 'center', fontSize: 12, color: '#fff', padding: '0 10px', display: 'block' }}>
                  吾爱最新小说
                </span>
              </div>
              <div className="blockcontent">
                <ul className="ultop" style={{ lineHeight: '25px', padding: 5, listStyle: 'decimal inside', margin: 0 }}>
                  {recentBooks.map((b) => (
                    <li key={b.id} style={{ borderBottom: '1px dotted #F2F2F2', padding: '0 3px', position: 'relative', fontSize: 11 }}>
                      <p style={{ position: 'absolute', top: '-3px', right: 0, color: '#999', margin: 0 }}>{b.updatedAt ? fmtDate(b.updatedAt).slice(5) : '—'}</p>
                      <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} target="_blank" style={{ color: '#2f468f', textDecoration: 'none', fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                        {b.name}
                      </a>
                    </li>
                  ))}
                  <li style={{ listStyle: 'none', textAlign: 'right', border: 'none' }}>
                    <a href="#" style={{ color: '#2f468f', textDecoration: 'none' }}>更多...</a>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 友情链接 */}
      <div className="cl" style={{ margin: 0, padding: 0, width: 0, height: 0, lineHeight: 0, fontSize: 0, clear: 'both' }} />
      <div className="main links" style={{ width: 960, maxWidth: '100%', margin: '8px auto 0' }}>
        <div className="block" style={{ border: '1px solid #E4E4E4' }}>
          <div className="blocktitle" style={{ height: 40, lineHeight: '40px', fontSize: 14, background: '#2f468f', color: '#fff', padding: '0 12px' }}>友情链接</div>
          <div className="blockmore" style={{ float: 'right', display: 'inline', fontSize: 12, lineHeight: '40px', padding: '0 12px' }}>
            <a href="#" target="_blank" style={{ color: '#fff', textDecoration: 'none' }}>更多...</a>
          </div>
          <div className="blockcontent" style={{ padding: '10px' }}>
            <ul className="ulrow" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, listStyle: 'none', margin: 0 }}>
              <li><a href="#" target="_blank" style={{ color: '#2f468f', textDecoration: 'none' }}>吾读小说网</a></li>
              <li><a href="#" target="_blank" style={{ color: '#2f468f', textDecoration: 'none' }}>吾爱文学网</a></li>
              <li><a href="#" target="_blank" style={{ color: '#2f468f', textDecoration: 'none' }}>免费小说</a></li>
              <li><a href="#" target="_blank" style={{ color: '#2f468f', textDecoration: 'none' }}>笔趣阁</a></li>
            </ul>
          </div>
        </div>
      </div>

      {/* 源站 .main.footer */}
      <div className="cl" style={{ margin: 0, padding: 0, width: 0, height: 0, lineHeight: 0, fontSize: 0, clear: 'both' }} />
      <div className="main footer" style={{ width: 960, maxWidth: '100%', margin: '8px auto 0', background: '#f7faff', border: '1px solid #E4E4E4' }}>
        <div className="bdtop" style={{ height: 2, border: '1px solid #33CCFF', background: '#D9EDFF', fontSize: 0 }} />
        <div className="ftc" style={{ padding: '10px 12px', lineHeight: '22px', textAlign: 'center', fontSize: 12, color: '#666' }}>
          {site.name}无弹窗小说网承诺没有弹窗广告，吾读小说网所有小说都能免费阅读。找好看的小说网站，就到{site.name}<br />
          请所有网友上传作品时务必遵守国家互联网信息管理办法规定，{site.name}拒绝任何色情小说，一经发现，即作删除<br />
          Copyright © {new Date().getFullYear()} <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>{site.name}</a>({site.domain}) · {formatWords(books.reduce((s, b) => s + (b.wordCount || 0), 0))}小说
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
        </div>
      </div>
    </div>
  )
}
