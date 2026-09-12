// ============================================================
// 规则克隆 — POST /api/admin/rules/[id]/duplicate
//
// 规格: 复制源规则的所有字段(name 加 " 副本"后缀, description/config/enabled/thread*
//       interval*/recrawlMode 等), 生成新规则(id 由 Prisma cuid 自动生成)。
//       源规则不存在 → 404; 同名规则已存在 → 不冲突(cuid 唯一, name 不唯一)。
//       克隆出的规则默认 enabled=false(避免克隆即生效, 用户需手动启用)。
//
// 用例: 用户基于已有规则快速派生新规则(微调 selector 后用于不同站点), 避免手工复制
//       200KB+ 的 JSON 配置。config 字段经原值透传(源端已校验过 regex 入口防线)。
// ============================================================
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, str, isPlainObject } from '../../../../_lib/http'

const NAME_MAX = 200
const DESC_MAX = 1000

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const source = await db.rule.findUnique({ where: { id } })
    if (!source) return fail('源规则不存在', 404)

    // 可选 body 覆盖: name / description / enabled (默认 name 加 " 副本" 后缀)
    const body = await readBody<Record<string, unknown>>(req)
    const safeBody = isPlainObject(body) ? body : {}
    const defaultName = `${source.name} 副本`.slice(0, NAME_MAX)
    const name = str(safeBody.name, NAME_MAX).trim() || defaultName
    if (!name) return fail('规则名称不能为空')
    const description =
      safeBody.description === undefined
        ? source.description
        : safeBody.description == null
        ? null
        : str(safeBody.description, DESC_MAX)
    // 克隆出的规则默认禁用, 用户审核 + 微调后再启用 (避免误用同 hostGateLimit 配置打挂不同站点)
    const enabled = safeBody.enabled === true

    // config 原样透传 (源端已通过 regexGate 校验, 克隆不变更正则)
    // 体积二次防护: 源可能被编辑后超过 200_000 上限(理论上 PUT 已拦截), 此处兜底
    const config = source.config.length > 200_000 ? '{}' : source.config

    let cloned
    try {
      cloned = await db.rule.create({
        data: {
          name,
          description,
          config,
          enabled,
        },
      })
    } catch (e: unknown) {
      // 极少发生: cuid 唯一, name 不唯一; 仅 DB 故障会到这
      const err = e as { code?: string; message?: string }
      if (err?.code === 'P2002') return fail('规则名已存在(并发同名克隆), 请换名重试', 409)
      throw e
    }
    return ok(cloned)
  })
}
