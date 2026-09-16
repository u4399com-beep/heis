// ============================================================
// clone-themes/aijjxs ReadChrome — 久久小说章节页外壳 1:1 克隆
// 实测 probe-aijjxs-chapter.html (犹怜作品全集页; aijjxs 阅读器嵌套在 iframe),
// 外壳走 .top-float nav + .wrap > header.top + main.layout + footer.foot.
// 正文 contentSelector: #view_content_txt (themes.ts 已声明, 由 read-layouts 包裹)
//
// R15-1C: 签名扩展为完整 ReadChromeProps 以与其他 9 套 ReadChrome 保持类型一致。
//   实测源站 chrome 内无章节翻页按钮(翻页在 iframe 内), 故 onPrev/onNext 不渲染按钮;
//   onPrev/onNext 在 props 层接受(避免 ReadView 透传时类型不匹配) 但渲染时静默忽略,
//   章节导航由内层 read-layout(ReadClassic 等) 自带的 prev/next 按钮承担。
// ============================================================
'use client'

import type { ReactNode } from 'react'
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared-props'

const FONT_STACK = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif'
const INK = '#1f2937'
const MUTED = '#6b7280'
const LINE = '#e5dccd'
const BRAND = '#0f766e'
const BRAND_DARK = '#115e59'
const PAPER = '#fffdf8'
const SHADOW = '0 10px 30px rgba(17, 24, 39, 0.08)'
const RADIUS = '14px'

const NAV_ITEMS = ['首页', '穿越', '重生', '古代架空', '现代言情', '总裁豪门', '仙侠幻想', '同人衍生', '无限流', '耽于纯美', '玄幻魔法', '都市异能', '历史军事', '网游小说', '惊悚悬疑', '文学名著']

// R15-1C: 接受完整 ReadChromeProps (含 onPrev/onNext/prevLabel/nextLabel) 以与其它 9 套 ReadChrome 签名一致;
// 源站 chrome 无翻页按钮故 onPrev/onNext 在此不渲染(章节翻页仍由内层 read-layout 提供)
export function ReadChrome({ children, chapterTitle }: ReadChromeProps): ReactNode {
  const { navigate } = usePublic()
  return (
    <div style={{ fontFamily: FONT_STACK, color: INK, minHeight: '100vh', background: '#f3efe7' }}>
      <div className="top-float" style={{ background: '#fff', borderBottom: `2px solid ${BRAND}` }}>
        <div className="top-float-inner" style={{ maxWidth: '1220px', margin: '0 auto', padding: '0 14px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <nav className="top-float-nav" style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
            {NAV_ITEMS.map((n, i) => (
              <a key={n} href="javascript:;" onClick={() => i === 0 && navigate({ view: 'home' })} style={{ fontSize: '14px', color: i === 0 ? BRAND : '#475569', fontWeight: i === 0 ? 700 : 400, textDecoration: 'none' }}>{n}</a>
            ))}
          </nav>
        </div>
      </div>
      <div className="wrap" style={{ maxWidth: '1220px', margin: '0 auto', padding: '18px 14px 36px' }}>
        <header className="top" style={{ background: 'rgba(255,253,248,.9)', border: `1px solid ${LINE}`, boxShadow: SHADOW, borderRadius: RADIUS, padding: '16px', marginBottom: '14px' }}>
          <div className="top-1" style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <h1 className="logo" style={{ margin: 0, fontSize: '20px', color: INK }}>
              站内搜索<small style={{ fontSize: '13px', color: MUTED, marginLeft: '8px' }}>快速找到你想要的TXT电子书</small>
            </h1>
          </div>
          <form className="search" style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 128px', gap: '10px' }} onSubmit={(e) => e.preventDefault()}>
            <input type="text" placeholder="请输入书名或作者关键字" style={{ height: '44px', borderRadius: '10px', border: `1px solid ${LINE}`, padding: '0 13px', fontSize: '15px', background: PAPER, color: INK }} />
            <button type="submit" style={{ border: '0', borderRadius: '10px', background: `linear-gradient(135deg,${BRAND},${BRAND_DARK})`, color: '#fff', fontSize: '15px', cursor: 'pointer' }}>搜索全站</button>
          </form>
        </header>

        {chapterTitle && (
          <div style={{ marginBottom: '14px', padding: '10px 14px', border: `1px solid ${LINE}`, borderRadius: RADIUS, background: PAPER, boxShadow: SHADOW, textAlign: 'center' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 'bold', color: INK, margin: 0 }}>{chapterTitle}</h1>
          </div>
        )}

        {children}

        <footer className="foot" style={{ marginTop: '24px', paddingTop: '12px', borderTop: `1px solid ${LINE}`, fontSize: '13px', color: MUTED, textAlign: 'center' }}>
          <a href="/support/about.html" style={{ color: BRAND_DARK, textDecoration: 'none' }}>网站简介</a> · <a href="/support/help.html" style={{ color: BRAND_DARK, textDecoration: 'none' }}>网站帮助</a> · <a href="/support/declare.html" style={{ color: BRAND_DARK, textDecoration: 'none' }}>版权声明</a> · <a href="/support/sitemap.html" style={{ color: BRAND_DARK, textDecoration: 'none' }}>网站地图</a> · <a href="/link/" style={{ color: BRAND_DARK, textDecoration: 'none' }}>友情链接</a> · <a href="/e/tool/gbook/index.php?bid=2" style={{ color: BRAND_DARK, textDecoration: 'none' }}>留言建议</a>
          <br />
          Copyright © 久久小说下载网 All Rights Reserved<br />
          本站所有小说电子书均系网友上传，仅供书友之间免费下载预览！
        </footer>
      </div>
    </div>
  )
}
