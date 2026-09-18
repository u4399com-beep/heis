'use client'
// ============================================================
// clone-aijjxs ReadChrome — 1:1 精仿 aijjxs.com 章节阅读页外壳
// 参考: agent-ctx/probe-html2/probe-aijjxs-chapter.html (源站真实 DOM)
// 复刻: .top-float (顶部固定分类导航) / .wrap > .top (logo+搜索)
//       / .layout > .cenMain (.articleInfo h1 章节标题 + 章节正文 children
//       + 上下章翻页 .lines) / .foot
// CSS 由 CloneCSSLoader 加载 public/clone-css/aijjxs.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: 'chuanyue', name: '穿越' }, { id: 'chongshengxiaoshuo', name: '重生' },
  { id: 'lsjs', name: '古代架空' }, { id: 'young', name: '现代言情' },
  { id: 'qinggan', name: '总裁豪门' }, { id: 'wuxia', name: '仙侠幻想' },
  { id: 'tongrenxiaoshuo', name: '同人衍生' }, { id: 'wuxianliu', name: '无限流' },
  { id: 'dmtr', name: '耽于纯美' }, { id: 'xuanhuan', name: '玄幻魔法' },
  { id: 'dushi', name: '都市异能' }, { id: 'tiexue', name: '历史军事' },
  { id: 'juben', name: '网游小说' }, { id: 'kongbu', name: '惊悚悬疑' },
  { id: 'gdmz', name: '文学名著' },
]

export function ReadChrome({ children, chapterTitle, onPrev, onNext }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])

  useEffect(() => {
    let aborted = false
    fetch('/api/public/categories?limit=60')
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const arr = Array.isArray(d) ? d : (d.data?.items || d.data?.categories || d.items || d.categories || [])
        const mapped: Cat[] = arr.map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) }))
        setCats(mapped.length ? mapped : DEFAULT_NAV)
      })
      .catch(() => { if (!aborted) setCats(DEFAULT_NAV) })
    return () => { aborted = true }
  }, [])

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 15)

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    navigate({ view: 'category', cat: catId })
  }
  const goHome = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'home' })
  }
  const goSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = (e.currentTarget.elements.namedItem('keyboard') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }

  return (
    <>
      {/* 顶部固定分类导航条 */}
      <div className="top-float">
        <div className="top-float-inner">
          <nav className="top-float-nav">
            <a href="/" onClick={goHome}>首页</a>
            {navCats.map(c => (
              <a key={c.id} href={`/txt/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
            ))}
          </nav>
          <div className="top-float-auth"></div>
        </div>
      </div>

      <div className="wrap">
        {/* 顶部搜索区 */}
        <header className="top">
          <div className="top-1">
            <h1 className="logo">{site.name}<small>快速找到你想要的TXT电子书</small></h1>
            <div className="top-links"></div>
          </div>
          <form className="search" onSubmit={goSearch}>
            <input type="hidden" name="show" value="title,writer" />
            <input type="text" name="keyboard" placeholder="请输入书名或作者关键字" autoComplete="off" />
            <button type="submit">搜索全站</button>
          </form>
        </header>

        <main className="layout">
          <div className="cenMain">
            {/* 章节标题 */}
            {chapterTitle && (
              <div className="articleInfo">
                <h1>{chapterTitle}</h1>
              </div>
            )}

            {/* 章节正文 (children 由父视图渲染分页/段落) */}
            <div className="catalog" style={{ padding: '4px 8px 14px' }}>
              <article className="panel" style={{ marginBottom: 14 }}>
                <div className="body" style={{ fontSize: 16, lineHeight: 1.9, color: '#1f2937' }}>
                  {children}
                </div>
              </article>
            </div>

            {/* 上下章翻页 */}
            {(onPrev || onNext) && (
              <article className="panel" style={{ marginTop: 14 }}>
                <div className="body">
                  <ul className="lines">
                    {onPrev && <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); onPrev() }}>上一章</a></li>}
                    {onNext && <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); onNext() }}>下一章</a></li>}
                    <li><a href="javascript:;" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }}>返回首页</a></li>
                  </ul>
                </div>
              </article>
            )}
          </div>

          <aside>
            <article className="panel">
              <h3>阅读提示</h3>
              <div className="body">
                <div className="desc">
                  如果您喜欢本站, 欢迎按 <kbd>Ctrl+D</kbd> 收藏本站, 方便下次继续阅读。
                  本站所有小说均系网友上传, 仅供书友之间免费阅读预览！
                </div>
              </div>
            </article>

            <article className="panel" style={{ marginTop: 14 }}>
              <h3>分类导航</h3>
              <div className="body">
                <ul className="lines">
                  {navCats.slice(0, 10).map(c => (
                    <li key={c.id}><a href={`/txt/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a></li>
                  ))}
                </ul>
              </div>
            </article>
          </aside>
        </main>

        <footer className="foot">
          <a href="/support/about.html">网站简介</a> · <a href="/support/help.html">网站帮助</a> · <a href="/support/declare.html">版权声明</a> · <a href="/support/sitemap.html">网站地图</a><br />
          Copyright © {site.name} All Rights Reserved<br />
          本站所有小说电子书均系网友上传，仅供书友之间免费下载预览！
        </footer>
      </div>
    </>
  )
}
