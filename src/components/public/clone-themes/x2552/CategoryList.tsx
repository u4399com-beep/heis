'use client'
// ============================================================
// clone-x2552 CategoryList — 1:1 精仿 x2552.com 吾爱文学网分类列表页
// 注: x2552 没有子页 probe, 按 JieQi CMS 标准分类列表页模板构造
//     (源站 URL /list/{catId}_{page}.html, 模板风格与首页一致)
// 复刻: .main.m_head (header + searchbox) / .main.m_menu (10 分类 + 全本,
//       当前分类高亮) / .main > .block (.blocktitle "分类名 - X 分类小说" +
//       .blockcontent 含 table 列表 thead 类别/书名/最新章节/作者/字数/更新时间 +
//       tbody tr × N + .pagelink 分页 上一页/页码/下一页) / .main.links / .main.footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/x2552.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
import { formatWords } from '../../seo'
import type { CategoryListProps } from '../shared'
import { useEffect, useState } from 'react'

interface Cat { id: string; name: string }

// 源站 10 个分类 (与首页 m_menu 顺序一致, fetch 失败兜底)
const DEFAULT_NAV: Cat[] = [
  { id: '1', name: '玄幻魔法' }, { id: '2', name: '武侠修真' },
  { id: '3', name: '都市言情' }, { id: '4', name: '历史军事' },
  { id: '5', name: '侦探推理' }, { id: '6', name: '网游动漫' },
  { id: '7', name: '科幻小说' }, { id: '8', name: '恐怖灵异' },
  { id: '9', name: '文学名著' }, { id: '10', name: '其他' },
]

export function CategoryList({ books, loading, label, page, total, size = 24, onPage, initialCategories }: CategoryListProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))

  // 拉分类列表用于 m_menu 导航
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

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 10)
  const totalPages = Math.max(1, Math.ceil(total / size))
  const fmtDateShort = (d?: string) => d ? new Date(d).toISOString().slice(2, 10) : ''

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

  // 分页区间 (与源站 .pagelink 风格一致: 上一页/页码/下一页)
  const renderPager = () => {
    if (total <= size) return null
    const start = Math.max(1, page - 4)
    const end = Math.min(totalPages, start + 9)
    const nums: number[] = []
    for (let i = start; i <= end; i++) nums.push(i)
    return (
      <div className="pagelink">
        {page > 1 ? (
          <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onPage(page - 1) }}>上一页</a>
        ) : (
          <a href="javascript:alert('已经是第一页了');" onClick={(e) => e.preventDefault()}>第一页</a>
        )}
        {nums.map(n => n === page ? (
          <strong key={n}>{n}</strong>
        ) : (
          <a key={n} href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onPage(n) }}>{n}</a>
        ))}
        {page < totalPages ? (
          <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onPage(page + 1) }}>下一页</a>
        ) : (
          <a href="javascript:alert('已经是最后一页了');" onClick={(e) => e.preventDefault()}>最后页</a>
        )}
      </div>
    )
  }

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

      {/* ============ 导航 menu (m_menu, 当前分类高亮) ============ */}
      <div className="main m_menu">
        <ul>
          <li className="m_ml" />
          <li><a href="/" onClick={goHome}>吾爱首页</a></li>
          {navCats.map(c => (
            <li key={c.id} className={label === c.name ? 'current' : ''}>
              <a href={`/list/${c.id}_1.html`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
            </li>
          ))}
          <li><a href="/fulltxt/1_1.html" onClick={goFulltext}>全本</a></li>
          <li className="m_bc"><a rel="nofollow" href="#" onClick={(e) => e.preventDefault()} title="我的书架" /></li>
          <li className="m_mr" />
        </ul>
      </div>

      {/* ============ 公告红框 ============ */}
      <div style={{ border: '1px solid #E4E4E4', color: 'red', width: 960, lineHeight: '25px', margin: '5px auto', padding: 0, textAlign: 'left' }}>
        &nbsp;&nbsp;&nbsp;&nbsp;1、{site.name}全面升级，<a href="#" onClick={(e) => e.preventDefault()}><b>手机版</b></a>同时上线 欢迎新老书友前来阅读。<br />
        &nbsp;&nbsp;&nbsp;&nbsp;2、感谢大家多年支持，{site.name} 坚持无弹窗广告阅读
      </div>

      {/* ============ 分类列表 block ============ */}
      <div className="main">
        <div className="block">
          <div className="blocktitle"><i />{label}</div>
          <div className="blockcontent">
            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>加载中...</div>
            ) : !books.length ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
                暂无该分类下的书籍
                <br />
                <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); navigate({ view: 'home' }) }} style={{ display: 'inline-block', marginTop: 16, padding: '6px 16px', background: '#2f468f', color: '#fff', textDecoration: 'none' }}>返回首页</a>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '12%' }}>类别</th>
                    <th style={{ width: '28%' }}>书名</th>
                    <th style={{ width: '30%' }}>最新章节</th>
                    <th style={{ width: '10%' }}>作者</th>
                    <th style={{ width: '10%' }}>字数</th>
                    <th style={{ width: '10%' }}>更新</th>
                  </tr>
                </thead>
                <tbody>
                  {books.map(b => (
                    <tr key={b.id}>
                      <td>
                        <a href={`/list/${b.categoryId || '0'}_1.html`} onClick={(e) => goCat(e, b.categoryId || undefined)}>[{b.category || '小说'}]</a>
                      </td>
                      <td>
                        <a href={`/html/${b.categoryId || '0'}/${b.id}/`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                      </td>
                      <td>
                        <a href={`/html/${b.categoryId || '0'}/${b.id}/${b.id}.html`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.latestChapter || '最新章节'}</a>
                      </td>
                      <td>{b.author}</td>
                      <td><span className="hottext">{formatWords(b.wordCount)}</span></td>
                      <td>{fmtDateShort(b.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {renderPager()}
          </div>
        </div>
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
