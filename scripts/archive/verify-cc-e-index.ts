// cc-e Task A: verify physical indexes via SQLite PRAGMA + API regression
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
let fails = 0
const check = (cond: boolean, label: string) => {
  console.log(cond ? `PASS ${label}` : `FAIL ${label}`)
  if (!cond) fails++
}

async function raw(sql: string): Promise<Record<string, unknown>[]> {
  return (await db.$queryRawUnsafe(sql)) as Record<string, unknown>[]
}

async function main() {
  const bookIdx = await raw("PRAGMA index_list('Book')")
  const chapterIdx = await raw("PRAGMA index_list('Chapter')")
  console.log('Book index_list:', bookIdx.map((r) => `${r.name}(${r.origin})`).join(', '))
  console.log('Chapter index_list:', chapterIdx.map((r) => `${r.name}(${r.origin})`).join(', '))

  const colsOf = async (_table: string, name: unknown) =>
    (await raw(`PRAGMA index_info('${name}')`)).map((r) => r.name).join(',')

  const colMap = new Map<string, string>()
  for (const r of [...bookIdx, ...chapterIdx]) {
    if (!colMap.has(String(r.name))) colMap.set(String(r.name), await colsOf(String(r.table || ''), r.name))
  }

  const bookCategoryIdx = bookIdx.find((r) => colMap.get(String(r.name)) === 'categoryId')
  check(!!bookCategoryIdx, 'Book.categoryId index physically exists')
  const bookUpdatedIdx = bookIdx.find((r) => colMap.get(String(r.name)) === 'updatedAt')
  check(!!bookUpdatedIdx, 'Book.updatedAt index physically exists')
  const chUpdatedIdx = chapterIdx.find((r) => colMap.get(String(r.name)) === 'updatedAt')
  check(!!chUpdatedIdx, 'Chapter.updatedAt index physically exists')

  // EXPLAIN QUERY PLAN: default sorts must hit index, not temp b-tree
  const plan = async (sql: string) =>
    (await raw(`EXPLAIN QUERY PLAN ${sql}`)).map((r) => String(r.detail)).join(' | ')
  const planBookSort = await plan(`SELECT * FROM Book ORDER BY updatedAt DESC`)
  console.log('plan Book ORDER BY updatedAt:', planBookSort)
  check(!planBookSort.includes('USE TEMP B-TREE FOR ORDER BY'), 'Book updatedAt sort avoids temp b-tree')
  const planCat = await plan(`SELECT * FROM Book WHERE categoryId = 'x' ORDER BY updatedAt DESC`)
  console.log('plan Book by categoryId:', planCat)
  check(planCat.includes('Book_categoryId_idx'), 'Book categoryId filter uses index')
  const planCh = await plan(`SELECT * FROM Chapter ORDER BY updatedAt DESC`)
  console.log('plan Chapter ORDER BY updatedAt:', planCh)
  check(!planCh.includes('USE TEMP B-TREE FOR ORDER BY'), 'Chapter updatedAt sort avoids temp b-tree')

  // API regression against dev server
  const api = async (url: string, label: string) => {
    const r = await fetch(`http://localhost:3000${url}`)
    const text = await r.text()
    let ok = false
    try {
      const b = JSON.parse(text)
      ok = b && b.ok !== false && r.status === 200
    } catch {
      ok = r.status === 200
    }
    check(ok, `${label} -> ${r.status} ${text.slice(0, 100)}`)
  }
  await api('/api/public/books?page=1&size=10', 'GET /api/public/books')
  await api('/api/public/books?cat=xxx&page=1', 'GET /api/public/books?cat=missing')
  await api('/api/public/books?sort=words&page=1', 'GET /api/public/books?sort=words')
  await api('/api/admin/books?page=1', 'GET /api/admin/books')
  await api('/api/admin/stats', 'GET /api/admin/stats')

  await db.$disconnect()
  process.exit(fails === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('SCRIPT ERROR', e)
  process.exit(2)
})
