/**
 * heis-mini-shared — 5 个 Bun 采集代理共用的样板(1-c)
 * ============================================================
 * 背景(worklog Task 4/6 audit + 1-c 收口):
 *   - 4/5 代理(bqg713/qimao/deqixs/xjp)历史未指定 hostname → Bun 默认 0.0.0.0
 *     与 README "全部绑定 127.0.0.1" 声明不符(实锤安全面)
 *   - 5 个代理各自重复 json()/Bun.serve()//health 三件套, 改一处要改 5 处
 *   - 多主机部署 / scrapling-bridge 跨主机时缺少共享密钥闸门
 *
 * 本模块导出:
 *   - json(data, status?)                  JSON 响应助手(替代各代理本地副本)
 *   - safeHeaderKey(k) / safeHeaderValue(v)
 *                                          RFC 7230 token 白名单 + CR/LF/NUL 剥离
 *                                          (从 fetch-relay 移植, 现全代理共用)
 *   - constantTimeEqual(a, b)              字符串常量时间比较(供 BRIDGE_KEY 校验)
 *   - createBridgeServer(opts)            Bun.serve 工厂:
 *       · hostname: '127.0.0.1'(HARD — 修复 H4)
 *       · idleTimeout 默认 120s(可被 opts.idleTimeoutS 覆盖)
 *       · /health 自动挂载, 返回 { ok, service, port, selfTestOk, upstreamProbe?, ts }
 *       · BRIDGE_KEY 环境变量非空时, 非 /health 请求必须带 X-Bridge-Key 头
 *         (常量时间比较, 失败 401) —— 多主机部署时给操作员一个闸门
 *       · 启动 banner 准确(不再误导)
 *
 * 不引入任何第三方依赖: 仅 node:crypto + Bun 内置。
 */
import { timingSafeEqual } from 'node:crypto'

/** JSON 响应助手(charset=utf-8, 与各代理历史本地 json() 行为完全等价) */
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** 请求头键安全名单(RFC 7230 token 简化版) —— 从 fetch-relay 移植, 5 个代理共用 */
export function safeHeaderKey(k: string): string {
  if (!k || k.length > 128) return ''
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(k) ? k : ''
}

/** 请求头值: 剥 CR/LF/NUL, 截 8192 字节(从 fetch-relay 移植) */
export function safeHeaderValue(v: string): string {
  return String(v).replace(/[\r\n\0]+/g, ' ').slice(0, 8192)
}

/**
 * 常量时间字符串比较(供 BRIDGE_KEY 校验用)。
 * 长度不等时仍走完一遍 dummy 比较, 避免长度短路泄密。
 * 注意: 非密码学用途(密钥本身在环境变量内, 不进镜像层); 仅用于阻止暴力枚举。
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    // dummy compare 防长度差形成计时旁路
    timingSafeEqual(ab, ab)
    return false
  }
  return timingSafeEqual(ab, bb)
}

export interface BridgeServerOptions {
  /** 服务名(出现在 /health 与启动 banner) */
  name: string
  /** 端口号 */
  port: number
  /** idleTimeout 秒数(默认 120, 覆盖 Bun 默认 ~10s 杀在途请求的实测痛点) */
  idleTimeoutS?: number
  /** 主路由 fetch handler */
  fetch: (req: Request) => Promise<Response> | Response
  /**
   * 可选自检: 返回业务侧自检结果(boolean), 写入 /health.selfTestOk。
   * 失败仅留档不退出 —— 主路由仍可用(降级链兜底语义)。
   */
  selfTest?: () => boolean | Promise<boolean>
  /**
   * 可选上游探针: 返回业务侧可达性快照(已归一为 Record), 写入 /health.upstreamProbe。
   * 设计: 仅在 /health 路由内被调用, 主路由不依赖; 失败不抛(由调用方吞 catch)。
   */
  healthCheck?: () => Record<string, unknown> | Promise<Record<string, unknown>>
}

/**
 * 创建并启动一个绑定 127.0.0.1 的 Bun.serve 实例。
 * 自动挂载 /health 与 BRIDGE_KEY 共享密钥闸门。
 * 返回 Bun.Server(供高级调用方 stop/ref/unref)。
 */
export function createBridgeServer(opts: BridgeServerOptions) {
  const {
    name,
    port,
    fetch: userFetch,
    selfTest,
    healthCheck,
    idleTimeoutS = 120,
  } = opts

  const bridgeKey = process.env.BRIDGE_KEY || ''

  /** /health 响应组装: 同步跑 selfTest(若提供), 异步跑 healthCheck(若提供) */
  async function healthHandler(): Promise<Response> {
    let selfTestOk: boolean | null = null
    if (selfTest) {
      try {
        selfTestOk = await selfTest()
      } catch {
        selfTestOk = false
      }
    }
    let upstreamProbe: Record<string, unknown> | undefined
    if (healthCheck) {
      try {
        upstreamProbe = await healthCheck()
      } catch (e) {
        upstreamProbe = { ok: false, error: String(e).slice(0, 120) }
      }
    }
    const payload: Record<string, unknown> = {
      ok: true,
      service: name,
      port,
      selfTestOk,
      ts: new Date().toISOString(),
    }
    if (upstreamProbe !== undefined) payload.upstreamProbe = upstreamProbe
    return json(payload)
  }

  /** 401 闸门响应(不带 WWW-Authenticate, 避免浏览器弹密码框干扰 API 调用方) */
  function unauthorized(): Response {
    return json(
      { ok: false, error: 'missing or invalid X-Bridge-Key', code: 'BRIDGE_KEY_REQUIRED' },
      401,
    )
  }

  const server = Bun.serve({
    port,
    // HARD: 始终绑定 127.0.0.1(修复 H4, 不再依赖调用方默认值)
    hostname: '127.0.0.1',
    idleTimeout: idleTimeoutS,
    async fetch(req): Promise<Response> {
      const u = new URL(req.url)
      if (u.pathname === '/health') return healthHandler()

      // BRIDGE_KEY 非空时, 所有非 /health 路由必须带 X-Bridge-Key 头
      if (bridgeKey) {
        const got = req.headers.get('x-bridge-key') || ''
        if (!got || !constantTimeEqual(got, bridgeKey)) return unauthorized()
      }

      return userFetch(req)
    },
  })

  // 启动 banner —— 准确(不写误导的 0.0.0.0)
  console.log(
    `[${name}] listening on http://127.0.0.1:${port} (/health${bridgeKey ? ' + X-Bridge-Key 闸门' : ''})`,
  )
  return server
}
