// ============================================================
// 搜索历史 — localStorage 持久化模块
//
// 设计:
// - 单条 string 记录最近 20 条搜索词
// - key: heis_search_history (JSON 数组)
// - addSearchHistory: 去重 + unshift 新词 + 截断到 20
// - 隐私模式 / 配额满时 try/catch 静默降级
// ============================================================

const KEY = 'heis_search_history'
const MAX_ENTRIES = 20

function safeRead(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v
      .filter((s): s is string => typeof s === 'string' && !!s.trim())
      .map((s) => s.trim())
      .slice(0, MAX_ENTRIES)
  } catch {
    return []
  }
}

function safeWrite(list: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)))
  } catch {
    /* 隐私模式 / 配额满 → 静默忽略 */
  }
}

/**
 * 读取搜索历史 — 最近 20 条, 最新的在最前。
 */
export function getSearchHistory(): string[] {
  return safeRead()
}

/**
 * 追加一条搜索词 (去重 + 置顶 + 截断到 20 条)。
 * 空白/空串直接忽略。
 */
export function addSearchHistory(term: string): void {
  const t = (term || '').trim()
  if (!t) return
  const cur = safeRead().filter((s) => s !== t)
  cur.unshift(t)
  safeWrite(cur)
}

/**
 * 移除单条搜索历史 (按精确匹配)。
 */
export function removeSearchHistory(term: string): void {
  const cur = safeRead().filter((s) => s !== term)
  safeWrite(cur)
}

/**
 * 清空全部搜索历史。
 */
export function clearSearchHistory(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* 隐私模式 → 静默 */
  }
}
