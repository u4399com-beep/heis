// qq-c: DB 证据检查 — 番茄规则的书/章节 content 覆盖情况(按 idx 分布)
export {}
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const RULE_ID = 'cmtgi08kt0003qbu988jf36ch'

async function main(): Promise<void> {
  const books = await db.book.findMany({
    where: { OR: [{ sourceRuleId: RULE_ID }, { sourceUrl: { contains: 'taijiwang' } }] },
    select: { id: true, name: true, author: true, sourceUrl: true, createdAt: true, updatedAt: true },
  })
  console.log(`tomato books=${books.length}`)
  for (const b of books) {
    const total = await db.chapter.count({ where: { bookId: b.id } })
    const fetched = await db.chapter.count({ where: { bookId: b.id, fetched: true } })
    const withContent = await db.chapter.count({ where: { bookId: b.id, content: { not: null } } })
    const emptyContentFetched = await db.chapter.count({ where: { bookId: b.id, fetched: true, content: '' } })
    console.log(`- 《${b.name}》${b.author} id=${b.id} total=${total} fetched=${fetched} withContent=${withContent} emptyFetched=${emptyContentFetched} src=${String(b.sourceUrl).slice(0, 60)}`)
    // idx 分段 content 覆盖
    const segs = await db.chapter.groupBy({
      by: ['fetched'],
      where: { bookId: b.id },
      _count: true,
    })
    console.log('   fetched groupBy:', JSON.stringify(segs))
  }
  // 所有书的存储概览
  const allBooks = await db.book.findMany({ select: { id: true, name: true, sourceRuleId: true }, take: 30 })
  console.log(`\nall books(${allBooks.length}):`)
  for (const b of allBooks) console.log(`  ${b.id} 《${b.name}》 rule=${b.sourceRuleId}`)
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
