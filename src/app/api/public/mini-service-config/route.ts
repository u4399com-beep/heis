// 公开 mini-service 配置端点 — 供 mini-services 启动/运行时拉取主应用管理的配置
// (如 xjp-proxy 需要的 Ywkey/Ywguid 登录凭证, qimao-proxy 的 token 等)
//
// 鉴权: BRIDGE_KEY 环境变量(与 mini-services _shared/server.ts 同口径);
//       留空时 dev 模式不校验(单机部署默认), 生产必填。
//
// 配置形态: Setting 表 key='miniServiceConfig', value=JSON对象 {
//   xjp: { ywkey, ywguid },        // 小雨/新键盘源登录凭证
//   qimao: { token },              // 七猫 API token(如需)
//   deqixs: { signKey },           // 得奇签名密钥(如需)
//   bqg713: { ... },               // 笔趣阁713 配置
//   fetchRelay: { ... },           // fetch-relay 配置
// }
//
// 缓存: 60s in-memory(配置变更后最多 60s 生效), 避免每次 mini-service 请求都打 DB
import { timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'
import { ok, fail } from '@/lib/api'
import { withGuard } from '../../_lib/http'

export const dynamic = 'force-dynamic'

// 进程级缓存(60s TTL, HMR 安全)
const CACHE_TTL_MS = 60_000
let cachedAt = 0
let cachedConfig: Record<string, unknown> | null = null

function getCached(): Record<string, unknown> | null {
  if (cachedConfig !== null && Date.now() - cachedAt < CACHE_TTL_MS) return cachedConfig
  return null
}

function setCached(cfg: Record<string, unknown>) {
  cachedConfig = cfg
  cachedAt = Date.now()
}

/** R7-18: 供 admin settings 保存后显式失效缓存(miniServiceConfig 变更时立即生效) */
export function invalidateMiniServiceConfigCache() {
  cachedConfig = null
  cachedAt = 0
}

/**
 * 常量时间字符串比较(供 BRIDGE_KEY 校验用, 防 timing side-channel)。
 * 长度不等时仍走完一遍 dummy 比较防长度短路泄密 —— 与 mini-services
 * _shared/server.ts constantTimeEqual 同口径。
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab) // dummy compare 防长度差形成计时旁路
    return false
  }
  return timingSafeEqual(ab, bb)
}

/** 校验 BRIDGE_KEY: 与 mini-services _shared/server.ts 同口径, 留空=dev 模式不校验 */
function checkBridgeKey(req: Request): boolean {
  const expected = process.env.BRIDGE_KEY || ''
  if (!expected) return true // dev 模式不校验
  // 支持 3 种头形式: X-Bridge-Key / X-Auth-Token / Authorization: Bearer
  const fromHeader = req.headers.get('x-bridge-key') || req.headers.get('x-auth-token') || ''
  const fromAuth = req.headers.get('authorization') || ''
  const bearer = fromAuth.toLowerCase().startsWith('bearer ') ? fromAuth.slice(7).trim() : ''
  const provided = fromHeader || bearer
  if (!provided) return false
  return constantTimeEqual(provided, expected)
}

export async function GET(req: Request) {
  return withGuard(async () => {
    if (!checkBridgeKey(req)) return fail('未授权(BRIDGE_KEY 不匹配)', 401)
    // 缓存命中
    const cached = getCached()
    if (cached) return ok(cached)
    // 从 DB 读取
    const row = await db.setting.findUnique({ where: { key: 'miniServiceConfig' } })
    let cfg: Record<string, unknown> = {}
    if (row?.value) {
      try { cfg = JSON.parse(row.value) } catch { cfg = {} }
    }
    setCached(cfg)
    return ok(cfg)
  })
}
