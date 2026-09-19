'use client'
// ============================================================
// clone-x2552 HomeClone — 1:1 精仿 x2552.com 吾爱文学网首页
// 参考: agent-ctx/probe-html2/probe-x2552.html (源站真实 DOM, 27KB GBK)
// 复刻: .main.m_head (h_logo + h_body 简繁切换 + searchbox dt/dd + loginbox)
//       / .main.m_menu (10 分类导航 + 全本 + m_bc 书架) / 公告红框
//       / .main.board (.bdtop + .bdsub > dl#s_dl > dt p#s_dt a.current + abbr > bdo#s_dd
//       6 张大封面排行榜) / .main > #centeri (.block.blocktitle 吾爱小说网最近更新
//       .blockcontent ul.update li × N, li.more 更多) + #right (.block 总推荐榜 ul.ultop +
//       .block 最新小说 ul.ultop) / .main.links (.block 友情链接 ul.ulrow) /
//       .main.footer (.bdtop + .ftc 版权)
// CSS 由 CloneCSSLoader 加载 public/clone-css/x2552.css (蓝紫链 #2f468f + 橙 hover #ff6600),
// 全部用源站真实 class 名, 不用 inline style 换配色
// ============================================================
import { usePublic } from '../../ctx'
import { BookCover } from '../../BookCover'
import { bookNavProps } from '../../bits'
import { addFavoriteSite, useTraditionalChinese } from '../tools'
import type { HomeCloneProps } from '../shared'
import { cloneNavHandlers, useCloneCategories } from '../shared'
import type { BookItem } from '../../types'

interface Cat { id: string; name: string }

// 源站 10 个分类 (与 probe m_menu 顺序一致, fetch 失败兜底)
// URL pattern: /list/{id}_1.html
const DEFAULT_NAV: Cat[] = [
  { id: '1', name: '玄幻魔法' }, { id: '2', name: '武侠修真' },
  { id: '3', name: '都市言情' }, { id: '4', name: '历史军事' },
  { id: '5', name: '侦探推理' }, { id: '6', name: '网游动漫' },
  { id: '7', name: '科幻小说' }, { id: '8', name: '恐怖灵异' },
  { id: '9', name: '文学名著' }, { id: '10', name: '其他' },
]

export function HomeClone({ books, loading, navCategoryCount = 10, homeModuleLimit = 36, initialCategories }: HomeCloneProps) {
  const { site, navigate } = usePublic()
  // 简繁切换状态 + setTc (用于 .h_body p 的 简体版/繁体版 链接)
  const { isTc, mounted, setTc } = useTraditionalChinese()
  // R28-1A: 复用 useCloneCategories (SSR initialCategories 优先 + 空时 fetch + DEFAULT_NAV 兜底)
  const cats = useCloneCategories(initialCategories, DEFAULT_NAV)

  // 拉分类列表用于 m_menu 导航

  const navCats = (cats.length ? cats : DEFAULT_NAV).slice(0, navCategoryCount)

  if (loading) return <div className="main" style={{ padding: 40, textAlign: 'center' }}>加载中...</div>
  if (!books.length) return <div className="main" style={{ padding: 40, textAlign: 'center' }}>暂无内容</div>

  // —— 数据切片 (与源站各模块对齐) ——
  // board 排行榜: 字数最多前 6 本 (源站 .board bdo#s_dd 6 张大封面)
  const boardBooks: BookItem[] = [...books].sort((a, b) => (b.wordCount || 0) - (a.wordCount || 0)).slice(0, 6)
  // 最近更新: 前 N 本 (源站 ul.update 36 行 li)
  const updateBooks = books.slice(0, homeModuleLimit)
  // 总推荐榜: 前 15 本 (源站 ul.ultop 推荐榜 15 条)
  const voteList = books.slice(0, 15)
  // 最新小说: 前 15 本 (源站 ul.ultop 最新小说 15 条)
  const newList = books.slice(0, 15)

  // R27-1C: 复用 cloneNavHandlers
  const { goHome, goSearch, goCat } = cloneNavHandlers(navigate, 'searchkey')
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

  // 格式化日期为 YY-MM-DD (与源站 ul.update li 末尾日期格式一致)
  const fmtDateShort = (d?: string) => d ? new Date(d).toISOString().slice(2, 10) : ''
  // 推荐数 (源站 ul.ultop li p 是数字, 用 wordCount/100 模拟)
  const voteCount = (b: BookItem, i: number) => Math.max(1, Math.floor((b.wordCount || 0) / 100) - i * 10)

  // 模拟排行榜分页点 (源站 JS wamccshow() 切换 6 张封面, 这里静态只显示一页)
  const rankPages = Math.max(1, Math.ceil(boardBooks.length / 6))

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
              <a rel="nofollow" href="#tc-toggle" onClick={(e) => { e.preventDefault(); setTc(false) }} title="切换为简体">简体版</a> | <a rel="nofollow" href="#tc-toggle" onClick={(e) => { e.preventDefault(); setTc(true) }} title="切换为繁体">繁体版</a> | <a rel="nofollow" href="#favorite" onClick={(e) => addFavoriteSite(e)} title="加入收藏 (Ctrl+D)">加入收藏</a>
              {mounted && isTc ? <span style={{ marginLeft: 6, color: '#f50' }}>【繁体模式】</span> : null}
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
            <li key={c.id}><a href={`/list/${c.id}_1.html`} onClick={(e) => goCat(e, c.id)}>{c.name}</a></li>
          ))}
          <li><a href="/fulltxt/1_1.html" onClick={goFulltext}>全本</a></li>
          <li className="m_bc"><a rel="nofollow" href="#" onClick={(e) => e.preventDefault()} title="我的书架" /></li>
          <li className="m_mr" />
        </ul>
      </div>

      {/* ============ 公告红框 (源站红色边框公告条) ============ */}
      <div style={{ border: '1px solid #E4E4E4', color: 'red', width: 960, lineHeight: '25px', margin: '5px auto', padding: 0, textAlign: 'left' }}>
        &nbsp;&nbsp;&nbsp;&nbsp;1、{site.name}全面升级，<a href="#" onClick={(e) => e.preventDefault()}><b>手机版</b></a>同时上线 欢迎新老书友前来阅读。<br />
        &nbsp;&nbsp;&nbsp;&nbsp;2、感谢大家多年支持，{site.name} 坚持无弹窗广告阅读
      </div>

      {/* ============ 排行榜 board (源站 6 张大封面 carousel) ============ */}
      <div className="main board">
        <div className="bdtop" />
        <div className="bdsub">
          <dl id="s_dl">
            <dt>
              <p id="s_dt">
                {Array.from({ length: rankPages }).map((_, i) => (
                  <a key={i} href="javascript:void(0);" className={i === 0 ? 'current' : ''} onClick={(e) => e.preventDefault()} />
                ))}
              </p>
              {site.name}排行榜
            </dt>
            <abbr><bdo id="s_dd">
              {boardBooks.map(b => (
                <dd key={b.id} style={{ display: 'block' }}>
                  <a href={`/html/${b.categoryId || '0'}/${b.id}/`} target="_blank" {...bookNavProps(navigate, b.id)}>
                    <BookCover name={b.name} cover={b.cover} style={{ width: 120, height: 150, border: '1px solid #E4E4E4', padding: 5, background: '#fff' }} />
                  </a>
                  <br />
                  <a href={`/html/${b.categoryId || '0'}/${b.id}/`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                </dd>
              ))}
            </bdo></abbr>
          </dl>
        </div>
      </div>

      {/* ============ 中心区域 (.main > #centeri + #right) ============ */}
      <div className="main">
        <div id="centeri">
          <div className="block">
            <div className="blocktitle"><i />{site.name}最近更新</div>
            <div className="blockcontent">
              <ul className="update">
                {updateBooks.map(b => (
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
                ))}
                <li className="more"><a href="/top/lastupdate_1.html" onClick={goRanking}>更多...</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div id="right">
          {/* 总推荐榜 */}
          <div className="block">
            <div className="blocktitle"><span>{site.name}总推荐榜</span></div>
            <div className="blockcontent">
              <ul className="ultop">
                {voteList.map((b, i) => (
                  <li key={b.id}>
                    <p>{voteCount(b, i)}</p>
                    <a href={`/html/${b.categoryId || '0'}/${b.id}/`} target="_blank" {...bookNavProps(navigate, b.id)}>{b.name}</a>
                  </li>
                ))}
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
                <li style={{ listStyle: 'none', textAlign: 'right', border: 'none' }}>
                  <a href="/top/postdate_1.html" onClick={goRanking}>更多...</a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ============ 友情链接 (links) ============ */}
      <div className="cl" style={{ height: 8 }} />
      <div className="main links">
        <div className="block">
          <div className="blocktitle">友情链接</div>
          <div className="blockmore"><a href="#" onClick={(e) => e.preventDefault()}>更多...</a></div>
          <div className="blockcontent">
            <ul className="ulrow">
              <li><a href="#" onClick={(e) => e.preventDefault()}>{site.name}</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()}>吾读小说网</a></li>
              <li><a href="#" onClick={(e) => e.preventDefault()}>无弹窗小说</a></li>
            </ul>
          </div>
        </div>
      </div>
      <div className="cl" style={{ height: 8 }} />

      {/* ============ 页脚 footer ============ */}
      <div className="main footer">
        <div className="bdtop"><i /><span title="0" /></div>
        <div className="ftc">
          {site.footerText || `${site.name}无弹窗小说网承诺没有弹窗广告，${site.name}所有小说都能免费阅读。找好看的小说网站，就来${site.name}http://www.x2552.com`}
          <br />
          请所有网友上传作品时务必遵守国家互联网信息管理办法规定，{site.name}拒绝任何色情小说，一经发现，即作删除
          <br />
          {site.footerCopyright || `Copyright © 2012 ${site.name}(www.x2552.com)`} <a href="/1.html" onClick={(e) => e.preventDefault()}>网站地图</a> All Rights Reserved.
        </div>
      </div>

      {/* 阅读足迹 (隐藏入口, 给键盘可达 footer 链接) */}
      <span style={{ display: 'none' }}>
        <a href="/history.html" onClick={goHistory}>阅读足迹</a>
      </span>
    </>
  )
}
