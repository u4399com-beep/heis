// 任务创建/更新入参规范化 (POST/PUT 共用)
import { clampInt, str, httpUrl, isPlainObject } from '../../_lib/http'

export const TASK_STATUSES = ['pending', 'running', 'paused', 'stopped', 'done', 'error'] as const

export interface NormalizedTask {
  name: string
  mode: 'single' | 'range'
  bookUrl: string
  listUrl: string
  listStart: number
  listEnd: number
  bookStart: number
  bookEnd: number
  recrawlMode: 'full' | 'incremental'
  storageMode: 'db' | 'txt'
  fetchConfig: string
  threadMin: number
  threadMax: number
  intervalMin: number
  intervalMax: number
  smartCategory: boolean
  smartComplete: boolean
  autoSuggest: boolean
}

/**
 * 任务字段白名单规范化: 全量模式(POST)时给默认值, 增量模式(PUT)时仅返回出现的字段。
 * 返回 { data, error } — error 为面向用户的错误消息。
 */
export function normalizeTaskData(
  body: Record<string, any>,
  mode: 'full' | 'partial'
): { data: Partial<NormalizedTask> & Record<string, unknown>; error?: string } {
  const out: Record<string, unknown> = {}
  const full = mode === 'full'

  // 名称
  if (full || body?.name !== undefined) {
    const name = str(body?.name, 100).trim()
    if (!name) return { data: {}, error: '任务名称必填' }
    out.name = name
  }

  // 模式(显式提供非法值时报错, 不静默改写为 range 造成误解)
  if (full || body?.mode !== undefined) {
    if (body?.mode !== undefined && !['single', 'range'].includes(body.mode)) {
      return { data: {}, error: '采集模式必须是 single(单本) 或 range(范围)' }
    }
    out.mode = body?.mode === 'single' ? 'single' : 'range'
  }

  // URL 字段: 必须是合法 http(s) 或空串
  if (full || body?.bookUrl !== undefined) {
    const u = httpUrl(body?.bookUrl) || ''
    if (body?.bookUrl && !u) return { data: {}, error: '书籍页URL格式非法(需 http/https)' }
    out.bookUrl = u
  }
  if (full || body?.listUrl !== undefined) {
    const u = httpUrl(body?.listUrl) || ''
    if (body?.listUrl && !u) return { data: {}, error: '列表页URL格式非法(需 http/https)' }
    out.listUrl = u
  }

  // 页码/序号范围: 钳制 + 起≥止自动交换
  if (full || body?.listStart !== undefined) out.listStart = clampInt(body?.listStart, 1, 1, 100_000)
  if (full || body?.listEnd !== undefined) out.listEnd = clampInt(body?.listEnd, 1, 1, 100_000)
  if (Number(out.listEnd) < Number(out.listStart)) {
    const s = out.listStart
    out.listStart = out.listEnd
    out.listEnd = s
  }
  if (full || body?.bookStart !== undefined) out.bookStart = clampInt(body?.bookStart, 0, 0, 100_000)
  if (full || body?.bookEnd !== undefined) out.bookEnd = clampInt(body?.bookEnd, 0, 0, 100_000)
  if (
    Number(out.bookStart) > 0 && Number(out.bookEnd) > 0 &&
    Number(out.bookEnd) < Number(out.bookStart)
  ) {
    const s = out.bookStart
    out.bookStart = out.bookEnd
    out.bookEnd = s
  }

  // 枚举
  if (full || body?.recrawlMode !== undefined) {
    out.recrawlMode = body?.recrawlMode === 'full' ? 'full' : 'incremental'
  }
  if (full || body?.storageMode !== undefined) {
    out.storageMode = body?.storageMode === 'txt' ? 'txt' : 'db'
  }

  // 反反爬覆盖配置: 对象→JSON, 大小限制
  if (full || body?.fetchConfig !== undefined) {
    if (isPlainObject(body?.fetchConfig)) {
      const s = JSON.stringify(body.fetchConfig)
      if (s.length > 50_000) return { data: {}, error: '反反爬配置过大' }
      out.fetchConfig = s
    } else if (typeof body?.fetchConfig === 'string') {
      if (body.fetchConfig.length > 50_000) return { data: {}, error: '反反爬配置过大' }
      out.fetchConfig = body.fetchConfig
    } else {
      out.fetchConfig = '{}'
    }
  }

  // 线程/间隔: 钳制 + min≤max
  if (full || body?.threadMin !== undefined) out.threadMin = clampInt(body?.threadMin, 1, 1, 32)
  if (full || body?.threadMax !== undefined) out.threadMax = clampInt(body?.threadMax, 3, 1, 32)
  if (Number(out.threadMax) < Number(out.threadMin)) out.threadMax = out.threadMin
  if (full || body?.intervalMin !== undefined) out.intervalMin = clampInt(body?.intervalMin, 500, 0, 600_000)
  if (full || body?.intervalMax !== undefined) out.intervalMax = clampInt(body?.intervalMax, 2000, 0, 600_000)
  if (Number(out.intervalMax) < Number(out.intervalMin)) out.intervalMax = out.intervalMin

  // 开关
  if (full || body?.smartCategory !== undefined) out.smartCategory = body?.smartCategory !== false
  if (full || body?.smartComplete !== undefined) out.smartComplete = body?.smartComplete !== false
  if (full || body?.autoSuggest !== undefined) out.autoSuggest = body?.autoSuggest !== false

  // 自动刷新(jj-e 实时更新): 完成后按分钟间隔自动重启; 间隔钳 5~1440
  if (full || body?.autoRefresh !== undefined) out.autoRefresh = body?.autoRefresh === true
  if (full || body?.refreshIntervalMin !== undefined) {
    out.refreshIntervalMin = clampInt(body?.refreshIntervalMin, 30, 5, 1440)
  }

  return { data: out }
}

/** 模式与URL联动校验(用合并后的生效值调用) */
export function validateTaskPair(
  mode: string | undefined,
  bookUrl: string | undefined,
  listUrl: string | undefined
): string | undefined {
  if (mode === 'single' && !bookUrl) return '单本模式必须填写书籍页URL'
  if (mode === 'range' && !listUrl) return '范围模式必须填写列表页URL(含{page})'
  return undefined
}
