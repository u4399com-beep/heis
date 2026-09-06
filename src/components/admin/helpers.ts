// ============================================================
// 后台管理 — 共享数据层 / 类型 / 工具函数
// 所有 API 均为相对路径, 统一返回 { ok, data, message }
// ============================================================
import type { CleanConfig, FetchConfig, FieldRule, PageRule, RuleConfig } from '@/lib/crawl/types'
import { parseRuleConfig } from '@/lib/crawl/types'

// ---------------- API 包装 ----------------
interface Envelope<T> {
  ok: boolean
  data: T
  message?: string
  // API-3: middleware 的 401/429 直接返回 { ok:false, error, code } 而非 fail() 的 message 字段;
  // 兼容两种信封: 优先取 message(路由内业务错误), 缺省时回退 error(中间件鉴权/限流), 最后兜底通用提示
  error?: string
  code?: string
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  })
  let json: Envelope<T> | null = null
  try {
    json = (await res.json()) as Envelope<T>
  } catch {
    throw new Error(`服务响应异常 (${res.status})`)
  }
  if (!json || typeof json.ok !== 'boolean') throw new Error('服务响应格式错误')
  if (!json.ok) throw new Error(json.message || json.error || '操作失败')
  return json.data
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

export const api = {
  get: <T>(url: string, params?: Record<string, string | number | undefined>) =>
    request<T>(url + (params ? qs(params) : '')),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(url: string, params?: Record<string, string | number | undefined>) =>
    request<T>(url + (params ? qs(params) : ''), { method: 'DELETE' }),
}

// ---------------- 通用行类型 ----------------
export type TaskStatus = 'pending' | 'running' | 'paused' | 'stopped' | 'done' | 'error'
export type BookStatus = 'ongoing' | 'completed' | 'unknown'
export type RuleSection = 'list' | 'book' | 'toc' | 'content'

export interface RuleRow {
  id: string
  name: string
  description: string | null
  config: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface TaskRow {
  id: string
  name: string
  ruleId: string
  mode: string // single | range
  bookUrl: string
  listUrl: string
  listStart: number
  listEnd: number
  bookStart: number
  bookEnd: number
  recrawlMode: string // full | incremental
  storageMode: string // db | txt
  fetchConfig: string
  threadMin: number
  threadMax: number
  intervalMin: number
  intervalMax: number
  smartCategory: boolean
  smartComplete: boolean
  autoSuggest: boolean
  autoRefresh: boolean
  refreshIntervalMin: number
  status: TaskStatus
  progress: string
  stats: string
  rule?: { id: string; name: string }
  createdAt: string
  updatedAt: string
}

/** 运行器进度快照 (见 src/lib/crawl/runner.ts) */
export interface TaskProgress {
  phase?: 'idle' | 'discovery' | 'book' | 'toc' | 'content' | 'done'
  phaseNote?: string
  discovered?: number
  booksDone?: number
  booksTotal?: number
  tocTotal?: number
  contentDone?: number
  contentTotal?: number
  currentBook?: string
}

/** 运行器统计快照 */
export interface TaskStats {
  booksCreated?: number
  booksUpdated?: number
  chaptersCreated?: number
  chaptersUpdated?: number
  coversSaved?: number
  suggestWords?: number
  errors?: number
}

export interface BookListRow {
  id: string
  name: string
  author: string
  cover: string
  status: string
  wordCount: number
  latestChapter: string
  sourceUrl: string
  storageMode: string
  intro?: string
  keywords?: string
  categoryId?: string | null
  updatedAt: string
  category?: { id: string; name: string } | null
  _count?: { chapters: number; tags?: number }
}

export interface BookDetailData extends BookListRow {
  collectedAt?: string | null
  tags: BookTagRow[]
  _count?: { chapters: number }
}

export interface BookTagRow {
  id: string
  tag: string
  source: string
  hits: number
}

export interface TocRow {
  id: string
  idx: number
  title: string
  url: string
  storage: string
  filePath?: string | null
  wordCount: number
  fetched: boolean
  /** 所属卷名(kk-a 番茄规则提取; 旧数据/无卷源为空串 → 目录不分组) */
  volume?: string
  updatedAt: string
}

export interface ChapterRow extends TocRow {
  bookId: string
  content?: string | null
}

export interface CategoryRow {
  id: string
  name: string
  sortOrder: number
  createdAt: string
  _count?: { books: number }
}

export interface SiteRow {
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
  /** 是否参与站群链轮(页脚互链); 缺省参与 — 旧数据可能缺字段 */
  inLinkWheel?: boolean
  createdAt: string
  updatedAt: string
}

export interface DownloadJobRow {
  id: string
  bookId: string
  options: string
  status: 'pending' | 'running' | 'done' | 'error'
  filePath: string | null
  error: string | null
  size: number
  createdAt: string
  book?: { name: string; author: string }
}

export interface StatsData {
  books: number
  chapters: number
  rules: number
  tasks: number
  runningTasks: number
  sites: number
  tags: number
  downloads: number
  totalWords: number
  recentTasks: (TaskRow & { rule?: { name: string } })[]
  recentBooks: {
    id: string
    name: string
    author: string
    cover: string
    status: string
    updatedAt: string
    _count?: { chapters: number }
  }[]
  categories: { id: string; name: string; _count?: { books: number } }[]
  // feat-b: 可视化字段 (后端每项独立 try/catch, 失败时为空数组, 客户端按空数组处理)
  wordsByCategory: { name: string; words: number }[]
  booksByStatus: { status: string; count: number }[]
  chaptersLast7d: { day: string; count: number }[]
  booksLast7d: { day: string; count: number }[]
  taskStatusBreakdown: { status: string; count: number }[]
}

/** feat-c: 可视化调试单条匹配记录 — 描述某个字段被哪个选择器命中、命中第几个列表项、值与预览 */
export interface DebugMatch {
  /** 字段名(title/url/name/author/content/...) */
  field: string
  /** 命中字段所用的选择器/规则摘要, 如 "css:h1.title" / "xpath://div" / "regex:..." */
  selector: string
  /** 列表项序号(0基; book/content 段固定为 0) */
  idx: number
  /** 提取到的完整值(可能为空串) */
  value: string
  /** 值的短预览(≤80 字符) */
  preview: string
}

export interface RuleTestResult {
  engine: string
  htmlSize: number
  ms: number
  type: RuleSection
  count?: number
  pages?: number
  sample?: Record<string, string>[] | { title: string; url: string }[]
  fields?: Record<string, string>
  rawLength?: number
  cleanedLength?: number
  cleanedText?: string
  cleanedHtml?: string
  // feat-c: 可视化调试附加字段(全部 ADDITIVE, 调用方不使用时不影响现有契约)
  // 服务端在 try/catch 内构建, 任何构建异常都会把这三字段置 null, 调用方按 null 隐藏调试视图
  /** 注入 <mark class="heis-debug-match"> 高亮标记的 HTML(cheerio 序列化) */
  debugHtml?: string | null
  /** 原始未修改的抓取 HTML(供"原始 HTML"视图切换) */
  rawHtml?: string | null
  /** 每条匹配的字段/选择器/索引/值/预览, 用于右侧"匹配详情"面板 */
  debugMatches?: DebugMatch[] | null
}

// ---------------- feat-b: 健康监控 (与 /api/admin/health 响应一致) ----------------
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthService {
  reachable: boolean
  selfTestOk?: boolean
  note?: string
}

export interface HealthData {
  status: HealthStatus
  uptime: number
  db: 'ok' | 'fail'
  runner: { activeTasks: number; runtimes: number }
  hostGate: { hosts: number }
  services: Record<string, HealthService>
  memory: { rss: number; heapUsed: number; heapTotal: number }
  reqId?: string
}

/** 运行时长格式化: "运行 X天 Y小时 Z分钟" / "运行 Y小时 Z分钟" / "运行 Z分钟" */
export function fmtUptime(seconds?: number | null): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  if (s < 60) return `运行 ${s}秒`
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}天`)
  if (h > 0 || d > 0) parts.push(`${h}小时`)
  parts.push(`${m}分钟`)
  return `运行 ${parts.join('')}`
}

/** 字节数 → MB 字符串, 1 位小数 */
export function fmtMB(n?: number | null): string {
  const v = Number(n) || 0
  return `${(v / 1024 / 1024).toFixed(1)}MB`
}

// ---------------- JSON 安全解析 ----------------
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw) as T
    if (v === null || v === undefined) return fallback
    return v
  } catch {
    return fallback
  }
}

// parseRuleConfig 直接复用后端实现(src/lib/crawl/types), 合并默认值并容错
export { parseRuleConfig }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * 更稳健的规则配置解析: 先校验顶层各段为纯对象再交给 parseRuleConfig,
 * 防止旧格式/脏数据(如某段是字符串或数组)被展开成索引键导致编辑器渲染异常白屏。
 */
export function safeParseRuleConfig(raw: string | null | undefined): RuleConfig {
  if (!raw) return parseRuleConfig(null)
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainObject(parsed)) return parseRuleConfig(null)
    for (const key of ['list', 'book', 'toc', 'content', 'fetch', 'clean']) {
      if (parsed[key] !== undefined && !isPlainObject(parsed[key])) delete parsed[key]
    }
    return parseRuleConfig(JSON.stringify(parsed))
  } catch {
    return parseRuleConfig(null)
  }
}

// ---------------- 格式化 ----------------
export function fmtDateTime(input?: string | Date | null): string {
  if (!input) return '-'
  const d = typeof input === 'string' ? new Date(input) : input
  if (isNaN(d.getTime())) return '-'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtWords(n?: number | null): string {
  const v = Number(n) || 0
  if (v < 10000) return String(v)
  return `${(v / 10000).toFixed(1)} 万`
}

export function fmtBytes(n?: number | null): string {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / 1024 / 1024).toFixed(2)} MB`
}

export function fmtNum(n?: number | null): string {
  return (Number(n) || 0).toLocaleString('zh-CN')
}

/** 封面地址: 外链直接用, 本地 covers/xxx.webp 走封面服务 */
export function coverUrl(cover?: string | null): string {
  if (!cover) return ''
  if (/^https?:\/\//i.test(cover)) return cover
  const file = cover.replace(/^covers\//, '').replace(/^\/+/, '')
  return `/api/public/cover?file=${encodeURIComponent(file)}`
}

/** 字符串转多行数组(去空行) */
export function linesToArray(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** 数组转多行文本 */
export function arrayToLines(arr?: string[] | null): string {
  return (arr || []).join('\n')
}

// ---------------- 状态徽章映射 ----------------
export interface StatusMeta {
  label: string
  className: string
}

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  pending: { label: '等待中', className: 'bg-zinc-700/60 text-zinc-300 border-zinc-600' },
  running: { label: '运行中', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' },
  paused: { label: '已暂停', className: 'bg-amber-500/15 text-amber-400 border-amber-500/40' },
  stopped: { label: '已停止', className: 'bg-zinc-600/40 text-zinc-400 border-zinc-600' },
  done: { label: '已完成', className: 'bg-teal-500/15 text-teal-400 border-teal-500/40' },
  error: { label: '出错', className: 'bg-red-500/15 text-red-400 border-red-500/40' },
}

export const BOOK_STATUS_META: Record<string, StatusMeta> = {
  ongoing: { label: '连载中', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' },
  completed: { label: '已完结', className: 'bg-sky-500/15 text-sky-400 border-sky-500/40' },
  unknown: { label: '未知', className: 'bg-zinc-700/60 text-zinc-400 border-zinc-600' },
}

export const PHASE_META: Record<string, string> = {
  idle: '空闲',
  discovery: '发现书籍',
  book: '采集书籍信息',
  toc: '解析目录',
  content: '采集正文',
  done: '完成',
}

export const LOG_LEVEL_STYLE: Record<string, string> = {
  info: 'text-zinc-300',
  success: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
}

/** 页面字段组定义 — 编辑器展示用 */
export const SECTION_FIELD_DEFS: Record<RuleSection, { key: string; label: string; placeholder: string }[]> = {
  list: [
    { key: 'title', label: '书籍标题', placeholder: '例: a.bookname 或 //a[@class="name"]/text()' },
    { key: 'url', label: '书籍链接', placeholder: '例: a.bookname (attr=href)' },
  ],
  book: [
    { key: 'name', label: '书名', placeholder: '例: h1.title' },
    { key: 'author', label: '作者', placeholder: '例: #author 或 正则捕获组' },
    { key: 'category', label: '分类', placeholder: '例: .breadcrumb span:nth-last(2)' },
    { key: 'keywords', label: '关键词', placeholder: '例: meta[name=keywords] (attr=content)' },
    { key: 'intro', label: '简介', placeholder: '例: .intro / #intro' },
    { key: 'cover', label: '封面图', placeholder: '例: .cover img (attr=src)' },
    { key: 'latestChapter', label: '最新章节', placeholder: '例: .lastest a' },
    { key: 'status', label: '连载状态', placeholder: '例: .status (连载中/已完结/完本)' },
  ],
  toc: [
    { key: 'title', label: '章节标题', placeholder: '例: #list dd a' },
    { key: 'url', label: '章节链接', placeholder: '例: #list dd a (attr=href)' },
  ],
  content: [
    { key: 'content', label: '正文内容', placeholder: '例: #content (attr=html)' },
  ],
}

export type { FieldRule, PageRule, FetchConfig, CleanConfig, RuleConfig }
