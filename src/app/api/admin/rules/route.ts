// 采集规则 CRUD
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { defaultRuleConfig, collectRegexIssues } from '@/lib/crawl/types'
import { withGuard, str, isPlainObject } from '../../_lib/http'

/** 规则配置序列化: 对象→JSON字符串; 字符串→原样; 均限制大小防DB膨胀 */
function configToString(v: unknown): string | null {
  if (isPlainObject(v)) {
    const s = JSON.stringify(v)
    return s.length > 200_000 ? null : s
  }
  if (typeof v === 'string') return v.length > 200_000 ? null : v
  return null
}

/** regex 入口防线(gg-a): 保存前全量审查配置中的正则四入口
 *  (四段 regex 型 expression / 全部 replaceFrom / fetch.tokenPattern regex: 形态 / clean.adPatterns),
 *  非法正则(引擎 try/catch 静默忽略 = 静默失效面)与灾难型嵌套量词(可挂住事件循环)
 *  一律 400 拒绝并指明字段与原因; 零误伤前提已验证(存量 27 规则 251 个正则面字段全数通过) */
function regexGate(v: unknown): string | null {
  const issues = collectRegexIssues(v)
  if (!issues.length) return null
  return `规则配置存在非法/危险正则, 已拒绝保存: ${issues.map((i) => `${i.field} ${i.reason}`).join('; ')}`
}

export async function GET() {
  return withGuard(async () => {
    const rules = await db.rule.findMany({ orderBy: { updatedAt: 'desc' } })
    return ok(rules)
  })
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody(req)
    const name = str(body?.name, 100).trim()
    if (!name) return fail('规则名称必填')
    let config: string
    if (body?.config === undefined || body?.config === null || body?.config === '') {
      config = JSON.stringify(defaultRuleConfig())
    } else {
      const regexError = regexGate(body.config)
      if (regexError) return fail(regexError, 400)
      const s = configToString(body.config)
      if (s === null) return fail('规则配置过大或类型非法')
      config = s
    }
    const rule = await db.rule.create({
      data: {
        name,
        description: str(body?.description, 500),
        config,
        enabled: body?.enabled !== false,
      },
    })
    return ok(rule)
  })
}
