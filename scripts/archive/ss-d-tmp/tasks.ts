import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
const tasks = await db.task.findMany({ select: { id: true, name: true, status: true, autoRefresh: true, ruleId: true } });
for (const t of tasks) {
  if (['running','pending','paused'].includes(t.status) || t.autoRefresh) {
    const rule = await db.rule.findUnique({ where: { id: t.ruleId }, select: { name: true, config: true } });
    const cfg = JSON.stringify(rule?.config ?? {});
    const dep = ['3010','3011','3012','3013','3014'].filter(p => cfg.includes(p));
    console.log(`LIVE: ${t.id} ${t.name} status=${t.status} autoRefresh=${t.autoRefresh} rule=${rule?.name} deps=${dep.join(',') || 'none'}`);
  }
}
console.log('--- all tasks statuses ---');
for (const t of tasks) console.log(`${t.id} ${t.name} ${t.status} auto=${t.autoRefresh}`);
await db.$disconnect();
