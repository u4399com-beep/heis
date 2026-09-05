/**
 * verify-jj-e-autorefresh.ts — jj-e 任务自动刷新功能 端到端断言
 * 链路: 探针任务(非法bookUrl, autoRefresh=true) → start → 快速 error →
 *       断言"⟳ 已排定自动刷新"日志 → 等待 interval 触发 → 断言"⟳ 自动刷新触发"+
 *       任务重新 running → stop → 断言"自动刷新已取消" → DELETE 清理
 * 纪律: 不触碰生产番茄任务(动态发现)的 control(只读观察);
 *       探针任务用完即删; process.exit(0/1)
 */
const BASE = process.env.VERIFY_BASE || 'http://localhost:3000'
// ll轮: 番茄任务数据事故后重建, 改为动态发现(名称含"番茄"); autoRefresh 期望不变
let TOMATO = ''

let pass = 0
let failCnt = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { failCnt++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
async function req(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, init)
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* noop */ }
  return { status: res.status, json, text }
}
const post = (p: string, b: unknown) => req(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('\n== 0. 前置: 番茄任务 autoRefresh 配置(只读) ==')
  {
    const listR = await req('/api/admin/tasks')
    const found = (listR.json?.data || []).find((t: any) => /番茄/.test(t?.name || ''))
    if (!found) { ok('动态发现番茄任务', false, '列表无番茄任务'); process.exit(1) }
    TOMATO = found.id
    ok('动态发现番茄任务', true, TOMATO)
    const r = await req(`/api/admin/tasks/${TOMATO}`)
    const d = r.json?.data
    ok('番茄任务存在', r.json?.ok === true && !!d)
    ok('autoRefresh=true(生产实时更新已开)', d?.autoRefresh === true, `got=${d?.autoRefresh}`)
    ok('refreshIntervalMin=15', d?.refreshIntervalMin === 15, `got=${d?.refreshIntervalMin}`)
    const running = d?.status === 'running' || d?.live === true
    console.log(`  (番茄任务当前: ${d?.status} live=${d?.live})`)
    if (!running) { console.log('  ⚠ 番茄任务未在运行 — 不影响本验证, 但生产实时更新依赖任务启动'); }
  }

  console.log('\n== 1. 钳制与白名单 ==')
  {
    // 非法值建任务: autoRefresh 非布尔/间隔超界 → 钳制而非拒绝(与既有 clamp 语义一致)
    const r = await post('/api/admin/tasks', {
      name: 'jj-e-探针任务-即删', ruleId: TOMATO_RULE(), mode: 'single',
      bookUrl: 'https://invalid.jjeprobe.example/book/404',
      autoRefresh: true, refreshIntervalMin: 2,
    })
    ok('探针任务创建成功', r.json?.ok === true, JSON.stringify(r.json).slice(0, 120))
    ok('interval 2 → 钳到 5', r.json?.data?.refreshIntervalMin === 5, `got=${r.json?.data?.refreshIntervalMin}`)
    const probeId = r.json?.data?.id as string

    // PUT 超界 → 钳到 1440
    const r2 = await req(`/api/admin/tasks/${probeId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshIntervalMin: 99999 }) })
    ok('interval 99999 → 钳到 1440', r2.json?.data?.refreshIntervalMin === 1440, `got=${r2.json?.data?.refreshIntervalMin}`)
    // 恢复 5(1 分钟太快无日志窗口, 但功能链一致; 用最小 5)
    await req(`/api/admin/tasks/${probeId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshIntervalMin: 5 }) })

    console.log('\n== 2. error 终态 → 自动排定(timer 路径真实触发) ==')
    const s = await post(`/api/admin/tasks/${probeId}/control`, { action: 'start' })
    ok('探针任务 start 成功', s.json?.ok === true)
    // 等待 error(非法域名 fetch 失败, 一般 2~30s)
    let final = ''
    for (let i = 0; i < 40; i++) {
      await sleep(1500)
      const t = await req(`/api/admin/tasks/${probeId}`)
      final = t.json?.data?.status || ''
      if (['error', 'done', 'stopped'].includes(final)) break
    }
    ok('探针任务进入终态', ['error', 'done'].includes(final), `status=${final}`)
    // 日志断言: 排定
    const logs = await req(`/api/admin/tasks/${probeId}/logs`)
    const msgs: string[] = (logs.json?.data || []).map((x: any) => String(x.message))
    ok('日志含"已排定自动刷新"', msgs.some((m) => m.includes('已排定自动刷新')), msgs.slice(-6).join(' | ').slice(0, 200))
    ok('排定间隔文案=5 分钟', msgs.some((m) => /已排定自动刷新: 5 分钟/.test(m)))
    ok('日志含"任务崩溃"(error 路径)', msgs.some((m) => m.includes('任务崩溃') || m.includes('任务完成')))

    // 等 timer 真触发(5 分钟 + 余量) — 端到端最重断言
    console.log('  (等待 5 分钟自动刷新真实触发...)')
    let triggered = false
    let restarted = false
    for (let i = 0; i < 46; i++) {
      await sleep(7000) // 7s × 46 ≈ 5m22s
      const t = await req(`/api/admin/tasks/${probeId}`)
      const st = t.json?.data?.status || ''
      const lg = await req(`/api/admin/tasks/${probeId}/logs`)
      const ms2: string[] = (lg.json?.data || []).map((x: any) => String(x.message))
      if (ms2.some((m) => m.includes('自动刷新触发'))) { triggered = true }
      // ll轮甄别: running 态在非法域名瞬时失败时短于 7s 轮询窗口, 用稳定判据 =
      // 触发后 runner 写入第二轮「▶ 任务启动」日志(首轮启动+触发重启各一条)
      const startCount = ms2.filter((m) => m.includes('▶ 任务启动')).length
      if (st === 'running' || startCount >= 2) { restarted = true }
      if (triggered && (st === 'running' || ['error', 'done'].includes(st))) {
        // 触发后新一轮已 start(error 会再次快速终态, 也算成功——状态机走通)
        break
      }
    }
    ok('timer 真实触发("自动刷新触发"日志在场)', triggered)
    ok('触发后任务被自动重启(status 机走通)', restarted)
    // 触发后应再次排定(第二轮 error 需 10~20s, 先等再断言 — 自动刷新循环闭环)
    await sleep(25000)
    const lg2 = await req(`/api/admin/tasks/${probeId}/logs`)
    const ms3: string[] = (lg2.json?.data || []).map((x: any) => String(x.message))
    ok('二次排定(自动刷新循环闭环)', ms3.filter((m) => m.includes('已排定自动刷新')).length >= 2, `count=${ms3.filter((m) => m.includes('已排定自动刷新')).length} tail=${ms3.slice(-4).join(' | ').slice(0, 200)}`)

    console.log('\n== 3. stop 取消 + DELETE 清理 ==')
    const st2 = await post(`/api/admin/tasks/${probeId}/control`, { action: 'stop' })
    ok('stop 成功', st2.json?.ok === true)
    const lg3 = await req(`/api/admin/tasks/${probeId}/logs`)
    const ms4: string[] = (lg3.json?.data || []).map((x: any) => String(x.message))
    ok('日志含"自动刷新已取消"', ms4.some((m) => m.includes('自动刷新已取消')))
    const del = await req(`/api/admin/tasks/${probeId}`, { method: 'DELETE' })
    ok('DELETE 探针任务成功', del.json?.ok === true)
    const gone = await req(`/api/admin/tasks/${probeId}`)
    ok('探针任务已不存在', gone.json?.ok === false || gone.status === 404)
  }

  console.log('\n==========')
  console.log(`PASS ${pass} / FAIL ${failCnt}`)
  if (failCnt) { console.log('FAILURES:'); for (const f of failures) console.log('  - ' + f); process.exit(1) }
  process.exit(0)
}

function TOMATO_RULE(): string {
  return 'cmtgi08kt0003qbu988jf36ch' // 番茄规则 id(探针用非法 bookUrl, 规则本身合法)
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(1) })
export {}
