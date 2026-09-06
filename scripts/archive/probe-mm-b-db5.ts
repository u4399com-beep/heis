import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const rule = await db.rule.findUnique({ where: { id: 'cmtlefjho025hqjh4yzuenady' } })
const cfg = JSON.parse(rule!.config)
const expr = cfg.toc.tocLink.expression
console.log('expr =', JSON.stringify(expr))
console.log('bytes:', Buffer.from(expr, 'utf8').toString('hex'))
console.log('is correct?', expr === "a[href*='/menu/']")
await db.$disconnect()
process.exit(0)
