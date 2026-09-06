// ============================================================
// 系统健康检查 (admin 鉴权) — Task 5-a observability
//
// GET /api/admin/health
// 返回进程级 + 依赖服务级健康快照:
//   {
//     ok: true,
//     data: {
//       status:   "healthy" | "degraded" | "unhealthy",
//       uptime:   <seconds>,
//       db:       "ok" | "fail",
//       runner:   { activeTasks, runtimes },
//       hostGate: { hosts },
//       services: { bqg713, fetch-relay, scrapling, qimao, deqixs, xjp },
//       memory:   { rss, heapUsed, heapTotal },
//       reqId:    "..."  // 来自 middleware 注入的 x-request-id 头
//     }
//   }
//
// 探针策略:
//   - DB:   db.$queryRaw`SELECT 1` (fail → unhealthy, 不论其余检查)
//   - 运行器: TaskRunner.instance 单例读 runtimes Map (private; 经类型擦除读取)
//   - 闸门: hostGateStats() (Task 2-other-engine 导出)
//   - 服务: 5 个 Bun 代理 + 1 个 Python 桥, 各 /health fetch (1s 超时)
//     · required 服务不通 → degraded
//     · scrapling(可选) 不通 → degraded, note="optional"
//   - 内存: process.memoryUsage()
//
// 缓存: 10s (避免仪表盘轮询打爆), 进程级 globalThis 单例缓存
// ============================================================
import { db } from '@/lib/db'
import { ok } from '@/lib/api'
import { logger } from '@/lib/logger'
import { withGuard } from '../../_lib/http'
import { TaskRunner } from '@/lib/crawl/runner'
import { hostGateStats } from '@/lib/crawl/hostgate'

// 缓存窗口: 仪表盘每 5~10s 轮询一次时, 避免每次都打 6 个 mini-service + DB ping
const HEALTH_CACHE_MS = 10_000
// 单服务探针超时: 远小于 10s 缓存窗口, 避免单个慢服务拖慢整次健康检查
const SERVICE_PROBE_TIMEOUT_MS = 1_000

// mini-services 端口表 (与 mini-services/*/index.ts 一致)
//  - bqg713-proxy:    3010 (required)
//  - fetch-relay:      3011 (required — 引擎降级链兜底)
//  - scrapling-bridge:3012 (optional — 仅 pili 主题需要, 部署常省略)
//  - qimao-proxy:     3013 (required)
//  - deqixs-proxy:     3014 (required)
//  - xjp-proxy:       3015 (required)
interface ServiceSpec { port: number; optional?: boolean }
const SERVICES: Record<string, ServiceSpec> = {
  bqg713: { port: 3010 },
  'fetch-relay': { port: 3011 },
  scrapling: { port: 3012, optional: true },
  qimao: { port: 3013 },
  deqixs: { port: 3014 },
  xjp: { port: 3015 },
}

interface ServiceHealth {
  reachable: boolean
  selfTestOk?: boolean
  note?: string
}

// 进程级缓存 (HMR 安全: 同一 globalThis 复用, dev 重载不丢)
interface CachedHealth {
  ts: number
  payload: Record<string, unknown>
}
const G = globalThis as unknown as { __heisHealthCache?: CachedHealth }

/** 探针单个 mini-service /health, 1s 超时; 失败一律返回 { reachable: false } 不抛 */
async function probeService(port: number): Promise<ServiceHealth> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), SERVICE_PROBE_TIMEOUT_MS)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      })
      if (!res.ok) return { reachable: false }
      const body = (await res.json().catch(() => ({}))) as { selfTestOk?: unknown }
      const st = body.selfTestOk
      return {
        reachable: true,
        selfTestOk: typeof st === 'boolean' ? st : undefined,
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return { reachable: false }
  }
}

/**
 * 读取 TaskRunner 运行时快照 — runtimes Map 是 private, 但 Task 5-a 允许经
 * 类型擦除读取 (不能改 runner.ts)。返回 { activeTasks, runtimes }:
 *   - activeTasks = running===true 的 runtime 数 (含 paused 的也算 active, 因占着 epoch)
 *   - runtimes    = Map.size (含已终态但未 LRU 驱逐的)
 */
function getRunnerSnapshot(): { activeTasks: number; runtimes: number } {
  try {
    // 类型擦除访问 private runtimes (private 仅 TS 编译期, 运行时无影响)
    type RuntimeLike = { running?: boolean; paused?: boolean }
    const inst = TaskRunner.instance as unknown as {
      runtimes?: Map<string, RuntimeLike>
    }
    const runtimes = inst.runtimes
    if (!runtimes) return { activeTasks: 0, runtimes: 0 }
    let activeTasks = 0
    for (const rt of runtimes.values()) {
      if (rt.running) activeTasks++
    }
    return { activeTasks, runtimes: runtimes.size }
  } catch {
    return { activeTasks: 0, runtimes: 0 }
  }
}

/** 全量收集 (无缓存版) */
async function collectHealth(): Promise<Record<string, unknown>> {
  // ---- DB ----
  let dbStatus: 'ok' | 'fail' = 'fail'
  try {
    await db.$queryRaw`SELECT 1`
    dbStatus = 'ok'
  } catch (e) {
    logger.error('health db check failed', { err: (e as Error)?.message })
  }

  // ---- Runner ----
  const runner = getRunnerSnapshot()

  // ---- HostGate ----
  let hostGate: { hosts: number } = { hosts: 0 }
  try {
    const hg = hostGateStats()
    hostGate = { hosts: hg.hosts }
  } catch { /* hostgate 未初始化等, 默认 0 hosts */ }

  // ---- Services (并发探针) ----
  const services: Record<string, ServiceHealth> = {}
  const entries = await Promise.all(
    Object.entries(SERVICES).map(async ([key, spec]) => {
      const probe = await probeService(spec.port)
      if (spec.optional && !probe.reachable) {
        return [key, { ...probe, note: 'optional' }] as const
      }
      return [key, probe] as const
    }),
  )
  for (const [k, v] of entries) services[k] = v

  // ---- Memory ----
  const mem = process.memoryUsage()

  // ---- Status 综合判定 ----
  //   unhealthy: DB fail (核心依赖不可用, 不能服务)
  //   degraded:  任意 required mini-service 不可达 (降级链受损但主流程可继续)
  //              或 optional 服务 (scrapling) 不可达 (可选能力缺失)
  //   healthy:   DB ok + 所有 required 服务可达 (optional 不通仍可 healthy, 但保留 degraded 提示)
  let status: 'healthy' | 'degraded' | 'unhealthy'
  if (dbStatus !== 'ok') {
    status = 'unhealthy'
  } else {
    const requiredDown = Object.entries(SERVICES)
      .filter(([, spec]) => !spec.optional)
      .some(([key]) => !services[key]?.reachable)
    const optionalDown = Object.entries(SERVICES)
      .filter(([, spec]) => spec.optional)
      .some(([key]) => !services[key]?.reachable)
    status = requiredDown || optionalDown ? 'degraded' : 'healthy'
  }

  return {
    status,
    uptime: Math.floor(process.uptime()),
    db: dbStatus,
    runner,
    hostGate,
    services,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
    },
  }
}

export async function GET(req: Request) {
  return withGuard(async () => {
    // 5-a: 从 middleware 注入的 x-request-id 头取 reqId, 注入响应 data 便于客户端关联
    const reqId = (req.headers.get('x-request-id') || '').trim().slice(0, 64)
    const log = reqId ? logger.withReqId(reqId) : logger

    // 10s 缓存 (避免仪表盘轮询时连打 6 个 mini-service + DB ping)
    const now = Date.now()
    const cached = G.__heisHealthCache
    if (cached && now - cached.ts < HEALTH_CACHE_MS) {
      log.debug('health cache hit', { age_ms: now - cached.ts, status: cached.payload.status })
      return ok({ ...cached.payload, reqId })
    }

    const payload = await collectHealth()
    G.__heisHealthCache = { ts: now, payload }
    log.info('health collected', { status: payload.status })

    // 把 reqId 合并进响应 data (spec 要求 data 中含 reqId 字段)
    return ok({ ...payload, reqId })
  })
}
