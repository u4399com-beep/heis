'use client'
// ============================================================
// clone-ddyueshu ReadChrome — 1:1 精仿 www.ddyueshu.cc 章节阅读页外壳
// 参考: agent-ctx/probe-html2/probe-ddyueshu.html (无章节 probe, 从 ddyueshu.css 推断)
// 源站 CSS 提取:
//   .content_read (980px width overflow hidden margin 2px auto)
//   .box_con (border 2px #88C6E5 overflow hidden width 976px margin 2px auto)
//   .con_top (border-bottom 1px #88C6E5 line-height 40px height 40px bg #E1ECED padding 0 10px text-align left)
//   .bookname (border-bottom 1px dashed #88C6E5 line-height 30px padding-top 10px margin-bottom 10px)
//   .bookname h1 (font 25px/35px 宋体 padding-top 10px text-align center)
//   .box_con #content (font-family 宋体/Microsoft YaHei font-size 19pt letter-spacing 0.2em line-height 150% padding-top 15px width 85% margin auto)
//   .bottem1 (clear both text-align center width 900px margin 5px)
//   .bottem2 (border-top 1px dashed #88C6E5 clear both text-align center width 900px margin 0 20px padding 15px)
//   .bottem1 a / .bottem2 a (color #085308 font-size 14px margin 0 10px)
// CSS 由 CloneCSSLoader 加载 public/clone-css/ddyueshu.css, 全部用源站真实 class 名
// ============================================================
import type { ReadChromeProps } from '../shared'

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  return (
    <div className="content_read">
      <div className="box_con">
        {/* .con_top: 顶部栏 (源站 line-height 40px bg #E1ECED, 用于面包屑 + 分享按钮) */}
        <div className="con_top">
          <span style={{ lineHeight: '40px' }}>正文卷</span>
          <div id="page_set" style={{ float: 'right', textAlign: 'right', height: '20px', lineHeight: '20px', paddingRight: '5px', paddingTop: '10px' }}>
            <span style={{ color: '#9E9E9E', fontSize: 12 }}>阅读设置</span>
          </div>
        </div>

        {/* .bookname: 章节标题 (源站 border-bottom 1px dashed #88C6E5 line-height 30px padding-top 10px) */}
        {chapterTitle && (
          <div className="bookname">
            <h1>{chapterTitle}</h1>
          </div>
        )}

        {/* #content: 正文区 (源站 font 19pt letter-spacing 0.2em line-height 150% padding-top 15px width 85% margin auto) */}
        <div id="content">
          {children}
        </div>

        {/* .bottem1: 上一章/下一章导航按钮 (源站 clear both text-align center width 900px margin 5px) */}
        <div className="bottem1">
          {onPrev && (
            <a
              role="button"
              tabIndex={0}
              onClick={onPrev}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPrev()
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              上一章
            </a>
          )}
          {onNext && (
            <a
              role="button"
              tabIndex={0}
              onClick={onNext}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onNext()
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              下一章
            </a>
          )}
        </div>

        {/* .bottem2: 底部第二导航 (源站 border-top 1px dashed #88C6E5 clear both text-align center padding 15px) */}
        <div className="bottem2">
          {onPrev && (
            <a
              role="button"
              tabIndex={0}
              onClick={onPrev}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onPrev()
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              上一章
            </a>
          )}
          <a href="/">返回书页</a>
          {onNext && (
            <a
              role="button"
              tabIndex={0}
              onClick={onNext}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onNext()
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              下一章
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
