import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const names = ['八零电子书 (80ge.info)·wap正文·直连', '天天看小说 (cn.ttkan.co)·Nuxt-SSR直连站'];
for (const n of names) {
  const r = await p.rule.findFirst({ where: { name: n } });
  if (!r) { console.log('NOT FOUND:', n); continue; }
  const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config;
  console.log('=====', r.id, r.name, 'enabled=', r.enabled);
  console.log(JSON.stringify(cfg, null, 1));
}
await p.$disconnect();
export {};
