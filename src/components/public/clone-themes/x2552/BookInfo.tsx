'use client'
// ============================================================
// clone-x2552 BookInfo — 1:1 精仿 x2552.com 吾爱文学网书籍详情页
// 注: x2552 没有子页 probe, 按 JieQi CMS 标准书籍详情页模板构造
//     (源站 URL /html/{catId-prefix}/{bookId}/, 模板风格与首页一致)
// 复刻: .main.m_head (header + searchbox) / .main.m_menu (10 分类 + 全本) /
//       #a_head (article header: 面包屑 + 小搜索 .so input+a) /
//       #a_main #at (table: 封面 td + 标题/作者/分类/状态/字数/最新章节 td +
//       简介行 + .btnlinks 操作按钮 开始阅读/查看目录/加入书架) /
//       .block 章节列表 (.blocktitle + .blockcontent ul.update 最新 12 章 +
//       li.more 查看更多) + #right (.block 总推荐榜 ul.ultop 15 本 +
//       .block 最新小说 ul.ultop 15 本) / .main.links / .main.footer
// CSS 由 CloneCSSLoader 加载 public/clone-css/x2552.css, 全部用源站真实 class 名
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { formatWords, statusLabel } from '../../seo'
import type { BookInfoProps } from '../shared'
import type { BookItem } from '../../types'
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

export function BookInfo({ book, onScrollToc, onContinueRead, onGoCategory }: BookInfoProps) {
  const { site, navigate } = usePublic()
  const [cats, setCats] = useState<Cat[]>([])
  const [related, setRelated] = useState<BookItem[]>([])

  // 拉分类列表用于 m_menu 导航
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

  // 拉"猜您喜欢"/侧栏推荐榜: 同分类前 15 本(排除当前书)
  useEffect(() => {
    if (!book?.id) return
    let aborted = false
    const cat = book.categoryId || ''
    const sp = new URLSearchParams({ size: '15', sort: 'hot' })
    if (cat) sp.set('cat', cat)
    if (site?.id) sp.set('site', site.id)
    fetch(`/api/public/books?${sp.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (aborted) return
        const list: BookItem[] = (d?.data?.books || d?.books || d?.data?.items || []).filter((b: BookItem) => b.id !== book.id).slice(0, 15)
        setRelated(list)
      })
      .catch(() => {})
    return () => { aborted = true }
  }, [book?.id, book?.categoryId, site?.id])

  if (!book) return null

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, 10)
  // 总推荐榜: 前 15 本
  const voteList = related.slice(0, 15)
  // 最新小说: 取前 15 本 (使用 books prop 不存在, 改用 related 反转, 兜底为同分类前 15 本)
  const newList = (related.length ? related : []).slice(0, 15)
  // 最新章节列表: 同分类前 12 本 (与 .block 章节列表对齐, 显示同分类最新更新)
  const chapterList = (related.length ? related : []).slice(0, 12)

  const goCat = (e: React.MouseEvent, catId?: string) => {
    e.preventDefault()
    if (onGoCategory && catId) onGoCategory(catId)
    else navigate({ view: 'category', cat: catId })
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

  // 标签拆分 (book.keywords 以逗号或顿号分隔)
  const tagList: string[] = (book.keywords || '').split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 8)
  const fmtDateShort = (d?: string) => d ? new Date(d).toISOString().slice(2, 10) : ''
  const fmtDateLong = (d?: string) => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : ''

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
          {navCats.map(c => (
            <li key={c.id} className={book.categoryId === c.id ? 'current' : ''}>
              <a href={`/list/${c.id}_1.html`} onClick={(e) => goCat(e, c.id)}>{c.name}</a>
            </li>
          ))}
          <li><a href="/fulltxt/1_1.html" onClick={goFulltext}>全本</a></li>
          <li className="m_bc"><a rel="nofollow" href="#" onClick={(e) => e.preventDefault()} title="我的书架" /></li>
          <li className="m_mr" />
        </ul>
      </div>

      {/* ============ 文章头 #a_head (面包屑 + 小搜索框) ============ */}
      <div id="a_head">
        <ul>
          <li><a href="/" onClick={goHome}>{site.name}</a> &gt; </li>
          <li>
            <a href={`/list/${book.categoryId || '0'}_1.html`} onClick={(e) => goCat(e, book.categoryId || undefined)}>{book.category || '小说'}</a> &gt;
          </li>
          <li>{book.name}</li>
        </ul>
        <form className="so" action="/modules/article/search.php" method="post" onSubmit={goSearch}>
          <input type="hidden" name="searchtype" value="articlename" />
          <input type="text" name="searchkey" placeholder="书名" autoComplete="off" />
          <a href="javascript:void(0);" onClick={(e) => { e.preventDefault(); goSearch(e as unknown as React.FormEvent<HTMLFormElement>) }}>搜索</a>
        </form>
      </div>

      {/* ============ 文章主体 #a_main (table #at 书籍信息) ============ */}
      <div id="a_main">
        <dl id="at">
          <dt>
            <h1>{book.name}</h1>
          </dt>
          <table>
            <tbody>
              <tr>
                <td className="grid">
                  {/* 封面 */}
                  <BookCover name={book.name} cover={book.cover} style={{ width: 120, height: 150, border: '1px solid #E4E4E4', padding: 5, background: '#fff', float: 'left', marginRight: 15 }} />
                </td>
                <td className="even">
                  {/* 书籍元信息 */}
                  <p>作&nbsp;&nbsp;&nbsp;&nbsp;者：
                    <a href="javascript:void(0)" title={book.author} onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: book.author }) }}>
                      <span className="hottext">{book.author}</span>
                    </a>
                  </p>
                  <p>类&nbsp;&nbsp;&nbsp;&nbsp;别：
                    {book.categoryId ? (
                      <a href={`/list/${book.categoryId}_1.html`} onClick={(e) => goCat(e, book.categoryId || undefined)}>{book.category || '小说'}</a>
                    ) : (
                      <span>{book.category || '小说'}</span>
                    )}
                  </p>
                  <p>状&nbsp;&nbsp;&nbsp;&nbsp;态：<span className="hottext">{statusLabel(book.status)}</span></p>
                  <p>字&nbsp;&nbsp;&nbsp;&nbsp;数：<span className="hottext">{formatWords(book.wordCount)}</span></p>
                  <p>最新章节：
                    <a href={`javascript:void(0)`} title={book.latestChapter || '第1章'} onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}>
                      {book.latestChapter || '第1章'}
                    </a>
                    <span style={{ color: '#999', marginLeft: 8 }}>{fmtDateLong(book.updatedAt)}</span>
                  </p>
                  {/* 标签 */}
                  {tagList.length > 0 && (
                    <p className="tags">
                      标签：
                      {tagList.map(t => (
                        <a key={t} href="javascript:void(0)" onClick={(e) => { e.preventDefault(); navigate({ view: 'keyword', tag: t }) }}>{t}</a>
                      ))}
                    </p>
                  )}
                </td>
              </tr>
              <tr>
                <td className="grid" colSpan={2}>
                  {/* 内容简介 */}
                  <div className="tips">
                    <strong>内容简介：</strong>
                    <br />
                    <span style={{ lineHeight: '26px', textIndent: '2em', display: 'block' }}>{book.intro || '暂无简介'}</span>
                  </div>
                  {/* 操作按钮 .btnlinks */}
                  <div className="btnlinks">
                    <a
                      className="read"
                      href="javascript:void(0)"
                      title={`开始阅读${book.name}`}
                      onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}
                    >开始阅读</a>
                    <a
                      href="javascript:void(0)"
                      title="查看目录"
                      onClick={(e) => { e.preventDefault(); onScrollToc() }}
                    >查看目录</a>
                    <a
                      href="javascript:void(0)"
                      title="加入书架"
                      onClick={(e) => { e.preventDefault(); navigate({ view: 'history' }) }}
                    >加入书架</a>
                    <a
                      href="javascript:void(0)"
                      title="返回列表"
                      onClick={(e) => { e.preventDefault(); if (book.categoryId) navigate({ view: 'category', cat: book.categoryId }); else navigate({ view: 'home' }) }}
                    >返回列表</a>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </dl>
      </div>

      {/* ============ 章节列表 block ============ */}
      <div className="main">
        <div id="centeri">
          <div className="block">
            <div className="blocktitle"><i />{book.name}最新章节</div>
            <div className="blockcontent">
              <ul className="update">
                {chapterList.length > 0 ? chapterList.map(b => (
                  <li key={b.id}>
                    <p className="ul1">
                      <a href={`/list/${b.categoryId || '0'}_1.html`} onClick={(e) => goCat(e, b.categoryId || undefined)}>[{b.category || '小说'}]</a>
                      《<a className="poptext" href={`/html/${b.categoryId || '0'}/${b.id}/`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>》
                    </p>
                    <p className="ul2">
                      <a href={`/html/${b.categoryId || '0'}/${b.id}/${b.id}.html`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.latestChapter || '最新章节'}</a>
                    </p>
                    <p>{b.author}</p>
                    {fmtDateShort(b.updatedAt)}
                  </li>
                )) : (
                  <li>
                    <p className="ul1">
                      《<a className="poptext" href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onScrollToc() }}>{book.name}</a>》
                    </p>
                    <p className="ul2">
                      <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); if (onContinueRead) onContinueRead(); else onScrollToc() }}>{book.latestChapter || '第1章'}</a>
                    </p>
                    <p>{book.author}</p>
                    {fmtDateShort(book.updatedAt)}
                  </li>
                )}
                <li className="more">
                  <a href="javascript:void(0)" onClick={(e) => { e.preventDefault(); onScrollToc() }}>查看完整章节目录...</a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* 右侧栏 #right */}
        <div id="right">
          {/* 总推荐榜 */}
          <div className="block">
            <div className="blocktitle"><span>{site.name}总推荐榜</span></div>
            <div className="blockcontent">
              <ul className="ultop">
                {voteList.map((b, i) => (
                  <li key={b.id}>
                    <p>{Math.max(1, Math.floor((b.wordCount || 0) / 100) - i * 10)}</p>
                    <a href={`/html/${b.categoryId || '0'}/${b.id}/`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                  </li>
                ))}
                {voteList.length === 0 && (
                  <li style={{ listStyle: 'none', textAlign: 'center', border: 'none', color: '#999' }}>暂无推荐</li>
                )}
                <li style={{ listStyle: 'none', textAlign: 'right', border: 'none' }}>
                  <a href="/top/allvote_1.html" onClick={goRanking}>更多...</a>
                </li>
              </ul>
            </div>
          </div>

          {/* 最新小说 */}
          <div className="block">
            <div className="blocktitle"><span>{site.name}最新小说</span></div>
            <div className="blockcontent">
              <ul className="ultop">
                {newList.map(b => (
                  <li key={b.id}>
                    <p>{fmtDateShort(b.updatedAt) || '00-00'}</p>
                    <a href={`/html/${b.categoryId || '0'}/${b.id}/`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                  </li>
                ))}
                {newList.length === 0 && (
                  <li style={{ listStyle: 'none', textAlign: 'center', border: 'none', color: '#999' }}>暂无最新</li>
                )}
                <li style={{ listStyle: 'none', textAlign: 'right', border: 'none' }}>
                  <a href="/top/postdate_1.html" onClick={goRanking}>更多...</a>
                </li>
              </ul>
            </div>
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

      {/* 阅读足迹 (隐藏入口) */}
      <span style={{ display: 'none' }}>
        <a href="/history.html" onClick={goHistory}>阅读足迹</a>
      </span>
    </>
  )
}
