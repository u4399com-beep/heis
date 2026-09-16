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
        </div>
      </div>
    </div>
  )
}
