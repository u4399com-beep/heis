// ============================================================
// 搜索引擎下拉关键词聚合
// 百度 / 必应 / 搜狗 / 360 / DuckDuckGo / Google / Yandex 下拉建议
// 作为书籍辅助标签/关联词, 独立访问页面均指向主书籍信息页
// R11-1C: 新增 Google Suggest(XML 解析) + Yandex Suggest(JSON)
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
    name: 'bing',
    url: (kw) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(kw)}`,
    parse: (body) => {
      try {
        const j = JSON.parse(body)
        return Array.isArray(j?.[1]) ? j[1].filter((s: any) => typeof s === 'string') : []
      } catch { return [] }
    },
  },
  {
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
    // R11-1C: Google Suggest XML 接口 (海外可达, 国内偶发可访问)
    name: 'google',
    url: (kw) => `https://suggestqueries.google.com/complete/search?output=toolbar&hl=zh-CN&q=${encodeURIComponent(kw)}`,
    parse: (body) => {
      // XML 格式: <CompleteSuggestion><suggestion data="xxx"/></CompleteSuggestion>
      try {
        const matches = [...body.matchAll(/<suggestion\s+data="([^"]+)"\s*\/>/gi)]
        return matches.map((m) => m[1]).filter((s) => s && typeof s === 'string')
      } catch { return [] }
    },
  },
  {
    // R11-1C: Yandex Suggest (备用引擎, 海外可达, 中文支持一般但偶有长尾词)
    name: 'yandex',
    url: (kw) => `https://suggest.yandex.com/suggest-backend/suggest/suggest-ya.cgi?part=${encodeURIComponent(kw)}&srv=www.yandex.com&icon=1&fact=1&pos=4&sn=7&ll=0&v=4&uilv=2&lang=zh&ssl=1&multiline=1`,
    parse: (body) => {
      // Yandex 返回 JSON 数组 [query, [[suggestion, ...], ...], ...]
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
