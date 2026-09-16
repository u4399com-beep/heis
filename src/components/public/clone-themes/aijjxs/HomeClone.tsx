// aijjxs.com 首页 1:1 克隆 — 使用源站 CSS class 名, 硬编码颜色
// 源站 CSS: /clone-css/aijjxs.css (由 CloneCSSLoader 加载)
// 源站 DOM: .top-float > nav.top-float-nav + .wrap > header.top + main.layout
'use client'

import type { HomeCloneProps } from '../shared'
import { usePublic } from '../../ctx'
import { formatWords, fmtDate } from '../../seo'
import { BookCover } from '../../BookCover'

function Skeleton() {
  return (
    <div className="wrap" style={{ maxWidth: 1220, margin: '0 auto', padding: '18px 14px 36px' }}>
      <div style={{ background: 'rgba(255,253,248,.9)', border: '1px solid #e5dccd', borderRadius: 14, padding: 24, marginBottom: 14 }}>
        <div style={{ height: 28, background: '#f3efe7', borderRadius: 7, marginBottom: 12 }} />
        <div style={{ height: 36, background: '#f3efe7', borderRadius: 7 }} />
      </div>
    </div>
  )
}

export function HomeClone({ books, loading, navCategoryCount = 16, homeModuleLimit = 20 }: HomeCloneProps) {
  const { site, navigate } = usePublic()

  if (loading) return <Skeleton />
  if (!books.length) return null

  // 源站实际导航分类 (从 probe-aijjxs.html 提取)
  const NAV_ITEMS = [
    { name: '首页', href: '/' },
    { name: '穿越', href: '/txt/chuanyue/' },
    { name: '重生', href: '/txt/chongshengxiaoshuo/' },
    { name: '古代架空', href: '/txt/lsjs/' },
    { name: '现代言情', href: '/txt/young/' },
    { name: '总裁豪门', href: '/txt/qinggan/' },
    { name: '仙侠幻想', href: '/txt/wuxia/' },
    { name: '同人衍生', href: '/txt/tongrenxiaoshuo/' },
    { name: '无限流', href: '/txt/wuxianliu/' },
    { name: '耽于纯美', href: '/txt/dmtr/' },
    { name: '玄幻魔法', href: '/txt/xuanhuan/' },
    { name: '都市异能', href: '/txt/dushi/' },
    { name: '历史军事', href: '/txt/tiexue/' },
    { name: '网游小说', href: '/txt/juben/' },
    { name: '惊悚悬疑', href: '/txt/kongbu/' },
    { name: '文学名著', href: '/txt/gdmz/' },
  ]
  const visibleNav = NAV_ITEMS.slice(0, navCategoryCount)

  // 热搜词 (从源站提取)
  const HOT_SEARCH = ['末日', '白月光', '末世', '直播', '万人迷', '女帝', '游戏入侵', '诡秘之主', '斗破', '香江']

  const latestBooks = books.slice(0, homeModuleLimit)
  const rankBooks = books.slice(0, 10)

  return (
    <>
      {/* 源站 .top-float 导航条 */}
      <div className="top-float" style={{ position: 'sticky', top: 0, zIndex: 100, background: '#fff', borderBottom: '2px solid #0f766e' }}>
        <div className="top-float-inner" style={{ maxWidth: 1220, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', height: 44 }}>
          <nav className="top-float-nav" style={{ display: 'flex', gap: 0, flexWrap: 'wrap', overflow: 'hidden' }}>
            {visibleNav.map((item, i) => (
              <a
                key={item.name}
                href={item.href}
                onClick={(e) => { e.preventDefault(); if (i === 0) navigate({ view: 'home' }) }}
                style={{
                  padding: '0 12px',
                  fontSize: 14,
                  lineHeight: '44px',
                  color: i === 0 ? '#0f766e' : '#6b7280',
                  fontWeight: i === 0 ? 700 : 400,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
                className={i === 0 ? 'active' : ''}
              >
                {item.name}
              </a>
            ))}
          </nav>
          <div className="top-float-auth" style={{ display: 'flex', gap: 8, fontSize: 13 }}>
            <a href="#" style={{ color: '#115e59', textDecoration: 'none' }}>登录</a>
            <a href="#" style={{ color: '#115e59', textDecoration: 'none' }}>注册</a>
          </div>
        </div>
      </div>

      {/* 源站 .wrap 主容器 */}
      <div className="wrap" style={{ maxWidth: 1220, margin: '0 auto', padding: '18px 14px 36px' }}>
        {/* 源站 header.top — logo + 搜索 + 热搜 */}
        <header className="top" style={{
          background: 'rgba(255,253,248,.9)',
          border: '1px solid #e5dccd',
          boxShadow: '0 10px 30px rgba(17, 24, 39, 0.08)',
          borderRadius: 14,
          padding: '24px',
          marginBottom: 14,
        }}>
          <div className="top-1" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
            <h1 className="logo" style={{ fontSize: 24, fontWeight: 700, color: '#1f2937', margin: 0 }}>
              {site.name}
              <small style={{ fontSize: 13, fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>快速找到你想要的TXT电子书</small>
            </h1>
            <div className="top-links" style={{ fontSize: 13, color: '#6b7280' }}>
              欢迎访问{site.name}，请 <a href="#" style={{ color: '#115e59' }}>登陆帐户</a> 或 <a href="#" style={{ color: '#115e59' }}>注册会员</a>
            </div>
          </div>

          {/* 源站 form.search */}
          <form className="search" style={{ display: 'flex', gap: 0, marginBottom: 8 }} onSubmit={(e) => e.preventDefault()}>
            <input
              type="text"
              name="keyboard"
              placeholder="请输入书名或作者关键字"
              style={{
                flex: 1,
                height: 40,
                padding: '0 16px',
                border: '2px solid #0f766e',
                borderRadius: '8px 0 0 8px',
                fontSize: 14,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              style={{
                height: 40,
                padding: '0 24px',
                background: '#0f766e',
                color: '#fff',
                border: 'none',
                borderRadius: '0 8px 8px 0',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              搜索全站
            </button>
          </form>

          {/* 源站 .search-history 今日热搜 */}
          <div className="search-history" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>今日热搜</span>
            {HOT_SEARCH.map((kw) => (
              <a
                key={kw}
                href="javascript:;"
                onClick={(e) => { e.preventDefault(); navigate({ view: 'search', q: kw }) }}
                style={{ fontSize: 12, color: '#115e59', textDecoration: 'none', padding: '2px 6px', borderRadius: 4 }}
              >
                {kw}
              </a>
            ))}
          </div>
        </header>

        {/* 源站 main.layout — 左主体 + 右侧栏 */}
        <main className="layout" style={{ display: 'grid', gridTemplateColumns: '1fr 330px', gap: 14 }}>
          <section>
            {/* 最新上传卡片列表 */}
            <article className="panel latest-upload" style={{
              background: 'rgba(255,253,248,.9)',
              border: '1px solid #e5dccd',
              borderRadius: 14,
              padding: '20px',
              marginBottom: 14,
            }}>
              <h3 className="latest" style={{ fontSize: 18, fontWeight: 700, color: '#1f2937', margin: '0 0 16px', paddingBottom: 8, borderBottom: '2px solid #0f766e' }}>
                最新上传<small style={{ fontSize: 13, fontWeight: 400, color: '#6b7280', marginLeft: 8 }}></small>
              </h3>
              <ul className="lines lines-books lines-books-2col" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
                {latestBooks.map((b) => (
                  <li key={b.id} className="line line-book" style={{ display: 'flex', gap: 10, paddingBottom: 10, borderBottom: '1px dashed #e5dccd' }}>
                    <div style={{ width: 48, height: 64, flexShrink: 0, overflow: 'hidden', borderRadius: 4, border: '1px solid #e5dccd' }}>
                      <BookCover name={b.name} cover={b.cover} className="w-full h-full" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <dl style={{ margin: 0 }}>
                        <dt style={{ marginBottom: 2 }}>
                          <a
                            href="#"
                            onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                            style={{ fontSize: 14, fontWeight: 600, color: '#115e59', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            《{b.name}》
                          </a>
                        </dt>
                        <dd style={{ fontSize: 12, color: '#6b7280', margin: 0, lineHeight: 1.6 }}>
                          <span>作者：{b.author}</span><br />
                          <span style={{ color: '#b45309' }}>{b.category}</span> · {formatWords(b.wordCount)} · {b.latestChapter || '暂无章节'}
                        </dd>
                      </dl>
                    </div>
                  </li>
                ))}
              </ul>
            </article>

            {/* 最近更新表格 */}
            <article className="panel" style={{
              background: 'rgba(255,253,248,.9)',
              border: '1px solid #e5dccd',
              borderRadius: 14,
              padding: '20px',
            }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1f2937', margin: '0 0 16px', paddingBottom: 8, borderBottom: '2px solid #0f766e' }}>
                最近更新
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table className="grid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f7f1e3', color: '#6b7280' }}>
                      <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400, whiteSpace: 'nowrap' }}>类别</th>
                      <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 400 }}>书名 / 最新章节</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400, whiteSpace: 'nowrap' }}>字数</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 400, whiteSpace: 'nowrap' }}>更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestBooks.slice(0, 15).map((b) => (
                      <tr key={b.id} style={{ borderTop: '1px solid #e5dccd' }}>
                        <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                          <span style={{ color: '#b45309', fontSize: 12 }}>{b.category}</span>
                        </td>
                        <td style={{ padding: '8px 6px', minWidth: 0 }}>
                          <a href="#" onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }} style={{ color: '#115e59', textDecoration: 'none', fontWeight: 500 }}>
                            《{b.name}》
                          </a>
                          <span style={{ color: '#6b7280', marginLeft: 8, fontSize: 12 }}>{b.latestChapter || '暂无章节'}</span>
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap', color: '#6b7280', fontSize: 12 }}>
                          {formatWords(b.wordCount)}
                        </td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', whiteSpace: 'nowrap', color: '#6b7280', fontSize: 12 }}>
                          {b.updatedAt ? fmtDate(b.updatedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          {/* 右侧栏: 排行榜 */}
          <aside>
            <article className="panel" style={{
              background: 'rgba(255,253,248,.9)',
              border: '1px solid #e5dccd',
              borderRadius: 14,
              padding: '20px',
            }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1f2937', margin: '0 0 12px', paddingBottom: 8, borderBottom: '2px solid #b45309' }}>
                📊 排行榜
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {rankBooks.map((b, i) => (
                  <li key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px dashed #e5dccd' }}>
                    <span style={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      background: i < 3 ? '#b45309' : '#f7f1e3',
                      color: i < 3 ? '#fff' : '#6b7280',
                    }}>
                      {i + 1}
                    </span>
                    <a
                      href="#"
                      onClick={(e) => { e.preventDefault(); navigate({ view: 'book', bookId: b.id }) }}
                      style={{ fontSize: 13, color: '#115e59', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                    >
                      {b.name}
                    </a>
                  </li>
                ))}
              </ul>
            </article>
          </aside>
        </main>

        {/* 源站 footer.foot */}
        <footer className="foot" style={{
          marginTop: 24,
          padding: '16px 0',
          borderTop: '1px solid #e5dccd',
          textAlign: 'center',
          fontSize: 13,
          color: '#6b7280',
        }}>
          <div style={{ marginBottom: 8 }}>
            <a href="#" style={{ color: '#115e59', textDecoration: 'none', margin: '0 8px' }}>网站简介</a>·
            <a href="#" style={{ color: '#115e59', textDecoration: 'none', margin: '0 8px' }}>网站帮助</a>·
            <a href="#" style={{ color: '#115e59', textDecoration: 'none', margin: '0 8px' }}>版权声明</a>·
            <a href="#" style={{ color: '#115e59', textDecoration: 'none', margin: '0 8px' }}>网站地图</a>·
            <a href="#" style={{ color: '#115e59', textDecoration: 'none', margin: '0 8px' }}>友情链接</a>·
            <a href="#" style={{ color: '#115e59', textDecoration: 'none', margin: '0 8px' }}>留言建议</a>
          </div>
          <div>{site.name} · {site.domain}</div>
        </footer>
      </div>
    </>
  )
}
