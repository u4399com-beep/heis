// ============================================================
// 批量操作 API 通用入参解析 (仅供 admin/*/batch 路由使用)
// 职责: 动作白名单 / ids 去重消毒(≤64字符) / 上限500 / payload 对象化
// ============================================================
import { isPlainObject } from './http'

/** 单次批量操作 id 上限 */
export const BATCH_MAX_IDS = 500
/** 单个 id 最大长度(全库主键均为 cuid, 64 字符已远超需要) */
export const BATCH_ID_MAX_LEN = 64

export interface BatchParseOk {
  ok: true
  action: string
  /** 去重消毒后的 id 列表(保留首次出现顺序 — 分类按勾选顺序重排依赖此顺序) */
  ids: string[]
  /** 恒为纯对象: 非对象 payload 一律降级为 {}, 调用方再按动作自行校验字段 */
  payload: Record<string, unknown>
}

export interface BatchParseFail {
  ok: false
  message: string
}

export type BatchParseResult = BatchParseOk | BatchParseFail

/**
 * 批量操作入参解析:
 * - body 必须是纯对象
 * - action 必须在白名单内(防任意动词注入)
 * - ids 必须为数组: 逐项 String 化 + trim + 截断 64 字符 + 剔除空串, Set 去重且保留出现顺序
 * - 数量超过 500 直接拒绝(防超长同步请求拖垮事件循环)
 * - payload 仅接受纯对象(数组/null/标量一律丢弃), 字段级校验由各动作自行完成
 */
export function parseBatchBody(body: unknown, actions: readonly string[]): BatchParseResult {
  if (!isPlainObject(body)) return { ok: false, message: '批量操作入参格式错误' }

  const action = typeof body.action === 'string' ? body.action.trim() : ''
  if (!actions.includes(action)) return { ok: false, message: '无效的批量操作' }

  if (!Array.isArray(body.ids)) return { ok: false, message: '缺少待操作的 ids 列表' }

  const ids: string[] = []
  const seen = new Set<string>()
  for (const raw of body.ids) {
    if (raw === null || raw === undefined) continue
    const id = String(raw).trim().slice(0, BATCH_ID_MAX_LEN)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length > BATCH_MAX_IDS) {
      return { ok: false, message: `单次批量操作最多 ${BATCH_MAX_IDS} 项, 请分批进行` }
    }
  }
  if (ids.length === 0) return { ok: false, message: '未选择任何项目' }

  return { ok: true, action, ids, payload: isPlainObject(body.payload) ? body.payload : {} }
}

/** 从 payload 安全取字符串字段: 非字符串 → null(由调用方决定默认值或报错) */
export function payloadString(payload: Record<string, unknown>, key: string, maxLen = 200): string | null {
  const v = payload[key]
  if (v === null || v === undefined) return null
  return typeof v === 'string' ? v.trim().slice(0, maxLen) : String(v).trim().slice(0, maxLen)
}

/** 批量跳过项结构: name 可选(记录缺失时无名字可带) */
export interface BatchSkippedItem {
  name?: string
  reason: string
}

/** 快捷构造 skipped 项(错误消息截断防信封爆炸) */
export function skipItem(reason: string, name?: string): BatchSkippedItem {
  return name ? { name, reason } : { reason }
}
