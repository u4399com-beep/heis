// 采集规则极限速率/并发校准 — 全量批量端点 (zz-a)
//
// 规格 : POST { profile?, siteBase? } → 对全部 enabled 规则按序【串行】校准,
//        共用一个聚合 job(jobId='__all__'), 202 返回 { jobId, status:'running',
//        currentIndex, total }; 完成/中止时逐条落 Setting(calibration:<ruleId>)。
//        0 条 enabled 规则 → 200 明确提示(不报错不启动)。
//        GET  → 聚合形态 { status, currentIndex, total, results?, startedAt, elapsedMs }
//        (results: Record<ruleId, CalibrationResult>, 含已完成的部分结果)。
//        DELETE → 置 abortFlag 中止(已完成规则的结果保留)。
// 路由优先级: 静态段 calibrate-all 优先于动态段 [id], 两者并存互不影响。
// 聚合 job 与单规则 job 共用 globalThis 单例 Map(键 '__all__' vs ruleId)。
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { readBody } from '@/lib/api'
import { withGuard, httpUrl } from '../../../_lib/http'
import { parseRuleConfig } from '@/lib/crawl/types'
import { calibrateRule, type CalibrationResult, type CalibrationTrace, type CalibrateProfile } from '@/lib/crawl/calibrate'

const PROFILES: CalibrateProfile[] = ['lenient', 'standard', 'strict']
const DEFAULT_SITE_BASE = 'http://127.0.0.1:3040'
const BATCH_JOB_ID = '__all__'

interface BatchJob {
  status: 'running' | 'done' | 'error'
  profile: CalibrateProfile
  siteBase: string
  error?: string
  startedAt: string
  startedAtMs: number
  /** ab-c: 结算时刻(running→done/error 落定瞬间), GET elapsedMs 结算后冻结不再增长 */
  endedAtMs?: number
  abortFlag: { value: boolean }
  /** zz-a2: 每条规则校准前重置模拟源站(回环安全门内) */
  resetBefore: boolean
  /** 已完成/正在执行的规则下标(完成数) */
  currentIndex: number
  totalRuleIds: string[]
  /** 规则配置快照(启动时定格, 避免中途规则变更干扰串行队列) */
  ruleConfigs: Array<{ id: string; config: string }>
  /** 聚合结果: Record<ruleId, CalibrationResult> */
  results: Record<string, CalibrationResult>
  /** zz-a4: 当前正在校准规则的渐进轨迹(running 态 GET 返回) */
  currentTraces: CalibrationTrace[]
}

// globalThis 单例(与 [id]/calibrate 共享同一 Map, 防热重载多实例)
const gJobs = globalThis as unknown as { __novelCalibJobs_v1?: Map<string, BatchJob> }
function jobMap(): Map<string, BatchJob> {
  if (!gJobs.__novelCalibJobs_v1) gJobs.__novelCalibJobs_v1 = new Map()
  return gJobs.__novelCalibJobs_v1
}

function parseOpts(body: Record<string, unknown> | null): { profile: CalibrateProfile; siteBase: string; resetBefore: boolean } | { error: string } {
  if (body?.profile !== undefined && !PROFILES.includes(body.profile as CalibrateProfile)) {
    return { error: 'profile 仅支持 lenient/standard/strict' }
  }
  const rawProfile = body?.profile
  const profile = (PROFILES.includes(rawProfile as CalibrateProfile) ? rawProfile : 'standard') as CalibrateProfile
  const rawSiteBase = typeof body?.siteBase === 'string' ? body.siteBase : ''
  const siteBase = rawSiteBase ? httpUrl(rawSiteBase, 500) : DEFAULT_SITE_BASE
  if (!siteBase) return { error: 'siteBase 必须是合法的 http(s) 地址' }
  // zz-a2: 每条规则校准前重置模拟源站(仅回环地址安全门内), 保证批量串行校准每条都从干净状态开始
  const isLoopback = /^(http:\/\/|https:\/\/)(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?\//.test(siteBase + '/')
  const resetBefore = body?.resetMock === false ? false : isLoopback
  return { profile, siteBase, resetBefore }
}

/** 批量执行体: 串行逐规则校准, 每条完成即落 Setting(渐进持久化, 中止不丢已完成) */
async function runBatch(job: BatchJob): Promise<void> {
  try {
    for (let i = 0; i < job.ruleConfigs.length; i++) {
      if (job.abortFlag.value) {
        job.status = 'error'
        job.endedAtMs = Date.now() // ab-c: elapsedMs 冻结基准
        job.error = '校准已取消'
        return
      }
      job.currentIndex = i
      const { id, config } = job.ruleConfigs[i]
      const result = await calibrateRule(parseRuleConfig(config), {
        siteBase: job.siteBase,
        profile: job.profile,
        resetBefore: job.resetBefore,
        onProgress: (t) => {
          job.currentTraces.push(t) // zz-a4: 渐进轨迹
        },
        shouldAbort: () => job.abortFlag.value,
      })
      job.results[id] = result
      job.currentTraces = [] // 进入下一条规则前清空(每条规则轨迹独立)
      const value = JSON.stringify({ result, profile: job.profile, finishedAt: result.finishedAt })
      await db.setting.upsert({ where: { key: `calibration:${id}` }, update: { value }, create: { key: `calibration:${id}`, value } })
      job.currentIndex = i + 1
    }
    job.status = 'done'
    job.endedAtMs = Date.now() // ab-c: elapsedMs 冻结基准
  } catch (e: any) {
    job.status = 'error'
    job.endedAtMs = Date.now() // ab-c: elapsedMs 冻结基准
    job.error = e?.name === 'CalibrateAbort' ? '校准已取消' : String(e?.message || e)
  }
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody(req).catch(() => ({}))
    const opts = parseOpts(body)
    if ('error' in opts) return NextResponse.json({ ok: false, error: opts.error, message: opts.error }, { status: 400 })
    const existing = jobMap().get(BATCH_JOB_ID)
    if (existing?.status === 'running') {
      return NextResponse.json({ ok: false, error: '校准进行中', message: '校准进行中' }, { status: 409 })
    }
    const rules = await db.rule.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, config: true },
    })
    if (rules.length === 0) {
      return NextResponse.json({
        ok: true,
        status: 'idle',
        total: 0,
        currentIndex: 0,
        message: '当前没有启用的采集规则, 无可校准对象; 请先在规则库中启用规则后再批量校准',
      })
    }
    const job: BatchJob = {
      status: 'running',
      profile: opts.profile,
      siteBase: opts.siteBase,
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      abortFlag: { value: false },
      resetBefore: opts.resetBefore,
      currentIndex: 0,
      totalRuleIds: rules.map((r) => r.id),
      ruleConfigs: rules,
      results: {},
      currentTraces: [],
    }
    jobMap().set(BATCH_JOB_ID, job)
    void runBatch(job) // 后台串行执行, 立即返回
    return NextResponse.json({ ok: true, jobId: BATCH_JOB_ID, status: 'running', currentIndex: 0, total: rules.length }, { status: 202 })
  })
}

export async function GET() {
  return withGuard(async () => {
    const job = jobMap().get(BATCH_JOB_ID)
    if (!job) {
      return NextResponse.json({ ok: true, status: 'idle', currentIndex: 0, total: 0, results: null })
    }
    return NextResponse.json({
      ok: true,
      status: job.status,
      currentIndex: job.currentIndex,
      total: job.totalRuleIds.length,
      results: job.status === 'running' ? null : job.results,
      partialResults: job.status === 'running' ? job.results : null,
      // zz-a4: running 态渐进返回当前规则的已完成探测档
      trace: job.status === 'running' ? job.currentTraces : undefined,
      error: job.error ?? null,
      startedAt: job.startedAt,
      // ab-c: 结算后冻结(旧实现 done/error 态 elapsedMs 随每次 GET 持续增长)
      elapsedMs: (job.endedAtMs ?? Date.now()) - job.startedAtMs,
    })
  })
}

export async function DELETE() {
  return withGuard(async () => {
    const job = jobMap().get(BATCH_JOB_ID)
    if (job?.status === 'running') job.abortFlag.value = true
    return NextResponse.json({ ok: true })
  })
}
