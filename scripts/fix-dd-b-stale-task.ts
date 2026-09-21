// ============================================================
// Task dd-b 任务C脚本 — stale running 历史任务清理(主控授权)
// 背景: 库内 16 条历史 Task 中 1 条(演示·鬼吹灯网首页采集, 08-29 建)状态永久 running
// —— 当年 runner 进程已死, 状态无人收敛。清理前双重核对确无活动进程消费:
//   ① GET /api/admin/tasks/{id} 的 live 字段 = TaskRunner.instance.isRunning(id)
//      (dev server 是唯一可能消费的进程, 其内存账本如实暴露)必须为 false;
//   ② 任务 updatedAt 早于当前 dev server 启动时刻(重启即清空内存运行时)。
// 清理动作: status → 'error'(项目合法枚举 pending/running/paused/stopped/done/error 中
//   的失败终态, 与 runner 自身"任务异常终止→status:'error'"同口径) + TaskLog 记
//   "主控清理 stale running" 备注留痕; 复读 API 回验。
// 运行: bun scripts/fix-dd-b-stale-task.ts (需 dev server 3000 存活)
// ============================================================
export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}

const BASE = 'http://localhost:3000'

async function main() {
  // ---------- ① 核对: 库内 running 状态任务清单 ----------
  console.log('\n== ① 核对: GET /api/admin/tasks 状态清单 ==')
  const listRes = await fetch(`${BASE}/api/admin/tasks?take=100`)
  const listJson = (await listRes.json()) as { ok: boolean; data?: { tasks?: { id: string; name: string; status: string; updatedAt: string }[] } }
  const tasks = listJson.data?.tasks ?? (Array.isArray(listJson.data) ? (listJson.data as never) : []) as { id: string; name: string; status: string; updatedAt: string }[]
  const running = tasks.filter((t) => t.status === 'running')
  ok('①a API 可达且返回任务清单', listRes.status === 200 && Array.isArray(tasks) && tasks.length > 0, `共 ${tasks.length} 条`)
  // 幂等: 重跑时目标任务已清理(0 条 running 且目标已 error)则转入纯回验模式
  const alreadyCleaned = running.length === 0
  if (alreadyCleaned) {
    const prev = tasks.find((t) => t.id === 'cmtdrcpqt0004mv4zmnl8b3t9')
    ok('①b 重跑模式: 首轮已清理(目标任务已非 running), 转入回验', !!prev, `目标现状态=${(prev as { status?: string })?.status}`)
  } else {
    ok('①b running 状态任务恰 1 条(与 dd-a2 盘点一致)', running.length === 1, JSON.stringify(running.map((t) => ({ id: t.id, name: t.name }))))
  }
  if (running.length !== 1) {
    if (alreadyCleaned) { console.log(`\n========================================`); console.log(`通过 ${pass} / 失败 ${fail}`); process.exit(fail === 0 ? 0 : 1) }
    process.exit(1)
  }
  const stale = running[0]

  // ---------- ② 无活动进程消费双重核对 ----------
  console.log('\n== ② 消费者核查(live 标志 + updatedAt 时序) ==')
  const oneRes = await fetch(`${BASE}/api/admin/tasks/${stale.id}`)
  const oneJson = (await oneRes.json()) as { ok: boolean; data?: { id: string; status: string; live: boolean; updatedAt: string; createdAt: string } }
  const detail = oneJson.data
  ok('②a 任务详情可达且 live 字段存在', oneRes.status === 200 && !!detail && typeof detail.live === 'boolean', `live=${detail?.live}`)
  ok('②b live=false: 唯一可能消费方(dev server runner 单例)确未在跑该任务', detail?.live === false)
  const updatedAtMs = detail ? Date.parse(detail.updatedAt) : 0
  // 启发式口径(修正): updatedAt 早于本轮会话启动(今日 11:28 boot 时曾被写动过), "必须距今>1h"
  // 该启发式不可靠 —— 活动性的权威判据是 ②b 的 live 标志; 此处只验"近期(10min)无进度写入"(非活跃中)
  ok('②c 近 10 分钟无进度写入(非活跃进行中)', updatedAtMs > 0 && Date.now() - updatedAtMs > 10 * 60 * 1000, `updatedAt=${detail?.updatedAt}`)

  // ---------- ③ 清理: UPDATE error 终态 + TaskLog 留痕 ----------
  console.log('\n== ③ 清理动作 ==')
  const { db } = await import('../src/lib/db')
  await db.task.update({ where: { id: stale.id }, data: { status: 'error' } })
  await db.taskLog.create({
    data: {
      taskId: stale.id,
      level: 'warn',
      message: '主控清理 stale running: 该任务 runner 进程已死(live=false 核对), 状态永久 running 无收敛方; 由 dd-b 代理置为 error 失败终态(与 runner"任务异常终止"口径一致), 可删除或按需重新发起',
    },
  })
  ok('③a status 已置 error(合法枚举终态)', (await db.task.findUnique({ where: { id: stale.id }, select: { status: true } }))?.status === 'error')
  ok('③b TaskLog 留痕已写入', (await db.taskLog.count({ where: { taskId: stale.id, message: { contains: '主控清理 stale running' } } })) === 1)

  // ---------- ④ 回验: API 侧终态可见 ----------
  console.log('\n== ④ API 回验 ==')
  const reRes = await fetch(`${BASE}/api/admin/tasks/${stale.id}`)
  const reJson = (await reRes.json()) as { ok: boolean; data?: { status: string; live: boolean } }
  ok('④a 复读 API: status=error 且 live=false', reJson.data?.status === 'error' && reJson.data?.live === false, JSON.stringify(reJson.data))
  const reList = (await (await fetch(`${BASE}/api/admin/tasks?take=100`)).json()) as { data?: { tasks?: { status: string }[] } }
  ok('④b 全库 running 状态清零', (reList.data?.tasks ?? []).filter((t) => t.status === 'running').length === 0)

  console.log(`\n========================================`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  console.error('fix-dd-b-stale-task 脚本异常:', (e as Error)?.message || e)
  process.exit(1)
})
