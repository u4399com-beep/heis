// ============================================================
// calibrate/apply — 校准推荐参数一键写回规则 (ab-c)
//
// 规格 : POST { recommended?: { hostGateLimit?: number } } (body 可空)
//        → hostGateLimit 解析顺序:
//          ① body.recommended.hostGateLimit (zz-a 契约形态, zz-c UI 主路径)
//          ② body.hostGateLimit (UI 平铺兼容形态)
//          ③ Setting 键 calibration:<ruleId> 落库的校准结果
//            (value 形状见 ../route.ts: { result, profile, finishedAt },
//             取 result.recommended.hostGateLimit)
//        → 钳制 1~8 (与校准引擎 HOST_GATE_CLAMP_MAX 同口径) 后,
//          合并进规则 config.fetch.hostGateLimit 并落库。
//
// 合并方式: 读规则原始 config 字符串 JSON.parse 后原样改写 —— 刻意【不经】
// parseRuleConfig(其 sanitizeFetchConfig 白名单会剥掉未知键), 除 fetch.hostGateLimit
// 外其余一切键(含未知扩展键)逐字保留。
//
// 响应 : { ok:true, data:{ applied:{hostGateLimit}, recommended, profile, message } }
//        (对齐项目 {ok,data} 信封, 与 [id]/route.ts 的 ok() 助手一致;
//         recommended=本次取值来源的完整推荐对象(无则只含 hostGateLimit),
//         profile=校准落库时的档位(无来源则 null))
// 错误面: 规则不存在 → 404;
//        body 无值且无校准 Setting → 400「该规则暂无校准结果」;
//        规则 config 非法(JSON 解析失败/非对象) → 400;
//        写库异常 → withGuard 兜底 500 信封。
// ============================================================
export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard } from '../../../../../_lib/http'

/** 钳制上限: 校准引擎 HOST_GATE_CLAMP_MAX 同口径(hostgate 上限 10, 保守 8) */
const HOST_GATE_CLAMP_MAX = 8

/** 从未知值提取可钳制数值(数字/数字串均可); 非有限数返回 null */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const rule = await db.rule.findUnique({ where: { id } })
    if (!rule) return fail('规则不存在', 404)

    // body 可空: readBody 解析失败/空体一律回落 {}
    const parsed = await readBody<unknown>(req)
    const body = isPlainObj(parsed) ? parsed : {}
    const recIn = isPlainObj(body.recommended) ? body.recommended : null

    // ① 契约形态 body.recommended.hostGateLimit → ② 平铺 body.hostGateLimit → ③ Setting 校准结果
    let raw = numOrNull(recIn?.hostGateLimit)
    if (raw === null) raw = numOrNull(body.hostGateLimit)
    let source: 'body' | 'setting' = 'body'
    let recommendedOut: Record<string, unknown> | null = raw !== null && recIn ? recIn : null
    let profileOut: unknown = null

    if (raw === null) {
      const row = await db.setting.findUnique({ where: { key: `calibration:${id}` } })
      if (!row) return fail('该规则暂无校准结果, 请先运行校准', 400)
      let stored: Record<string, unknown> | null = null
      try {
        const parsedSetting: unknown = JSON.parse(row.value)
        if (isPlainObj(parsedSetting)) stored = parsedSetting
      } catch {
        stored = null
      }
      const storedResult = isPlainObj(stored?.result) ? stored!.result : null
      const storedRec = isPlainObj(storedResult?.recommended) ? storedResult!.recommended : null
      raw = numOrNull(storedRec?.hostGateLimit)
      if (raw === null) return fail('该规则暂无校准结果, 请先运行校准', 400)
      source = 'setting'
      recommendedOut = storedRec
      profileOut = stored?.profile ?? null
    }

    // 钳制 1~8(取整防小数)
    const applied = Math.min(HOST_GATE_CLAMP_MAX, Math.max(1, Math.round(raw)))

    // 原样改写 config JSON(不经 parseRuleConfig, 防白名单剥未知键), 其余键一律保留
    let cfg: Record<string, unknown> | null = null
    try {
      const parsedConfig: unknown = JSON.parse(rule.config)
      if (isPlainObj(parsedConfig)) cfg = parsedConfig
    } catch {
      cfg = null
    }
    if (!cfg) return fail('规则配置非法(JSON 解析失败), 无法写入 hostGateLimit', 400)
    const fetchCfg = isPlainObj(cfg.fetch) ? { ...cfg.fetch } : {}
    fetchCfg.hostGateLimit = applied
    const newConfig = JSON.stringify({ ...cfg, fetch: fetchCfg })
    await db.rule.update({ where: { id }, data: { config: newConfig } })

    return ok({
      applied: { hostGateLimit: applied },
      recommended: recommendedOut ?? { hostGateLimit: applied },
      profile: profileOut,
      message:
        source === 'setting'
          ? `已将最近一次校准推荐的 hostGateLimit=${applied} 写入规则 config.fetch.hostGateLimit`
          : `已将 hostGateLimit=${applied} 写入规则 config.fetch.hostGateLimit`,
    })
  })
}
