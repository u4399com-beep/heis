// ============================================================
// Task dd-b 任务B验证脚本 — runner.saveProgress P2025 噪音修复实证
// bb-g 存档竞态: 任务被删除后 stop 收尾的 saveProgress 对已删任务 update 抛 P2025,
// 被 .catch 吞掉但 prisma log:['error'] 层已打出 "prisma:error …P2025"(dev.log 常态污染)。
// 修复: saveProgress catch 内 P2025 静默跳过(预期终态), 其余异常自有 warn。
// 本脚本:
//   ① 基线(修前失败证据): 裸 db.task.update 对不存在 id 仍产生 prisma:error 捕获
//      (同时证明本脚本的 prisma error 捕获机制有效)
//   ② 修后: 建 Task → saveProgress(成功, 零 prisma error) → 删 Task →
//      saveProgress(修前必产生 P2025 error 日志, 修后零新增 prisma error)
//   ③ DB 残余核对: 测试任务已删(残余=0), 任务总数与开工一致
// 纪律: 本脚本必须创建一条真实 Task 模拟"先删后存", 用后立删并核对残余=0
// 运行: bun scripts/verify-dd-b-p2025.ts (独立 bun 进程, 不依赖 dev server)
// ============================================================
export {}

const captured: string[] = []
// 捕获 prisma error 级输出: P7 实测 log:['error'] 的 "prisma:error" 经【console.log】落
// stdout→dev.log(探针实证, 非 console.error/stderr), 故四通道全拦
const origCe = console.error.bind(console)
const origCl = console.log.bind(console)
const origCw = console.warn.bind(console)
const captureIfPrisma = (s: string) => {
  // 精确匹配 prisma 错误信封(多行整体以 "prisma:error" 开头, 含调用点码框),
  // 避免本脚本自身打印的断言文案(含 prisma/P2025 字样)造成误捕
  if (s.startsWith('prisma:error') || s.includes('Invalid `prisma') || s.includes('Invalid `db.')) captured.push(s.slice(0, 800))
}
console.error = (...args: unknown[]) => {
  captureIfPrisma(args.map((a) => String((a as Error)?.message ?? a)).join(' '))
  origCe(...args)
}
console.log = (...args: unknown[]) => {
  captureIfPrisma(args.map((a) => String((a as Error)?.message ?? a)).join(' '))
  origCl(...args)
}
console.warn = (...args: unknown[]) => {
  captureIfPrisma(args.map((a) => String((a as Error)?.message ?? a)).join(' '))
  origCw(...args)
}
const origOut = process.stdout.write.bind(process.stdout)
const origErrW = process.stderr.write.bind(process.stderr)
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  captureIfPrisma(typeof chunk === 'string' ? chunk : String(chunk ?? ''))
  return origOut(chunk as never, ...(rest as never[]))
}) as typeof process.stdout.write
process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
  captureIfPrisma(typeof chunk === 'string' ? chunk : String(chunk ?? ''))
  return origErrW(chunk as never, ...(rest as never[]))
}) as typeof process.stderr.write

const { db } = await import('../src/lib/db')
const { TaskRunner } = await import('../src/lib/crawl/runner')

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}

const TASK_NAME = 'dd-b-p2025-noise-test'

async function main() {
  const totalAtStart = await db.task.count()
  const rule = await db.rule.findFirst({ select: { id: true } })
  if (!rule) throw new Error('库内无规则, 无法建立测试任务(FK 依赖)')

  // ---------- ① 基线: 裸 update 不存在 id → prisma:error 必现(修前失败证据+捕获机制自证) ----------
  console.log('\n== ① 基线: 裸 db.task.update 对不存在 id(旧噪音形态) ==')
  const before = captured.length
  await db.task.update({ where: { id: 'dd-b-no-such-task' }, data: { status: 'error' } }).catch(() => {})
  await new Promise((r) => setTimeout(r, 300))
  ok('①a 旧路径产生 prisma error 级输出(P2025 噪音存在, 修前失败证据)', captured.length > before, `captured+${captured.length - before} (信封以 prisma 标记开头, 码框指向本脚本 L71 裸 update 调用点)`)
  ok('①b 噪音为 P2025(记录不存在, 信封含其正文特征)', /No record was found for an update|P2025/.test(captured.slice(before).join('\n')))
  const afterBaseline = captured.length

  // ---------- ② 修复路径: TaskRunner.saveProgress(经私有方法直调, 运行时可达) ----------
  console.log('\n== ② 修复路径: saveProgress 先存(成功)→删任务→再存(P2025 静默) ==')
  const runner = TaskRunner.instance as unknown as { saveProgress: (id: string, p: unknown, s: unknown) => Promise<void> }
  const progress = { phase: 'content', discovered: 1, booksDone: 0, booksTotal: 1, tocTotal: 0, contentDone: 0, contentTotal: 0 }
  const stats = { booksCreated: 0, booksUpdated: 0, chaptersCreated: 0, chaptersUpdated: 0, coversSaved: 0, errors: 0, suggestWords: 0 }
  const task = await db.task.create({ data: { name: TASK_NAME, ruleId: rule.id } })
  ok('②a 测试任务已创建(用后立删)', !!task.id, task.id)
  await runner.saveProgress(task.id, progress, stats)
  await new Promise((r) => setTimeout(r, 300))
  ok('②b 存活任务 saveProgress 正常落库且零 prisma error', captured.length === afterBaseline && (await db.task.findUnique({ where: { id: task.id }, select: { progress: true } }))?.progress === JSON.stringify(progress))

  await db.task.delete({ where: { id: task.id } })
  const afterDel = captured.length
  await runner.saveProgress(task.id, progress, stats) // 修前: 此处必产生 prisma:error P2025
  await new Promise((r) => setTimeout(r, 300))
  ok('②c 已删任务 saveProgress 零新增 prisma error 级输出(核心断言)', captured.length === afterDel, `captured ${afterDel}→${captured.length}`)

  // ---------- ③ DB 残余核对 ----------
  console.log('\n== ③ DB 残余核对 ==')
  const residual = await db.task.count({ where: { name: TASK_NAME } })
  const totalAtEnd = await db.task.count()
  ok('③a 测试任务残余=0', residual === 0)
  ok('③b 任务总数与开工一致', totalAtEnd === totalAtStart, `${totalAtStart}→${totalAtEnd}`)

  console.log(`\n========================================`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e: unknown) => {
  origCe('verify-dd-b-p2025 脚本异常:', (e as Error)?.message || e)
  process.exit(1)
})