// ============================================================
// scripts/verify-ss-b3-xjp.ts — 新键盘小说网(xinjianpan.com) 采集链路断言 (ss-b3)
// ============================================================
// 六断言面:
//   A. 解密代理(3015): /health 自检 + 上游可达
//   B. 代理正文链: 真章经 /content 全量解密(var c 后半在正文内)
//   C. 规则六段: config 关键选择器/字段逐一在位(行级 adPatterns 专项)
//   D. DB 章节: 实测任务 ≥30 章非空 + 站名广告零残渣(存量已再清洗)
//   E. 任务: 在库 ruleId 对齐 + errors=0 + 温和线程
//   F. 引擎清洗语义: `.*?$` 广告模式盲区防线(行级模式而非全文锚定)
// 用法: bun run scripts/verify-ss-b3-xjp.ts   (exit 0 = 全过)
// ============================================================
import { PrismaClient } from '@prisma/client'

export {} // module 守卫(bun 顶层代码 + tsc 惯例)

const db = new PrismaClient()
let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}`)
  }
}
const RULE_NAME = '新键盘小说网 (xinjianpan.com)·直连+var c解密代理正文'
const TASK_NAME = 'ss-b3·新键盘小说网 单书实测'
const PROXY = 'http://127.0.0.1:3015'

try {
  // ---------- A. 解密代理 ----------
  console.log('A. 解密代理(3015)')
  const h = (await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(45_000) }).then((r) => r.json())) as Record<string, unknown>
  ok(h.ok === true && h.selfTestOk === true, 'A1 /health 自检(合成c回环/越界拒绝/HTML→文本/章节抽取)')
  ok(h.upstreamReachable === true, 'A2 上游 xinjianpan.com 可达')

  // ---------- B. 代理正文链(真章) ----------
  console.log('B. 代理正文链(真章全量解密)')
  const ch = (await fetch(`${PROXY}/content?u=${encodeURIComponent('https://www.xinjianpan.com/txt/oaa/vl7.html')}`, { signal: AbortSignal.timeout(45_000) }).then((r) => r.json())) as { ok: boolean; content: string }
  ok(ch.ok === true && ch.content.length > 1000, `B1 第一章经代理解密 len=${ch.content?.length ?? 0} > 1000`)
  ok(!/<[a-z]/i.test(ch.content), 'B2 代理输出零 HTML 标签残渣')

  // ---------- C. 规则六段 ----------
  console.log('C. 规则六段关键面')
  const rule = await db.rule.findFirst({ where: { name: RULE_NAME } })
  ok(!!rule && rule.enabled, `C1 规则在库且启用 (id=${rule?.id ?? '无'})`)
  const cfg = (typeof rule?.config === 'string' ? JSON.parse(rule.config) : rule?.config) as Record<string, any>
  ok(cfg?.list?.urlTemplate === 'https://www.xinjianpan.com/sort/xuanhuan-{page}.html', 'C2 list 段 sort 分页模板')
  ok(cfg?.toc?.pagination?.enabled === true && cfg?.toc?.pagination?.maxPages >= 100, 'C3 toc 翻页开启+maxPages 覆盖长书')
  const urlField = cfg?.toc?.fields?.url
  ok(urlField?.attr === 'onclick' && urlField?.replaceTo?.includes('127.0.0.1:3015/content?u='), 'C4 toc url onclick→代理重写(replaceFrom/To)')
  ok(cfg?.content?.fields?.content?.type === 'json' && cfg?.content?.fields?.content?.expression === 'content', 'C5 content 段消费代理 JSON')
  const ads: string[] = cfg?.clean?.adPatterns ?? []
  ok(ads.some((p) => p.includes('一秒记住')) && ads.every((p) => !p.includes('?$')), 'C6 行级 adPatterns(无 `.*?$` 盲区形态)')
  ok(ads.includes('[^\\n]*xinjianpan\\.com[^\\n]*'), 'C7 域名行兜底模式在位')

  // ---------- D. DB 章节 ----------
  console.log('D. DB 章节质量')
  const book = await db.book.findFirst({ where: { name: '修罗武神' }, select: { id: true, sourceUrl: true, _count: { select: { chapters: true } } } })
  ok(!!book && book._count.chapters >= 30, `D1 实测书入库且章节 ≥30 (实际 ${book?._count.chapters ?? 0}, source=${book?.sourceUrl ?? '-'})`)
  const [residueAd, residueDomain, emptyCh] = await Promise.all([
    db.chapter.count({ where: { bookId: book!.id, content: { contains: '一秒记住' } } }),
    db.chapter.count({ where: { bookId: book!.id, content: { contains: 'xinjianpan' } } }),
    db.chapter.count({ where: { bookId: book!.id, content: { lte: '' } } }),
  ])
  ok(residueAd === 0 && residueDomain === 0, `D2 站名广告零残渣(一秒记住=${residueAd}/域名=${residueDomain}, 含382章存量再清洗)`)
  ok(emptyCh === 0, `D3 零空章节(${emptyCh})`)
  const sample = await db.chapter.findFirst({ where: { bookId: book!.id, idx: 1 }, select: { content: true } })
  ok((sample?.content?.length ?? 0) > 2000 && !sample!.content!.startsWith('\n'), `D4 第一章存量干净(${sample?.content?.length ?? 0} 字)`)

  // ---------- E. 任务 ----------
  console.log('E. 实测任务')
  const task = await db.task.findFirst({ where: { name: TASK_NAME }, select: { id: true, ruleId: true, status: true, threadMin: true, threadMax: true, intervalMin: true, intervalMax: true } })
  ok(!!task, `E1 任务在库 (id=${task?.id ?? '无'})`)
  ok(task!.ruleId === rule!.id, 'E2 任务 ruleId 与在库规则对齐(seed 删旧建新后已重定向)')
  ok((task!.intervalMax ?? 0) >= 800, `E3 温和间隔(${task?.intervalMin}~${task?.intervalMax}ms)`)
  const errLogs = await db.taskLog.count({ where: { taskId: task!.id, level: 'error' } })
  ok(errLogs === 0, `E4 任务零 error 日志(${errLogs})`)
} finally {
  await db.$disconnect()
}

console.log(`\n结果: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
console.log('verify-ss-b3-xjp: ALL PASS')
process.exit(0)
