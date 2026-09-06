// ============================================================
// 阅读位置记忆 + 阅读时长统计 — localStorage 持久化模块
//
// 设计:
// - 每本书一份 ReadPos 记录, 记录上次阅读位置 + 累计阅读时长
// - key: heis_readpos_<bookId>
// - listReadPos LRU 上限 50 条 (按 ts 倒序)
// - 调用方负责 debounce 节流 (见 shared.tsx useReadPosMemory)
//
// 与 bookmarks.ts 区分: 本模块只存"上次读到哪里"单条记录;
// bookmarks 存"用户主动收藏的章节" 多条列表。
// ============================================================

export interface ReadPos {
  /** 上次阅读章节 id */
  chapterId: string
  /** 滚动比例 (0-1) = scrollY / (scrollHeight - clientHeight) */
  scrollRatio: number
  /** 章节标题 (回看历史时展示) */
  title: string
  /** 上次活动时间戳 (ms) */
  ts: number
  /** 累计阅读时长 (ms) */
  readTimeMs?: number
}

const KEY_PREFIX = 'heis_readpos_'
const MAX_ENTRIES = 50

function lsKey(bookId: string): string {
  return `${KEY_PREFIX}${bookId}`
}

function safeRead(bookId: string): ReadPos | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(lsKey(bookId))
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<ReadPos>
    if (!v || typeof v.chapterId !== 'string') return null
    return {
      chapterId: v.chapterId,
      scrollRatio:
        typeof v.scrollRatio === 'number' && Number.isFinite(v.scrollRatio)
          ? Math.min(1, Math.max(0, v.scrollRatio))
          : 0,
      title: typeof v.title === 'string' ? v.title : '',
      ts: typeof v.ts === 'number' ? v.ts : Date.now(),
      readTimeMs:
        typeof v.readTimeMs === 'number' && Number.isFinite(v.readTimeMs)
          ? Math.max(0, Math.floor(v.readTimeMs))
          : 0,
    }
  } catch {
    return null
  }
}

function safeWrite(bookId: string, pos: ReadPos): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(lsKey(bookId), JSON.stringify(pos))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/**
 * 保存阅读位置 (覆盖式). 调用方应在 scroll 事件中 debounce 300ms 调用,
 * 避免高频写入 localStorage。
 */
export function saveReadPos(
  bookId: string,
  chapterId: string,
  scrollRatio: number,
  title: string,
): void {
  const prev = safeRead(bookId)
  const next: ReadPos = {
    chapterId,
    scrollRatio: Math.min(1, Math.max(0, scrollRatio)),
    title: title || prev?.title || '',
    ts: Date.now(),
    readTimeMs: prev?.readTimeMs ?? 0,
  }
  safeWrite(bookId, next)
}

/** 读取本书的阅读位置 (无则 null) */
export function getReadPos(bookId: string): ReadPos | null {
  return safeRead(bookId)
}

/** 清除本书的阅读位置 + 阅读时长 */
export function clearReadPos(bookId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(lsKey(bookId))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/**
 * 列出所有保存过阅读位置的书籍 (阅读历史), 按 ts 倒序, 上限 50。
 * 用于"最近阅读"列表。
 */
export function listReadPos(): Array<ReadPos & { bookId: string }> {
  if (typeof window === 'undefined') return []
  const out: Array<ReadPos & { bookId: string }> = []
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k || !k.startsWith(KEY_PREFIX)) continue
      const bookId = k.slice(KEY_PREFIX.length)
      const p = safeRead(bookId)
      if (p) out.push({ ...p, bookId })
    }
  } catch {
    /* 隐私模式等场景忽略 */
  }
  out.sort((a, b) => b.ts - a.ts)
  return out.slice(0, MAX_ENTRIES)
}

/** 取本书累计阅读时长 (ms), 无记录返回 0 */
export function getReadTimeMs(bookId: string): number {
  return safeRead(bookId)?.readTimeMs ?? 0
}

/** 写入本书累计阅读时长 (ms), 不动其它字段 */
export function setReadTimeMs(bookId: string, ms: number): void {
  const prev = safeRead(bookId)
  const safeMs = Math.max(0, Math.floor(ms))
  if (prev) {
    safeWrite(bookId, { ...prev, readTimeMs: safeMs, ts: Date.now() })
  } else {
    // 没有 chapter 也要先建一个空记录, 后续 saveReadPos 会补全
    safeWrite(bookId, {
      chapterId: '',
      scrollRatio: 0,
      title: '',
      ts: Date.now(),
      readTimeMs: safeMs,
    })
  }
}

/**
 * 将 ms 阅读时长格式化为简短中文:
 * - < 1min: N秒
 * - < 1h:   N分
 * - >= 1h:  NhNmm (或 Nh if M=0)
 */
export function formatReadTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm === 0 ? `${h}小时` : `${h}小时${mm}分`
}

/**
 * 紧凑格式 (用于徽章): 2h15m / 15m / 45s
 */
export function formatReadTimeShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm === 0 ? `${h}h` : `${h}h${mm}m`
}
