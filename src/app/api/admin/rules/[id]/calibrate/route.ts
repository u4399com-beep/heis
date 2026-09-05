// 采集规则极限速率/并发校准 — 单规则任务端点 (zz-a)
//
// 规格 : POST   { profile?, siteBase? } → 校验规则存在后后台启动校准(不 await),
//        202 { jobId: ruleId, status: 'running' }; 同规则重复启动 409;
//        GET    → { status, result?, startedAt, elapsedMs } / 无 job 时 { status:'idle' }
//        (附 last=最近一次持久化结果, 取自 Setting calibration:<ruleId>);
//        DELETE → 置 abortFlag 中止后台校准 { ok: true }。
// 完成(done)时结果持久化: Setting key=`calibration:${ruleId}`
//        value=JSON.stringify({ result, profile, finishedAt })。
// job 状态存 globalThis 单例 Map(防 dev 热重载丢实例, 同 hostgate.ts 模式)。
// 探测引擎 src/lib/crawl/calibrate.ts 自持节奏(不依赖 hostgate); 模拟源站
// scripts/ratelimit-site.ts(默认 http://127.0.0.1:3040, standard 档)。
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fail, readBody } from '@/lib/api'
import { withGuard, httpUrl } from '../../../../_lib/http'
import { parseRuleConfig } from '@/lib/crawl/types'
import { calibrateRule, type CalibrationResult, type CalibrationTrace, type CalibrateProfile } from '@/lib/crawl/calibrate'

const PROFILES: CalibrateProfile[] = ['lenient', 'standard', 'strict']
const DEFAULT_SITE_BASE = 'http://127.0.0.1:3040'

interface CalibJob {
  status: 'running' | 'done' | 'error'
  profile: CalibrateProfile
  siteBase: string
  result?: CalibrationResult
  error?: string
  startedAt: string
  startedAtMs: number
  /** ab-c: 结算时刻(running→done/error 落定瞬间), GET elapsedMs 结算后冻结不再增长 */
  endedAtMs?: number
  abortFlag: { value: boolean }
  /** zz-a4: 渐进轨迹(running 态 GET 返回, UI 实时展示探测进度) */
  traces: CalibrationTrace[]
}

// globalThis 单例(防 dev 热重载多实例各记一套 job)
const gJobs = globalThis as unknown as { __novelCalibJobs_v1?: Map<string, CalibJob> }
function jobMap(): Map<string, CalibJob> {
  if (!gJobs.__novelCalibJobs_v1) gJobs.__novelCalibJobs_v1 = new Map()
  return gJobs.__novelCalibJobs_v1
}

/** body 出参校验: profile 白名单 + siteBase http(s) 合法性(缺省走模拟源站) */
function parseOpts(body: Record<string, unknown> | null): { profile: CalibrateProfile; siteBase: string; resetBefore: boolean } | { error: string } {
  if (body?.profile !== undefined && !PROFILES.includes(body.profile as CalibrateProfile)) {
    return { error: 'profile 仅支持 lenient/standard/strict' }
  }
  const rawProfile = body?.profile
  const profile = (PROFILES.includes(rawProfile as CalibrateProfile) ? rawProfile : 'standard') as CalibrateProfile
  const rawSiteBase = typeof body?.siteBase === 'string' ? body.siteBase : ''
  const siteBase = rawSiteBase ? httpUrl(rawSiteBase, 500) : DEFAULT_SITE_BASE
  if (!siteBase) return { error: 'siteBase 必须是合法的 http(s) 地址' }
  // zz-a2: 校准前重置模拟源站(默认开)——仅回环地址安全门内执行, 真实站点永不发送
  // (清空上一轮残余的 429 计数/临时封禁, 保证每轮校准可重复); resetMock=false 可关
  const isLoopback = /^(http:\/\/|https:\/\/)(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?\//.test(siteBase + '/')
  const resetBefore = body?.resetMock === false ? false : isLoopback
  return { profile, siteBase, resetBefore }
}

/** 后台校准执行体: done 落 Setting(calibration:<ruleId>); abort/异常转 error 态 */
async function runCalibration(jobId: string, ruleConfigRaw: string, opts: { profile: CalibrateProfile; siteBase: string; resetBefore: boolean }, job: CalibJob): Promise<void> {
  try {
    const cfg = parseRuleConfig(ruleConfigRaw)
    const result = await calibrateRule(cfg, {
      siteBase: opts.siteBase,
      profile: opts.profile,
      resetBefore: opts.resetBefore,
      onProgress: (t) => {
        job.traces.push(t) // zz-a4: 渐进轨迹供 running 态轮询展示
      },
      shouldAbort: () => job.abortFlag.value,
    })
    job.result = result
    job.status = 'done'
    job.endedAtMs = Date.now() // ab-c: elapsedMs 冻结基准
    const value = JSON.stringify({ result, profile: opts.profile, finishedAt: result.finishedAt })
    await db.setting.upsert({ where: { key: `calibration:${jobId}` }, update: { value }, create: { key: `calibration:${jobId}`, value } })
  } catch (e: any) {
    job.status = 'error'
    job.endedAtMs = Date.now() // ab-c: elapsedMs 冻结基准
    job.error = e?.name === 'CalibrateAbort' ? '校准已取消' : String(e?.message || e)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const rule = await db.rule.findUnique({ where: { id } })
    if (!rule) return fail('规则不存在', 404)
    const body = await readBody(req).catch(() => ({}))
    const opts = parseOpts(body)
    if ('error' in opts) return fail(opts.error, 400)
    const existing = jobMap().get(id)
    if (existing?.status === 'running') {
      return NextResponse.json({ ok: false, error: '校准进行中', message: '校准进行中' }, { status: 409 })
    }
    const job: CalibJob = {
      status: 'running',
      profile: opts.profile,
      siteBase: opts.siteBase,
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      abortFlag: { value: false },
      traces: [],
    }
    jobMap().set(id, job)
    void runCalibration(id, rule.config, opts, job) // 后台执行, 立即返回
    return NextResponse.json({ ok: true, jobId: id, status: 'running' }, { status: 202 })
  })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const job = jobMap().get(id)
    if (!job) {
      // 无活动 job: 附带最近一次持久化结果(若有), 便于前端回显
      let last: unknown = null
      try {
        const row = await db.setting.findUnique({ where: { key: `calibration:${id}` } })
        if (row) last = JSON.parse(row.value)
      } catch {
        /* 持久化值解析失败不影响状态查询 */
      }
      return NextResponse.json({ ok: true, status: 'idle', last })
    }
    return NextResponse.json({
      ok: true,
      status: job.status,
      result: job.result ?? null,
      // zz-a4: running 态渐进返回已完成的探测档(UI 实时轨迹表); done 态 result.trace 完整
      trace: job.status === 'running' ? job.traces : undefined,
      error: job.error ?? null,
      startedAt: job.startedAt,
      // ab-c: 结算后冻结(旧实现 done/error 态 elapsedMs 随每次 GET 持续增长, 与 durationMs 口径脱节)
      elapsedMs: (job.endedAtMs ?? Date.now()) - job.startedAtMs,
    })
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const job = jobMap().get(id)
    if (job?.status === 'running') job.abortFlag.value = true
    return NextResponse.json({ ok: true })
  })
}
