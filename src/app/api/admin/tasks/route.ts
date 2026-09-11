// 采集任务 CRUD
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, str } from '../../_lib/http'
import { normalizeTaskData, validateTaskPair, TASK_STATUSES, type NormalizedTask } from './_shared'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const status = str(url.searchParams.get('status'), 20).trim()
    // 状态白名单过滤: 非法值忽略(不报错, 保持列表可用)
    const validStatus = (TASK_STATUSES as readonly string[]).includes(status) ? status : undefined
    const tasks = await db.task.findMany({
      where: validStatus ? { status: validStatus } : undefined,
      orderBy: { updatedAt: 'desc' },
      include: { rule: { select: { id: true, name: true } } },
      // API-12: 加 take: 500 上限, 防止任务表无限膨胀拉回内存
      take: 500,
    })
    return ok(tasks)
  })
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody(req)

    // agent-H-features: "重试仅失败书籍"特殊模式 —— body.retryFailedFromTaskId 指向源任务,
    // 克隆源任务所有配置(rule/threads/intervals/fetchConfig 等), 把源任务 progress.failedBookUrls
    // 作为新任务 fetchConfig.urls(mode='urls')的 startUrls, 跳过 list 发现阶段直接采书籍。
    // 失败 URL 列表上限 1000(过大则截断 + 提示); URL 必须合法 http(s), 经 sanitizeFetchConfig 再校验
    const retryFromId = str(body?.retryFailedFromTaskId, 64).trim()
    if (retryFromId) {
      const src = await db.task.findUnique({ where: { id: retryFromId }, include: { rule: { select: { name: true } } } })
      if (!src) return fail('源任务不存在', 404)

      // 从源任务 progress.failedBookUrls 提取 URL 列表
      let failedUrls: string[] = []
      try {
        const p = src.progress ? JSON.parse(src.progress) : {}
        if (Array.isArray(p?.failedBookUrls)) {
          failedUrls = (p.failedBookUrls as unknown[])
            .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
            .slice(0, 1000)
        }
      } catch { /* 脏 progress 视为无失败 URL */ }
      if (failedUrls.length === 0) return fail('源任务没有失败书籍可重试(失败 URL 列表为空)')

      // 复制源任务 fetchConfig 并注入 urls 字段(sanitizeFetchConfig 会再校验一遍)
      let srcFetchCfg: Record<string, unknown> = {}
      try { srcFetchCfg = src.fetchConfig ? JSON.parse(src.fetchConfig) : {} } catch { srcFetchCfg = {} }
      srcFetchCfg.urls = failedUrls
      const fetchConfigStr = JSON.stringify(srcFetchCfg)
      if (fetchConfigStr.length > 50_000) return fail('失败 URL 列表过大, 请先清理后重试')

      const truncatedNote = failedUrls.length < 1000 ? '' : `(已截断至 1000 条)`
      const newName = `${src.name} - 重试失败 ${failedUrls.length} 本${truncatedNote}`.slice(0, 100)
      try {
        const task = await db.task.create({
          data: {
            name: newName,
            ruleId: src.ruleId,
            mode: 'urls',
            bookUrl: '',
            listUrl: '',
            listStart: 1,
            listEnd: 1,
            bookStart: 0,
            bookEnd: 0,
            recrawlMode: 'full', // 重试失败: 强制 full 模式, 不跳过任何 URL
            storageMode: src.storageMode,
            fetchConfig: fetchConfigStr,
            threadMin: src.threadMin,
            threadMax: src.threadMax,
            intervalMin: src.intervalMin,
            intervalMax: src.intervalMax,
            smartCategory: src.smartCategory,
            smartComplete: src.smartComplete,
            autoSuggest: src.autoSuggest,
            autoRefresh: false, // 重试任务不自动刷新
            refreshIntervalMin: src.refreshIntervalMin,
          },
        })
        return ok(task)
      } catch (e: any) {
        if (e?.code === 'P2003') return fail('所选采集规则已被删除, 请刷新后重试', 409)
        throw e
      }
    }

    const ruleId = str(body?.ruleId, 64).trim()
    if (!ruleId) return fail('请选择采集规则')
    const rule = await db.rule.findUnique({ where: { id: ruleId } })
    if (!rule) return fail('规则不存在', 404)

    const { data, error } = normalizeTaskData(body ?? {}, 'full')
    if (error) return fail(error)
    const pairErr = validateTaskPair(data.mode, data.bookUrl, data.listUrl)
    if (pairErr) return fail(pairErr)

    // full 模式下所有字段均已规范化
    // FK 竞态兜底(主控z遗留项): ruleId 校验通过后规则被并发删除 → create 落 P2003 原会裸 500
    try {
      const task = await db.task.create({
        data: { ...(data as NormalizedTask), ruleId },
      })
      return ok(task)
    } catch (e: any) {
      if (e?.code === 'P2003') return fail('所选采集规则已被删除, 请刷新后重试', 409)
      throw e
    }
  })
}
