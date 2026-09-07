import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const t = await db.task.findUnique({ where: { id: 'cmtmrbd9q00fgnscz8uexxvy8' }, select: { status: true, updatedAt: true, stats: true } })
console.log('qimao task:', JSON.stringify(t))
const logs = await db.taskLog.findMany({ where: { taskId: 'cmtmrbd9q00fgnscz8uexxvy8' }, orderBy: { createdAt: 'desc' }, take: 3, select: { createdAt: true, level: true, message: true } })
for (const l of logs) console.log(l.createdAt, l.level, l.message.slice(0, 100))
await db.$disconnect()
