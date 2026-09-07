// ============================================================
// verify-ab-c-apply — calibrate/apply 路由实装 + 校准链路抓 bug 回归断言 (ab-c)
//
// 覆盖面:
//  S 段(静态) apply 路由契约 — 文件存在/POST 导出/解析顺序(契约形态→平铺兼容→
//             Setting 回落)/钳制 1~8/{ok,data} 信封/404·400 分支/config 原样合并
//             (不经 parseRuleConfig)/UI 契约形态调用/本轮抓修的 4 处真 bug 钉死
//  D 段(动态) dev server 实测 — 正常落库+其余 config 键保留/钳制上下界/404 规则
//             不存在/400 无校准结果/Setting 回落(空 body)/Setting 损坏 400/
//             config 非法 400
//
// 前置: dev server 运行于 localhost:3000(禁止 build/重启)
// 用法: bun scripts/verify-ab-c-apply.ts
// ============================================================
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { db } from '../src/lib/db'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const BASE = 'http://localhost:3000'
let pass = 0
let fail = 0
const fails: string[] = []

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) pass++
  else {
    fail++
    fails.push(name + (detail ? ` (${detail})` : ''))
  }
}

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const applyRoute = read('src/app/api/admin/rules/[id]/calibrate/apply/route.ts')
const dialog = read('src/components/admin/CalibrateDialog.tsx')
const calib = read('src/lib/crawl/calibrate.ts')
const routeSingle = read('src/app/api/admin/rules/[id]/calibrate/route.ts')
const routeBatch = read('src/app/api/admin/rules/calibrate-all/route.ts')

// ---------- S 段: 静态断言 ----------
ok('S1 apply 路由存在+POST 导出+force-dynamic+(ab-c) 头注', applyRoute.includes('export async function POST') && applyRoute.includes("dynamic = 'force-dynamic'") && applyRoute.includes('(ab-c)'))
ok('S2 解析顺序: recommended→平铺 hostGateLimit→Setting calibration:<id>', applyRoute.includes('body.recommended') && applyRoute.includes('numOrNull(body.hostGateLimit)') && applyRoute.includes('`calibration:${id}`'))
ok('S3 钳制 1~8(HOST_GATE_CLAMP_MAX=8 同引擎口径)', applyRoute.includes('HOST_GATE_CLAMP_MAX = 8') && applyRoute.includes('Math.min(HOST_GATE_CLAMP_MAX, Math.max(1,'))
ok('S4 {ok,data} 信封+applied/recommended/profile/message 四字段', applyRoute.includes('return ok({') && applyRoute.includes('applied: { hostGateLimit: applied }') && applyRoute.includes('recommended:') && applyRoute.includes('profile: profileOut') && applyRoute.includes('message:'))
ok('S5 404 分支: 规则不存在', applyRoute.includes("fail('规则不存在', 404)"))
ok('S6 400 分支: 无校准结果×2 + config 非法', (applyRoute.match(/该规则暂无校准结果/g) || []).length >= 2 && applyRoute.includes("fail('规则配置非法(JSON 解析失败), 无法写入 hostGateLimit', 400)"))
ok('S7 config 原样合并(不经 parseRuleConfig)+其余键保留', applyRoute.includes('JSON.parse(rule.config)') && applyRoute.includes('JSON.stringify({ ...cfg, fetch: fetchCfg })') && !applyRoute.includes("from '@/lib/crawl/types'") && !applyRoute.includes('import { parseRuleConfig'))
ok('S8 UI 契约形态调用 apply({recommended:{hostGateLimit}})', dialog.includes('JSON.stringify({ recommended: { hostGateLimit } })'))
ok('S9 UI 批量 done 摘要: Record<ruleId,result> 对象映射修复', dialog.includes('Object.entries(rv).map') && dialog.includes("Array.isArray(rv)"))
ok('S10 UI boot idle 回显 last 持久化结果', dialog.includes('isPlainObj(raw.last)') && dialog.includes('isPlainObj(last.result)'))
ok('S11 UI startAll 识别 idle(0 规则不卡进度页)', dialog.includes("started && started.status === 'idle'"))
ok('S12 引擎 probeLevel 通过率计入其他异常(宕机/404 不再虚高)', calib.includes('(hit429 + hit403 + other) / requests <= PASS_FAIL_RATIO') && calib.includes('(429+403+其他异常)/12'))
ok('S13 双路由 elapsedMs 结算后冻结(endedAtMs)', routeSingle.includes('(job.endedAtMs ?? Date.now()) - job.startedAtMs') && routeBatch.includes('(job.endedAtMs ?? Date.now()) - job.startedAtMs') && (routeSingle.match(/endedAtMs = Date\.now\(\)/g) || []).length >= 2 && (routeBatch.match(/endedAtMs = Date\.now\(\)/g) || []).length >= 3)

// ---------- D 段: 动态断言(dev server 实测) ----------
interface Env {
  ok?: boolean
  data?: any
  message?: string
}

async function jfetch(url: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  let json: any = null
  try {
    json = await res.json()
  } catch {
    json = null
  }
  return { status: res.status, json }
}

const TAG = `ab-c-verify-${Date.now()}`

async function dynamicSection(): Promise<void> {
  const createdIds: string[] = []
  const settingKeys: string[] = []
  try {
    // D1 建临时规则 A: fetch 段带既有键+未知键(验证合并保留)
    const r1 = await jfetch('/api/admin/rules', {
      method: 'POST',
      body: JSON.stringify({
        name: `${TAG} A(apply合并保留)`,
        config: {
          fetch: { hostGateLimit: 2, timeoutMs: 9000, uaMode: 'rotate', abCUnknownKey: 'keep-me' },
          list: { enabled: false, urlTemplate: 'http://example.com/list/{page}', itemSelector: { type: 'css', expression: 'li' }, fields: {} },
        },
        enabled: false,
      }),
    })
    const ruleA: string | null = r1.json?.data?.id ?? null
    ok('D1 建临时规则 A(fetch 段含未知键)', r1.status === 200 && !!ruleA, `status=${r1.status}`)
    if (ruleA) createdIds.push(ruleA)

    // D2 契约形态 apply {recommended:{hostGateLimit:3}} → 200 信封
    const r2 = await jfetch(`/api/admin/rules/${ruleA}/calibrate/apply`, {
      method: 'POST',
      body: JSON.stringify({ recommended: { hostGateLimit: 3 } }),
    })
    ok('D2 apply 契约形态 200 + data.applied.hostGateLimit=3', r2.status === 200 && r2.json?.ok === true && r2.json?.data?.applied?.hostGateLimit === 3 && typeof r2.json?.data?.message === 'string' && r2.json.data.message.length > 0, `status=${r2.status} body=${JSON.stringify(r2.json).slice(0, 160)}`)

    // D3 落库核实: hostGateLimit=3 且其余 fetch 键(含未知键)原样保留
    const r3 = await jfetch(`/api/admin/rules/${ruleA}`)
    const cfg3 = (() => {
      try {
        return JSON.parse(r3.json?.data?.config ?? '{}')
      } catch {
        return {}
      }
    })()
    ok('D3 config.fetch.hostGateLimit=3 落库', cfg3?.fetch?.hostGateLimit === 3, `got=${cfg3?.fetch?.hostGateLimit}`)
    ok('D4 合并保留其余 config 键(unknown/timeoutMs/uaMode/list 段)', cfg3?.fetch?.abCUnknownKey === 'keep-me' && cfg3?.fetch?.timeoutMs === 9000 && cfg3?.fetch?.uaMode === 'rotate' && cfg3?.list?.urlTemplate === 'http://example.com/list/{page}')

    // D5 平铺兼容形态 + 钳上界 99→8
    const r4 = await jfetch(`/api/admin/rules/${ruleA}/calibrate/apply`, { method: 'POST', body: JSON.stringify({ hostGateLimit: 99 }) })
    ok('D5 平铺 body.hostGateLimit=99 → 钳 8 落库', r4.status === 200 && r4.json?.data?.applied?.hostGateLimit === 8, `status=${r4.status}`)
    const r4g = await jfetch(`/api/admin/rules/${ruleA}`)
    ok('D6 钳 8 落库核实', (() => {
      try {
        return JSON.parse(r4g.json?.data?.config ?? '{}')?.fetch?.hostGateLimit === 8
      } catch {
        return false
      }
    })())

    // D7 钳下界 0→1
    const r5 = await jfetch(`/api/admin/rules/${ruleA}/calibrate/apply`, { method: 'POST', body: JSON.stringify({ recommended: { hostGateLimit: 0 } }) })
    ok('D7 hostGateLimit=0 → 钳 1', r5.status === 200 && r5.json?.data?.applied?.hostGateLimit === 1, `status=${r5.status}`)

    // D8 404: 规则不存在
    const r6 = await jfetch('/api/admin/rules/no-such-rule-ab-c/calibrate/apply', { method: 'POST', body: JSON.stringify({ recommended: { hostGateLimit: 3 } }) })
    ok('D8 不存在规则 → 404 ok:false', r6.status === 404 && r6.json?.ok === false, `status=${r6.status}`)

    // D9 400: 规则 B 无 body 且无校准 Setting
    const r7 = await jfetch('/api/admin/rules', { method: 'POST', body: JSON.stringify({ name: `${TAG} B(无校准结果)`, enabled: false }) })
    const ruleB: string | null = r7.json?.data?.id ?? null
    if (ruleB) createdIds.push(ruleB)
    const r8 = await jfetch(`/api/admin/rules/${ruleB}/calibrate/apply`, { method: 'POST', body: JSON.stringify({}) })
    ok('D9 无校准结果 → 400 该规则暂无校准结果', r8.status === 400 && String(r8.json?.message || '').includes('该规则暂无校准结果'), `status=${r8.status} msg=${r8.json?.message}`)

    // D10 Setting 回落: 空 body → 取 calibration:<id> 的 result.recommended.hostGateLimit
    if (ruleB) {
      const key = `calibration:${ruleB}`
      settingKeys.push(key)
      await db.setting.upsert({
        where: { key },
        update: { value: JSON.stringify({ result: { ok: true, maxConcurrency: 4, minIntervalMs: 1000, recommended: { hostGateLimit: 4, threadMin: 2, threadMax: 4, intervalMin: 1000, intervalMax: 2500 } }, profile: 'standard', finishedAt: new Date().toISOString() }) },
        create: { key, value: JSON.stringify({ result: { ok: true, maxConcurrency: 4, minIntervalMs: 1000, recommended: { hostGateLimit: 4, threadMin: 2, threadMax: 4, intervalMin: 1000, intervalMax: 2500 } }, profile: 'standard', finishedAt: new Date().toISOString() }) },
      })
      const r9 = await fetch(BASE + `/api/admin/rules/${ruleB}/calibrate/apply`, { method: 'POST' }) // 真空 body
      const j9: any = await r9.json().catch(() => null)
      ok('D10 空 body Setting 回落 applied=4 + profile=recommended 透传', r9.status === 200 && j9?.data?.applied?.hostGateLimit === 4 && j9?.data?.profile === 'standard' && j9?.data?.recommended?.threadMax === 4, `status=${r9.status} body=${JSON.stringify(j9).slice(0, 160)}`)
    } else {
      ok('D10 空 body Setting 回落 applied=4 + profile=recommended 透传', false, 'ruleB 未创建')
    }

    // D11 Setting 损坏(非 JSON)→ 400
    const r10 = await jfetch('/api/admin/rules', { method: 'POST', body: JSON.stringify({ name: `${TAG} C(损坏Setting)`, enabled: false }) })
    const ruleC: string | null = r10.json?.data?.id ?? null
    if (ruleC) createdIds.push(ruleC)
    if (ruleC) {
      const key = `calibration:${ruleC}`
      settingKeys.push(key)
      await db.setting.upsert({ where: { key }, update: { value: 'not-json{{' }, create: { key, value: 'not-json{{' } })
      const r11 = await jfetch(`/api/admin/rules/${ruleC}/calibrate/apply`, { method: 'POST', body: JSON.stringify({}) })
      ok('D11 Setting 损坏 → 400 该规则暂无校准结果', r11.status === 400 && String(r11.json?.message || '').includes('该规则暂无校准结果'), `status=${r11.status}`)
    } else {
      ok('D11 Setting 损坏 → 400 该规则暂无校准结果', false, 'ruleC 未创建')
    }

    // D12 规则 config 非法(损坏 JSON)→ 400
    const r12 = await jfetch('/api/admin/rules', { method: 'POST', body: JSON.stringify({ name: `${TAG} D(config非法)`, enabled: false }) })
    const ruleD: string | null = r12.json?.data?.id ?? null
    if (ruleD) createdIds.push(ruleD)
    if (ruleD) {
      await db.rule.update({ where: { id: ruleD }, data: { config: 'not-json{{' } })
      const r13 = await jfetch(`/api/admin/rules/${ruleD}/calibrate/apply`, { method: 'POST', body: JSON.stringify({ recommended: { hostGateLimit: 2 } }) })
      ok('D12 config 非法 → 400 规则配置非法', r13.status === 400 && String(r13.json?.message || '').includes('规则配置非法'), `status=${r13.status}`)
    } else {
      ok('D12 config 非法 → 400 规则配置非法', false, 'ruleD 未创建')
    }
  } finally {
    // 清理: 临时规则 + 临时 Setting(还原现场)
    for (const id of createdIds) {
      await jfetch(`/api/admin/rules/${id}`, { method: 'DELETE' }).catch(() => {})
    }
    for (const key of settingKeys) {
      await db.setting.delete({ where: { key } }).catch(() => {})
    }
  }

  // D13 清理核实
  const rl = await jfetch('/api/admin/rules')
  const names: string[] = (rl.json?.data ?? []).map((r: any) => String(r?.name || ''))
  ok('D13 临时规则/Setting 清理归零', !names.some((n) => n.includes(TAG)), `残留=${names.filter((n) => n.includes(TAG)).join(',') || '无'}`)
}

await dynamicSection()
await db.$disconnect().catch(() => {})

// ---------- 汇总 ----------
console.log(`\n========== verify-ab-c-apply: ${pass + fail} 项 ==========`)
if (fail === 0) {
  console.log(`========== 结果: ${pass} 通过 / 0 失败 ==========`)
  console.log('verify-ab-c-apply: ALL PASS')
} else {
  console.log(`========== 结果: ${pass} 通过 / ${fail} 失败 ==========`)
  for (const f of fails) console.log('  FAIL:', f)
  process.exit(1)
}
