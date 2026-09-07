import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const books = await db.book.findMany({ where: { sourceUrl: { contains: 'pilishuwu' } }, select: { id: true, name: true, author: true, sourceUrl: true, _count: { select: { chapters: true } } } })
console.log(JSON.stringify(books, null, 1))
for (const b of books) {
  const chs = await db.chapter.findMany({ where: { bookId: b.id }, orderBy: { idx: 'asc' }, select: { idx: true, title: true, url: true, volume: true, wordCount: true, fetched: true }, take: 3 })
  const last = await db.chapter.findMany({ where: { bookId: b.id }, orderBy: { idx: 'desc' }, select: { idx: true, title: true, url: true }, take: 2 })
  console.log(b.name, 'first:', JSON.stringify(chs), 'last:', JSON.stringify(last))
}
await db.$disconnect()
process.exit(0)
