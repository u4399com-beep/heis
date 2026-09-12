// ============================================================
// 前台站群公共类型定义
// ============================================================

export type BookStatus = 'completed' | 'ongoing' | 'unknown'

/** 站群站点（/api/admin/sites 返回结构） */
export interface SiteInfo {
  id: string
  name: string
  domain: string
  themeId: string
  title: string
  description: string
  keywords: string
  icbm: string
  geoRegion: string
  geoPlacename: string
  offset: number
  isDefault: boolean
  status: boolean
  inLinkWheel?: boolean
  /** 章节内容分页模式: off | byWords | byPages (agent-P) */
  chapterPaginationMode?: 'off' | 'byWords' | 'byPages'
  /** byWords 模式: 每页字数 */
  chapterPaginationWords?: number
  /** byPages 模式: 强制拆分页数 */
  chapterPaginationPages?: number
  /** 自动生成 SEO TDK */
  chapterSeoAuto?: boolean
  /** SEO 标题模板 */
  chapterSeoTitleTemplate?: string
  /** SEO 描述模板 */
  chapterSeoDescTemplate?: string
  /** SEO 关键词模板 */
  chapterSeoKeywordsTemplate?: string
  /** 伪静态 URL 风格: query|numeric|alphanumeric|slug|short|classic|dir */
  pseudoStaticStyle?: string
}

/** 分类（/api/admin/categories 返回结构） */
export interface CategoryItem {
  id: string
  name: string
  _count?: { books: number }
}

/** 书籍列表项（/api/public/books 完整字段；/api/public/search 结果不含 latestChapter/updatedAt，故为可选） */
export interface BookItem {
  id: string
  name: string
  author: string
  intro: string
  cover: string
  status: BookStatus | string
  wordCount: number
  latestChapter?: string
  category: string
  categoryId?: string | null
  updatedAt?: string
}

/** 书籍详情（/api/public/book 中的 book 字段; rr-d: sourceUrl 已从公开面剥离, 仅管理端 API 提供） */
export interface BookDetail {
  id: string
  name: string
  author: string
  intro: string
  cover: string
  status: BookStatus | string
  keywords: string
  wordCount: number
  latestChapter: string
  category: string
  categoryId: string | null
  updatedAt: string
}

/** 目录章节项 */
export interface TocChapter {
  id: string
  idx: number
  title: string
  wordCount: number
  /** 所属卷名(kk-a 番茄规则提取; 旧数据/无卷源为空串 → 目录不分组) */
  volume?: string
}

/** 书籍标签项 */
export interface BookTagHit {
  tag: string
  hits: number
  source?: string
}

/** 章节数据（/api/public/chapter） */
export interface ChapterData {
  chapter: {
    id: string
    idx: number
    title: string
    content: string
    wordCount: number
  }
  book: {
    id: string
    name: string
    author: string
    status: BookStatus | string
    keywords: string
  }
  prev: { id: string; title: string } | null
  next: { id: string; title: string } | null
  /** 章节内容分页元数据 (agent-P) */
  pagination?: {
    mode: 'off' | 'byWords' | 'byPages'
    totalPages: number
    currentPage: number
    wordsPerPage?: number | null
    pagesTarget?: number | null
  }
  /** SEO 模板 (agent-P) */
  seo?: {
    auto: boolean
    titleTemplate: string
    descTemplate: string
    keywordsTemplate: string
  }
}

/** 搜索结果（/api/public/search） */
export interface SearchData {
  q: string
  books: BookItem[]
  relatedTags: { tag: string; bookId: string; bookName: string }[]
}

/** 关键词落地页数据（/api/public/keyword） */
export interface KeywordData {
  tag: string
  book: {
    id: string
    name: string
    author: string
    intro: string
    cover: string
    status: BookStatus | string
    wordCount: number
    category: string
  } | null
  otherBooks: { id: string; name: string; author: string }[]
  related: string[]
}
