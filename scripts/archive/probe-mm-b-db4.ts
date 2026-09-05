import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const rule = await db.rule.findUnique({ where: { id: 'cmtlefjho025hqjh4yzuenady' }, select: { createdAt: true, updatedAt: true } })
const task = await db.task.findUnique({ where: { id: 'cmtlefji2025jqjh4d1qa2jpo' }, select: { createdAt: true, updatedAt: true } })
console.log('rule:', JSON.stringify(rule), '\ntask:', JSON.stringify(task))
await db.$disconnect()
process.exit(0)
