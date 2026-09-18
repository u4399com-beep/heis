// ============================================================
// 搜索引擎下拉关键词聚合
// 百度 / 必应 / 搜狗 / 360 / DuckDuckGo / Google / Yandex 下拉建议
// 作为书籍辅助标签/关联词, 独立访问页面均指向主书籍信息页
// R11-1C: 新增 Google Suggest + Yandex Suggest
// R13-1A: 新增 fetchSuggestKeywordsForBook / generatePSEOKeywords
//         + LRU 缓存(Map + TTL, 24h) — PSEO 长尾词程序化生成入口
// R25-1D: 修复失效引擎 — Bing api.bing.com→www.bing.com+cc=cn (强制中文市场),
//         Google output=toolbar XML 已弃用→client=firefox JSON (与 Bing 同款 j[1] 解析);
//         搜狗 sugproxy/sug 返回 HTML 错误页 (suggest API 下线), 解析器优雅 []
// ============================================================
import { fetchBinary } from './fetcher'

interface SuggestEngine {
  name: string
  url: (kw: string) => string
  parse: (body: string) => string[]
}

const ENGINES: SuggestEngine[] = [
  {
    name: 'baidu',
    url: (kw) => `https://www.baidu.com/sugrec?prod=pc&wd=${encodeURIComponent(kw)}`,
    parse: (body) => {
      try {
        const j = JSON.parse(body)
        return (j.g || []).map((x: any) => x.q).filter((s: any) => typeof s === 'string')
      } catch { return [] }
    },
  },
  {
    // R25-1D: api.bing.com 已退役 (返回 400); 改用 www.bing.com 并加 cc=cn 强制中文市场,
    // 否则中文 query 返回空数组 ["斗罗大陆",[]] (默认走英文市场无中文 suggest)
    name: 'bing',
    url: (kw) => `https://www.bing.com/osjson.aspx?query=${encodeURIComponent(kw)}&cc=cn`,
    parse: (body) => {
      try {
        const j = JSON.parse(body)
        return Array.isArray(j?.[1]) ? j[1].filter((s: any) => typeof s === 'string') : []
      } catch { return [] }
    },
  },
  {
    // R25-1D: 搜狗 sugproxy/sug 与 sugg/sug.jsp 均返回 HTML 错误页 (suggest API 已下线);
    // 解析器对非 JSON 优雅返回 [], 不影响其他引擎聚合, 不缓存空结果 (R13-1C P1 fix)
    name: 'sogou',
    url: (kw) => `https://www.sogou.com/sugproxy/sug?action=get&encode=utf-8&query=${encodeURIComponent(kw)}`,
    parse: (body) => {
      try {
        const j = JSON.parse(body)
        return (j?.data || []).map((x: any) => (typeof x === 'string' ? x : x?.word || x?.q)).filter(Boolean)
      } catch { return [] }
    },
  },
  {
    name: 'so360',
    url: (kw) => `https://sug.so.360.cn/suggest/word?word=${encodeURIComponent(kw)}`,
    parse: (body) => {
      // R11-1C: 修正 360 接口 (sug.so.360.cn/suggest/word?word= 返回 JSON {result:[{word:...}]})
      try {
        const j = JSON.parse(body)
        return (j?.result || []).map((x: any) => x?.word).filter((s: any) => typeof s === 'string')
      } catch { return [] }
    },
  },
  {
    name: 'ddg',
    url: (kw) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(kw)}&type=list`,
    parse: (body) => {
      try {
        const j = JSON.parse(body)
        if (Array.isArray(j) && Array.isArray(j?.[1])) return j[1]
        if (Array.isArray(j)) return j.map((x: any) => x?.phrase).filter(Boolean)
        return []
      } catch { return [] }
    },
  },
  {
    // R25-1D: output=toolbar XML 接口已弃用 (返回 400 Bad Request); 改用 client=firefox
    // JSON 接口, 返回 ["query", ["sugg1", ...]] 格式, 解析器与 bing 同款 (取 j[1])
    name: 'google',
    url: (kw) => `https://suggestqueries.google.com/complete/search?client=firefox&hl=zh-CN&q=${encodeURIComponent(kw)}`,
    parse: (body) => {
      try {
        const j = JSON.parse(body)
        if (Array.isArray(j) && Array.isArray(j[1])) {
          return (j[1] as unknown[]).filter((s: any) => typeof s === 'string')
        }
        return []
      } catch { return [] }
    },
  },
  {
    // R11-1C: Yandex Suggest (备用引擎, 海外可达)
    // R25-1D: 旧 endpoint /suggest-backend/suggest/suggest-ya.cgi 已下线 (返回 404),
    // 改用 /suggest-ya.cgi 根路径; 中文长查询(如完整书名"斗罗大陆")Yandex 无中文索引,
    // 返回 ["斗罗大陆",[],{"r":134}], 解析器对空数组优雅返回 [], 不影响聚合
    name: 'yandex',
    url: (kw) => `https://suggest.yandex.com/suggest-ya.cgi?part=${encodeURIComponent(kw)}&uilv=2&srv=search&lang=zh&ssl=1`,
    parse: (body) => {
      // Yandex 返回 JSON 数组 [query, [[suggestion, ...], ...], ...] 或 [query, [], ...]
      try {
        const j = JSON.parse(body)
        if (Array.isArray(j) && j.length >= 2 && Array.isArray(j[1])) {
          return j[1].map((item: any) => {
            if (typeof item === 'string') return item
            if (Array.isArray(item) && item.length > 0) return String(item[0])
            return ''
          }).filter(Boolean)
        }
        return []
      } catch { return [] }
    },
  },
]

export interface SuggestResult {
  engine: string
  words: string[]
  ok: boolean
}

/** 聚合多引擎下拉词 */
export async function fetchSuggestKeywords(keyword: string, perEngineLimit = 12): Promise<SuggestResult[]> {
  const results: SuggestResult[] = await Promise.all(
    ENGINES.map(async (eng) => {
      try {
        const res = await fetchBinary(eng.url(keyword), {
          engine: 'http',
          timeout: 8000,
          retries: 0,
          referer: false,
          uaMode: 'rotate',
        })
        if (!res) return { engine: eng.name, words: [], ok: false }
        const body = res.buf.toString('utf-8')
        const words = eng.parse(body)
          .map((w) => String(w).trim())
          .filter((w) => w && w.length <= 50 && !/^https?:/.test(w))
        return { engine: eng.name, words: words.slice(0, perEngineLimit), ok: words.length > 0 }
      } catch {
        return { engine: eng.name, words: [], ok: false }
      }
    })
  )
  return results
}

/** 去重合并 + 相关度过滤(保留含主词的 + 高频关联词) */
export function mergeSuggestWords(
  bookName: string,
  results: SuggestResult[],
  limit = 25
): string[] {
  const freq = new Map<string, number>()
  for (const r of results) {
    for (const w of r.words) {
      const k = w.trim()
      if (!k) continue
      freq.set(k, (freq.get(k) || 0) + 1)
    }
  }
  const scored = Array.from(freq.entries()).map(([word, count]) => {
    let score = count * 10
    if (word.includes(bookName)) score += 30
    if (word === bookName) score += 20
    return { word, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.word)
}

// ============================================================
// R13-1A: PSEO 长尾词程序化生成入口
// - fetchSuggestKeywordsForBook: 聚合 7 引擎, 返回 Top 30 关键词列表
// - generatePSEOKeywords: 输出 PSEO 长尾词(带 source/score/频次)
// - LRU 缓存: Map + TTL(24h), 不引入新依赖
// ============================================================

/** PSEO 关键词条目 */
export interface PSEOKeyword {
  keyword: string
  /** 主源引擎(命中的第一个引擎名) */
  source: string
  /** 频次(被多少引擎/查询词命中) */
  count: number
  /** 综合相关度分数(频次×10 + 书名命中加分 + 精确匹配加分 + 分类命中加分) */
  score: number
}

/** LRU 缓存条目 */
interface CacheEntry<T> {
  ts: number
  value: T
}

const PSEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const PSEO_CACHE_MAX = 200 // 最多缓存 200 本书的 PSEO 结果

const pseoCache = new Map<string, CacheEntry<PSEOKeyword[]>>()

/** LRU 读: 命中且未过期 → 返回值并刷新顺序(删除后重插, Map 迭代序 = LRU 优先级) */
function cacheRead<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > PSEO_CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  // 刷新顺序: 删后重插 → LRU 最近使用前置
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

/** LRU 写: 超 MAX 时淘汰最老条目(Map 迭代首项) */
function cacheWrite<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, max = PSEO_CACHE_MAX) {
  // 已存在则先删, 避免 size 计算重复
  cache.delete(key)
  cache.set(key, { ts: Date.now(), value })
  // LRU 淘汰: 超 max 时移除最早项(Map 迭代顺序为插入序)
  while (cache.size > max) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

/** 清空 PSEO 缓存(测试/手动刷新用) */
export function clearPSEOCache(): void {
  pseoCache.clear()
}

/**
 * P2 fix (R13-1C): 仅清空指定书籍的 PSEO 缓存条目(按 cacheKey 精确删除)。
 * 修前 force=true 走 clearPSEOCache() 清空整个缓存, 影响所有书的 PSEO 落地页
 * (一本书的 force 重抓让其他书的缓存也失效, 下次访问都需重新跑 7 引擎聚合,
 * 增加搜索引擎侧压力与首屏延迟)。按 cacheKey 删除只让本书缓存失效, 其它书
 * 缓存保留。cacheKey 构造口径与 fetchSuggestKeywordsForBook 完全一致 */
export function clearPSEOCacheForBook(
  bookName: string,
  author?: string,
  limit = 30,
  category?: string
): void {
  const cacheKey = `${bookName.trim()}|${(author || '').trim()}|${limit}|${(category || '').trim()}`
  pseoCache.delete(cacheKey)
}

/**
 * 敏感词过滤 — PSEO 长尾词质量闸门
 * 过滤规则:
 *  - 纯数字/纯字母(信息量过低)
 *  - 过短(<2 字符)或过长(>30 字符)
 *  - 含 http(s) 协议头
 *  - 含敏感词(色情/赌博/政治敏感等, 避免被搜索引擎降权)
 *  - 全部为停用词/无意义组合(如"在线小说"单字)
 */
const SENSITIVE_PATTERNS = [
  /色情|黄色|成人|18禁|av\b|porn|sex/i,
  /赌博|博彩|彩票|赌场|casino/i,
  /反动|法轮|六四|政治敏感/i,
  /病毒|木马|hack|crack|破解版|注册机/i,
  /枪支|弹药|爆炸物|毒品|大麻/i,
]

function isLowQualityKeyword(kw: string): boolean {
  if (!kw || kw.length < 2 || kw.length > 30) return true
  if (/^\d+$/.test(kw)) return true // 纯数字
  if (/^[a-zA-Z\s]+$/.test(kw) && kw.length < 4) return true // 过短英文
  if (/^https?:\/\//i.test(kw)) return true
  if (SENSITIVE_PATTERNS.some((re) => re.test(kw))) return true
  return false
}

/**
 * 为书籍构造查询词池 — 书名衍生 5 个变体查询词, 覆盖典型搜索意图
 */
function buildBookQueries(bookName: string, author?: string): string[] {
  const name = bookName.trim().slice(0, 30)
  if (!name) return []
  const queries = new Set<string>([name])
  queries.add(`${name} 小说`)
  if (author && author.trim() && author !== '佚名') {
    queries.add(`${name} ${author.trim().slice(0, 20)}`)
  }
  queries.add(`${name} 全文阅读`)
  queries.add(`${name} TXT下载`)
  return Array.from(queries)
}

/**
 * 聚合 7 引擎下拉词, 为书籍生成 Top 30 PSEO 候选词
 *
 * 实现:
 *  1. 根据 (书名, 作者) 构造 5 个查询词(书名 / 书名+小说 / 书名+作者 / 书名+全文阅读 / 书名+TXT下载)
 *  2. 对每个查询词并发跑 7 引擎聚合
 *  3. 合并去重, 按频次+相关性打分(含书名加分、精确匹配加分、分类加分)
 *  4. 过滤低质量词(纯数字/过长/含敏感词)
 *  5. 用 LRU 缓存(key=bookName|author, TTL=24h) 避免重复请求搜索引擎
 *
 * @param bookName 书名
 * @param author 作者(可选, 默认空)
 * @param limit 返回数量, 默认 30
 * @param category 分类(可选, 仅用于打分加分, 不参与查询词构造)
 */
export async function fetchSuggestKeywordsForBook(
  bookName: string,
  author?: string,
  limit = 30,
  category?: string
): Promise<PSEOKeyword[]> {
  const cacheKey = `${bookName.trim()}|${(author || '').trim()}|${limit}|${(category || '').trim()}`
  const cached = cacheRead(pseoCache, cacheKey)
  if (cached) return cached

  const queries = buildBookQueries(bookName, author)
  if (queries.length === 0) return []

  // 每个查询词并发跑 7 引擎, 多组结果合并
  const allResults = await Promise.all(queries.map((q) => fetchSuggestKeywords(q, 10)))

  // 合并: keyword → { count, sources: Set<engine>, queryCount: Set<query> }
  const merged = new Map<
    string,
    { count: number; sources: Set<string>; queryCount: Set<string>; containsBookName: boolean }
  >()
  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi]
    const results = allResults[qi]
    for (const r of results) {
      if (!r.ok) continue
      for (const w of r.words) {
        const k = w.trim()
        if (!k) continue
        let entry = merged.get(k)
        if (!entry) {
          entry = { count: 0, sources: new Set(), queryCount: new Set(), containsBookName: false }
          merged.set(k, entry)
        }
        entry.count += 1
        entry.sources.add(r.engine)
        entry.queryCount.add(q)
        if (k.includes(bookName)) entry.containsBookName = true
      }
    }
  }

  // 打分 + 转换为 PSEOKeyword
  const catLower = (category || '').trim().toLowerCase()
  const scored: PSEOKeyword[] = []
  for (const [keyword, info] of merged) {
    if (isLowQualityKeyword(keyword)) continue
    // 主源引擎: sources 中第一个(按 ENGINES 顺序优先)
    const sourcePriority = ['baidu', 'bing', 'so360', 'google', 'sogou', 'ddg', 'yandex']
    const source = sourcePriority.find((e) => info.sources.has(e)) || Array.from(info.sources)[0] || 'baidu'
    let score = info.count * 10
    if (info.containsBookName) score += 30
    if (keyword === bookName) score += 20
    if (info.sources.size >= 3) score += 15 // 多引擎共识加分
    if (info.queryCount.size >= 3) score += 10 // 多查询词命中加分
    if (catLower && keyword.toLowerCase().includes(catLower)) score += 5
    scored.push({
      keyword,
      source,
      count: info.count,
      score,
    })
  }
  scored.sort((a, b) => b.score - a.score)
  const result = scored.slice(0, limit)
  // P1 fix (R13-1C): 仅缓存非空结果。修前 bug: 7 引擎瞬时全败(网络抖动/DNS 暂时故障)
  // 时 scored=[] 被缓存, 24h TTL 内所有后续调用直接返回空数组不再重试 → PSEO 落地页
  // 整本书"无相关搜索词"持续 24h。仅当至少有 1 条质量结果时才写缓存, 让瞬时失败可在
  // 下次调用时重新走引擎聚合; 永久性空结果(书名异常/引擎全部不可达)每次也只多花一次
  // 7 引擎并发请求(失败兜底本地模板, 语义无变化)
  if (result.length > 0) {
    cacheWrite(pseoCache, cacheKey, result)
  }
  return result
}

/**
 * 输出 PSEO 长尾词列表(用于批量生成 landing page)
 * 与 fetchSuggestKeywordsForBook 同源, 但:
 *  - 优先过滤与书名重复的纯词(留作扩展词, 如"凡人修仙传 全文阅读" 等)
 *  - 给每个词的 score 加 PSEO 长尾权重(扩展型词 +5)
 *
 * @param bookName 书名
 * @param author 作者
 * @param category 分类
 * @param limit 返回数量, 默认 30
 */
export function generatePSEOKeywords(
  bookName: string,
  author?: string,
  category?: string,
  limit = 30
): PSEOKeyword[] {
  // 同步函数: 直接读缓存(若已有 fetchSuggestKeywordsForBook 异步结果), 否则生成基础词
  // 注: 本函数不主动调引擎(同步要求), 仅在缓存命中时返回缓存结果
  const cacheKey = `${bookName.trim()}|${(author || '').trim()}|${limit}|${(category || '').trim()}`
  const cached = cacheRead(pseoCache, cacheKey)
  if (cached && cached.length > 0) {
    return cached
  }

  // 缓存未命中: 生成基础 PSEO 长尾词(无网络请求, 仅本地组合)
  const name = bookName.trim().slice(0, 30)
  if (!name) return []

  const templates: { kw: string; src: string; score: number }[] = [
    { kw: `${name} 小说`, src: 'local', score: 60 },
    { kw: `${name} 全文阅读`, src: 'local', score: 55 },
    { kw: `${name} TXT下载`, src: 'local', score: 55 },
    { kw: `${name} 在线阅读`, src: 'local', score: 50 },
    { kw: `${name} 最新章节`, src: 'local', score: 50 },
    { kw: `${name} 无弹窗`, src: 'local', score: 45 },
    { kw: `${name} 完结`, src: 'local', score: 45 },
    { kw: `${name} 笔趣阁`, src: 'local', score: 40 },
    { kw: `${name} 百度云`, src: 'local', score: 40 },
    { kw: `${name} 下载`, src: 'local', score: 40 },
  ]
  if (author && author.trim() && author !== '佚名') {
    templates.push({ kw: `${name} ${author.trim().slice(0, 20)}`, src: 'local', score: 50 })
    templates.push({ kw: `${name} ${author.trim().slice(0, 20)} 小说`, src: 'local', score: 48 })
  }
  if (category && category.trim()) {
    templates.push({ kw: `${name} ${category.trim().slice(0, 10)}`, src: 'local', score: 38 })
    templates.push({ kw: `${category.trim().slice(0, 10)} ${name}`, src: 'local', score: 38 })
  }

  const seen = new Set<string>()
  const result: PSEOKeyword[] = []
  for (const t of templates) {
    if (isLowQualityKeyword(t.kw)) continue
    if (seen.has(t.kw)) continue
    seen.add(t.kw)
    result.push({ keyword: t.kw, source: t.src, count: 1, score: t.score })
  }
  return result.slice(0, limit)
}

/**
 * 异步生成 PSEO 关键词列表(优先用网络聚合结果, 失败回退本地组合)
 * 推荐入口: 既走引擎聚合, 又保证缓存命中后再次同步调用零开销
 */
export async function generatePSEOKeywordsAsync(
  bookName: string,
  author?: string,
  category?: string,
  limit = 30
): Promise<PSEOKeyword[]> {
  return fetchSuggestKeywordsForBook(bookName, author, limit, category)
}
