// R13-1A: PSEO 关键词批量生成 API
// POST: 调用 generatePSEOKeywordsAsync 跑引擎聚合, 返回 Top 30 PSEO 长尾词,
//      同时批量 upsert 到 BookTag 表(source='pseo', 让这些关键词自动出现在 KeywordView 等页面)
import { readBody, ok, fail } from '@/lib/api'
import { db } from '@/lib/db'
import { generatePSEOKeywordsAsync, type PSEOKeyword } from '@/lib/crawl/suggest'
import { withGuard, str, clampInt } from '../../../../_lib/http'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const book = await db.book.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        author: true,
        categoryId: true,
        category: { select: { name: true } },
      },
    })
    if (!book) return fail('书籍不存在', 404)

    // 同步本地组合(立即返回, 无网络延迟); 若已抓过 LRU 缓存命中, 返回真实聚合结果
    const localKws = generateLocalPSEOTemplate(book.name, book.author, book.category?.name || '')

    // 已入库的 PSEO 关键词(source='pseo', 按词频倒序)
    const existingTags = await db.bookTag.findMany({
      where: { bookId: id, source: 'pseo' },
      orderBy: { hits: 'desc' },
      take: 30,
    })

    return ok({
      book: { id: book.id, name: book.name, author: book.author, category: book.category?.name || '' },
      localTemplate: localKws,
      existing: existingTags.map((t) => ({ tag: t.tag, hits: t.hits, source: t.source })),
      count: existingTags.length,
    })
  })
}

// POST: 生成 PSEO 关键词 + 入库
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const body = await readBody(req)
    const book = await db.book.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        author: true,
        categoryId: true,
        category: { select: { name: true } },
      },
    })
    if (!book) return fail('书籍不存在', 404)

    const limit = clampInt(body?.limit, 30, 5, 100)
    const persist = body?.persist !== false // 默认 true: 写入 BookTag 表; false 仅返回不入库
    const force = body?.force === true // true 强制重抓(忽略 LRU 缓存)

    // R13-1C: 强制重抓时清缓存(若已存在)
    // P2 fix: 用 clearPSEOCacheForBook 只清本书缓存条目; 修前 clearPSEOCache() 清整个缓存
    // 会让其它书的 PSEO 落地页也立即失效, 下次访问需重新跑 7 引擎聚合(增加搜索引擎压力)
    if (force) {
      const { clearPSEOCacheForBook } = await import('@/lib/crawl/suggest')
      clearPSEOCacheForBook(book.name, book.author, limit, book.category?.name || '')
    }

    // 生成 PSEO 关键词(7 引擎聚合, 走 LRU 缓存)
    let pseoKeywords: PSEOKeyword[] = []
    try {
      pseoKeywords = await generatePSEOKeywordsAsync(book.name, book.author, book.category?.name || '', limit)
    } catch {
      // 引擎聚合失败时回退本地模板(保证 API 不空)
      pseoKeywords = generateLocalPSEOTemplate(book.name, book.author, book.category?.name || '', limit)
    }
    // 兜底: 网络聚合返回空时, 拼本地模板
    if (pseoKeywords.length === 0) {
      pseoKeywords = generateLocalPSEOTemplate(book.name, book.author, book.category?.name || '', limit)
    }

    // 入库 (source='pseo', 让 KeywordView 等页面能查到)
    let added = 0
    let updated = 0
    if (persist) {
      for (const kw of pseoKeywords) {
        const tag = str(kw.keyword, 60).trim()
        if (!tag) continue
        // upsert 原子化: 避免 findUnique→create 两步并发撞唯一约束 P2003
        const row = await db.bookTag.upsert({
          where: { bookId_tag: { bookId: id, tag } },
          create: { bookId: id, tag, source: 'pseo' },
          update: { hits: { increment: 1 } },
        })
        if (row.hits === 0) added++
        else updated++
      }
    }

    return ok({
      book: { id: book.id, name: book.name, author: book.author, category: book.category?.name || '' },
      pseoKeywords,
      added,
      updated,
      persisted: persist,
      count: pseoKeywords.length,
    })
  })
}

/** 本地模板兜底: 同 generatePSEOKeywords 的本地组合, 但不依赖缓存(直接计算) */
function generateLocalPSEOTemplate(
  bookName: string,
  author?: string,
  category?: string,
  limit = 30
): PSEOKeyword[] {
  const name = bookName.trim().slice(0, 30)
  if (!name) return []
  const templates: { kw: string; score: number }[] = [
    { kw: `${name} 小说`, score: 60 },
    { kw: `${name} 全文阅读`, score: 55 },
    { kw: `${name} TXT下载`, score: 55 },
    { kw: `${name} 在线阅读`, score: 50 },
    { kw: `${name} 最新章节`, score: 50 },
    { kw: `${name} 无弹窗`, score: 45 },
    { kw: `${name} 完结`, score: 45 },
    { kw: `${name} 笔趣阁`, score: 40 },
    { kw: `${name} 百度云`, score: 40 },
    { kw: `${name} 下载`, score: 40 },
  ]
  if (author && author.trim() && author !== '佚名') {
    templates.push({ kw: `${name} ${author.trim().slice(0, 20)}`, score: 50 })
    templates.push({ kw: `${name} ${author.trim().slice(0, 20)} 小说`, score: 48 })
  }
  if (category && category.trim()) {
    templates.push({ kw: `${name} ${category.trim().slice(0, 10)}`, score: 38 })
    templates.push({ kw: `${category.trim().slice(0, 10)} ${name}`, score: 38 })
  }
  const seen = new Set<string>()
  const result: PSEOKeyword[] = []
  for (const t of templates) {
    if (seen.has(t.kw)) continue
    seen.add(t.kw)
    result.push({ keyword: t.kw, source: 'local', count: 1, score: t.score })
  }
  return result.slice(0, limit)
}
