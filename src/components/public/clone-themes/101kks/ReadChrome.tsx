'use client'
// ============================================================
// clone-101kks ReadChrome — 1:1 精仿 101kks.com 101看書 章节阅读页 (/txt/xxx/xxx.html)
// 参考: agent-ctx/probe-html2/probe-101kks-chapter.html (无章节 probe, 但 CSS 含 .txtnav/.txtinfo/.page1)
// 源站 CSS 提取:
//   .black (背景 rgb(45,49,52)) + .black .mybox (背景 rgb(32,40,46) + 颜色 #fff)
//   .tools (顶部工具栏 padding 10px 30px 0 0 + flex justify-end)
//   .tools li i (icon 36x36 bg #4c5356)
//   .txtnav (padding 0 30px line-height 2 word-wrap break-word)
//   .txtnav h1 (text-align center font-size 20px padding 10px)
//   .txtinfo (text-align center font-size 14px padding-bottom 15px)
//   .txtnav p (line-height 2 padding 10px 0 text-indent 5% word-wrap break-word)
//   .page1 (background #f2f3f4 border-radius 3px display flex align-items center)
//   .page1 a (width 100% font-size 16px text-align center line-height 48px border-right 1px solid rgba(191,191,191,.24))
// 复刻:
//   <div class="black">
//     <div class="container"><div class="mybox">
//       <div class="tools"><ul><li>...</li></ul></div>
//       <div class="txtnav"><h1>{chapterTitle}</h1></div>
//       <div className="txtinfo">{children}</div>
//       <div class="page1">
//         <a 上一章 / a 返回書頁 / a 下一章
// CSS 由 CloneCSSLoader 加载 public/clone-css/101kks.css
// ============================================================
import type { ReadChromeProps } from '../shared'
import { cloneNavHandlers } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  const { site, navigate } = usePublic()

  // R28-1A: 复用 cloneNavHandlers (goHome 共享, 本页无搜索表单)
  const { goHome } = cloneNavHandlers(navigate, 'searchkey')

  // 上一章/下一章: 源站 .page1 a (width 100% text-align center line-height 48px)
  const navBtnProps = (handler?: () => void) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: (e: React.MouseEvent) => { e.preventDefault(); if (handler) handler() },
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && handler) {
        e.preventDefault()
        handler()
      }
    },
    style: { cursor: 'pointer' as const },
  })

  return (
    <div className="black">
      <div className="container">
        <div className="mybox">
          {/* 顶部工具栏 .tools (源站 padding 10px 30px 0 0 + flex justify-end) */}
          <div className="tools">
            <ul>
              <li><i className="iconfont icon-list"></i><span>目錄</span></li>
              <li><i className="iconfont icon-set"></i><span>設置</span></li>
              <li><i className="iconfont icon-yuedujilu"></i><span>書籤</span></li>
            </ul>
          </div>

          {/* 章节标题 .txtnav h1 (源站 text-align center font-size 20px padding 10px) */}
          <div className="txtnav">
            <h1>{chapterTitle || '正文'}</h1>
          </div>

          {/* 正文内容 .txtinfo (源站 text-align center font-size 14px padding-bottom 15px) */}
          <div className="txtinfo">
            {children}
          </div>

          {/* 分页 .page1 (源站 flex 1 1 0, 3 个 a: 上一章/返回書頁/下一章) */}
          <div className="page1">
            {onPrev && (
              <a {...navBtnProps(onPrev)}>上一章</a>
            )}
            <a href="/" onClick={goHome}>返回書頁</a>
            {onNext && (
              <a {...navBtnProps(onNext)}>下一章</a>
            )}
          </div>
        </div>
      </div>

      {/* 页脚 */}
      <div className="foot">
        <div className="copyright">
          <div>
            <a href="/novels/hot" onClick={(e) => { e.preventDefault(); navigate({ view: 'ranking' }) }}>排行榜</a>
            <a href="/last" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>最新更新</a>
            <a href="/all.html" onClick={goHome}>全部小說</a>
            <a href="/newtags" onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: '系統' }) }}>熱門標籤</a>
          </div>
          <p>Copyright 2023 <a href="/" onClick={goHome}>Powered by © {site.name}（https://{site.domain || '101kks.com'}）</a></p>
          <div>
            友情連結：<a href="/" onClick={goHome} title={site.name}>{site.name}</a>|
            <a href="/privacy_policy.html" onClick={(e) => e.preventDefault()}>Cookies Policy</a>|
            <a href="/DMCA.html" onClick={(e) => e.preventDefault()}>DMCA</a>
            <div className="clear"></div>
          </div>
        </div>
      </div>
    </div>
  )
}
