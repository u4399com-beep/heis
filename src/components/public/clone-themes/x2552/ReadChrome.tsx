<<<<<<< HEAD
// ============================================================
// clone-themes/x2552 ReadChrome — 吾爱文学章节页外壳 1:1 克隆
// 实测 heibing 模板: #content 正文 + .bottem1 翻页
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '"微软雅黑", "Microsoft YaHei", "宋体", Verdana, Arial, sans-serif'
const INK = '#333333'
const MUTED = '#666666'
const LINK = '#2f468f'
const BORDER = '#E4E4E4'
const HEADER_BG = '#f5f5dc'

const NAV_ITEMS = ['吾爱首页', '玄幻魔法', '武侠修真', '都市言情', '历史军事', '侦探推理', '网游动漫', '科幻小说', '恐怖灵异', '文学名著', '其他', '全本']

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: '#fafafa' }}>
      <div className="main m_head" style={{ width: '100%', maxWidth: '960px', margin: '10px auto 0', height: '60px', display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ width: '180px' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: LINK, fontSize: '22px', fontWeight: 700, textDecoration: 'none' }}>吾爱文学网</a>
        </div>
        <div style={{ flex: 1 }}>
          <dl style={{ margin: 0, display: 'flex', gap: '6px' }}>
            <dd style={{ flex: 1, margin: 0 }}>
              <input type="text" placeholder="搜索小说/作者" style={{ width: '100%', height: '28px', padding: '0 8px', border: `1px solid ${BORDER}`, fontSize: '12px' }} />
            </dd>
            <dd style={{ margin: 0 }}><button type="submit" style={{ background: LINK, color: '#fff', border: 'none', padding: '0 12px', height: '28px', cursor: 'pointer', fontSize: '12px' }}>搜索</button></dd>
          </dl>
        </div>
      </div>
      <div className="main m_menu" style={{ width: '100%', maxWidth: '960px', margin: '5px auto 0', height: '40px', background: LINK }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {NAV_ITEMS.map((n, i) => (
            <li key={n} style={{ float: 'left', fontSize: '14px', padding: '0 12px', fontWeight: 700, lineHeight: '39px' }}>
              <a href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ color: '#fff', textDecoration: 'none' }}>{n}</a>
            </li>
          ))}
        </ul>
      </div>
      <div className="main" style={{ width: '100%', maxWidth: '960px', margin: '8px auto 0', clear: 'both' }}>
        <div className="block" style={{ border: `1px solid ${BORDER}`, marginTop: '8px' }}>
          <div className="blocktitle" style={{ height: '40px', lineHeight: '40px', fontSize: '14px', background: HEADER_BG, padding: '0 10px', textAlign: 'center' }}>
            <span style={{ fontWeight: 700, color: INK }}>{chapterTitle}</span>
          </div>
          <div className="blockcontent" style={{ padding: '24px' }}>
            {children}
            <div style={{ marginTop: '24px', paddingTop: '14px', borderTop: `1px dashed ${BORDER}`, textAlign: 'center' }}>
              {onPrev && <a href="javascript:;" onClick={onPrev} style={{ padding: '4px 12px', background: LINK, color: '#fff', textDecoration: 'none', fontSize: '12px', margin: '0 6px' }}>{prevLabel}</a>}
              <a href="javascript:;" onClick={() => navigate({ view: 'home' })} style={{ padding: '4px 12px', border: `1px solid ${BORDER}`, color: LINK, textDecoration: 'none', fontSize: '12px', margin: '0 6px' }}>返回首页</a>
              {onNext && <a href="javascript:;" onClick={onNext} style={{ padding: '4px 12px', background: LINK, color: '#fff', textDecoration: 'none', fontSize: '12px', margin: '0 6px' }}>{nextLabel}</a>}
            </div>
          </div>
        </div>
      </div>
      <div className="main footer" style={{ width: '100%', maxWidth: '960px', margin: '14px auto 0', height: '70px', background: HEADER_BG, textAlign: 'center' }}>
        <div className="ftc" style={{ paddingTop: '10px', lineHeight: '22px', fontSize: '12px', color: MUTED }}>
          Copyright © 2012 吾爱文学网(www.x2552.com) All Rights Reserved.
=======
'use client'
// x2552 (吾爱文学网) 章节阅读页 1:1 克隆 — heibing 模板
// 源站 DOM: .main(#a_head .so + h1 章节名 + #contents 正文 + .pagelink 翻页)
// 实测 #contents padding 25px line-height 26px font-size 14px / .pagelink bg #F2F2F2
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  return (
    <div style={{ color: '#666', background: '#fff', font: '12px/120% "Microsoft YaHei", Arial, Verdana, sans-serif', minHeight: '100%' }}>
      {/* 源站 .main.m_head — 简化版 */}
      <div className="main m_head" style={{ width: 960, maxWidth: '100%', margin: '10px auto 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <div className="h_logo fl" style={{ width: 180, flexShrink: 0, textAlign: 'center' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ display: 'inline-block', fontSize: 24, fontWeight: 700, color: '#2f468f', textDecoration: 'none' }}>
            {site.name}
          </a>
        </div>
        <div className="h_body fl" style={{ flex: 1, minWidth: 280 }}>
          <form target="_blank" action="/search" method="post" name="articlesearch" id="articlesearch" style={{ margin: 0 }} onSubmit={(e) => e.preventDefault()}>
            <dl className="fl searchbox" style={{ display: 'flex', alignItems: 'center', margin: 0, padding: '10px 0 0' }}>
              <dt style={{ display: 'flex', alignItems: 'center', width: 260, height: 28, border: '1px solid #CCCCCC', background: '#fff', borderRadius: 2 }}>
                <input type="text" name="searchkey" placeholder="可搜索小说名/作者" style={{ width: 240, background: 'transparent', border: 'none', color: '#666', height: 20, padding: '4px 8px 0 8px', outline: 'none', fontSize: 12 }} />
              </dt>
              <dd style={{ paddingLeft: 4 }}>
                <a href="javascript:void(0);" className="so_book" onClick={() => navigate({ view: 'search' })} style={{ display: 'inline-block', width: 70, height: 28, lineHeight: '28px', textAlign: 'center', background: '#2f468f', color: '#fff', textDecoration: 'none', marginRight: 4 }}>搜书名</a>
              </dd>
            </dl>
          </form>
        </div>
        <div className="cl" style={{ clear: 'both' }} />
      </div>

      {/* 源站 .main.m_menu — 简化版 */}
      <div className="main m_menu" style={{ width: 960, maxWidth: '100%', margin: '5px auto 0', height: 40, background: 'linear-gradient(to bottom, #4a78c4, #2f468f)' }}>
        <ul style={{ display: 'flex', flexWrap: 'wrap', listStyle: 'none', padding: 0, margin: 0, height: '100%' }}>
          <li style={{ fontSize: 14, paddingLeft: 12, fontWeight: 700, lineHeight: '39px' }}>
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#fff', textDecoration: 'none' }}>吾爱首页</a>
          </li>
          <li style={{ fontSize: 14, paddingLeft: 12, fontWeight: 700, lineHeight: '39px' }}>
            <a href="#" style={{ color: '#fff', textDecoration: 'none' }}>书库</a>
          </li>
        </ul>
      </div>

      {/* 源站 h1 — 章节名 */}
      {chapterTitle && (
        <div className="main" style={{ width: 960, maxWidth: '100%', margin: '10px auto 0' }}>
          <h1 style={{ fontSize: 20, textAlign: 'center', lineHeight: '65px', height: '70px', color: '#333', margin: 0 }}>
            {chapterTitle}
          </h1>
        </div>
      )}

      {/* 源站 #contents — 正文区 */}
      <div className="main" style={{ width: 960, maxWidth: '100%', margin: '0 auto' }}>
        <div className="block" style={{ border: '1px solid #E4E4E4', background: '#fff' }}>
          <div className="blockcontent">
            <div id="contents" style={{ padding: 25, lineHeight: '26px', fontSize: 14, color: '#666' }}>
              {children}
            </div>

            {/* 翻页 .pagelink */}
            {(onPrev || onNext) && (
              <div className="pagelink" style={{ border: '1px solid #E4E4E4', float: 'right', background: '#F2F2F2', margin: '0 10px 12px', display: 'flex', alignItems: 'center', clear: 'both' }}>
                {onPrev && (
                  <a href="#" onClick={(e) => { e.preventDefault(); onPrev() }} style={{ float: 'left', display: 'inline', padding: '0 6px', color: '#2f468f', textDecoration: 'none', height: 30, lineHeight: '30px' }}>{prevLabel}</a>
                )}
                <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ float: 'left', display: 'inline', padding: '0 6px', color: '#2f468f', textDecoration: 'none', height: 30, lineHeight: '30px' }}>目录</a>
                {onNext && (
                  <a href="#" onClick={(e) => { e.preventDefault(); onNext() }} style={{ float: 'left', display: 'inline', padding: '0 6px', color: '#2f468f', textDecoration: 'none', height: 30, lineHeight: '30px' }}>{nextLabel}</a>
                )}
              </div>
            )}
            <div className="cl" style={{ clear: 'both' }} />
          </div>
        </div>
      </div>

      {/* 源站 .main.footer */}
      <div className="main footer" style={{ width: 960, maxWidth: '100%', margin: '8px auto 0', background: '#f7faff', border: '1px solid #E4E4E4' }}>
        <div className="ftc" style={{ padding: '10px 12px', lineHeight: '22px', textAlign: 'center', fontSize: 12, color: '#666' }}>
          Copyright © {new Date().getFullYear()} <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>{site.name}</a>({site.domain}) All Rights Reserved
>>>>>>> 1d2b523 (refactor(R16): 真正1:1克隆+CloneCSSLoader+18种TDK预设+主题编辑)
        </div>
      </div>
    </div>
  )
}
