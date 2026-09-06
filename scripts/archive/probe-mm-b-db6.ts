import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const total = await db.chapter.count({ where: { bookId: 'cmtleieaf026oqjh4y2r4tk8w' } })
const fetched = await db.chapter.count({ where: { bookId: 'cmtleieaf026oqjh4y2r4tk8w', fetched: true } })
const unfetched = await db.chapter.findMany({ where: { bookId: 'cmtleieaf026oqjh4y2r4tk8w', fetched: false }, select: { idx: true, title: true } })
console.log(JSON.stringify({ total, fetched, unfetched }))
await db.$disconnect()
process.exit(0)
