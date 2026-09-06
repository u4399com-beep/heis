// ss-a e2e 观察脚本(只读): 等待自动填充任务采入并对比 chaptersCreated 增长 → 用后即删
// 注意: Task.stats/progress 在 DB 是 JSON 字符串列, 需先 parse
export {}
const TASK_ID = process.argv[2] ?? ''
if (!TASK_ID) { console.log('usage: bun tmp/ss-a-observe.ts <taskId>'); process.exit(1) }
const BASE = 'http://127.0.0.1:3000'
function parse(v: unknown): any {
  if (typeof v === 'string') { try { return JSON.parse(v) } catch { return {} } }
  return v ?? {}
}
async function snap() {
  const j: any = await (await fetch(`${BASE}/api/admin/tasks/${TASK_ID}`)).json()
  const d = j?.data ?? {}
  const st = parse(d.stats)
  const pg = parse(d.progress)
  return {
    status: d.status, phase: pg.phase,
    booksCreated: st.booksCreated, chaptersCreated: st.chaptersCreated,
    chaptersUpdated: st.chaptersUpdated, errors: st.errors,
    contentDone: pg.contentDone, contentTotal: pg.contentTotal,
    currentBook: pg.currentBook,
  }
}
const a = await snap()
console.log('t=0s   ', JSON.stringify(a))
await new Promise((r) => setTimeout(r, 30000))
const b = await snap()
console.log('t=+30s ', JSON.stringify(b))
const grew = (b.chaptersCreated ?? 0) > (a.chaptersCreated ?? 0) || (b.contentDone ?? 0) > (a.contentDone ?? 0)
console.log(grew ? 'GROWTH=YES' : 'GROWTH=NO')
process.exit(grew ? 0 : 2)
