// ============================================================
// 伪静态 URL 构建与解析 — 站群 SEO 友好地址
// ============================================================
// §1  预设风格 ............................ PSEUDO_PRESETS
// §2  构建 URL ............................. buildViewUrl
// §3  解析 URL ............................. parseViewPath
// §4  兼容旧接口 .......................... buildBookUrl
// ============================================================

/**
 * 伪静态 URL 风格预设。
 *
 * 每种风格定义 view → URL 路径的构建规则，以及 URL 路径 → view 参数的反解析规则。
 * 所有风格共享同一套查询串兜底（?view=book&id=X），伪静态仅在站点启用时生效。
 *
 * 风格选择在 后台 → 站群系统 → 编辑站点 → 伪静态设置 中配置。
 */
export type PseudoStaticStyle =
  | 'query'        // 查询串: /?view=book&id=xxx (默认, 兼容所有环境)
  | 'numeric'      // 纯数字: /book/123456.html  /read/123456/789.html  /category/2/1.html
  | 'alphanumeric' // 字母+数字: /book/b123456.html  /read/r123456/c789.html  /category/c2/p1.html
  | 'slug'         // 别名风格: /book/123456/  /read/123456/789/  /category/2/  (尾斜杠)
  | 'short'        // 短路径: /b/123456  /r/123456/789  /c/2  /s?q=xxx
  | 'classic'      // 经典 .html: /book-123456.html  /read-123456-789.html  /category-2-1.html
  | 'dir'          // 目录层级: /book/123/456.html  (ID前3位作目录)  /read/123/456/789.html

/** 预设风格列表（供 UI 选择器渲染） */
export const PSEUDO_PRESETS: Array<{
  id: PseudoStaticStyle
  name: string
  desc: string
  example: string
}> = [
  {
    id: 'query',
    name: '查询串模式',
    desc: '默认兼容模式, 无需 rewrite 配置, 开箱即用',
    example: '/?view=book&id=123456',
  },
  {
    id: 'numeric',
    name: '纯数字模式',
    desc: '经典小说站风格, 数字 ID 直接作路径, 搜索引擎友好',
    example: '/book/123456.html  /read/123456/789.html  /category/2/1.html',
  },
  {
    id: 'alphanumeric',
    name: '字母+数字模式',
    desc: '带类型前缀(b/r/c), 避免路径冲突, 适合多类型内容混排',
    example: '/book/b123456.html  /read/r123456/c789.html  /category/c2/p1.html',
  },
  {
    id: 'slug',
    name: '别名尾斜杠模式',
    desc: '尾斜杠风格, 视觉简洁, 部分站群偏好',
    example: '/book/123456/  /read/123456/789/  /category/2/',
  },
  {
    id: 'short',
    name: '短路径模式',
    desc: '单字母前缀, URL 最短, 适合移动端分享',
    example: '/b/123456  /r/123456/789  /c/2  /s?q=xxx',
  },
  {
    id: 'classic',
    name: '经典连字符模式',
    desc: '中划线分隔, .html 结尾, 老牌小说站常见',
    example: '/book-123456.html  /read-123456-789.html  /category-2-1.html',
  },
  {
    id: 'dir',
    name: '目录分层模式',
    desc: 'ID 前3位作子目录, 大规模站群防止单目录文件过多',
    example: '/book/123/456.html  /read/123/456/789.html  /category/2/1.html',
  },
]

// ============================================================
// §2  构建 URL
// ============================================================

export interface ViewPathParams {
  view: 'home' | 'book' | 'read' | 'search' | 'keyword' | 'category' | 'history'
  bookId?: string
  chapterId?: string
  q?: string
  tag?: string
  cat?: string
  page?: number
  site?: string
}

/**
 * 构建视图 URL 路径（不含域名, 不含 site 参数）。
 *
 * style='query' 或未启用伪静态时, 返回查询串风格 /?view=book&id=xxx
 * 其他风格按预设规则构建伪静态路径, site 参数始终追加为查询串（伪静态路径 + ?site=xxx 混合）。
 */
export function buildViewUrl(v: ViewPathParams, style: PseudoStaticStyle = 'query', siteId?: string): string {
  // 兜底: query 风格始终走查询串
  if (style === 'query' || !style) {
    return buildQueryUrl(v, siteId)
  }

  let path = ''
  const bookId = (v.bookId || '').trim()
  const chapterId = (v.chapterId || '').trim()
  const cat = (v.cat || '').trim()
  const page = v.page && v.page > 1 ? v.page : 1

  switch (v.view) {
    case 'home':
      path = '/'
      break
    case 'book':
      if (!bookId) { path = '/'; break }
      path = buildBookPath(bookId, style)
      break
    case 'read':
      if (!bookId || !chapterId) { path = buildBookPath(bookId, style); break }
      path = buildReadPath(bookId, chapterId, style)
      break
    case 'category':
      if (!cat) { path = '/'; break }
      path = buildCategoryPath(cat, page, style)
      break
    case 'search':
      path = buildSearchPath(v.q, page, style)
      break
    case 'keyword':
      path = buildKeywordPath(v.tag || v.q || '', page, style)
      break
    case 'history':
      path = '/history'
      if (style === 'classic') path = '/history.html'
      if (style === 'slug') path = '/history/'
      break
    default:
      path = '/'
  }

  // site 参数始终走查询串（伪静态路径不编码 site）
  if (siteId) {
    const sep = path.includes('?') ? '&' : '?'
    path = `${path}${sep}site=${encodeURIComponent(siteId)}`
  }
  // search 的 q 参数也走查询串（伪静态路径不含关键词, 避免特殊字符编码问题）
  if (v.view === 'search' && v.q && path.includes('?')) {
    // q 已在 buildSearchPath 中追加
  }
  return path
}

/** 构建书籍页路径 */
function buildBookPath(bookId: string, style: PseudoStaticStyle): string {
  const id = encodeURIComponent(bookId)
  switch (style) {
    case 'numeric': return `/book/${id}.html`
    case 'alphanumeric': return `/book/b${id}.html`
    case 'slug': return `/book/${id}/`
    case 'short': return `/b/${id}`
    case 'classic': return `/book-${id}.html`
    case 'dir': {
      // ID 前3位作子目录 (不足3位用0补)
      const prefix = id.padStart(3, '0').slice(0, 3)
      return `/book/${prefix}/${id}.html`
    }
    default: return `/?view=book&id=${id}`
  }
}

/** 构建阅读页路径 */
function buildReadPath(bookId: string, chapterId: string, style: PseudoStaticStyle): string {
  const bid = encodeURIComponent(bookId)
  const cid = encodeURIComponent(chapterId)
  switch (style) {
    case 'numeric': return `/read/${bid}/${cid}.html`
    case 'alphanumeric': return `/read/r${bid}/c${cid}.html`
    case 'slug': return `/read/${bid}/${cid}/`
    case 'short': return `/r/${bid}/${cid}`
    case 'classic': return `/read-${bid}-${cid}.html`
    case 'dir': {
      const prefix = bid.padStart(3, '0').slice(0, 3)
      return `/read/${prefix}/${bid}/${cid}.html`
    }
    default: return `/?view=read&id=${bid}&chapter=${cid}`
  }
}

/** 构建分类页路径 */
function buildCategoryPath(cat: string, page: number, style: PseudoStaticStyle): string {
  const c = encodeURIComponent(cat)
  const p = page > 1 ? page : 1
  switch (style) {
    case 'numeric': return `/category/${c}/${p}.html`
    case 'alphanumeric': return `/category/c${c}/p${p}.html`
    case 'slug': return `/category/${c}/${p}/`
    case 'short': return `/c/${c}${p > 1 ? `/${p}` : ''}`
    case 'classic': return `/category-${c}-${p}.html`
    case 'dir': return `/category/${c}/${p}.html`
    default: return `/?view=category&cat=${c}${p > 1 ? `&page=${p}` : ''}`
  }
}

/** 构建搜索页路径 */
function buildSearchPath(q: string | undefined, page: number, style: PseudoStaticStyle): string {
  const p = page > 1 ? page : 1
  const base = style === 'short' ? '/s' : style === 'classic' ? '/search.html' : style === 'slug' ? '/search/' : '/search'
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  if (p > 1) sp.set('page', String(p))
  const qs = sp.toString()
  return qs ? `${base}?${qs}` : base
}

/** 构建关键词页路径 */
function buildKeywordPath(tag: string, page: number, style: PseudoStaticStyle): string {
  const t = encodeURIComponent(tag)
  const p = page > 1 ? page : 1
  switch (style) {
    case 'numeric': return `/tag/${t}/${p}.html`
    case 'alphanumeric': return `/tag/t${t}/p${p}.html`
    case 'slug': return `/tag/${t}/${p}/`
    case 'short': return `/t/${t}${p > 1 ? `/${p}` : ''}`
    case 'classic': return `/tag-${t}-${p}.html`
    case 'dir': return `/tag/${t}/${p}.html`
    default: return `/?view=keyword&tag=${t}${p > 1 ? `&page=${p}` : ''}`
  }
}

/** 查询串风格 URL (兜底, 兼容所有环境) */
function buildQueryUrl(v: ViewPathParams, siteId?: string): string {
  const sp = new URLSearchParams()
  sp.set('view', v.view)
  if (v.bookId) sp.set('id', v.bookId)
  if (v.chapterId) sp.set('chapter', v.chapterId)
  if (v.q) sp.set('q', v.q)
  if (v.tag) sp.set('tag', v.tag)
  if (v.cat) sp.set('cat', v.cat)
  if (v.page && v.page > 1) sp.set('page', String(v.page))
  if (siteId) sp.set('site', siteId)
  const qs = sp.toString()
  return qs ? `/?${qs}` : '/'
}

// ============================================================
// §3  解析 URL
// ============================================================

/**
 * 解析 URL 路径为视图参数。
 *
 * 支持 query 风格的查询串, 以及所有伪静态风格的路径。
 * 路径匹配失败时回退到 query 风格解析（从查询串取 view/id 等）。
 */
export function parseViewPath(pathname: string, search: string, style: PseudoStaticStyle = 'query'): ViewPathParams {
  // 始终先尝试从查询串解析（?view=book&id=xxx 永远有效）
  const sp = new URLSearchParams(search)
  const queryView = sp.get('view')
  if (queryView) {
    // 查询串风格优先（显式 ?view=xxx 总是权威）
    return {
      view: (queryView as ViewPathParams['view']) || 'home',
      bookId: sp.get('id') || undefined,
      chapterId: sp.get('chapter') || undefined,
      q: sp.get('q') || undefined,
      tag: sp.get('tag') || undefined,
      cat: sp.get('cat') || undefined,
      page: Number(sp.get('page')) || 1,
      site: sp.get('site') || undefined,
    }
  }

  // 伪静态路径解析
  const path = pathname.replace(/\/+$/, '') || '/' // 去尾斜杠, 空保留根
  const result = parsePseudoPath(path, style)
  if (result) {
    // 合并查询串中的 site 参数（伪静态路径不编码 site）
    const site = sp.get('site') || undefined
    if (site) result.site = site
    // search 视图的 q 参数也在查询串
    if (result.view === 'search' && sp.get('q')) result.q = sp.get('q') || undefined
    if (result.view === 'keyword' && sp.get('tag')) result.tag = sp.get('tag') || result.tag
    return result
  }

  // 兜底: 首页
  return { view: 'home', site: sp.get('site') || undefined }
}

/** 伪静态路径解析核心 */
function parsePseudoPath(path: string, style: PseudoStaticStyle): ViewPathParams | null {
  if (path === '/' || path === '') return { view: 'home' }

  switch (style) {
    case 'numeric':
      // /book/123.html  /read/123/456.html  /category/2/1.html  /tag/x/1.html  /search.html
      return parseNumeric(path) || parseAlphanumeric(path) || parseSlug(path) || parseShort(path) || parseClassic(path) || parseDir(path)

    case 'alphanumeric':
      return parseAlphanumeric(path) || parseNumeric(path) || parseSlug(path) || parseShort(path) || parseClassic(path) || parseDir(path)

    case 'slug':
      return parseSlug(path) || parseNumeric(path) || parseAlphanumeric(path) || parseShort(path) || parseClassic(path) || parseDir(path)

    case 'short':
      return parseShort(path) || parseNumeric(path) || parseAlphanumeric(path) || parseSlug(path) || parseClassic(path) || parseDir(path)

    case 'classic':
      return parseClassic(path) || parseNumeric(path) || parseAlphanumeric(path) || parseSlug(path) || parseShort(path) || parseDir(path)

    case 'dir':
      return parseDir(path) || parseNumeric(path) || parseAlphanumeric(path) || parseSlug(path) || parseShort(path) || parseClassic(path)

    default:
      return null
  }
}

/** /book/123.html  /read/123/456.html  /category/2/1.html  /tag/x/1.html  /search  /history */
function parseNumeric(path: string): ViewPathParams | null {
  let m: RegExpMatchArray | null
  // /book/{id}.html
  if ((m = path.match(/^\/book\/([^/]+)\.html$/))) return { view: 'book', bookId: m[1] }
  // /read/{bid}/{cid}.html
  if ((m = path.match(/^\/read\/([^/]+)\/([^/]+)\.html$/))) return { view: 'read', bookId: m[1], chapterId: m[2] }
  // /category/{cat}/{page}.html
  if ((m = path.match(/^\/category\/([^/]+)\/(\d+)\.html$/))) return { view: 'category', cat: m[1], page: Number(m[2]) }
  // /tag/{tag}/{page}.html
  if ((m = path.match(/^\/tag\/([^/]+)\/(\d+)\.html$/))) return { view: 'keyword', tag: m[1], page: Number(m[2]) }
  // /search (无 .html)
  if (path === '/search') return { view: 'search' }
  // /history
  if (path === '/history') return { view: 'history' }
  return null
}

/** /book/b123.html  /read/r123/c456.html  /category/c2/p1.html */
function parseAlphanumeric(path: string): ViewPathParams | null {
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/book\/b([^/]+)\.html$/))) return { view: 'book', bookId: m[1] }
  if ((m = path.match(/^\/read\/r([^/]+)\/c([^/]+)\.html$/))) return { view: 'read', bookId: m[1], chapterId: m[2] }
  if ((m = path.match(/^\/category\/c([^/]+)\/p(\d+)\.html$/))) return { view: 'category', cat: m[1], page: Number(m[2]) }
  if ((m = path.match(/^\/tag\/t([^/]+)\/p(\d+)\.html$/))) return { view: 'keyword', tag: m[1], page: Number(m[2]) }
  return null
}

/** /book/123/  /read/123/456/  /category/2/  /tag/x/  /search/  /history/ */
function parseSlug(path: string): ViewPathParams | null {
  // 注意: path 已去尾斜杠, 这里匹配无尾斜杠形态
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/book\/([^/]+)$/))) return { view: 'book', bookId: m[1] }
  if ((m = path.match(/^\/read\/([^/]+)\/([^/]+)$/))) return { view: 'read', bookId: m[1], chapterId: m[2] }
  if ((m = path.match(/^\/category\/([^/]+)(?:\/(\d+))?$/))) return { view: 'category', cat: m[1], page: m[2] ? Number(m[2]) : 1 }
  if ((m = path.match(/^\/tag\/([^/]+)(?:\/(\d+))?$/))) return { view: 'keyword', tag: m[1], page: m[2] ? Number(m[2]) : 1 }
  if (path === '/search') return { view: 'search' }
  if (path === '/history') return { view: 'history' }
  return null
}

/** /b/123  /r/123/456  /c/2  /c/2/1  /t/x  /s  /h */
function parseShort(path: string): ViewPathParams | null {
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/b\/([^/]+)$/))) return { view: 'book', bookId: m[1] }
  if ((m = path.match(/^\/r\/([^/]+)\/([^/]+)$/))) return { view: 'read', bookId: m[1], chapterId: m[2] }
  if ((m = path.match(/^\/c\/([^/]+)(?:\/(\d+))?$/))) return { view: 'category', cat: m[1], page: m[2] ? Number(m[2]) : 1 }
  if ((m = path.match(/^\/t\/([^/]+)(?:\/(\d+))?$/))) return { view: 'keyword', tag: m[1], page: m[2] ? Number(m[2]) : 1 }
  if (path === '/s') return { view: 'search' }
  if (path === '/h') return { view: 'history' }
  return null
}

/** /book-123.html  /read-123-456.html  /category-2-1.html  /tag-x-1.html  /search.html  /history.html */
function parseClassic(path: string): ViewPathParams | null {
  let m: RegExpMatchArray | null
  if ((m = path.match(/^\/book-([^/]+)\.html$/))) return { view: 'book', bookId: m[1] }
  if ((m = path.match(/^\/read-([^/]+)-([^/]+)\.html$/))) return { view: 'read', bookId: m[1], chapterId: m[2] }
  if ((m = path.match(/^\/category-([^/]+)-(\d+)\.html$/))) return { view: 'category', cat: m[1], page: Number(m[2]) }
  if ((m = path.match(/^\/tag-([^/]+)-(\d+)\.html$/))) return { view: 'keyword', tag: m[1], page: Number(m[2]) }
  if (path === '/search.html') return { view: 'search' }
  if (path === '/history.html') return { view: 'history' }
  return null
}

/** /book/123/456.html  /read/123/456/789.html  /category/2/1.html  /tag/x/1.html */
function parseDir(path: string): ViewPathParams | null {
  let m: RegExpMatchArray | null
  // /book/{prefix}/{id}.html (prefix 是 id 前3位, 可忽略, 用 id)
  if ((m = path.match(/^\/book\/([^/]+)\/([^/]+)\.html$/))) return { view: 'book', bookId: m[2] }
  // /read/{prefix}/{bid}/{cid}.html
  if ((m = path.match(/^\/read\/([^/]+)\/([^/]+)\/([^/]+)\.html$/))) return { view: 'read', bookId: m[2], chapterId: m[3] }
  if ((m = path.match(/^\/category\/([^/]+)\/(\d+)\.html$/))) return { view: 'category', cat: m[1], page: Number(m[2]) }
  if ((m = path.match(/^\/tag\/([^/]+)\/(\d+)\.html$/))) return { view: 'keyword', tag: m[1], page: Number(m[2]) }
  return null
}

// ============================================================
// §4  兼容旧接口
// ============================================================

export type BookUrlStyle = 'id' | 'query'

/** 伪静态是否已启用 (配置 /book/* rewrite 后置 true, 见 next.config.ts rewrites) */
export const PSEUDOSTATIC_ENABLED = false

/**
 * 构建书籍页路径 (不含域名) — 兼容旧调用方(links.ts)。
 * 新代码应使用 buildViewUrl。
 */
export function buildBookUrl(bookId: string, style: BookUrlStyle = 'id'): string {
  const id = (bookId || '').trim()
  if (!id) return '/'
  if (style === 'id' && PSEUDOSTATIC_ENABLED) return `/book/${encodeURIComponent(id)}.html`
  return `/?view=book&id=${encodeURIComponent(id)}`
}

/**
 * Next.js rewrites 规则 — 把伪静态路径转发到查询串风格。
 * 在 next.config.ts 的 rewrites() 中调用。
 *
 * 规则把所有伪静态路径(/book/*, /read/*, /category/*, /tag/*, /b/*, /r/*, /c/*, /t/*, /s, /h,
 * /book-*, /read-*, /category-*, /tag-*, /search.html, /history.html, /history/) 转发到根路径
 * /?view=...&id=...&chapter=...&cat=...&tag=...&page=..., 由 parseView 从查询串解析。
 *
 * 注意: rewrites 不改变浏览器 URL, 用户看到的仍是伪静态路径; 服务端把请求转发到根路由,
 * PublicSite 用 parseViewPath 从 window.location.pathname 解析回视图参数。
 */
export function pseudoStaticRewrites() {
  return [
    // numeric: /book/{id}.html → /
    { source: '/book/:id.html', destination: '/' },
    // numeric: /read/{bid}/{cid}.html → /
    { source: '/read/:bid/:cid.html', destination: '/' },
    // numeric: /category/{cat}/{page}.html → /
    { source: '/category/:cat/:page.html', destination: '/' },
    // numeric: /tag/{tag}/{page}.html → /
    { source: '/tag/:tag/:page.html', destination: '/' },
    // alphanumeric: /book/b{id}.html → /
    { source: '/book/b:id.html', destination: '/' },
    // alphanumeric: /read/r{bid}/c{cid}.html → /
    { source: '/read/r:bid/c:cid.html', destination: '/' },
    // alphanumeric: /category/c{cat}/p{page}.html → /
    { source: '/category/c:cat/p:page.html', destination: '/' },
    // slug: /book/{id}/ → /
    { source: '/book/:id/', destination: '/' },
    // slug: /read/{bid}/{cid}/ → /
    { source: '/read/:bid/:cid/', destination: '/' },
    // slug: /category/{cat}/ → /
    { source: '/category/:cat/', destination: '/' },
    // slug: /category/{cat}/{page}/ → /
    { source: '/category/:cat/:page/', destination: '/' },
    // slug: /tag/{tag}/ → /
    { source: '/tag/:tag/', destination: '/' },
    // short: /b/{id} → /
    { source: '/b/:id', destination: '/' },
    // short: /r/{bid}/{cid} → /
    { source: '/r/:bid/:cid', destination: '/' },
    // short: /c/{cat} → /
    { source: '/c/:cat', destination: '/' },
    // short: /c/{cat}/{page} → /
    { source: '/c/:cat/:page', destination: '/' },
    // short: /t/{tag} → /
    { source: '/t/:tag', destination: '/' },
    // short: /s → /?view=search
    { source: '/s', destination: '/?view=search' },
    // short: /h → /?view=history
    { source: '/h', destination: '/?view=history' },
    // classic: /book-{id}.html → /
    { source: '/book-:id.html', destination: '/' },
    // classic: /read-{bid}-{cid}.html → /
    { source: '/read-:bid-:cid.html', destination: '/' },
    // classic: /category-{cat}-{page}.html → /
    { source: '/category-:cat-:page.html', destination: '/' },
    // classic: /tag-{tag}-{page}.html → /
    { source: '/tag-:tag-:page.html', destination: '/' },
    // classic: /search.html → /?view=search
    { source: '/search.html', destination: '/?view=search' },
    // classic: /history.html → /?view=history
    { source: '/history.html', destination: '/?view=history' },
    // dir: /book/{prefix}/{id}.html → /
    { source: '/book/:prefix/:id.html', destination: '/' },
    // dir: /read/{prefix}/{bid}/{cid}.html → /
    { source: '/read/:prefix/:bid/:cid.html', destination: '/' },
    // /search → /?view=search
    { source: '/search', destination: '/?view=search' },
    // /history → /?view=history
    { source: '/history', destination: '/?view=history' },
    // /history/ → /?view=history
    { source: '/history/', destination: '/?view=history' },
    // sitemap.xml → /api/public/sitemap (保留)
    { source: '/sitemap.xml', destination: '/api/public/sitemap' },
  ]
}
