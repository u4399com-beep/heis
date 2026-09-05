// 重采集: full(完全覆盖) / incremental(增量更新) — 以书籍为粒度创建临时任务
import { readBody, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { TaskRunner } from '@/lib/crawl/runner'
import { withGuard } from '../../../../_lib/http'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const book = await db.book.findUnique({ where: { id } })
    if (!book) return fail('书籍不存在', 404)
    if (!book.sourceUrl) return fail('该书无来源地址, 无法重采集')

    const recrawlMode = body?.mode === 'full' ? 'full' : 'incremental'
    // 找一个可用规则(优先来源规则)
    let ruleId = book.sourceRuleId
    if (!ruleId || !(await db.rule.findUnique({ where: { id: ruleId } }))) {
      const anyRule = await db.rule.findFirst()
      if (!anyRule) return fail('系统中无采集规则, 请先创建')
      ruleId = anyRule.id
    }

    // FK 竞态兜底(tt-b, 与 POST /api/admin/tasks 同型): ruleId 校验通过后规则被并发删除
    // → create 落 P2003 原会裸 500 → 转 409 引导刷新重试
    let task
    try {
      task = await db.task.create({
        data: {
          name: `${recrawlMode === 'full' ? '完全覆盖' : '增量更新'}重采:《${book.name.slice(0, 80)}》`,
          ruleId,
          mode: 'single',
          bookUrl: book.sourceUrl,
          recrawlMode,
          storageMode: book.storageMode === 'txt' ? 'txt' : 'db',
          threadMin: 2,
          threadMax: 4,
          intervalMin: 300,
          intervalMax: 1200,
          smartCategory: false, // 重采保留已有分类
          smartComplete: true,
          autoSuggest: false,
        },
      })
    } catch (e: any) {
      if (e?.code === 'P2003') return fail('所选采集规则已被删除, 请刷新后重试', 409)
      throw e
    }
    // 立即执行; control 失败(理论上仅任务不存在)时如实回报, 避免静默滞留 pending
    const res = await TaskRunner.instance.control(task.id, 'start')
    if (!res.ok) return fail(`重采任务已创建但启动失败: ${res.message}`, 500)
    return ok(task)
  })
}
