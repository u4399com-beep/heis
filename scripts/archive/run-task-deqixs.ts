// ============================================================
// rr-a 生产任务实测: deqixs 上一本真实书籍建单书任务 + start + 采入监控
// 书: 捞尸人(纯洁滴小龙, /books/126/, 914章连载) — 探测定案用书, 全字段已知
// 运行: bun run scripts/run-task-deqixs.ts [start|monitor|stop]
// ============================================================
export {} // module 守卫(tsc: 顶层 await 需要)
const BASE = 'http://127.0.0.1:3000'
const RULE_ID = 'cmtmv3ai50004nsxbnyjn7z6g'
const TASK_NAME = '得奇小说网·捞尸人 单书实测(rr-a)'
const BOOK_URL = 'https://www.deqixs.cc/books/126/'

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...init })
  return (await res.json()) as any
}

async function findTask(): Promise<{ id: string; status: string; name: string } | null> {
  const j = await api(`/api/admin/tasks`)
  const tasks = (Array.isArray(j?.data) ? j.data : []) as any[]
  return tasks.find((t) => t.name === TASK_NAME) ?? null
}

const action = process.argv[2] || 'start'

if (action === 'start') {
  let task = await findTask()
  if (task) {
    console.log('任务已存在:', task.id, task.status)
  } else {
    const created = await api('/api/admin/tasks', {
      method: 'POST',
      body: JSON.stringify({
        name: TASK_NAME,
        ruleId: RULE_ID,
        mode: 'single',
        bookUrl: BOOK_URL,
        recrawlMode: 'incremental',
        storageMode: 'db',
        threadMin: 1,
        threadMax: 2,
        intervalMin: 300,
        intervalMax: 600,
      }),
    })
    if (!created?.ok) {
      console.log('建任务失败:', created?.message)
      process.exit(1)
    }
    task = { id: created.data.id, status: created.data.status, name: TASK_NAME }
    console.log('任务已建:', task.id)
  }
  const ctl = await api(`/api/admin/tasks/${task.id}/control`, { method: 'POST', body: JSON.stringify({ action: 'start' }) })
  console.log('start:', ctl?.ok ? 'OK' : ctl?.message)
  process.exit(ctl?.ok ? 0 : 1)
}

if (action === 'monitor') {
  const task = await findTask()
  if (!task) { console.log('任务不存在'); process.exit(1) }
  const j = await api(`/api/admin/tasks/${task.id}/logs?take=8`)
  const logs = (Array.isArray(j?.data) ? j.data : (j?.data?.logs ?? [])) as any[]
  console.log(`任务 ${task.id} 状态=${task.status}`)
  for (const l of logs.slice(0, 8).reverse()) console.log(`  [${l.level ?? ''}] ${String(l.message ?? '').slice(0, 140)}`)
  process.exit(0)
}

if (action === 'stop') {
  const task = await findTask()
  if (!task) { console.log('任务不存在'); process.exit(1) }
  const ctl = await api(`/api/admin/tasks/${task.id}/control`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) })
  console.log('stop:', ctl?.ok ? 'OK' : ctl?.message)
  process.exit(ctl?.ok ? 0 : 1)
}

console.log('用法: run-task-deqixs.ts [start|monitor|stop]')
process.exit(1)
