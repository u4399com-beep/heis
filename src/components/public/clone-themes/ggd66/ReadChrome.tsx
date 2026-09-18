'use client'
// ============================================================
// clone-ggd66 ReadChrome — 1:1 精仿 ggd66.com 章节阅读页
// 参考: agent-ctx/probe-html2/probe-ggd66.html + CSS .read / h1 / .readcontent /
//       #linkIndex / #linkPrev / #linkNext / .readmiddle / .kongwen / .booktag
// 复刻: .header > .container (.header-left .logo + .header-right + .header-nav)
//       / .container > .breadcrumb (首页 > 书库 > 书名 > 章节名)
//       / .container > .read (h1 章节标题 + .booktag 上/下/目录 + .readmiddle
//       .readcontent 章节正文 children + .kongwen 撑高 + .booktag 底部翻页)
//       / .footer
// CSS: .read 背景 #FBF4EC; .read h1 / .read .booktag color #00886d; .readcontent
//      font-size 24px / line-height 180% / letter-spacing .1em
// 全部用源站真实 class 名, 不用 inline style 换配色
// ============================================================
import { usePublic } from '../../ctx'
import type { ReadChromeProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

const DEFAULT_NAV: Cat[] = [
  { id: 'dushi', name: '都市言情' },
  { id: 'xuanhuan', name: '玄幻魔法' },
  { id: 'wuxia', name: '武侠修真' },
  { id: 'lishi', name: '历史军事' },
  { id: 'nvsheng', name: '女生耽美' },
  { id: 'youxi', name: '游戏竞技' },
  { id: 'kehuan', name: '科幻灵异' },
  { id: 'yanqing', name: '言情' },
  { id: 'other', name: '其它' },
]

const TOP_NAV: { id: string; name: string; view: 'home' | 'category' | 'fulltext' | 'search' }[] = [
  { id: 'home', name: '首 页', view: 'home' },
  { id: 'sort', name: '书 库', view: 'category' },
  { id: 'quanben', name: '全本', view: 'fulltext' },
  { id: 'search', name: '搜索', view: 'search' },
]

export function ReadChrome({ children, chapterTitle, onPrev, onNext, initialCategories }: ReadChromeProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))

  useEffect(() => {
    if (cats.length > 0) return
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
  }, [cats.length])

  // 章节切换时滚动到顶部
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  }, [chapterTitle])

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
    const q = (e.currentTarget.elements.namedItem('searchkey') as HTMLInputElement)?.value?.trim()
    if (q) navigate({ view: 'search', q })
  }
  const goRanking = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'ranking' })
  }
  const goFulltext = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'fulltext' })
  }
  const goBookToc = (e: React.MouseEvent) => {
    e.preventDefault()
    navigate({ view: 'book' })
  }
  const handlePrev = (e: React.MouseEvent) => {
    e.preventDefault()
    if (onPrev) onPrev()
  }
  const handleNext = (e: React.MouseEvent) => {
    e.preventDefault()
    if (onNext) onNext()
  }

  return (
    <>
      {/* ============ header ============ */}
      <div className="header">
        <div className="container">
          <div className="header-left">
            <a href="/" title={site.name} className="logo" onClick={goHome}>{site.name}</a>
          </div>
          <div className="header-right">
            <a href="/history.html" onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}>阅读历史</a>
            {' | '}
            <a href="/login/" onClick={(e) => e.preventDefault()}>登录</a>
            {' | '}
            <a href="/register" onClick={(e) => e.preventDefault()}>注册</a>
          </div>
          <div className="header-nav">
            {TOP_NAV.map(n => (
              <a
                key={n.id}
                href={n.view === 'home' ? '/' : n.view === 'category' ? '/sort/' : n.view === 'fulltext' ? '/quanben/sort/' : '/search/'}
                title={n.name.trim()}
                onClick={(e) => {
                  e.preventDefault()
                  if (n.view === 'home') navigate({ view: 'home' })
                  else if (n.view === 'category') navigate({ view: 'category' })
                  else if (n.view === 'fulltext') navigate({ view: 'fulltext' })
                  else navigate({ view: 'search' })
                }}
              >
                {n.name}
              </a>
            ))}
          </div>
        </div>
        <div className="clear"></div>
      </div>

      {/* ============ 主容器 ============ */}
      <div className="container">
        <ul className="breadcrumb">
          <li><a href="/" onClick={goHome}>首页</a></li>
          <li><a href="/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>书库</a></li>
          <li><a href="/top/rank/" onClick={goRanking}>排行</a></li>
          {cats[0] && <li><a href={`/sort/${cats[0].id}/`} onClick={(e) => goCat(e, cats[0].id)}>{cats[0].name}</a></li>}
          <li className="active">{chapterTitle || '阅读'}</li>
        </ul>

        {/* .read 阅读主体 */}
        <div className="read">
          <h1>{chapterTitle}</h1>
          <div className="booktag">
            {onPrev && <a id="linkPrev" href="javascript:;" onClick={handlePrev}>上一章</a>}
            <a id="linkIndex" href="javascript:;" onClick={goBookToc}>返回目录</a>
            {onNext && <a id="linkNext" href="javascript:;" onClick={handleNext}>下一章</a>}
          </div>
          <div className="readmiddle">
            <div className="readcontent">
              {children}
            </div>
          </div>
          <span className="kongwen"></span>
          <div className="booktag">
            {onPrev && <a id="linkPrev" href="javascript:;" onClick={handlePrev}>上一章</a>}
            <a id="linkIndex" href="javascript:;" onClick={goBookToc}>返回目录</a>
            {onNext && <a id="linkNext" href="javascript:;" onClick={handleNext}>下一章</a>}
          </div>
          <div className="clear"></div>
        </div>

        {/* 阅读页搜索条 + 友情链接 */}
        <div className="content">
          <div className="content-left">
            <div className="search hidden-xs">
              <form name="articlesearch" method="post" action="/search/" onSubmit={goSearch}>
                <input name="searchkey" type="text" className="text" id="searchkey" size={10} maxLength={50} placeholder="搜索从这里开始..." autoComplete="off" />
                <button type="submit" name="submit">搜  索</button>
              </form>
            </div>
          </div>
          <div className="content-right">
            <a href="/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>书库</a>
            {' | '}
            <a href="/quanben/sort/" onClick={goFulltext}>全本</a>
            {' | '}
            <a href="/top/rank/" onClick={goRanking}>排行</a>
          </div>
          <div className="clear"></div>
        </div>

        {/* 友情链接 */}
        <div className="content tuijian hidden-xs">
          友情链接：
          <div className="class">
            <ul>
              <li><a href="/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'category' }) }}>书库</a></li>
              <li><a href="/quanben/sort/" onClick={(e) => { e.preventDefault(); navigate({ view: 'fulltext' }) }}>全本</a></li>
              {cats.slice(0, 9).map(c => (
                <li key={c.id}><a href={`/sort/${c.id}/`} onClick={(e) => goCat(e, c.id)}>{c.name}</a></li>
              ))}
            </ul>
          </div>
          <div className="clear"></div>
        </div>
      </div>

      {/* ============ footer ============ */}
      <div className="footer">
        <p className="hidden-xs">本站所有小说为转载作品，所有章节均由网友上传，转载至本站只是为了宣传本书让更多读者欣赏。</p>
        <p className="hidden-xs">Copyright {new Date().getFullYear()} {site.name}({site.domain}) All Rights Reserved.</p>
        <div className="clear"></div>
      </div>
    </>
  )
}
