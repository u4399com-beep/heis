// ============================================================
// 章节阅读进度 — localStorage 持久化模块 (feat-round-10 B1)
//
// 设计:
// - 每本书一份已读章节集合, 上限 500 条 (按章节 id 去重, LRU 驱逐)
// - key: heis_readchapters_<bookId>
// - 内部存为 JSON 数组, 顺序 = 阅读顺序 (尾部追加; 重复 id 先 splice 再 push)
// - "已读" 定义: 用户访问过该章节 + 滚动 > 10% (调用方 useReadPosMemory 判定)
//
// 与 reading-memory.ts 区分: 那个只记"上次读到哪里"单条记录;
// 与 bookmarks.ts 区分: 那个是用户主动收藏的多条列表;
// 本模块是"读过哪些章节"的集合, 用于目录中显示已读状态与整体阅读进度。
// ============================================================

const KEY_PREFIX = 'heis_readchapters_'
const MAX_PER_BOOK = 500

function lsKey(bookId: string): string {
  return `${KEY_PREFIX}${bookId}`
}

function safeReadList(bookId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(lsKey(bookId))
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((e): e is string => typeof e === 'string' && e.length > 0)
  } catch {
    return []
  }
}

function safeWriteList(bookId: string, list: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(lsKey(bookId), JSON.stringify(list))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/**
 * 返回本书已读章节 id 的 Set。
 * 用于 TocDrawer 渲染每行已读状态 + 计算阅读进度。
 */
export function getReadChapters(bookId: string): Set<string> {
  return new Set(safeReadList(bookId))
}

/**
 * 标记某章节为已读 (幂等: 已存在则只更新顺序到尾部; 不存在则追加, 超上限 LRU 驱逐)。
 * 调用方应在用户访问该章节且滚动 > 10% 时调用一次 (内部 ref 去重, 重复调用安全)。
 */
export function markChapterRead(bookId: string, chapterId: string): void {
  if (!bookId || !chapterId) return
  const list = safeReadList(bookId)
  const i = list.indexOf(chapterId)
  if (i >= 0) {
    // 已存在且已在尾部 → 跳过写入, 减少 localStorage IO
    if (i === list.length - 1) return
    list.splice(i, 1)
    list.push(chapterId)
    safeWriteList(bookId, list)
    return
  }
  list.push(chapterId)
  // 超上限: 从头部裁剪 (最旧的"已读"标记被移除, 仍为"已读" — 只是退出可视范围)
  if (list.length > MAX_PER_BOOK) {
    const trimmed = list.slice(list.length - MAX_PER_BOOK)
    safeWriteList(bookId, trimmed)
  } else {
    safeWriteList(bookId, list)
  }
}

/** 清除本书所有已读章节记录 (预留: 设置页"清除阅读记录"调用) */
export function clearReadChapters(bookId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(lsKey(bookId))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
