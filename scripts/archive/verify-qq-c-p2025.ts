/** qq-c: P2025 修复语义验证 — update 撞已删行可 catch, create 兜底重建, 内容不丢 */
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
let pass = 0, fail = 0
function ok(name: string, cond: boolean) { if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}`) } }

const bk = await db.book.create({ data: { name: 'P2025语义验证书', author: 't', sourceUrl: 'mock://p2025', sourceRuleId: 'mock', categoryId: (await db.category.findFirst())?.id ?? '' } }).catch(() => null)
if (!bk) { console.log('SKIP: 无分类可挂'); process.exit(1) }
const ch = await db.chapter.create({ data: { bookId: bk.id, idx: 0, title: '第一章', url: 'mock://1', volume: '', storage: 'db', fetched: false } })

// 场景: 章节行在任务运行中被删(删书/清空章节) → runner 的 update 必须可 catch 不炸
await db.chapter.delete({ where: { id: ch.id } })
const updated = await db.chapter.update({ where: { id: ch.id }, data: { content: 'x', fetched: true } }).then(() => true).catch((e: any) => { ok('update 撞已删行可 catch(不抛 P2025)', e?.code === 'P2025'); return false })
ok('update 返回 false', updated === false)

// create 兜底重建
const recreated = await db.chapter.create({ data: { bookId: bk.id, idx: 0, title: '第一章', url: 'mock://1', volume: '', content: '正文内容', storage: 'db', wordCount: 4, fetched: true } }).catch(() => null)
ok('create 兜底重建成功', !!recreated)
ok('重建后内容在库', (await db.chapter.findFirst({ where: { bookId: bk.id } }))?.content === '正文内容')

// 场景2: 正常路径 update 不受影响
const u2 = await db.chapter.update({ where: { id: recreated!.id }, data: { content: '正文2' } }).then(() => true).catch(() => false)
ok('正常 update 不受影响', u2 === true)

await db.chapter.deleteMany({ where: { bookId: bk.id } })
await db.book.delete({ where: { id: bk.id } })
console.log(`\nverify-qq-c-p2025: ${pass} pass / ${fail} fail ${fail === 0 ? '— ALL PASS' : '— FAIL'}`)
process.exit(fail === 0 ? 0 : 1)
