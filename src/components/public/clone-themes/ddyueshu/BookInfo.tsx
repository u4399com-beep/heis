'use client'
// ============================================================
// clone-ddyueshu BookInfo — 1:1 精仿 www.ddyueshu.cc 书籍详情页
// 参考: agent-ctx/probe-html2/probe-ddyueshu.html (首页 DOM 推断 + ddyueshu.css 详情页样式)
// 源站 CSS 提取: .box_con (border 2px #88C6E5 width 976px) / .con_top (line-height 40px bg #E1ECED)
//                #sidebar (140px 左栏) / #maininfo (800px 右栏) / #fmimg (126x150 cover + .a/.b 标记)
//                #info (h1 28px 700 + p 350px float left) / #intro (简介 13px line-height 150%)
//                #list (dl/dt/dt 章节目录 33% width)
// CSS 由 CloneCSSLoader 加载 public/clone-css/ddyueshu.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords, statusLabel } from '../../seo'
import type { BookInfoProps } from '../shared'

export function BookInfo({ book, onScrollToc, onGoCategory }: BookInfoProps) {
  const { navigate } = usePublic()
  if (!book) return null

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goCat = (e: React.MouseEvent) => {
    e.preventDefault()
    if (onGoCategory) onGoCategory(book.categoryId || book.category)
    else navigate({ view: 'category', cat: book.categoryId || book.category })
  }

  const isCompleted = book.status === 'completed'
  // 源站 #fmimg 内 .a 标记完本, .b 标记连载; 此处根据 status 渲染对应 class
  const statusMark = isCompleted ? 'a' : 'b'
  const statusText = isCompleted ? '完结' : '连载'

  return (
    <div className="content_read">
      <div className="box_con">
        {/* .con_top: 顶部面包屑栏 (源站 line-height 40px bg #E1ECED border-bottom 1px #88C6E5) */}
        <div className="con_top">
          <a href="/" onClick={goHome}>{book.category || '小说'}</a>
          &nbsp;&gt;&nbsp;
          <a href="/" onClick={goCat}>{book.category || '小说'}</a>
          &nbsp;&gt;&nbsp;
          <a {...bookNavProps(navigate, book.id)}>{book.name}</a>
        </div>

        {/* #maininfo: 右侧主信息 (源站 width 800px float right) */}
        <div id="maininfo">
          {/* #fmimg: 封面图 (源站 126px width 12px margin+padding + .a/.b 状态徽章) */}
          <div id="fmimg">
            <a {...bookNavProps(navigate, book.id)}>
              <BookCover name={book.name} cover={book.cover} style={{ width: 120, height: 150 }} />
            </a>
            <span className={statusMark} title={statusText} />
          </div>

          {/* #info: 书名 + 作者/分类/字数/状态元数据 (源站 h1 28px 700 + p 350px float left 25px line-height) */}
          <div id="info">
            <h1>{book.name}</h1>
            <p>作者：<a {...bookNavProps(navigate, book.id)}>{book.author}</a></p>
            <p>分类：<a href="/" onClick={goCat}>{book.category || '小说'}</a></p>
            <p>字数：{formatWords(book.wordCount)}</p>
            <p>状态：{statusLabel(book.status)}</p>
            <div className="clear" />
          </div>

          {/* #intro: 简介 (源站 96% width line-height 150% border-top dashed 1px #88C6E5 padding 10px font 13px) */}
          <div id="intro">
            <p>{book.intro || '暂无简介'}</p>
            <div className="clear" />
          </div>

          {/* #list: 章节目录入口 (源站 dl/dt/dd 33% width 浮动; BookView 实际章节列表由父级渲染, 这里只放"查看完整目录"入口) */}
          <div id="list">
            <dl>
              <dt>最新章节</dt>
              <dd><a {...bookNavProps(navigate, book.id)}>{book.latestChapter || '点击查看完整目录'}</a></dd>
              <div className="clear" />
            </dl>
            <dl>
              <dt>开始阅读</dt>
              <dd>
                <a
                  role="button"
                  tabIndex={0}
                  onClick={onScrollToc}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onScrollToc()
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  点击开始阅读 →
                </a>
              </dd>
              <div className="clear" />
            </dl>
            <div className="clear" />
          </div>
        </div>

        {/* #sidebar: 左侧栏 (源站 140px float left, 推荐位/广告位) — 此处放同分类热门书籍占位 */}
        <div id="sidebar">
          <dl style={{ padding: '5px' }}>
            <dt style={{ fontSize: 14, fontWeight: 700, padding: '5px 0' }}>同分类推荐</dt>
            <dd style={{ padding: '5px 0', fontSize: '12px' }}>
              <a {...bookNavProps(navigate, book.id)}>{book.name}</a>
            </dd>
          </dl>
        </div>

        <div className="clear" />

        {/* .bottem1: 底部导航按钮 (源站 clear both text-align center width 900px margin 5px) */}
        <div className="bottem1">
          <a href="/" onClick={goHome}>返回首页</a>
          <a
            role="button"
            tabIndex={0}
            onClick={onScrollToc}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onScrollToc()
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            点击查看完整目录
          </a>
        </div>
      </div>
    </div>
  )
}
