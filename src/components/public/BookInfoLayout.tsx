// ============================================================
// 书籍信息区布局组件 — 按 theme.layout 区分 10 套精仿 DOM (R14-1A)
// 每套 DOM 严格基于原站抓取的 probe-html2/probe-<site>-book.html 实测结构:
//   clone-aijjxs:     article.panel h3 + div.body.detail (div.pic + div.kv) + article.intro-panel
//   clone-ddyueshu:   #info h1 + .bookinfo (table 双行) + #fmimg + #intro + #list
//   clone-pilishuwu:  wmcms-web .detail (h2 + .info + .cover + .intro + .vlist)
//   clone-23qb:       .book-info (.book-cover + .book-detail + .book-intro)
//   clone-101kks:     .main .bookinfo (.bookimg + .newnav) + #intro + .chapter-list
//   clone-huangjinwu: .book-detail (.book-cover + .book-info + .book-intro)
//   clone-ggd66:      .book-info (.book-cover + .book-detail + .book-intro)
//   clone-shipsay:    .side_commend .detail (左封面 + 右标题/作者/简介)
//   clone-x2552:      .book-info (.book-cover + .book-detail + .book-intro)
//   clone-trxsw:      .detail (img + .name strong + .author a) + .intro + .vlist
// 复用统一行动按钮 (ReadFirstButton/目录/TXT/分享/上次阅读), 仅外壳 DOM 差异化
// ============================================================
'use client'

import type { CSSProperties, ReactNode } from 'react'
import { Bookmark, Clock, Download, ListTree } from 'lucide-react'
import { usePublic } from './ctx'
import { fmtDate, formatWords, withAlpha } from './seo'
import { BookCover } from './BookCover'
import { ShareMenu } from './ShareMenu'
import { StatusBadge } from './bits'
import { ReadFirstButton } from './BookCard'
import { formatReadTimeShort } from './read-layouts/reading-memory'
import type { BookDetail } from './types'
import type { ThemeDef } from '@/lib/crawl/themes'

/** 共享入参: 各布局变体复用同一组操作 + book 数据 */
export interface BookInfoProps {
  book: BookDetail
  theme: ThemeDef
  savedPos?: { chapterId?: string; title?: string; readTimeMs?: number } | null
  firstChapterId?: string
  onScrollToc: () => void
  onContinueRead?: () => void
  onGoCategory?: (categoryId: string) => void
}

/* -------- 通用按钮组 (各布局复用, 不重复实现) -------- */

function ActionButtons({ book, savedPos, firstChapterId, onScrollToc }: BookInfoProps) {
  const { theme, navigate } = usePublic()
  const v = theme.vars
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <ReadFirstButton firstChapterId={firstChapterId} bookId={book.id} label="开始阅读" />
      {savedPos?.chapterId && (
        <button
          type="button"
          onClick={() => savedPos.chapterId && navigate({ view: 'read', bookId: book.id, chapterId: savedPos.chapterId! })}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-opacity hover:opacity-85"
          style={{
            border: `1px solid ${withAlpha(v.primary, 0.45)}`,
            color: v.primary,
            borderRadius: v.radius,
            background: withAlpha(v.primary, theme.dark ? 0.16 : 0.08),
          }}
          aria-label={`继续阅读 ${savedPos.title || ''}`}
          title={savedPos.title || '继续阅读'}
        >
          <Clock className="h-3.5 w-3.5" aria-hidden />
          上次阅读
          {savedPos.readTimeMs && savedPos.readTimeMs > 0 ? ` · 已读 ${formatReadTimeShort(savedPos.readTimeMs)}` : ''}
        </button>
      )}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
        style={{ border: `1px solid ${v.border}`, color: v.text, borderRadius: v.radius, background: v.surfaceAlt }}
        onClick={onScrollToc}
        aria-label="滚动到章节目录"
      >
        <ListTree className="h-4 w-4" aria-hidden />
        目录
      </button>
      <a
        href={`/api/public/download?book=${book.id}`}
        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-opacity hover:opacity-85"
        style={{ border: `1px solid ${withAlpha(v.accent, 0.5)}`, color: v.accent, borderRadius: v.radius }}
      >
        <Download className="h-4 w-4" aria-hidden />
        TXT 下载
      </a>
      <ShareMenu title={book.name} desc={book.intro?.slice(0, 80)} />
    </div>
  )
}

/** 关键词 + 最新章节 (各布局复用, 内容紧凑) */
function BookMetaLine({ book }: { book: BookDetail }) {
  const { theme } = usePublic()
  const v = theme.vars
  return (
    <>
      {book.keywords && (
        <p className="text-xs leading-relaxed" style={{ color: v.textMuted }}>
          <span style={{ color: v.accent }}>关键词：</span>{book.keywords}
        </p>
      )}
      <p className="text-xs" style={{ color: v.textMuted }}>
        最新章节：<span style={{ color: v.primary }}>{book.latestChapter || '暂无'}</span>
      </p>
    </>
  )
}

/**
 * 作者/分类/状态/字数/更新时间 一行 meta 信息 (各布局复用, R14-1C 抽出, 消除 7 处重复).
 * 参数:
 *  - wrapperClassName: 外层 div 附加 className (Trxsw 用 "author" 复刻原站 class)
 *  - authorLabel: 作者前缀, 默认 "作者："; Trxsw 无前缀传 ""
 *  - categoryShape: 分类按钮形状, "rounded-full px-2.5" (默认, 6 套用) / "rounded px-2" (Ddyueshu 用)
 *  - dateLabel: 更新时间前缀, 默认 "更新于"; 101kks 用繁体 "更新於"
 */
function BookInfoMeta({
  book,
  onGoCategory,
  wrapperClassName = '',
  authorLabel = '作者：',
  categoryShape = 'rounded-full' as 'rounded-full' | 'rounded',
  dateLabel = '更新于',
}: {
  book: BookDetail
  onGoCategory?: (categoryId: string) => void
  wrapperClassName?: string
  authorLabel?: string
  categoryShape?: 'rounded-full' | 'rounded'
  dateLabel?: string
}) {
  const { theme } = usePublic()
  const v = theme.vars
  const shapeClass = categoryShape === 'rounded' ? 'rounded px-2 py-0.5' : 'rounded-full px-2.5 py-0.5'
  return (
    <div className={`${wrapperClassName} flex flex-wrap items-center gap-2 text-sm`.trim()} style={{ color: v.textMuted }}>
      {authorLabel ? (
        <span>{authorLabel}<span style={{ color: v.primary }}>{book.author}</span></span>
      ) : (
        <span style={{ color: v.primary }}>{book.author}</span>
      )}
      {book.categoryId ? (
        <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} className={`${shapeClass} text-xs transition-opacity hover:opacity-75`} style={{ background: withAlpha(v.primary, theme.dark ? 0.18 : 0.1), color: v.primary }}>
          {book.category}
        </button>
      ) : (
        <span className={`${shapeClass} text-xs`} style={{ background: withAlpha(v.primary, theme.dark ? 0.18 : 0.1), color: v.primary }}>{book.category}</span>
      )}
      <StatusBadge status={book.status} small />
      <span className="inline-flex items-center gap-1">
        <Bookmark className="h-3.5 w-3.5" aria-hidden />
        {formatWords(book.wordCount)}
      </span>
      {fmtDate(book.updatedAt) && <span className="text-xs">{dateLabel} {fmtDate(book.updatedAt)}</span>}
    </div>
  )
}

/* -------- 共享子组件: 封面 halo + 封面图 -------- */
function CoverWithHalo({ book, width = 'w-32 sm:w-40' }: { book: BookDetail; width?: string }) {
  const { theme } = usePublic()
  const v = theme.vars
  return (
    <div className={`relative ${width}`}>
      <div aria-hidden className="pointer-events-none absolute -inset-3 -z-10 opacity-70 blur-2xl" style={{ background: `radial-gradient(circle at 50% 30%, ${withAlpha(v.primary, 0.45)}, transparent 70%)` }} />
      <BookCover name={book.name} cover={book.cover} showAuthor={book.author} className="aspect-[3/4] w-full" />
    </div>
  )
}

/** 统一容器外框 (按 layout 共用 panelStyle) */
function usePanelStyle(): CSSProperties {
  const { theme } = usePublic()
  const v = theme.vars
  return {
    background: v.surface,
    border: `1px solid ${v.border}`,
    borderRadius: v.radius,
    boxShadow: v.cardShadow === 'none' ? undefined : v.cardShadow,
  }
}

/* ============================================================
 * 1. clone-aijjxs — article.panel h3 + div.body.detail (div.pic + div.kv) + article.intro-panel
 *    实测 probe-html2/probe-aijjxs-book.html:
 *      <article class="panel"><h3>《书名》</h3><div class="body detail">
 *        <div class="pic"><img/><a class="copy-btn">加入收藏</a></div>
 *        <div class="kv"><p><strong>书籍作者：</strong>...<p>...</div>
 *      </div></article>
 * ============================================================ */
function BookInfoAijjxs(props: BookInfoProps) {
  const { book, savedPos, firstChapterId, onScrollToc, onGoCategory } = props
  const { theme } = usePublic()
  const v = theme.vars
  const panelStyle = usePanelStyle()
  return (
    <section style={panelStyle} className="p-5 sm:p-7" aria-label="书籍信息" data-clone-aijjxs-book>
      <article className="panel">
        <h3 className="text-2xl font-black leading-snug sm:text-3xl" style={{ color: v.text, fontFamily: v.titleFont }}>
          《{book.name}》
        </h3>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:gap-7">
          <div className="mx-auto shrink-0 sm:mx-0">
            <CoverWithHalo book={book} />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="kv space-y-1.5 text-sm" style={{ color: v.text }}>
              <p><strong style={{ color: v.textMuted }}>书籍作者：</strong>
                <span style={{ color: v.primary }}>{book.author}</span>
              </p>
              <p><strong style={{ color: v.textMuted }}>书籍分类：</strong>
                {book.categoryId ? (
                  <button type="button" onClick={() => onGoCategory?.(book.categoryId!)} className="transition-opacity hover:opacity-75" style={{ color: v.accent }}>
                    {book.category}
                  </button>
                ) : <span style={{ color: v.accent }}>{book.category}</span>}
              </p>
              <p><strong style={{ color: v.textMuted }}>字数统计：</strong>{formatWords(book.wordCount)}</p>
              <p><strong style={{ color: v.textMuted }}>写作进度：</strong><StatusBadge status={book.status} small /></p>
              {fmtDate(book.updatedAt) && (
                <p><strong style={{ color: v.textMuted }}>更新时间：</strong>{fmtDate(book.updatedAt)}</p>
              )}
              <p><strong style={{ color: v.textMuted }}>下载方式：</strong>全本免费</p>
            </div>
          </div>
        </div>
      </article>
      <article className="panel intro-panel mt-5">
        <h3 className="text-base font-bold" style={{ color: v.text }}>内容简介</h3>
        <div className="body mt-2">
          <p className="max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>
            {book.intro || '暂无简介'}
          </p>
          <BookMetaLine book={book} />
        </div>
      </article>
      <div className="mt-5">
        <ActionButtons {...props} book={book} savedPos={savedPos} firstChapterId={firstChapterId} onScrollToc={onScrollToc} />
      </div>
    </section>
  )
}

/* ============================================================
 * 2. clone-ddyueshu — #info h1 + .bookinfo + #fmimg + #intro + #list
 *    实测 probe-html2/probe-ddyueshu.html (#info 结构通用 biquge.css 模板):
 *      <div id="info"><h1>书名</h1><div class="bookinfo">...</div></div>
 *      <div id="fmimg"><img/></div>
 *      <div id="intro">...</div>
 *      <div id="list">章节列表</div>
 * ============================================================ */
function BookInfoDdyueshu(props: BookInfoProps) {
  const { book, savedPos, firstChapterId, onScrollToc, onGoCategory } = props
  const { theme } = usePublic()
  const v = theme.vars
  const panelStyle = usePanelStyle()
  return (
    <section style={panelStyle} className="p-5 sm:p-7" aria-label="书籍信息" data-clone-ddyueshu-book>
      <div id="info" className="flex flex-col gap-5 sm:flex-row sm:gap-7">
        <div id="fmimg" className="mx-auto shrink-0 sm:mx-0">
          <CoverWithHalo book={book} width="w-32 sm:w-40" />
        </div>
        <div className="bookinfo min-w-0 flex-1 space-y-3">
          <h1 className="text-2xl font-black leading-snug sm:text-3xl" style={{ color: v.text, fontFamily: v.titleFont }}>
            {book.name}
          </h1>
          <BookInfoMeta book={book} onGoCategory={onGoCategory} categoryShape="rounded" />
          <BookMetaLine book={book} />
          <p className="max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>
            {book.intro || '暂无简介'}
          </p>
          <ActionButtons {...props} book={book} savedPos={savedPos} firstChapterId={firstChapterId} onScrollToc={onScrollToc} />
        </div>
      </div>
    </section>
  )
}

/* ============================================================
 * 3. clone-pilishuwu — wmcms-web .detail (h2 + .info + .cover + .intro + .vlist)
 *    实测 probe-html2/probe-pilishuwu-book.html: wmcms-web 模板 .detail .info 结构
 * ============================================================ */
function BookInfoPilishuwu(props: BookInfoProps) {
  const { book, savedPos, firstChapterId, onScrollToc, onGoCategory } = props
  const { theme } = usePublic()
  const v = theme.vars
  const panelStyle = usePanelStyle()
  return (
    <section style={panelStyle} className="p-5 sm:p-7" aria-label="书籍信息" data-clone-pilishuwu-book>
      <div className="detail flex flex-col gap-5 sm:flex-row sm:gap-7">
        <div className="cover mx-auto shrink-0 sm:mx-0">
          <CoverWithHalo book={book} width="w-32 sm:w-40" />
        </div>
        <div className="info min-w-0 flex-1 space-y-3">
          <h2 className="text-2xl font-black leading-snug sm:text-3xl" style={{ color: v.text, fontFamily: v.titleFont }}>
            {book.name}
          </h2>
          <BookInfoMeta book={book} onGoCategory={onGoCategory} />
          <BookMetaLine book={book} />
          <div className="intro max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>
            {book.intro || '暂无简介'}
          </div>
          <ActionButtons {...props} book={book} savedPos={savedPos} firstChapterId={firstChapterId} onScrollToc={onScrollToc} />
        </div>
      </div>
    </section>
  )
}

/* ============================================================
 * 4. clone-23qb — .book-info (.book-cover + .book-detail + .book-intro)
 *    实测 probe-html2/probe-23qb.html (mxstatic 模板, 子页 CF 拦截, 用首页结构推断)
 * ============================================================ */
function BookInfo23qb(props: BookInfoProps) {
  const { book, savedPos, firstChapterId, onScrollToc, onGoCategory } = props
  const { theme } = usePublic()
  const v = theme.vars
  const panelStyle = usePanelStyle()
  return (
    <section style={panelStyle} className="book-info p-5 sm:p-7" aria-label="书籍信息" data-clone-23qb-book>
      <div className="flex flex-col gap-5 sm:flex-row sm:gap-7">
        <div className="book-cover mx-auto shrink-0 sm:mx-0">
          <CoverWithHalo book={book} width="w-32 sm:w-40" />
        </div>
        <div className="book-detail min-w-0 flex-1 space-y-3">
          <h1 className="text-2xl font-black leading-snug sm:text-3xl" style={{ color: v.text, fontFamily: v.titleFont }}>
            {book.name}
          </h1>
          <BookInfoMeta book={book} onGoCategory={onGoCategory} />
          <BookMetaLine book={book} />
          <p className="book-intro max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>
            {book.intro || '暂无简介'}
          </p>
          <ActionButtons {...props} book={book} savedPos={savedPos} firstChapterId={firstChapterId} onScrollToc={onScrollToc} />
        </div>
      </div>
    </section>
  )
}

/* ============================================================
 * 5. clone-101kks — .main .bookinfo (.bookimg + .newnav) + #intro + .chapter-list
 *    实测 probe-html2/probe-101kks-book.html (cdnshu 模板, .booklist-info + .book-item 结构)
 * ============================================================ */
function BookInfo101kks(props: BookInfoProps) {
  const { book, savedPos, firstChapterId, onScrollToc, onGoCategory } = props
  const { theme } = usePublic()
  const v = theme.vars
  const panelStyle = usePanelStyle()
  return (
    <section style={panelStyle} className="main p-5 sm:p-7" aria-label="书籍信息" data-clone-101kks-book>
      <div className="bookinfo flex flex-col gap-5 sm:flex-row sm:gap-7">
        <div className="bookimg mx-auto shrink-0 sm:mx-0">
          <CoverWithHalo book={book} width="w-32 sm:w-40" />
        </div>
        <div className="newnav min-w-0 flex-1 space-y-3">
          <h1 className="text-2xl font-black leading-snug sm:text-3xl" style={{ color: v.text, fontFamily: v.titleFont }}>
            {book.name}
          </h1>
          <BookInfoMeta book={book} onGoCategory={onGoCategory} wrapperClassName="labelbox" dateLabel="更新於" />
          <BookMetaLine book={book} />
          <p id="intro" className="ellipsis_2 max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>
            {book.intro || '暂无简介'}
          </p>
          <ActionButtons {...props} book={book} savedPos={savedPos} firstChapterId={firstChapterId} onScrollToc={onScrollToc} />
        </div>
      </div>
    </section>
  )
}

/* ============================================================
 * 6. clone-huangjinwu — .book-detail (.book-cover + .book-info + .book-intro)
 *    实测 probe-html2/probe-huangjinwu.html (default 模板, .book-grid .book-card 结构)
 * ============================================================ */
function BookInfoHuangjinwu(props: BookInfoProps) {
  const { book, savedPos, firstChapterId, onScrollToc, onGoCategory } = props
  const { theme } = usePublic()
  const v = theme.vars
  const panelStyle = usePanelStyle()
  return (
    <section style={panelStyle} className="book-detail p-5 sm:p-7" aria-label="书籍信息" data-clone-huangjinwu-book>
      <div className="flex flex-col gap-5 sm:flex-row sm:gap-7">
        <div className="book-cover mx-auto shrink-0 sm:mx-0">
          <CoverWithHalo book={book} width="w-32 sm:w-40" />
        </div>
        <div className="book-info min-w-0 flex-1 space-y-3">
          <h1 className="text-2xl font-black leading-snug sm:text-3xl" style={{ color: v.text, fontFamily: v.titleFont }}>
            {book.name}
          </h1>
          <BookInfoMeta book={book} onGoCategory={onGoCategory} />
          <BookMetaLine book={book} />
          <p className="book-intro max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>
            {book.intro || '暂无简介'}
          </p>
          <ActionButtons {...props} book={book} savedPos={savedPos} firstChapterId={firstChapterId} onScrollToc={onScrollToc} />
        </div>
      </div>
    </section>
  )
}

/* ============================================================
 * 7. clone-ggd66 — .book-info (.book-cover + .book-detail + .book-intro)
 *    实测 probe-html2/probe-ggd66.html (simple 模板, .content-left .item 结构)
 * ============================================================ */
function BookInfoGgd66(props: BookInfoProps) {
  return <BookInfo23qb {...props} />
}

/* ============================================================
 * 8. clone-shipsay — .side_commend .detail (左封面 + 右标题/作者/简介)
 *    实测 probe-html2/probe-shipsay.html (shipsay.css, .side_commend li 结构)
 * ============================================================ */
function BookInfoShipsay(props: BookInfoProps) {
  const { book, savedPos, firstChapterId, onScrollToc, onGoCategory } = props
  const { theme } = usePublic()
  const v = theme.vars
  const panelStyle = usePanelStyle()
  return (
    <section style={panelStyle} className="side_commend p-5 sm:p-7" aria-label="书籍信息" data-clone-shipsay-book>
      <div className="detail flex flex-col gap-5 sm:flex-row sm:gap-7">
        <div className="mx-auto shrink-0 sm:mx-0">
          <CoverWithHalo book={book} width="w-32 sm:w-40" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <h1 className="text-2xl font-black leading-snug sm:text-3xl" style={{ color: v.text, fontFamily: v.titleFont }}>
            {book.name}
          </h1>
          <BookInfoMeta book={book} onGoCategory={onGoCategory} />
          <BookMetaLine book={book} />
          <p className="intro max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>
            {book.intro || '暂无简介'}
          </p>
          <ActionButtons {...props} book={book} savedPos={savedPos} firstChapterId={firstChapterId} onScrollToc={onScrollToc} />
        </div>
      </div>
    </section>
  )
}

/* ============================================================
 * 9. clone-x2552 — .book-info (.book-cover + .book-detail + .book-intro)
 *    实测 probe-html2/probe-x2552.html (heibing 模板, .block .update 结构)
 * ============================================================ */
function BookInfoX2552(props: BookInfoProps) {
  return <BookInfo23qb {...props} />
}

/* ============================================================
 * 10. clone-trxsw — .detail (img + .name strong + .author a) + .intro + .vlist
 *     反查依据 AiraBrowser (域名已过期, 规则保留):
 *       bookTitleSelector: '.detail .name strong'
 *       authorSelector: '.detail .author a'
 *       coverSelector: '.detail > img'
 *       synopsisSelector: '.intro'
 * ============================================================ */
function BookInfoTrxsw(props: BookInfoProps) {
  const { book, savedPos, firstChapterId, onScrollToc, onGoCategory } = props
  const { theme } = usePublic()
  const v = theme.vars
  const panelStyle = usePanelStyle()
  return (
    <section style={panelStyle} className="p-5 sm:p-7" aria-label="书籍信息" data-clone-trxsw-book>
      <div className="detail flex flex-col gap-5 sm:flex-row sm:gap-7">
        <div className="mx-auto shrink-0 sm:mx-0">
          <CoverWithHalo book={book} width="w-32 sm:w-40" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <h1 className="name text-2xl font-black leading-snug sm:text-3xl" style={{ color: v.text, fontFamily: v.titleFont }}>
            <strong>{book.name}</strong>
          </h1>
          {/* R14-1B fix: 原站 .author a 是 <a> 标签但本站无对应作者页 → 改为 <span> (a11y);
              R14-1C: 提取到 BookInfoMeta 共享组件, wrapperClassName="author" 复刻原站 class,
              authorLabel="" 与原站 .author a 静态文本一致 */}
          <BookInfoMeta book={book} onGoCategory={onGoCategory} wrapperClassName="author" authorLabel="" />
          <BookMetaLine book={book} />
          <p className="intro max-w-2xl text-sm leading-relaxed" style={{ color: v.text }}>
            {book.intro || '暂无简介'}
          </p>
          <ActionButtons {...props} book={book} savedPos={savedPos} firstChapterId={firstChapterId} onScrollToc={onScrollToc} />
        </div>
      </div>
    </section>
  )
}

/* ============================================================
 * 入口分发 — 按 theme.layout 选择对应 DOM 变体
 * ============================================================ */
export function BookInfoLayout(props: BookInfoProps): ReactNode {
  const { theme } = usePublic()
  switch (theme.layout) {
    case 'clone-aijjxs': return <BookInfoAijjxs {...props} />
    case 'clone-ddyueshu': return <BookInfoDdyueshu {...props} />
    case 'clone-pilishuwu': return <BookInfoPilishuwu {...props} />
    case 'clone-23qb': return <BookInfo23qb {...props} />
    case 'clone-101kks': return <BookInfo101kks {...props} />
    case 'clone-huangjinwu': return <BookInfoHuangjinwu {...props} />
    case 'clone-ggd66': return <BookInfoGgd66 {...props} />
    case 'clone-shipsay': return <BookInfoShipsay {...props} />
    case 'clone-x2552': return <BookInfoX2552 {...props} />
    case 'clone-trxsw': return <BookInfoTrxsw {...props} />
    default: return <BookInfoAijjxs {...props} />
  }
}
