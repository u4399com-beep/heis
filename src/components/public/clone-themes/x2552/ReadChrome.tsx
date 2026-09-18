'use client'
// ============================================================
// clone-x2552 ReadChrome — 章节阅读页外壳
// 注: x2552 没有子页 probe, 按 JieQi CMS 标准章节阅读页模板构造
//     (源站 URL /html/{catId}/{bookId}/{chapterId}.html)
// 复刻: .main.m_head (header + searchbox) / .main.m_menu (10 分类 + 全本) /
//       #a_head (面包屑 + 小搜索框) / #a_main (.myset 字号控制 A-/A+ | 阅读设置 +
//       h1 章节标题 + #contents 正文 children + .btnlinks 上下章翻页) /
//       #a_footer (返回书页/返回顶部/上下章 链接) / .main.links / .main.footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/x2552.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared'
import { useEffect, useState } from 'react'

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  const [fontSize, setFontSize] = useState(14)

  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const goFulltext = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'fulltext' })
  }
  const goRanking = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'ranking' })
  }
  const goHistory = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'history' })
  }
  // 字号控制 (A- / A+)
  const changeSize = (delta: number) => setFontSize(s => Math.max(12, Math.min(22, s + delta)))
  // 回顶部
  const goTop = () => { if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }

  // 章节切换时自动滚回顶部
  useEffect(() => { goTop() }, [chapterTitle])

  return (
    <>
      {/* ============ 顶部 header (m_head) ============ */}
      <div className="main m_head">
        <div className="h_logo fl">
          <a href="/" onClick={goHome}>
            <span style={{ display: 'inline-block', fontSize: 24, fontWeight: 'bold', color: '#2f468f', lineHeight: '50px', padding: '5px 0' }}>{site.name}</span>
          </a>
        </div>
        <div className="h_body fl">
          <div>
            <p className="fr">
              <a rel="nofollow" href="#" onClick={(e) => e.preventDefault()}>简体版</a> | <a rel="nofollow" href="#" onClick={(e) => e.preventDefault()}>繁体版</a> | <a rel="nofollow" href="#" onClick={(e) => e.preventDefault()}>设为首页</a> | <a rel="nofollow" href="#" onClick={(e) => e.preventDefault()}>联系我们</a> | <a rel="nofollow" href="#" onClick={(e) => e.preventDefault()}>加入收藏</a>
            </p>
            {site.name}：新吾读小说网,没有弹窗广告 好看的小说免费阅读
          </div>
          <div>
            <form action="/modules/article/search.php" method="post" name="articlesearch" id="articlesearch" onSubmit={goSearch}>
              <input type="hidden" id="searchtype" name="searchtype" value="articlename" />
              <dl className="fl searchbox">
                <dt>
                  <i />
                  <input type="text" name="searchkey" placeholder="搜索书名" autoComplete="off" />
                </dt>
                <dd>
                  <a href="javascript:void(0);" className="so_book" title="搜索书名" onClick={(e) => { e.preventDefault(); goSearch(e as unknown as React.FormEvent<HTMLFormElement>) }} />
                  <a href="javascript:void(0);" className="so_author" title="搜索作者" onClick={(e) => {
                    e.preventDefault()
                    const f = (e.currentTarget.closest('form') as HTMLFormElement)
                    if (f) {
                      const t = f.querySelector('#searchtype') as HTMLInputElement | null
                      if (t) t.value = 'author'
                      f.requestSubmit()
                    }
                  }} />
                </dd>
              </dl>
            </form>
            <dl className="fr loginbox">
              <dd>欢迎您,[<a href="#" onClick={(e) => e.preventDefault()}>登录</a>]或[<a href="#" onClick={(e) => e.preventDefault()}>注册</a>]</dd>
            </dl>
          </div>
        </div>
        <div className="cl" />
      </div>

      {/* ============ 导航 menu (m_menu) ============ */}
      <div className="main m_menu">
        <ul>
          <li className="m_ml" />
          <li><a href="/" onClick={goHome}>吾爱首页</a></li>
          <li><a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>分类</a></li>
          <li><a href="/fulltxt/1_1.html" onClick={goFulltext}>全本</a></li>
          <li className="m_bc"><a rel="nofollow" href="#" onClick={(e) => e.preventDefault()} title="我的书架" /></li>
          <li className="m_mr" />
        </ul>
      </div>

      {/* ============ 文章头 #a_head (面包屑 + 小搜索框) ============ */}
      <div id="a_head">
        <ul>
          <li><a href="/" onClick={goHome}>{site.name}</a> &gt; </li>
          <li>{chapterTitle || '章节阅读'} &gt; </li>
          <li>正在阅读</li>
        </ul>
        <form className="so" action="/modules/article/search.php" method="post" onSubmit={goSearch}>
          <input type="hidden" name="searchtype" value="articlename" />
          <input type="text" name="searchkey" placeholder="书名" autoComplete="off" />
          <a href="javascript:void(0);" onClick={(e) => { e.preventDefault(); goSearch(e as unknown as React.FormEvent<HTMLFormElement>) }}>搜索</a>
        </form>
      </div>

      {/* ============ 文章主体 #a_main (字号 + h1 + 正文 + 翻页) ============ */}
      <div id="a_main">
        {/* 字号控制 .myset */}
        <div className="myset">
          阅读设置：
          <a href="javascript:void(0)" title="减小字号" onClick={(e) => { e.preventDefault(); changeSize(-1) }} style={{ display: 'inline-block', padding: '2px 8px', border: '1px solid #E4E4E4', color: '#666', textDecoration: 'none', marginLeft: 8 }}>A-</a>
          <span style={{ color: '#999', fontSize: 12, margin: '0 6px' }}>{fontSize}px</span>
          <a href="javascript:void(0)" title="增大字号" onClick={(e) => { e.preventDefault(); changeSize(1) }} style={{ display: 'inline-block', padding: '2px 8px', border: '1px solid #E4E4E4', color: '#666', textDecoration: 'none' }}>A+</a>
          <span style={{ margin: '0 12px', color: '#eee' }}>|</span>
          <a href="javascript:void(0)" title="回顶部" onClick={(e) => { e.preventDefault(); goTop() }} style={{ color: '#2f468f', textDecoration: 'none' }}>回顶部</a>
          <span style={{ margin: '0 12px', color: '#eee' }}>|</span>
          <a href="javascript:void(0)" title="返回书页" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: '' }) }} style={{ color: '#2f468f', textDecoration: 'none' }}>返回书页</a>
        </div>

        {/* 章节标题 */}
        <h1>{chapterTitle || '章节阅读'}</h1>

        {/* 章节正文 #contents (CSS padding:25px;line-height:26px;font-size:14px) */}
        <div id="contents" style={{ fontSize: `${fontSize}px`, lineHeight: 1.9, color: '#333', wordBreak: 'break-word', textAlign: 'justify', textIndent: '2em' }}>
          {children || <p style={{ textAlign: 'center', color: '#999', textIndent: 0 }}>本章内容加载中...</p>}
        </div>

        {/* 操作按钮 .btnlinks (上下章翻页) */}
        <div className="btnlinks" style={{ textAlign: 'center', marginTop: 24 }}>
          {onPrev && (
            <a
              className="read"
              href="javascript:void(0)"
              title="上一章"
              onClick={(e) => { e.preventDefault(); onPrev() }}
            >« 上一章</a>
          )}
          <a
            href="javascript:void(0)"
            title="回顶部"
            onClick={(e) => { e.preventDefault(); goTop() }}
          >返回顶部</a>
          {onNext && (
            <a
              className="read"
              href="javascript:void(0)"
              title="下一章"
              onClick={(e) => { e.preventDefault(); onNext() }}
            >下一章 »</a>
          )}
        </div>
      </div>

      {/* ============ 文章底 #a_footer (上下章 / 返回书页) ============ */}
      <div id="a_footer">
        {onPrev && (
          <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onPrev() }} style={{ color: '#2f468f', textDecoration: 'none', marginRight: 16 }}>« 上一章</a>
        )}
        |
        <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: '' }) }} style={{ color: '#2f468f', textDecoration: 'none', margin: '0 16px' }}>返回书页</a>
        |
        {onNext && (
          <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onNext() }} style={{ color: '#2f468f', textDecoration: 'none', marginLeft: 16 }}>下一章 »</a>
        )}
      </div>

      {/* ============ 友情链接 + 页脚 ============ */}
      <div className="cl" style={{ height: 8 }} />
      <div className="main links">
        <div className="block">
          <div className="blocktitle">友情链接</div>
          <div className="blockmore"><a href="#" onClick={(e) => e.preventDefault()}>更多...</a></div>
          <div className="blockcontent">
            <ul className="ulrow">
              <li><a href="#" onClick={(e) => e.preventDefault()}>{site.name}</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()}>吾读小说网</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div className="cl" style={{ height: 8 }} />

      <div className="main footer">
        <div className="bdtop"><i /><span title="0" /></div>
        <div className="ftc">
          {site.footerText || `${site.name}无弹窗小说网承诺没有弹窗广告，${site.name}所有小说都能免费阅读。`}
          <br />
          {site.footerCopyright || `Copyright © 2012 ${site.name}(www.x2552.com)`} <a href="/1.html" onClick={(e) => e.preventDefault()}>网站地图</a> All Rights Reserved.
        </div>
      </div>

      {/* 隐藏入口 (排行榜/阅读足迹) */}
      <span style={{ display: 'none' }}>
        <a href="/top/lastupdate_1.html" onClick={goRanking}>排行榜</a>
        <a href="/history.html" onClick={goHistory}>阅读足迹</a>
      </span>
    </>
  )
}
