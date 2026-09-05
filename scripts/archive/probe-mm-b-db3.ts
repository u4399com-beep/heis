import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const logs = await db.taskLog.findMany({ where: { taskId: 'cmtlefji2025jqjh4d1qa2jpo' }, orderBy: { id: 'asc' }, select: { id: true, level: true, message: true } })
console.log('total logs:', logs.length)
for (const l of logs) console.log(`[${l.level}]`, l.message.slice(0, 200))
await db.$disconnect()
process.exit(0)
