// ============================================================
// 智能 TDK 自动生成 — 从书籍/章节内容自动提取关键词、生成描述、构建标题
// ============================================================

/** 中文停用词(高频但无 SEO 价值的词) */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '上', '也', '很',
  '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '他', '她',
  '它', '们', '把', '被', '让', '从', '向', '为', '以', '于', '对', '与', '及', '或', '但',
  '而', '则', '可', '能', '得', '地', '着', '过', '来', '去', '上', '下', '里', '中', '内',
  '外', '前', '后', '又', '再', '还', '已', '才', '只', '便', '就', '即', '将', '正', '刚',
  '一个', '一种', '这个', '那个', '什么', '怎么', '为什么', '如何', '可以', '应该', '需要',
  '他们', '她们', '我们', '你们', '它们', '自己', '别人', '大家', '咱们', '这样', '那样',
  '时候', '时间', '地方', '东西', '事情', '样子', '感觉', '觉得', '认为', '知道', '明白',
  '小说', '章节', '正文', '内容', '全文', '阅读', '在线', '免费', '下载', '最新', '更新',
  '到了', '起来', '下来', '出来', '过来', '回去', '那里', '这里', '哪里',
])

/** 分词: 简单的 N-gram 提取(2-4字词), 适用于中文小说内容 */
function tokenize(text: string): string[] {
  const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ').trim()
  if (!clean) return []
  const tokens: string[] = []
  const segments = clean.split(/\s+/).filter((s) => s.length >= 2)
  for (const seg of segments) {
    for (let len = 2; len <= Math.min(4, seg.length); len++) {
      for (let i = 0; i <= seg.length - len; i++) {
        const word = seg.substring(i, i + len)
        if (word.length >= 2 && !STOP_WORDS.has(word)) {
          tokens.push(word)
        }
      }
    }
  }
  return tokens
}

/** 词频统计 + Top N 关键词 */
function topKeywords(tokens: string[], n: number): string[] {
  const freq = new Map<string, number>()
  for (const t of tokens) {
    freq.set(t, (freq.get(t) || 0) + 1)
  }
  const sorted = [...freq.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return b[0].length - a[0].length
  })
  const result: string[] = []
  for (const [word] of sorted) {
    if (result.length >= n) break
    const isSubstring = result.some((existing) => existing.includes(word) || word.includes(existing))
    if (!isSubstring) result.push(word)
  }
  return result
}

/** 从文本提取关键词 */
export function extractKeywords(text: string, maxCount = 8): string[] {
  if (!text || text.trim().length === 0) return []
  const tokens = tokenize(text)
  if (tokens.length === 0) return []
  return topKeywords(tokens, maxCount)
}

/** 从章节内容生成描述(取前 N 个有效段落, 拼接为摘要) */
export function generateDescription(
  content: string,
  maxLength = 150,
): string {
  if (!content) return ''
  const plain = content
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return ''
  let desc = plain.substring(0, maxLength + 50)
  const lastPeriod = Math.max(
    desc.lastIndexOf('。'),
    desc.lastIndexOf('！'),
    desc.lastIndexOf('？'),
    desc.lastIndexOf('.'),
  )
  if (lastPeriod > 50) {
    desc = desc.substring(0, lastPeriod + 1)
  } else if (desc.length > maxLength) {
    desc = desc.substring(0, maxLength) + '...'
  }
  return desc
}

/** 构建页面标题 */
export function generateTitle(opts: {
  bookName?: string
  chapterTitle?: string
  author?: string
  category?: string
  siteName?: string
  page?: number
  totalPages?: number
}): string {
  const { bookName, chapterTitle, author, category, siteName, page, totalPages } = opts
  const parts: string[] = []
  if (chapterTitle && bookName) {
    parts.push(chapterTitle)
    parts.push(bookName)
  } else if (bookName) {
    parts.push(bookName)
    if (author) parts.push(author)
  } else if (category) {
    parts.push(category + '小说')
  }
  if (page && totalPages && totalPages > 1) {
    parts.push(`第${page}页`)
  }
  if (siteName) parts.push(siteName)
  return parts.join('_').substring(0, 80)
}

/** 构建 meta keywords */
export function generateKeywords(opts: {
  bookName?: string
  author?: string
  category?: string
  chapterTitle?: string
  existingKeywords?: string
  content?: string
  siteName?: string
}): string {
  const { bookName, author, category, chapterTitle, existingKeywords, content, siteName } = opts
  const keywords: string[] = []
  if (existingKeywords) {
    keywords.push(...existingKeywords.split(/[,，、;；\s]+/).filter(Boolean))
  }
  if (bookName) keywords.push(bookName)
  if (author) keywords.push(author)
  if (category) keywords.push(category + '小说')
  if (chapterTitle) {
    const chKw = extractKeywords(chapterTitle, 3)
    keywords.push(...chKw)
  }
  if (keywords.length < 4 && content) {
    const contentKw = extractKeywords(content, 5)
    keywords.push(...contentKw)
  }
  if (siteName) keywords.push(siteName)
  const unique = [...new Set(keywords.filter(Boolean))].slice(0, 12)
  return unique.join(',')
}

/** 构建 meta description */
export function generateMetaDescription(opts: {
  bookName?: string
  author?: string
  category?: string
  chapterTitle?: string
  intro?: string
  content?: string
  wordCount?: number
  page?: number
  totalPages?: number
  siteName?: string
}): string {
  const { bookName, author, category, chapterTitle, intro, content, wordCount, page, totalPages, siteName } = opts
  const parts: string[] = []
  if (bookName) {
    parts.push(bookName)
    if (author) parts.push(`作者:${author}`)
  }
  if (category) parts.push(category + '小说')
  if (chapterTitle) {
    parts.push(`最新章节:${chapterTitle}`)
  }
  const summary = intro?.trim() || (content ? generateDescription(content, 120) : '')
  if (summary) parts.push(summary)
  if (wordCount && wordCount > 0) {
    parts.push(formatWordCount(wordCount))
  }
  if (page && totalPages && totalPages > 1) {
    parts.push(`第${page}/${totalPages}页`)
  }
  parts.push('在线阅读')
  if (siteName) parts.push(siteName)
  let desc = parts.join('，')
  if (desc.length > 160) {
    desc = desc.substring(0, 157) + '...'
  }
  return desc
}

/** 字数格式化 */
function formatWordCount(n: number): string {
  if (n >= 100000000) return (n / 100000000).toFixed(2).replace(/\.?0+$/, '') + '亿字'
  if (n >= 10000) return Math.round(n / 10000) + '万字'
  return n + '字'
}

/** 统一 TDK 生成入口 */
export interface TDKResult {
  title: string
  description: string
  keywords: string
}

export function generateTDK(opts: {
  bookName?: string
  chapterTitle?: string
  author?: string
  category?: string
  intro?: string
  content?: string
  existingKeywords?: string
  wordCount?: number
  page?: number
  totalPages?: number
  siteName?: string
}): TDKResult {
  return {
    title: generateTitle(opts),
    description: generateMetaDescription(opts),
    keywords: generateKeywords(opts),
  }
}
