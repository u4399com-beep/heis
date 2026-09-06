import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const chs = await db.chapter.findMany({ where: { bookId: 'cmtleieaf026oqjh4y2r4tk8w', fetched: true }, select: { idx: true, content: true, wordCount: true }, take: 60 })
let junk = 0, checked = 0, minW = 1e9, maxW = 0, emptyC = 0
const pats = [/请记住本站/, /本站所收录/, /最快更新/, /pilishuwu/, /霹雳书屋/, /\uFFFD/]
for (const c of chs) {
  checked++
  if (!c.content) { emptyC++; continue }
  for (const p of pats) if (p.test(c.content)) { junk++; console.log('JUNK hit idx', c.idx, p); break }
  minW = Math.min(minW, c.wordCount); maxW = Math.max(maxW, c.wordCount)
}
console.log(JSON.stringify({ checked, emptyC, junk, minW, maxW }))
// check a tail chapter too (idx 170+)
const tail = await db.chapter.findMany({ where: { bookId: 'cmtleieaf026oqjh4y2r4tk8w', idx: { gt: 170 } }, select: { idx: true, content: true, wordCount: true } })
let tailJunk = 0
for (const c of tail) if (c.content && pats.some((p) => p.test(c.content))) { tailJunk++; console.log('TAIL JUNK idx', c.idx) }
console.log('tail checked', tail.length, 'tailJunk', tailJunk)
await db.$disconnect()
process.exit(0)
