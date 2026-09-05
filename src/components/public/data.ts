// ============================================================
// 前台 API fetch 封装 — 统一 { ok, data } 解包
// ============================================================
import type {
  BookDetail,
  BookItem,
  BookTagHit,
  CategoryItem,
  ChapterData,
  KeywordData,
  SearchData,
  SiteInfo,
  TocChapter,
} from './types'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  let json: { ok?: boolean; data?: T; message?: string }
  try {
    json = await res.json()
  } catch {
    throw new Error('网络响应异常')
  }
  if (!json.ok || json.data === undefined) throw new Error(json.message || '请求失败')
  return json.data
}

/** 站点列表（站群切换器用） */
export function fetchSites(): Promise<SiteInfo[]> {
  return get<SiteInfo[]>('/api/admin/sites')
}

/** 分类列表（顶部导航用） */
export function fetchCategories(): Promise<CategoryItem[]> {
  return get<CategoryItem[]>('/api/admin/categories')
}

export interface BooksQuery {
  site?: string
  q?: string
  cat?: string
  status?: string
  sort?: 'latest' | 'words'
  page?: number
  size?: number
}

export interface BooksData {
  total: number
  page: number
  size: number
  books: BookItem[]
}

/** 书籍列表（site 传站点ID，后端按站点偏移量切片） */
export function fetchBooks(qy: BooksQuery): Promise<BooksData> {
  const sp = new URLSearchParams()
  if (qy.site) sp.set('site', qy.site)
  if (qy.q) sp.set('q', qy.q)
  if (qy.cat) sp.set('cat', qy.cat)
  if (qy.status) sp.set('status', qy.status)
  sp.set('sort', qy.sort || 'latest')
  sp.set('page', String(qy.page || 1))
  sp.set('size', String(qy.size || 24))
  return get<BooksData>(`/api/public/books?${sp.toString()}`)
}

export interface BookDetailData {
  book: BookDetail
  tocTotal: number
  tocPage: number
  tocSize: number
  tocTotalPages: number
  chapters: TocChapter[]
  tags: BookTagHit[]
}

/** 书籍详情 + 分页目录 */
export function fetchBook(id: string, tocPage = 1, tocSize = 100): Promise<BookDetailData> {
  const sp = new URLSearchParams({ id })
  sp.set('tocPage', String(tocPage))
  sp.set('tocSize', String(tocSize))
  return get<BookDetailData>(`/api/public/book?${sp.toString()}`)
}

/** 章节正文 + 上一章/下一章 */
export function fetchChapter(id: string): Promise<ChapterData> {
  return get<ChapterData>(`/api/public/chapter?id=${encodeURIComponent(id)}`)
}

/** 全站搜索 */
export function fetchSearch(q: string): Promise<SearchData> {
  return get<SearchData>(`/api/public/search?q=${encodeURIComponent(q)}`)
}

/** 关键词落地页 */
export function fetchKeyword(tag: string): Promise<KeywordData> {
  return get<KeywordData>(`/api/public/keyword?tag=${encodeURIComponent(tag)}`)
}

// ---------------- 页脚友链/链轮 ----------------

export interface FooterFriendLink {
  id: string
  name: string
  url: string
  logo: string
}

export interface FooterWheelLink {
  text: string
  url: string
}

export interface FooterLinksData {
  friend: FooterFriendLink[]
  wheel: FooterWheelLink[]
  wheelEnabled?: boolean
  mode?: string
  count?: number
}

/**
 * 页脚友链/链轮 — in-flight 去重(同一时刻共享同一请求), 无长缓存(请求结束即弃,
 * 每次挂载/换一批都拿实时随机结果), 失败静默降级返回 null(调用方不渲染模块)。
 * fresh=true 绕过 in-flight 强制拉新(「换一批」按钮用)。
 */
const footerLinksInflight = new Map<string, Promise<FooterLinksData | null>>()

export function fetchFooterLinks(fresh = false, siteId = ''): Promise<FooterLinksData | null> {
  // ii-a 修复: inflight 去重按 siteId 分键 —— 修前模块级单例无视 siteId, 换站瞬间新站
  // 复用旧站在途 Promise, 友链/链轮数据按"旧站排除旧站"计算, 可能出现指向当前站的链接
  // (违反 links.ts「永不指向当前站」不变量)且持续到下次换站
  if (fresh) footerLinksInflight.clear()
  const existing = footerLinksInflight.get(siteId)
  if (existing) return existing
  const p = (async (): Promise<FooterLinksData | null> => {
    try {
      const sp = new URLSearchParams()
      if (siteId) sp.set('site', siteId)
      const qs = sp.toString()
      const res = await fetch(`/api/public/links${qs ? `?${qs}` : ''}`, { cache: 'no-store' })
      const json: { ok?: boolean; data?: Record<string, unknown> } = await res.json().catch(() => null)
      if (!json?.ok || !json.data) return null
      const d = json.data
      return {
        friend: Array.isArray(d.friend) ? (d.friend as FooterFriendLink[]) : [],
        wheel: Array.isArray(d.wheel) ? (d.wheel as FooterWheelLink[]) : [],
        wheelEnabled: typeof d.wheelEnabled === 'boolean' ? d.wheelEnabled : undefined,
        mode: typeof d.mode === 'string' ? d.mode : undefined,
        count: typeof d.count === 'number' ? d.count : undefined,
      }
    } catch {
      return null // 失败静默降级: 页脚友链模块整体不渲染
    }
  })()
  footerLinksInflight.set(siteId, p)
  void p.finally(() => {
    if (footerLinksInflight.get(siteId) === p) footerLinksInflight.delete(siteId)
  })
  return p
}

// ---------------- 全站搜索下拉词(首页/页脚随机词云) ----------------

export interface SuggestTagsEntry {
  ts: number
  /** 词池条数(缓存按它分键, 词池变化自然换键) */
  poolSize: number
  tags: string[]
}

const SUGGEST_KEY_PREFIX = 'suggestTags:'
const SUGGEST_TTL = 60_000

let suggestInflight: Promise<SuggestTagsEntry | null> | null = null
// sessionStorage 不可用(隐私模式/配额满)时的内存兜底
let suggestMemory: SuggestTagsEntry | null = null

function suggestCacheRead(): SuggestTagsEntry | null {
  if (suggestMemory && Date.now() - suggestMemory.ts < SUGGEST_TTL) return suggestMemory
  try {
    const now = Date.now()
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (!k || !k.startsWith(SUGGEST_KEY_PREFIX)) continue
      const raw = sessionStorage.getItem(k)
      if (!raw) continue
      const c = JSON.parse(raw) as SuggestTagsEntry
      if (c && typeof c.ts === 'number' && Array.isArray(c.tags) && now - c.ts < SUGGEST_TTL) {
        suggestMemory = c
        return c
      }
    }
  } catch {
    // 隐私模式读写抛错 → 退化到仅内存缓存
  }
  return null
}

function suggestCacheWrite(c: SuggestTagsEntry) {
  suggestMemory = c
  try {
    sessionStorage.setItem(SUGGEST_KEY_PREFIX + c.poolSize, JSON.stringify(c))
  } catch {
    // 隐私模式/配额满 → 仅内存
  }
}

/**
 * 全站下拉词池(≤120 条, 后端已洗牌) — in-flight 去重 + sessionStorage 60s TTL
 * (按 poolSize 分键) + 隐私模式 try/catch 退化内存缓存。失败静默返回 null(调用方不渲染)。
 * 客户端组件再自行洗牌抽 n 个, 「换一批」不重新请求。
 */
export function fetchSuggestTags(): Promise<SuggestTagsEntry | null> {
  const cached = suggestCacheRead()
  if (cached) return Promise.resolve(cached)
  if (suggestInflight) return suggestInflight
  const p = (async (): Promise<SuggestTagsEntry | null> => {
    try {
      const res = await fetch('/api/public/tags?n=120', { cache: 'no-store' })
      const json: { ok?: boolean; data?: { tags?: unknown } } = await res.json().catch(() => null)
      if (!json?.ok || !json.data) return null
      const tags = Array.isArray(json.data.tags)
        ? (json.data.tags as unknown[]).filter((t): t is string => typeof t === 'string' && !!t.trim())
        : []
      const entry: SuggestTagsEntry = { ts: Date.now(), poolSize: tags.length, tags }
      suggestCacheWrite(entry)
      return entry
    } catch {
      return null // 失败静默降级
    }
  })()
  suggestInflight = p
  void p.finally(() => {
    if (suggestInflight === p) suggestInflight = null
  })
  return p
}

// ---------------- 首页分类图文卡(6 分类封面) ----------------

export interface ShowcaseCategory {
  id: string
  name: string
  bookCount: number
  /** 代表书: 字数最高带封面书; 无书时为 null */
  rep: { id: string; name: string; cover: string } | null
}

/**
 * 分类图文数据(非空分类按 sortOrder, 各带代表书封面), 失败静默返回 null(调用方不渲染区块)。
 */
export function fetchShowcaseCategories(): Promise<ShowcaseCategory[] | null> {
  return (async (): Promise<ShowcaseCategory[] | null> => {
    try {
      const res = await fetch('/api/public/categories?limit=24', { cache: 'no-store' })
      const json: { ok?: boolean; data?: { items?: unknown } } = await res.json().catch(() => null)
      if (!json?.ok || !json.data || !Array.isArray(json.data.items)) return null
      const items: ShowcaseCategory[] = []
      for (const raw of json.data.items) {
        if (!raw || typeof raw !== 'object') continue
        const it = raw as Record<string, unknown>
        if (typeof it.id !== 'string' || typeof it.name !== 'string') continue
        const repRaw = it.rep && typeof it.rep === 'object' ? (it.rep as Record<string, unknown>) : null
        items.push({
          id: it.id,
          name: it.name,
          bookCount: typeof it.bookCount === 'number' ? it.bookCount : 0,
          rep:
            repRaw && typeof repRaw.id === 'string' && typeof repRaw.name === 'string'
              ? { id: repRaw.id, name: repRaw.name, cover: typeof repRaw.cover === 'string' ? repRaw.cover : '' }
              : null,
        })
      }
      return items
    } catch {
      return null // 失败静默降级: 分类图文卡整体不渲染
    }
  })()
}
