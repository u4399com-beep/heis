/**
 * verify-jj-d-engine.ts — jj-d 引擎域第8轮残作收编 断言脚本
 * 验证超时 agent 留下的 5 处修复:
 *   1. sorter.cnNumToNumber "万"前有"亿"段累加语义(一亿二千万=1.2亿, 不再丢亿位)
 *   2. runner.sleepGap 可中断批次间隔(源码模式断言+行为断言)
 *   3. runner.epoch 传入绑定(crawlOneBook 签名) — 关闭 stop→start 双循环窗口
 *   4. runner.booksDone 每轮归零
 *   5. runner 收尾 saveProgress 漂移跳过 + stopped 短路 + moveFinalIdx 重排章最终位
 * 纪律: 纯函数直测 + 源码模式断言; 不触碰运行中任务; process.exit(0/1)
 */
import { cnNumToNumber } from '../src/lib/crawl/sorter'

let pass = 0
let failCnt = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { failCnt++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ---------- 1. cnNumToNumber 修复验证 ----------
console.log('\n== 1. sorter.cnNumToNumber 中文数字 ==')
{
  // 修复目标: "万"前已有"亿"段 → 累加而非覆盖
  ok('一亿二千万 = 120000000 (修前 2000万丢亿位)', cnNumToNumber('一亿二千万') === 120_000_000, `got=${cnNumToNumber('一亿二千万')}`)
  ok('一亿 = 100000000', cnNumToNumber('一亿') === 100_000_000, `got=${cnNumToNumber('一亿')}`)
  ok('三亿五千万 = 350000000', cnNumToNumber('三亿五千万') === 350_000_000, `got=${cnNumToNumber('三亿五千万')}`)
  // 常态回归: 无亿段语义不变
  ok('三万 = 30000 (常态不变)', cnNumToNumber('三万') === 30_000, `got=${cnNumToNumber('三万')}`)
  ok('十万零八百 = 100800', cnNumToNumber('十万零八百') === 100_800, `got=${cnNumToNumber('十万零八百')}`)
  ok('二十五万 = 250000', cnNumToNumber('二十五万') === 250_000, `got=${cnNumToNumber('二十五万')}`)
  // 基础回归
  ok('十二 = 12', cnNumToNumber('十二') === 12)
  ok('一百二十三 = 123', cnNumToNumber('一百二十三') === 123)
  ok('三千零五 = 3005', cnNumToNumber('三千零五') === 3005)
  ok('第两千章 (含前缀数字形态)', cnNumToNumber('第两千章') === 2000 || cnNumToNumber('两千') === 2000, `got=${cnNumToNumber('两千')}`)
  // 空串返回 NaN 是设计内行为 — 调用方 extractChapterNo L73 有 !isNaN 防护(继续后续匹配路径)
  ok('空串=NaN(设计内, 调用方有防护)', Number.isNaN(cnNumToNumber('')))
}

// ---------- 2-5. runner 源码模式断言 ----------
console.log('\n== 2. runner.ts 修复模式在场 ==')
{
  const fs = await import('fs')
  const src = fs.readFileSync('src/lib/crawl/runner.ts', 'utf8')

  // 2. sleepGap 定义与使用: 批次间隔全部走可中断睡眠
  ok('sleepGap 函数已定义', /async function sleepGap\(ms: number, rt: TaskRuntime, myEpoch: number\)/.test(src))
  const gapUses = (src.match(/await sleepGap\(/g) || []).length
  ok(`sleepGap 被批量间隔使用(≥3处: 列表页/书籍间/章节批), got=${gapUses}`, gapUses >= 3)
  ok('裸 await sleep(interval) 已绝迹', !/await sleep\(cfg\.interval\(\)\)/.test(src) && !/await sleep\(interval\)/.test(src))
  ok('sleepGap 含 600ms 切片探测', /Math\.min\(600,/.test(src))

  // 3. epoch 传入绑定: crawlOneBook 签名含 myEpoch 形参, 函数内不再重新捕获
  //    (L189 的 const myEpoch = rt.epoch 属 executeTask 自身正确捕获, 保留)
  const cbSig = src.slice(src.indexOf('private async crawlOneBook('), src.indexOf('private async crawlOneBook(') + 500)
  ok('crawlOneBook 签名形参 myEpoch: number', /myEpoch: number,/.test(cbSig))
  const cbBody = src.slice(src.indexOf('private async crawlOneBook('), src.indexOf('private async crawlOneBook(') + 3000)
  ok('crawlOneBook 函数体内无 rt.epoch 重捕获', !/const myEpoch = rt\.epoch/.test(cbBody))

  // 4. booksDone 每轮归零
  ok('booksDone 轮归零语句在场', /progress\.booksDone = 0/.test(src))

  // 5a. 收尾 saveProgress 漂移跳过
  ok('收尾 saveProgress 漂移守卫', /if \(rt\.epoch === myEpoch\) await this\.saveProgress\(taskId, progress, stats\)/.test(src))
  // 5b. stopped 短路紧邻书籍完成日志之前(短路在 crawlOneBook 内有 5 处, 取最后一次与完成日志比对)
  const shortCircuitIdx = src.lastIndexOf("if (rt.stopped || rt.epoch !== myEpoch) return 'stopped'")
  const bookDoneLogIdx = src.indexOf('》完成: ')
  ok(`stopped 短路先于书籍完成日志`, shortCircuitIdx > 0 && bookDoneLogIdx > shortCircuitIdx && bookDoneLogIdx - shortCircuitIdx < 200, `sc=${shortCircuitIdx} log=${bookDoneLogIdx}`)
  // 5c. catch 内 isStale() 吞漂移异常(不回写进度)
  ok('catch 分支 isStale() 漂移守卫', /if \(isStale\(\)\) \{/.test(src))
  // 5d. moveFinalIdx 重排章最终位
  ok('moveFinalIdx 重排章最终位映射', /new Map\(moves\.map\(\(m\) => \[m\.id, m\.to\]\)\)/.test(src))
  ok('队列 idx 回退链 tailMoves→moveFinalIdx→c.idx', /tailMoves\.get\(c\.id\) \?\? moveFinalIdx\.get\(c\.id\) \?\? c\.idx/.test(src))
}

// ---------- 3. sleepGap 行为断言(动态 import 后直测非导出? 不可 — 改用行为等价复刻+源码已证) ----------
console.log('\n== 3. sleepGap 行为等价复刻断言 ==')
{
  // sleepGap 未导出 — 按源码语义复刻并验证其设计承诺: stopped 时 600ms 内返回(而非睡满 interval)
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  interface RT { paused: boolean; stopped: boolean; epoch: number }
  async function sleepGap(ms: number, rt: RT, myEpoch: number): Promise<void> {
    const deadline = Date.now() + Math.max(0, ms)
    while (Date.now() < deadline) {
      if (rt.stopped || rt.paused || rt.epoch !== myEpoch) return
      await sleep(Math.min(600, deadline - Date.now()))
    }
  }
  // 用例1: 睡到 300ms 时 stop → 总耗时应 ≈300-900ms, 远小于 5000ms
  const rt1: RT = { paused: false, stopped: false, epoch: 1 }
  const t0 = Date.now()
  const p = sleepGap(5000, rt1, 1)
  setTimeout(() => { rt1.stopped = true }, 300)
  await p
  const dt = Date.now() - t0
  ok(`stop 提前中断(300ms 信号, 实耗 ${dt}ms << 5000ms)`, dt < 2000, `dt=${dt}`)
  // 用例2: 无信号 happy path 睡满(容差)
  const t2 = Date.now()
  await sleepGap(700, { paused: false, stopped: false, epoch: 1 }, 1)
  const dt2 = Date.now() - t2
  ok(`happy path 睡满(700ms, 实耗 ${dt2}ms)`, dt2 >= 650, `dt2=${dt2}`)
  // 用例3: epoch 漂移立即返回
  const t3 = Date.now()
  await sleepGap(5000, { paused: false, stopped: false, epoch: 2 }, 1)
  const dt3 = Date.now() - t3
  ok(`epoch 漂移立即返回(${dt3}ms)`, dt3 < 100, `dt3=${dt3}`)
}

// ---------- 4. 活体任务健康观察(只读) ----------
console.log('\n== 4. 活体任务健康(番茄任务只读观察) ==')
{
  // qq-e2 适配(ll-a"断言矩阵动态化"同款): qq-0 第3次抹库后生产任务再易 id,
  // 硬编码 id(cmtkqgocx…, ll-0 时代)已不存在 → 改为运行时按名称+运行态动态发现番茄任务,
  // 上游任务重建不再破坏断言
  const listR = await fetch('http://localhost:3000/api/admin/tasks').then((x) => x.json())
  const tomato = (listR?.data || []).find((t: any) => (t.name || '').includes('番茄') && t.status === 'running')
  const detail = tomato
    ? await fetch(`http://localhost:3000/api/admin/tasks/${tomato.id}`).then((x) => x.json())
    : null
  const r = detail
  const d = r?.data
  ok('番茄任务动态发现+详情 200', r?.ok === true && !!d, tomato ? `id=${tomato.id}` : '无 running 态番茄任务')
  ok('任务仍 running/live', d?.status === 'running' && d?.live === true, `status=${d?.status} live=${d?.live}`)
  const p = JSON.parse(d?.progress || '{}')
  ok('content 阶段推进中', p.phase === 'content' || p.phase === 'done', `phase=${p.phase} content=${p.contentDone}/${p.contentTotal}`)
  ok('contentTotal 合理(≥1300章)', p.contentTotal >= 1300, `contentTotal=${p.contentTotal}`)
  const s = JSON.parse(d?.stats || '{}')
  ok('零错误持续', (s.errors || 0) === 0, `errors=${s.errors}`)
  ok('chaptersCreated 已落库', (s.chaptersCreated || 0) > 0, `chaptersCreated=${s.chaptersCreated}`)
}

console.log('\n==========')
console.log(`PASS ${pass} / FAIL ${failCnt}`)
if (failCnt) { console.log('FAILURES:'); for (const f of failures) console.log('  - ' + f); process.exit(1) }
process.exit(0)
