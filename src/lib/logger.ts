// ============================================================
// 结构化日志 (零依赖) — Task 5-a observability
// 职责:
//   1) 分级日志: debug(10) / info(20) / warn(30) / error(40)
//   2) JSON 行格式输出 stdout:
//        {"ts":"2025-01-01T00:00:00.000Z","level":"info","msg":"...",
//         "ctx":{...},"reqId":"..."}
//   3) 上下文 ctx 敏感字段递归脱敏 (depth≤3):
//        password / secret / token / cookie / authorization / api[-_]?key
//   4) withReqId(reqId) → 子 logger 绑定 reqId (中间件按请求打 tag)
//   5) child(bindings) → 子 logger 注入额外上下文 (如 {module:'fetcher'})
//   6) globalThis.__heisLogger 单例 (Next.js dev HMR 安全, 模块热重载不重建)
//
// 通过 LOG_LEVEL 环境变量控制输出层级
// (默认 dev=debug, prod=info; setLogLevel 可运行时调整)
// ============================================================

export enum LogLevel {
  debug = 10,
  info = 20,
  warn = 30,
  error = 40,
}

const LEVEL_NAME: Record<number, string> = {
  10: 'debug',
  20: 'info',
  30: 'warn',
  40: 'error',
}

// 敏感字段名匹配 (大小写不敏感):
//   password / secret / token / cookie / authorization / api-key / api_key / apikey
const SENSITIVE_RE = /password|secret|token|cookie|authorization|api[-_]?key/i

// 递归脱敏最大深度 (防止循环引用 + 防止巨型对象打满日志)
const MAX_DEPTH = 3
// 单字符串最长截断 (避免大正文/HTML 误塞进日志行撑爆 stdout)
const MAX_STRING_LEN = 4096
// 数组元素最多保留前 N 个 (后续丢弃)
const MAX_ARRAY_ELEMS = 100

/**
 * 递归脱敏: 任何 key 匹配 SENSITIVE_RE 的 value 替换为 "[REDACTED]"。
 * 嵌套对象递归处理, depth > MAX_DEPTH 时返回 "[depth-exceeded]" (仅对 object/array;
 * 标量无递归风险仍透传 — 既是可读性考虑也避免丢非敏感诊断字段)。
 * 循环引用安全 (WeakSet 标记); Error 折叠为 {name, message, stack}。
 */
function redact(value: unknown, depth: number, seen?: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value
  const t = typeof value
  if (t === 'string') {
    const s = value as string
    return s.length > MAX_STRING_LEN
      ? s.slice(0, MAX_STRING_LEN) + '…[truncated]'
      : s
  }
  if (t === 'number' || t === 'boolean') return value
  if (t === 'bigint') return String(value) + 'n'
  if (t === 'symbol') return (value as symbol).toString()
  if (t === 'function') return '[function]'
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? value.stack.slice(0, 500) : undefined,
    }
  }
  // object / array — 深度上限 + 循环引用保护
  if (depth > MAX_DEPTH) return '[depth-exceeded]'
  if (!seen) seen = new WeakSet()
  const obj = value as object
  if (seen.has(obj)) return '[circular]'
  seen.add(obj)
  try {
    if (Array.isArray(value)) {
      return (value as unknown[]).slice(0, MAX_ARRAY_ELEMS).map((v) => redact(v, depth + 1, seen))
    }
    const dict = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(dict)) {
      if (SENSITIVE_RE.test(k)) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = redact(v, depth + 1, seen)
      }
    }
    return out
  } finally {
    seen.delete(obj)
  }
}

/** 安全 JSON 序列化 (循环引用 → 占位符) */
function safeJsonStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj)
  } catch {
    // 循环引用 / BigInt 等不可序列化场景: 兜底返回基本字段
    try {
      const fallback: Record<string, unknown> = {
        ts: (obj as { ts?: unknown })?.ts,
        level: (obj as { level?: unknown })?.level,
        msg: (obj as { msg?: unknown })?.msg,
        ctx: '[unserializable]',
      }
      return JSON.stringify(fallback)
    } catch {
      return '{"ts":"' + new Date().toISOString() + '","level":"error","msg":"log-serialize-failed"}'
    }
  }
}

/** 根据 LOG_LEVEL / NODE_ENV 环境变量解析默认日志级别 */
function resolveDefaultLevel(): LogLevel {
  const env = (process.env.LOG_LEVEL || '').trim().toLowerCase()
  if (env === 'debug') return LogLevel.debug
  if (env === 'info') return LogLevel.info
  if (env === 'warn') return LogLevel.warn
  if (env === 'error') return LogLevel.error
  // 默认: dev=debug, prod=info
  return process.env.NODE_ENV === 'production' ? LogLevel.info : LogLevel.debug
}

export class Logger {
  private level: LogLevel
  private bindings: Record<string, unknown>

  constructor(level: LogLevel, bindings: Record<string, unknown> = {}) {
    this.level = level
    this.bindings = bindings
  }

  /** 调整日志级别 (运行时; 也可通过 LOG_LEVEL 环境变量初始化) */
  setLevel(level: LogLevel): void {
    this.level = level
  }

  getLevel(): LogLevel {
    return this.level
  }

  /** 创建子 logger: 注入额外上下文字段 (合并父 bindings) */
  child(bindings: Record<string, unknown>): Logger {
    return new Logger(this.level, { ...this.bindings, ...bindings })
  }

  /** 创建绑定 reqId 的子 logger (供中间件按请求打 tag) */
  withReqId(reqId: string): Logger {
    return this.child({ reqId })
  }

  private emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (level < this.level) return
    const line: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: LEVEL_NAME[level] || 'info',
      msg: typeof msg === 'string' ? msg : String(msg),
    }
    if (ctx !== undefined) {
      line.ctx = redact(ctx, 0)
    }
    // 合并 bindings (reqId / module / ...) —— 与 ctx 同级, 便于检索
    for (const [k, v] of Object.entries(this.bindings)) {
      // bindings 也要脱敏 (避免操作员 child({apiToken:...}) 误注入)
      if (!(k in line)) line[k] = redact(v, 0)
    }
    process.stdout.write(safeJsonStringify(line) + '\n')
  }

  debug(msg: string, ctx?: Record<string, unknown>): void {
    this.emit(LogLevel.debug, msg, ctx)
  }
  info(msg: string, ctx?: Record<string, unknown>): void {
    this.emit(LogLevel.info, msg, ctx)
  }
  warn(msg: string, ctx?: Record<string, unknown>): void {
    this.emit(LogLevel.warn, msg, ctx)
  }
  error(msg: string, ctx?: Record<string, unknown>): void {
    this.emit(LogLevel.error, msg, ctx)
  }
}

// ---- globalThis 单例 (HMR 安全) ----
// dev 模式下模块热重载会重新执行模块体, 直接 const logger = new Logger() 会
// 在每次重载时创建新实例并重置 level 为环境默认值。
// 通过 globalThis.__heisLogger 缓存: 模块重载时返回既有实例, level/bindings 保持。
interface GlobalWithLogger {
  __heisLogger?: Logger
}
const G = globalThis as unknown as GlobalWithLogger

if (!G.__heisLogger) {
  G.__heisLogger = new Logger(resolveDefaultLevel())
}

/** 根 logger (进程级单例, HMR 安全) */
export const logger: Logger = G.__heisLogger

/** 创建绑定 reqId 的子 logger (供中间件按请求打 tag) */
export function withReqId(reqId: string): Logger {
  return logger.withReqId(reqId)
}

/** 创建携带额外上下文的子 logger (如 logger.child({ module: 'fetcher' })) */
export function child(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings)
}
