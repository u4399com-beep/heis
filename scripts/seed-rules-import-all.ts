// ============================================================
// 批量导入所有种子规则脚本到后台 (feat-rules-import-all)
// 用法: bun run scripts/seed-rules-import-all.ts
//
// 设计:
//  - 登录 POST /api/auth/login 拿 heis_admin cookie
//  - 22 单站 seed-rule-*.ts + seed-rules-v2.ts (5 条) = 27 条规则
//  - 不跑 4 段实测(慢 + 多站 CF/403); 只 upsert 入库
//  - 幂等: 同名规则先删后建
//  - 4 类源脚本模式分别处理:
//    A) const rule: RuleSeed = {...} + 无守卫 main()  → 抽 const rule 块, 写 temp, import, POST
//    B) export const ruleConfig + RULE_NAME + import.meta.main 守卫 → 直接 import 拿导出 + 抽 description
//    C) export const rule + import.meta.main 守卫 (wanben) → 直接 import 拿 rule
//    D) const config + const RULE_NAME + 顶层 await (80ge) → 抽 config/RULE_NAME/UA 块, 写 temp, import, POST
//    E) const rules: RuleSeed[] + baseClean spread (seed-rules-v2) → 抽 baseClean/UA/rules 块, 写 temp, import, POST 数组
//  - temp 文件路径: scripts/.import-tmp/<name>.import-tmp.ts (运行后清理)
//  - 描述提取: 对 B/D 模式从源 main() body 内 fetch description 字段 regex 抽 + new Function 求值
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE || 'http://localhost:3000'
const PASSWORD = process.env.ADMIN_PASSWORD || 'audit-fix-2025'
const TMP_DIR = path.resolve('scripts/.import-tmp')

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

// ============ 1. 登录 ============
async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  if (res.status === 429) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(`登录被限流: ${j.error || '请稍后再试'}`)
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(`登录失败: HTTP ${res.status} ${j.error || ''}`)
  }
  const setCookie = res.headers.get('set-cookie') || ''
  const m = /heis_admin=([^;]+)/.exec(setCookie)
  if (!m) throw new Error('登录响应缺少 heis_admin cookie')
  return `heis_admin=${m[1]}`
}

// ============ 2. API helpers ============
// 注: /api/admin/* 路由在 src/proxy.ts 内有 60 req/min 令牌桶限流(每 IP)。
// 本脚本对 23 个脚本可能产生 ~70 次 API 调用, 必须节流:
//  - 每次调用前 sleep DELAY_MS(默认 250ms) 给桶补 0.25 token
//  - 收到 429 时退避重试(读 Retry-After 头, 上限 60s), 最多 MAX_RETRIES 次
const DELAY_MS = 250
const MAX_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 带节流 + 429 退避重试的 fetch 包装(仅用于 /api/admin/* 调用) */
async function adminFetch(
  cookie: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await sleep(DELAY_MS)
    const headers = new Headers(init.headers)
    headers.set('cookie', cookie)
    const res = await fetch(url, { ...init, headers })
    if (res.status !== 429) return res
    if (attempt === MAX_RETRIES) return res
    const retryAfterRaw = res.headers.get('retry-after') || '60'
    const retryAfter = Math.min(parseInt(retryAfterRaw, 10) || 60, 65)
    console.log(
      `  ⏳ 429 rate-limited, 退避 ${retryAfter}s 后重试 (attempt ${attempt + 1}/${MAX_RETRIES})`,
    )
    await sleep(retryAfter * 1000)
  }
  // unreachable
  return fetch(url, init)
}

async function listRules(cookie: string): Promise<Array<{ id: string; name: string }>> {
  const res = await adminFetch(cookie, `${BASE}/api/admin/rules?take=500`)
  const j = (await res.json()) as { ok: boolean; data?: unknown }
  const data = j.data
  if (Array.isArray(data)) return data as { id: string; name: string }[]
  const obj = data as { rules?: { id: string; name: string }[] } | null | undefined
  return obj?.rules || []
}

async function upsert(cookie: string, rule: RuleSeed): Promise<{ ok: boolean; msg: string }> {
  const existing = await listRules(cookie)
  const dups = existing.filter((r) => r.name === rule.name)
  for (const d of dups) {
    await adminFetch(cookie, `${BASE}/api/admin/rules/${d.id}`, { method: 'DELETE' })
  }
  const res = await adminFetch(cookie, `${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  })
  const j = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  if (!j.ok) return { ok: false, msg: j.message || `HTTP ${res.status}` }
  return { ok: true, msg: `id=${j.data?.id || '?'}` }
}

// ============ 3. 源码抽取(花括号匹配 + 字符串/注释感知) ============
function skipWhitespace(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i])) i++
  return i
}

/** 从指定位置抽取一个完整表达式(对象/数组/字符串字面量), 含尾部分号 */
function extractExpressionAt(src: string, startIdx: number): string | null {
  const i = skipWhitespace(src, startIdx)
  if (i >= src.length) return null
  const c = src[i]

  if (c === '{' || c === '[') {
    const open = c
    const close = c === '{' ? '}' : ']'
    let depth = 0
    let inString: string | null = null
    let escaped = false
    let inLineComment = false
    let inBlockComment = false
    const start = i
    for (let j = i; j < src.length; j++) {
      const ch = src[j]
      const nx = src[j + 1]
      if (inLineComment) {
        if (ch === '\n') inLineComment = false
        continue
      }
      if (inBlockComment) {
        if (ch === '*' && nx === '/') {
          inBlockComment = false
          j++
        }
        continue
      }
      if (inString) {
        if (escaped) {
          escaped = false
          continue
        }
        if (ch === '\\') {
          escaped = true
          continue
        }
        if (ch === inString) {
          inString = null
          continue
        }
        // 模板字符串内 ${...} — 需跳过其中可能出现的引号/反引号
        if (inString === '`' && ch === '$' && nx === '{') {
          let braceDepth = 1
          j += 2
          while (j < src.length && braceDepth > 0) {
            if (src[j] === '{') braceDepth++
            else if (src[j] === '}') braceDepth--
            if (braceDepth > 0) j++
          }
          continue
        }
        continue
      }
      if (ch === '/' && nx === '/') {
        inLineComment = true
        j++
        continue
      }
      if (ch === '/' && nx === '*') {
        inBlockComment = true
        j++
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch
        continue
      }
      if (ch === open) depth++
      if (ch === close) {
        depth--
        if (depth === 0) {
          let end = j + 1
          while (end < src.length && /[ \t]/.test(src[end])) end++
          if (src[end] === ';') end++
          return src.slice(start, end)
        }
      }
    }
    return null
  }

  if (c === '"' || c === "'" || c === '`') {
    let escaped = false
    let j = i + 1
    while (j < src.length) {
      const ch = src[j]
      if (escaped) {
        escaped = false
        j++
        continue
      }
      if (ch === '\\') {
        escaped = true
        j++
        continue
      }
      if (c === '`' && ch === '$' && src[j + 1] === '{') {
        let braceDepth = 1
        j += 2
        while (j < src.length && braceDepth > 0) {
          if (src[j] === '{') braceDepth++
          else if (src[j] === '}') braceDepth--
          if (braceDepth > 0) j++
        }
        continue
      }
      if (ch === c) {
        let end = j + 1
        while (end < src.length && /[ \t]/.test(src[end])) end++
        if (src[end] === ';') end++
        return src.slice(i, end)
      }
      j++
    }
    return null
  }

  return null
}

/**
 * 抽取源文件中所有「顶层」(零缩进, 列 0) const 声明, 仅取值为字面量(字符串/对象/数组)
 * 的; 跳过 await 表达式、函数调用等(由 extractExpressionAt 返回 null 自然过滤)。
 * 用于 temp 文件模式: 把所有支撑性 const(UA/MOBILE_UA/DESKTOP_UA/baseClean 等)一并带入
 * temp, 防止 rule config 引用未定义符号。
 */
function extractAllTopLevelConsts(src: string): string[] {
  const re = /^(?:export\s+)?const\s+(\w+)\b(?:\s*:[^=\n]+)?\s*=\s*/gm
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const expr = extractExpressionAt(src, m.index + m[0].length)
    if (expr) {
      out.push(src.slice(m.index, m.index + m[0].length) + expr)
    }
  }
  return out
}

/** 把 export const 形式剥成 const 形式(避免与 temp 末尾的 export 声明冲突) */
function stripExportPrefix(decl: string): string {
  return decl.replace(/^export\s+/, '')
}

/** 从源 main() body 内 fetch description 字段抽取并求值字符串拼接表达式 */
function extractDescription(src: string): string | null {
  // 匹配: description: <expr>, (enabled|config): ...
  const m = src.match(/description:\s*([\s\S]*?),\s*(?:enabled|config)\s*[:,]/)
  if (!m) return null
  const expr = m[1].trim()
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(`return (${expr});`)
    const val = fn()
    return typeof val === 'string' ? val : null
  } catch {
    return null
  }
}

// ============ 4. 脚本清单与处理 ============
type ScriptKind = 'rule' | 'rules' | 'ruleConfig-exported' | 'rule-exported' | 'config+RULE_NAME'

interface ScriptSpec {
  file: string
  kind: ScriptKind
}

const SPECS: ScriptSpec[] = [
  // 模式 A: const rule: RuleSeed = {...}, 无守卫 main() 自动跑(15 条)
  { file: 'seed-rule-biqugetw.ts', kind: 'rule' },
  { file: 'seed-rule-bqg713.ts', kind: 'rule' },
  { file: 'seed-rule-kanunu8.ts', kind: 'rule' },
  { file: 'seed-rule-aijjxs.ts', kind: 'rule' },
  { file: 'seed-rule-shudugu.ts', kind: 'rule' },
  { file: 'seed-rule-yybsw.ts', kind: 'rule' },
  { file: 'seed-rule-hodei.ts', kind: 'rule' },
  { file: 'seed-rule-daweixs.ts', kind: 'rule' },
  { file: 'seed-rule-zxcs.ts', kind: 'rule' },
  { file: 'seed-rule-iidcr.ts', kind: 'rule' },
  { file: 'seed-rule-dafengdagengren.ts', kind: 'rule' },
  { file: 'seed-rule-wuxiaworld.ts', kind: 'rule' },
  { file: 'seed-rule-piaotia.ts', kind: 'rule' },
  { file: 'seed-rule-jpxs123.ts', kind: 'rule' },
  { file: 'seed-rule-book4.ts', kind: 'rule' },
  // 模式 D: 80ge.ts 顶层 await + const config + RULE_NAME + UA
  { file: 'seed-rule-80ge.ts', kind: 'config+RULE_NAME' },
  // 模式 E: seed-rules-v2.ts const baseClean + UA + const rules[] (5 条)
  { file: 'seed-rules-v2.ts', kind: 'rules' },
  // 模式 B: 守卫脚本 export const ruleConfig + RULE_NAME (5 条)
  { file: 'seed-rule-deqixs.ts', kind: 'ruleConfig-exported' },
  { file: 'seed-rule-xjp.ts', kind: 'ruleConfig-exported' },
  { file: 'seed-rule-qimao.ts', kind: 'ruleConfig-exported' },
  { file: 'seed-rule-fanqie.ts', kind: 'ruleConfig-exported' },
  { file: 'seed-rule-ratelimit-demo.ts', kind: 'ruleConfig-exported' },
  // 模式 C: 守卫脚本 export const rule (1 条, wanben) — 直接 import 拿导出
  { file: 'seed-rule-wanben.ts', kind: 'rule-exported' },
]

interface ProcessResult {
  ok: boolean
  msg: string
  ruleNames: string[]
}

async function processSpec(cookie: string, spec: ScriptSpec): Promise<ProcessResult> {
  const fullPath = path.resolve('scripts', spec.file)
  if (!existsSync(fullPath)) {
    return { ok: false, msg: `源文件不存在: ${fullPath}`, ruleNames: [] }
  }
  const src = readFileSync(fullPath, 'utf8')

  if (spec.kind === 'ruleConfig-exported' || spec.kind === 'rule-exported') {
    // 直接 import — main 被 import.meta.main 守卫不会跑
    try {
      const mod: { ruleConfig?: unknown; rule?: RuleSeed; RULE_NAME?: string } = await import(
        `${fullPath}?t=${Date.now()}`
      )
      // 情况 C: 已 export const rule: RuleSeed = { name, description, enabled, config }
      if (mod.rule && mod.rule.name) {
        const r = await upsert(cookie, mod.rule)
        return { ok: r.ok, msg: r.msg, ruleNames: [mod.rule.name] }
      }
      // 情况 B: export const ruleConfig + export const RULE_NAME, description 从源 main() 抽
      const ruleConfig = mod.ruleConfig
      const RULE_NAME = mod.RULE_NAME
      if (!ruleConfig || !RULE_NAME) {
        return {
          ok: false,
          msg: `缺 export: ruleConfig=${!!ruleConfig} RULE_NAME=${!!RULE_NAME} rule=${!!mod.rule}`,
          ruleNames: [],
        }
      }
      const desc =
        extractDescription(src) || '(import-all wrapper: 描述提取失败, 见源 main() body)'
      const r = await upsert(cookie, {
        name: RULE_NAME,
        description: desc,
        enabled: true,
        config: ruleConfig,
      })
      return { ok: r.ok, msg: r.msg, ruleNames: [RULE_NAME] }
    } catch (e) {
      return { ok: false, msg: (e as Error).message, ruleNames: [] }
    }
  }

  // 生成 temp 文件: 抽取所有顶层 const 声明(字面量值), 剥 export 前缀, 末尾追加 export
  const allConsts = extractAllTopLevelConsts(src).map(stripExportPrefix)
  if (allConsts.length === 0) {
    return { ok: false, msg: '未找到任何顶层 const 声明', ruleNames: [] }
  }
  let tempContent = ''
  let postFn: (mod: Record<string, unknown>) => Promise<ProcessResult>

  if (spec.kind === 'rule') {
    const hasRule = allConsts.some((c) => /^const\s+rule\b/.test(c))
    if (!hasRule) return { ok: false, msg: '未找到 const rule 定义', ruleNames: [] }
    tempContent = allConsts.join('\n\n') + '\n\nexport { rule };\n'
    postFn = async (mod) => {
      const rule = mod.rule as RuleSeed | undefined
      if (!rule || !rule.name) {
        return { ok: false, msg: 'temp 模块缺 rule export 或 rule.name', ruleNames: [] }
      }
      const r = await upsert(cookie, rule)
      return { ok: r.ok, msg: r.msg, ruleNames: [rule.name] }
    }
  } else if (spec.kind === 'rules') {
    const hasRules = allConsts.some((c) => /^const\s+rules\b/.test(c))
    if (!hasRules) return { ok: false, msg: '未找到 const rules 定义', ruleNames: [] }
    tempContent = allConsts.join('\n\n') + '\n\nexport { rules };\n'
    postFn = async (mod) => {
      const rules = mod.rules as RuleSeed[] | undefined
      if (!Array.isArray(rules)) {
        return { ok: false, msg: 'temp 模块缺 rules 数组 export', ruleNames: [] }
      }
      const sub: { ok: boolean; msg: string }[] = []
      const names: string[] = []
      for (const r of rules) {
        const rr = await upsert(cookie, r)
        sub.push(rr)
        names.push(r.name)
      }
      const okCount = sub.filter((r) => r.ok).length
      return {
        ok: okCount === rules.length,
        msg: `${okCount}/${rules.length} ok`,
        ruleNames: names,
      }
    }
  } else if (spec.kind === 'config+RULE_NAME') {
    const hasConfig = allConsts.some((c) => /^const\s+config\b/.test(c))
    const hasRuleName = allConsts.some((c) => /^const\s+RULE_NAME\b/.test(c))
    if (!hasConfig || !hasRuleName) {
      return {
        ok: false,
        msg: `未找到 const config/RULE_NAME 定义 (config=${hasConfig} RULE_NAME=${hasRuleName})`,
        ruleNames: [],
      }
    }
    tempContent = allConsts.join('\n\n') + '\n\nexport { config, RULE_NAME };\n'
    const desc = extractDescription(src)
    postFn = async (mod) => {
      const config = mod.config
      const RULE_NAME = mod.RULE_NAME as string | undefined
      if (!config || !RULE_NAME) {
        return { ok: false, msg: 'temp 模块缺 config/RULE_NAME export', ruleNames: [] }
      }
      const r = await upsert(cookie, {
        name: RULE_NAME,
        description: desc || '(import-all wrapper: 描述提取失败, 见源 80ge.ts main body)',
        enabled: true,
        config,
      })
      return { ok: r.ok, msg: r.msg, ruleNames: [RULE_NAME] }
    }
  } else {
    return { ok: false, msg: `未处理的 kind: ${spec.kind satisfies never}`, ruleNames: [] }
  }

  const tmpName = spec.file.replace(/\.ts$/, '.import-tmp.ts')
  const tmpFile = path.join(TMP_DIR, tmpName)
  try {
    writeFileSync(tmpFile, tempContent, 'utf8')
    const mod = (await import(`${tmpFile}?t=${Date.now()}`)) as Record<string, unknown>
    return await postFn(mod)
  } catch (e) {
    return { ok: false, msg: (e as Error).message, ruleNames: [] }
  } finally {
    try {
      rmSync(tmpFile)
    } catch {
      // ignore
    }
  }
}

// ============ 5. main ============
async function main(): Promise<void> {
  console.log(`== 批量导入种子规则 (BASE=${BASE}, ${SPECS.length} 个脚本) ==\n`)

  let cookie: string
  try {
    cookie = await login()
    console.log('✓ 登录成功, 拿到 heis_admin cookie\n')
  } catch (e) {
    console.error('✗ 登录失败:', (e as Error).message)
    process.exit(1)
  }

  mkdirSync(TMP_DIR, { recursive: true })

  const results: Array<{ file: string; ok: boolean; msg: string; ruleNames: string[] }> = []

  console.log('-- 逐脚本抽取 + 入库 --')
  for (const spec of SPECS) {
    const r = await processSpec(cookie, spec)
    results.push({ file: spec.file, ...r })
    const names = r.ruleNames.length ? ` [${r.ruleNames.join(', ')}]` : ''
    console.log(`${r.ok ? '✓' : '✗'} ${spec.file}: ${r.msg}${names}`)
  }

  // 清理 temp 目录(best effort)
  try {
    rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    // ignore
  }

  // 汇总
  const okCount = results.filter((r) => r.ok).length
  const failCount = results.length - okCount
  const totalRules = results.reduce((sum, r) => sum + r.ruleNames.length, 0)
  console.log()
  console.log(`脚本: ${okCount}/${results.length} 全部成功; 共导出 ${totalRules} 条规则`)
  if (failCount > 0) {
    console.log(`失败 ${failCount} 个脚本:`)
    results
      .filter((r) => !r.ok)
      .forEach((r) => console.log(`  - ${r.file}: ${r.msg}`))
  }

  // 最终核对: 拉一次规则全表
  console.log('\n-- 最终规则列表(按 updatedAt desc) --')
  const allRules = await listRules(cookie)
  console.log(`DB 共 ${allRules.length} 条规则`)
  for (const r of allRules.slice(0, 100)) {
    console.log(`  ${r.id}  ${r.name}`)
  }
  if (allRules.length > 100) {
    console.log(`  ... 余 ${allRules.length - 100} 条略`)
  }
}

main().catch((e) => {
  console.error('未捕获异常:', e)
  process.exit(1)
})

export {}
