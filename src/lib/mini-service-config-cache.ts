// mini-service-config 进程级缓存逻辑 — 从 route.ts 抽出
// 避免 Next.js route 文件导出非标准函数 (invalidateMiniServiceConfigCache) 导致 OmitWithTag 类型检查失败
// (R26: tsc error "Property 'invalidateMiniServiceConfigCache' is incompatible with index signature" 修复)

const CACHE_TTL_MS = 60_000
let cachedAt = 0
let cachedConfig: Record<string, unknown> | null = null

export function getCached(): Record<string, unknown> | null {
  if (cachedConfig !== null && Date.now() - cachedAt < CACHE_TTL_MS) return cachedConfig
  return null
}

export function setCached(cfg: Record<string, unknown>) {
  cachedConfig = cfg
  cachedAt = Date.now()
}

/** R7-18: 供 admin settings 保存后显式失效缓存(miniServiceConfig 变更时立即生效) */
export function invalidateMiniServiceConfigCache() {
  cachedConfig = null
  cachedAt = 0
}
