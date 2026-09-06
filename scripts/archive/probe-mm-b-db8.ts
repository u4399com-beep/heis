import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const tasks = await db.task.findMany({ select: { id: true, name: true, status: true, autoRefresh: true, refreshIntervalMin: true }, orderBy: { createdAt: 'desc' }, take: 6 })
console.log(JSON.stringify(tasks, null, 1))
await db.$disconnect()
process.exit(0)
