'use client'
// ddyueshu.cc 章节阅读页 1:1 克隆 — biquge.css 模板
// 源站 DOM: .content_read > .box_con > .con_top + .bookname h1 + #content + .bottem2 (上一章/下一章)
// 实测 #content 字号 19pt 字间距 0.2em 行高 150%, 宽度 85%
import type { ReadChromeProps } from '../shared'
import { usePublic } from '../../ctx'

export function ReadChrome({ children, chapterTitle, onPrev, onNext, prevLabel = '上一章', nextLabel = '下一章' }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  return (
    <div className="content_read" style={{ overflow: 'hidden', width: 980, maxWidth: '100%', margin: '2px auto auto', background: '#E9FAFF', color: '#1e293b', fontFamily: '"宋体", Arial, sans-serif', fontSize: 12 }}>
      <div className="box_con" style={{ border: '2px solid #88C6E5', overflow: 'hidden', width: '100%', margin: '2px auto' }}>
        {/* 源站 .con_top — 顶部面包屑 + 站点链接 */}
        <div className="con_top" style={{ borderBottom: '1px solid #88C6E5', textAlign: 'left', padding: '0 10px', lineHeight: '40px', height: 40, background: '#E1ECED' }}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#085308', textDecoration: 'none', fontSize: 14, marginRight: 10 }}>
            {site.name}
          </a>
          <span style={{ color: '#B3B3B3', fontSize: 14 }}>{'>'} 在线阅读</span>
        </div>

        {/* 源站 .bookname — 章节标题 */}
        <div className="bookname" style={{ borderBottom: '1px dashed #88C6E5', lineHeight: '30px', paddingTop: 10, marginBottom: 10, textAlign: 'center' }}>
          {chapterTitle && (
            <h1 style={{ font: '25px/35px "宋体"', paddingTop: 10, textAlign: 'center', color: '#1f2937', margin: 0 }}>
              {chapterTitle}
            </h1>
          )}
          <div style={{ fontSize: 12, color: '#B3B3B3', marginTop: 6 }}>
            <span>作者：{site.name}</span>
            <span style={{ margin: '0 10px' }}>·</span>
            <span>来源：{site.domain}</span>
          </div>
        </div>

        {/* 源站 #content — 正文区, 19pt 字间距 0.2em */}
        <div id="content" style={{ fontFamily: '"宋体", "Microsoft YaHei", 微软雅黑, 宋体', fontSize: '19pt', letterSpacing: '0.2em', lineHeight: 1.5, paddingTop: 15, width: '85%', margin: '0 auto', padding: '15px 0 32px', color: '#1e293b' }}>
          {children}
        </div>

        {/* 源站 .bottem2 — 翻页区 */}
        {(onPrev || onNext) && (
          <div className="bottem2" style={{ borderTop: '1px dashed #88C6E5', clear: 'both', textAlign: 'center', width: '100%', margin: '0 auto', padding: 15 }}>
            {onPrev && (
              <button onClick={onPrev} style={{ border: '1px solid #88C6E5', background: '#fff', color: '#085308', fontSize: 14, padding: '6px 20px', margin: '0 10px', cursor: 'pointer', borderRadius: 2, textDecoration: 'none' }}>
                {prevLabel}
              </button>
            )}
            <a href="/" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ color: '#085308', fontSize: 14, padding: '6px 20px', margin: '0 10px', textDecoration: 'none' }}>
              返回首页
            </a>
            {onNext && (
              <button onClick={onNext} style={{ border: '1px solid #88C6E5', background: '#1f6cb2', color: '#fff', fontSize: 14, padding: '6px 20px', margin: '0 10px', cursor: 'pointer', borderRadius: 2, textDecoration: 'none' }}>
                {nextLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
