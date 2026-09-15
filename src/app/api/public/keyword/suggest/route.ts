// R13-1A: 关键词 suggest 聚合 — 给定查询词返回多引擎聚合下拉词
// 用于 KeywordView 底部"相关搜索"区块, 链到其他 keyword 落地页
import { ok } from '@/lib/api'
import { withGuard, str, withCache } from '../../../_lib/http'
import { fetchSuggestKeywords, mergeSuggestWords } from '@/lib/crawl/suggest'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const kw = str(url.searchParams.get('kw'), 100).trim()
    if (!kw) return ok({ words: [] as string[] })

    // 7 引擎并发聚合
    let words: string[] = []
    try {
      const results = await fetchSuggestKeywords(kw, 10)
      words = mergeSuggestWords(kw, results, 12)
    } catch {
      words = []
    }
    return withCache(ok({ words }), 600, 1800)
  })
}
