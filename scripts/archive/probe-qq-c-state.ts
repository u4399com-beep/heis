// qq-c 开工盘点: 番茄规则现状 + 任务列表状态(只读)
export {}
const BASE = 'http://localhost:3000'
const RULE_ID = 'cmtgi08kt0003qbu988jf36ch'

interface Env<T = any> { ok: boolean; data?: T; message?: string }

async function main(): Promise<void> {
  const r = await fetch(`${BASE}/api/admin/rules?take=100`).then((x) => x.json() as Promise<Env<any[]>>)
  const arr = Array.isArray(r?.data) ? r.data : []
  console.log(`rules total=${arr.length}`)
  const rule = arr.find((x) => x.id === RULE_ID)
  if (!rule) {
    console.log('TOMATO RULE NOT FOUND!')
  } else {
    console.log(`tomato rule: id=${rule.id} name=${rule.name} enabled=${rule.enabled} siteId=${rule.siteId}`)
    const cfg = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config
    console.log('--- six sections ---')
    for (const sec of ['list', 'book', 'toc', 'content', 'fetch', 'clean']) {
      console.log(`\n== ${sec} ==`)
      console.log(JSON.stringify(cfg[sec], null, 1).slice(0, 2600))
    }
  }
  // tasks
  const t = await fetch(`${BASE}/api/admin/tasks?take=100`).then((x) => x.json() as Promise<Env<any[]>>).catch(() => null)
  if (t?.ok) {
    const tasks = Array.isArray(t.data) ? t.data : []
    console.log(`\n=== tasks (${tasks.length}) ===`)
    for (const tk of tasks) {
      console.log(`- ${tk.id} name=${tk.name} status=${tk.status} autoRefresh=${tk.autoRefresh} interval=${tk.refreshIntervalMin} rule=${tk.ruleId} mode=${tk.mode} bookUrl=${String(tk.bookUrl).slice(0, 70)}`)
    }
  } else {
    console.log('tasks api fail:', t?.message)
  }
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
