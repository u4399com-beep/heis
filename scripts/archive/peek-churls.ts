import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const book = await p.book.findFirst({ where: { name: { contains: '捞尸人' } }, select: { id: true, name: true } });
console.log('book:', book);
if (book) {
  const chs = await p.chapter.findMany({ where: { bookId: book.id }, take: 2, orderBy: { idx: 'asc' }, select: { url: true, title: true, idx: true } });
  console.log(JSON.stringify(chs, null, 1));
}
await p.$disconnect();
export {};
