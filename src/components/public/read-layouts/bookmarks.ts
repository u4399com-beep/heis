// ============================================================
// 章节书签 — localStorage 持久化模块
//
// 设计:
// - 每本书一份书签列表, 上限 200 条
// - key: heis_bookmarks_<bookId>
// - 列表按章节 idx 升序排序
// - 调用方负责主动刷新 UI (toggleBookmark 返回新状态以便 setState)
// ============================================================

export interface Bookmark {
  /** 章节 id */
  chapterId: string
  /** 章节序号 (用于排序) */
  idx: number
  /** 章节标题 */
  title: string
  /** 加入书签的时间戳 (ms) */
  ts: number
}

const KEY_PREFIX = 'heis_bookmarks_'
const MAX_PER_BOOK = 200

function lsKey(bookId: string): string {
  return `${KEY_PREFIX}${bookId}`
}

function safeRead(bookId: string): Bookmark[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(lsKey(bookId))
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v
      .filter((e): e is Bookmark =>
        !!e &&
        typeof (e as Bookmark).chapterId === 'string' &&
        typeof (e as Bookmark).idx === 'number' &&
        typeof (e as Bookmark).title === 'string' &&
        typeof (e as Bookmark).ts === 'number',
      )
      .sort((a, b) => a.idx - b.idx)
  } catch {
    return []
  }
}

function safeWrite(bookId: string, list: Bookmark[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(lsKey(bookId), JSON.stringify(list))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/**
 * 切换书签状态 (返回 true = 已添加, false = 已移除)。
 * 上限 MAX_PER_BOOK, 已满则返回 false 且不添加。
 */
export function toggleBookmark(
  bookId: string,
  chapter: { id: string; idx: number; title: string },
): boolean {
  const list = safeRead(bookId)
  const i = list.findIndex((b) => b.chapterId === chapter.id)
  if (i >= 0) {
    list.splice(i, 1)
    safeWrite(bookId, list)
    return false
  }
  if (list.length >= MAX_PER_BOOK) {
    // LRU: 移除最旧 (ts 最小) 的一条
    let oldestIdx = 0
    for (let k = 1; k < list.length; k++) {
      if (list[k].ts < list[oldestIdx].ts) oldestIdx = k
    }
    list.splice(oldestIdx, 1)
  }
  list.push({
    chapterId: chapter.id,
    idx: chapter.idx,
    title: chapter.title,
    ts: Date.now(),
  })
  list.sort((a, b) => a.idx - b.idx)
  safeWrite(bookId, list)
  return true
}

/** 查询某章是否已加入书签 */
export function isBookmarked(bookId: string, chapterId: string): boolean {
  const list = safeRead(bookId)
  return list.some((b) => b.chapterId === chapterId)
}

/** 列出本书所有书签 (按 idx 升序) */
export function listBookmarks(bookId: string): Bookmark[] {
  return safeRead(bookId)
}

/** 清空本书所有书签 */
export function clearBookmarks(bookId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(lsKey(bookId))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/**
 * 相对时间中文 (3天前 / 2小时前 / 5分钟前 / 刚刚)
 */
export function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts
  if (delta < 0) return '刚刚'
  const s = Math.floor(delta / 1000)
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}个月前`
  const y = Math.floor(d / 365)
  return `${y}年前`
}
