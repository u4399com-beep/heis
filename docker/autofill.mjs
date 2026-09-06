// ============================================================
// docker/autofill.mjs — 自动填充引导脚本 (ss-a)
// ============================================================
// 定位: Docker 部署"装完即自动填充网站"的最后一公里 —— 由 docker-entrypoint.sh
// 在启动代理之后、exec server.js 之前后台拉起(`node /app/docker/autofill.mjs &`);
// 本脚本自己轮询等 server 健康, 不阻塞主服务启动; exec 后由 PID 1 接管。
//
// 纯 node(node:22-slim 内运行, 用内置 fetch, 零外部依赖)。
//
// 做什么(对每条选中的规则, 全程幂等):
//   ① 规则入库: GET /api/admin/rules 按名称精确匹配 → 缺失才 POST 创建
//      (绝不清空/覆盖用户已改过的同名规则);
//   ② 任务建跑: 任务名统一前缀「自动填充·」→ 同名任务已存在则跳过创建,
//      然后按状态机续跑: pending/paused/stopped/error → POST control start;
//      running/done → 跳过(running 在跑; done 已填充完毕, 容器重启由
//      runner recoverOnBoot 的 autoRefresh 重排兜底, 不重跑);
//   ③ 每步打印 [自动填充] 前缀中文日志(docker logs 可见)。
//
// 环境变量:
//   AUTO_FILL          =1 才执行(缺省/其他值直接退出; 由 compose 注入, 裸 docker run 不受影响)
//   AUTO_FILL_RULES    逗号分隔站点 key 清单(默认 fanqie,qimao,deqixs,80ge,jhssd,ttkan,bqg713;
//                      不含 pili —— 霹雳书屋依赖 scrapling 桥, 属 compose --profile stealthy 可选件)
//   DRY_RUN            =1 只打印意图不执行(排障与测试两用)
//   BASE_URL           服务地址(默认 http://127.0.0.1:3000; 测试可覆盖)
//   AUTOFILL_WAIT_SECONDS 等服务健康上限(默认 180)
// ============================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const TAG = '[自动填充]'
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
const WAIT_SECONDS = Number(process.env.AUTOFILL_WAIT_SECONDS || 180)
const POLL_INTERVAL_MS = 3000
const DEFAULT_RULES = 'fanqie,qimao,deqixs,80ge,jhssd,ttkan,bqg713'
// 与容器/entrypoint 约定一致: /app/docker/autofill.mjs → /app/docker/autofill-rules.json
const RULES_FILE = process.env.AUTOFILL_RULES_FILE || join(dirname(fileURLToPath(import.meta.url)), 'autofill-rules.json')

const DRY_RUN = process.env.DRY_RUN === '1'
const AUTO_FILL = process.env.AUTO_FILL === '1'

function log(msg) { console.log(`${TAG} ${msg}`) }
function warn(msg) { console.log(`${TAG} [警告] ${msg}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 统一 API 调用: 返回 { ok, status, data, message } 信封(网络异常也归一为 ok:false) */
async function api(path, init) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      signal: AbortSignal.timeout(30_000),
    })
    const body = await res.json().catch(() => ({}))
    return { status: res.status, ok: res.ok && body?.ok !== false, data: body?.data, message: body?.message }
  } catch (e) {
    return { status: 0, ok: false, message: e?.message || String(e) }
  }
}

/** 轮询等 server 健康: GET / 2xx 即视为就绪(首页=管理端 SPA) */
async function waitServerHealthy() {
  const deadline = Date.now() + WAIT_SECONDS * 1000
  let lastErr = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) return true
      lastErr = `HTTP ${res.status}`
    } catch (e) {
      lastErr = e?.message || String(e)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  warn(`等待服务健康超时(${WAIT_SECONDS}s, 最后状态: ${lastErr}) —— 放弃自动填充; 服务就绪后可手动在管理面板导入`)
  return false
}

async function main() {
  if (!AUTO_FILL) {
    // 门控: 静默退出(不打日志, 避免裸 docker run 场景的噪音)
    process.exit(0)
  }
  log(`引导启动 (DRY_RUN=${DRY_RUN ? 1 : 0}, 服务: ${BASE})`)

  // ① 等健康(容器内 server 尚未启动 —— entrypoint 是先拉起本脚本再 exec server.js)
  if (DRY_RUN) {
    log('DRY_RUN=1: 跳过健康等待, 仅校验清单与打印意图')
  } else {
    const healthy = await waitServerHealthy()
    if (!healthy) process.exit(0)
    log('服务健康检查通过, 开始自动填充')
  }

  // ② 读规则清单
  let entries
  try {
    entries = JSON.parse(readFileSync(RULES_FILE, 'utf8'))
  } catch (e) {
    warn(`规则清单读取失败(${RULES_FILE}): ${e?.message || e} —— 放弃自动填充`)
    process.exit(0)
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    warn('规则清单为空或格式非法(应为数组) —— 放弃自动填充')
    process.exit(0)
  }
  const byKey = new Map(entries.map((e) => [e?.key, e]))

  // ③ 按环境变量过滤站点
  const wanted = String(process.env.AUTO_FILL_RULES || DEFAULT_RULES)
    .split(',').map((s) => s.trim()).filter(Boolean)
  const unknown = wanted.filter((k) => !byKey.has(k))
  if (unknown.length) warn(`清单中不存在的站点 key 已忽略: ${unknown.join(',')} (可用: ${[...byKey.keys()].join(',')})`)
  const selected = wanted.filter((k) => byKey.has(k)).map((k) => byKey.get(k))
  if (!selected.length) {
    warn('没有可执行的站点(检查 AUTO_FILL_RULES 拼写) —— 放弃自动填充')
    process.exit(0)
  }
  log(`本次站点(${selected.length}): ${selected.map((e) => e.key).join(', ')}`)

  // ④ 规则列表快照(一次拉取, 循环内按名称匹配)
  let existingRules = []
  if (!DRY_RUN) {
    const rulesRes = await api('/api/admin/rules')
    if (!rulesRes.ok || !Array.isArray(rulesRes.data)) {
      warn(`规则列表获取失败: ${rulesRes.message || '信封异常'} —— 放弃自动填充`)
      process.exit(0)
    }
    existingRules = rulesRes.data
  }

  let okCount = 0
  for (const entry of selected) {
    const { key, rule, task } = entry
    try {
      // ── 规则: 按名称幂等(缺失才建, 绝不覆盖) ──
      let ruleId = existingRules.find((r) => r.name === rule.name)?.id
      if (ruleId) {
        log(`规则已存在, 跳过创建: ${rule.name} (${ruleId})`)
      } else if (DRY_RUN) {
        log(`[DRY_RUN] 将创建规则: ${rule.name}`)
        ruleId = '(dry-run)'
      } else {
        const created = await api('/api/admin/rules', {
          method: 'POST',
          body: JSON.stringify({ name: rule.name, description: rule.description, config: rule.config, enabled: rule.enabled !== false }),
        })
        if (!created.ok || !created.data?.id) {
          warn(`规则创建失败: ${rule.name} — ${created.message || JSON.stringify(created).slice(0, 200)}`)
          continue
        }
        ruleId = created.data.id
        log(`规则已创建: ${rule.name} (${ruleId})`)
      }

      // ── 任务: 同名幂等 + 状态机续跑 ──
      const taskName = task.name
      let existingTask = null
      if (!DRY_RUN) {
        const tasksRes = await api('/api/admin/tasks')
        const tasks = Array.isArray(tasksRes?.data) ? tasksRes.data : []
        existingTask = tasks.find((t) => t.name === taskName) || null
      }
      if (DRY_RUN) {
        log(`[DRY_RUN] 将确保任务存在并按状态机启动: ${taskName} (规则 ${key})`)
        okCount++
        continue
      }
      if (!existingTask) {
        const payload = {
          name: taskName,
          ruleId,
          mode: task.mode || 'single',
          bookUrl: task.bookUrl || '',
          listUrl: task.listUrl || '',
          recrawlMode: task.recrawlMode || 'incremental',
          storageMode: task.storageMode || 'db',
          threadMin: task.threadMin ?? 2,
          threadMax: task.threadMax ?? 2,
          intervalMin: task.intervalMin ?? 300,
          intervalMax: task.intervalMax ?? 600,
          smartCategory: task.smartCategory !== undefined ? task.smartCategory : false,
          smartComplete: task.smartComplete !== undefined ? task.smartComplete : false,
          autoSuggest: task.autoSuggest !== undefined ? task.autoSuggest : false,
          autoRefresh: task.autoRefresh !== undefined ? task.autoRefresh : true,
          refreshIntervalMin: task.refreshIntervalMin ?? 30,
        }
        const createdTask = await api('/api/admin/tasks', { method: 'POST', body: JSON.stringify(payload) })
        if (!createdTask.ok || !createdTask.data?.id) {
          warn(`任务创建失败: ${taskName} — ${createdTask.message || JSON.stringify(createdTask).slice(0, 200)}`)
          continue
        }
        existingTask = createdTask.data
        log(`任务已创建: ${taskName} (${existingTask.id})`)
      } else {
        log(`任务已存在, 跳过创建: ${taskName} (${existingTask.id})`)
      }

      // ── 状态机: pending/paused/stopped/error → start; running/done → 跳过 ──
      const status = String(existingTask.status || 'pending')
      if (status === 'running') {
        log(`任务运行中, 无需操作: ${taskName}`)
        okCount++
        continue
      }
      if (status === 'done') {
        log(`任务已完成(数据已填充, 重启由 autoRefresh 兜底), 跳过: ${taskName}`)
        okCount++
        continue
      }
      if (!['pending', 'paused', 'stopped', 'error'].includes(status)) {
        warn(`未知任务状态 '${status}', 跳过: ${taskName}`)
        continue
      }
      const ctl = await api(`/api/admin/tasks/${existingTask.id}/control`, {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      })
      if (ctl.ok) {
        log(`任务已启动(原状态 ${status} → 采集中): ${taskName}`)
        okCount++
      } else {
        warn(`任务启动失败(${status}): ${taskName} — ${ctl.message || '未知错误'}`)
      }
      await sleep(500) // 轻微错峰, 避免多任务同瞬起跑
    } catch (e) {
      warn(`站点 ${key} 处理异常: ${e?.message || e}`)
    }
  }

  log(`自动填充引导结束: 成功 ${okCount}/${selected.length} 条; 明细见上方日志, 采集进度看管理面板「任务」页`)
  process.exit(0)
}

main().catch((e) => {
  warn(`引导脚本异常退出: ${e?.message || e}`)
  process.exit(0) // 引导失败绝不影响主服务(docker logs 中已留中文日志)
})
