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
// R35-1C: 去 export — 仅 generateKeywords 内部调用 (0 外部引用)
function extractKeywords(text: string, maxCount = 8): string[] {
  if (!text || text.trim().length === 0) return []
  const tokens = tokenize(text)
  if (tokens.length === 0) return []
  return topKeywords(tokens, maxCount)
}

/** 从章节内容生成描述(取前 N 个有效段落, 拼接为摘要) */
// R35-1C: 去 export — 仅 generateMetaDescription 内部调用 (0 外部引用)
function generateDescription(
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
// R35-1C: 去 export — generateTDK 返回类型推断生效 (0 外部 import)
interface TDKResult {
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

// ============================================================
// R16-1B: 18 种 SEO TDK 预设 + 模板渲染工具
// 占位符: {bookName} {author} {category} {chapterTitle} {siteName}
//        {wordCount} {status} {latestChapter} {page} {totalPages}
// ============================================================

/** 18 种 SEO TDK 预设 ID */
// R35-1C: 去 export — randomCombineTDK 返回字段类型推断生效 (0 外部 import)
type TDKPresetId =
  | 'classic-seo' | 'keyword-rich' | 'question-form' | 'list-style'
  | 'brand-first' | 'chapter-focus' | 'category-first' | 'author-first'
  | 'download-focus' | 'read-online' | 'latest-chapter' | 'complete-status'
  | 'word-count' | 'pinyin-style' | 'mobile-seo' | 'social-share'
  | 'long-tail' | 'minimal'

/** 单个 TDK 预设结构 */
// R35-1C: 去 export — TDK_PRESETS 内部用 (0 外部 import)
interface TDKPreset {
  id: TDKPresetId
  name: string
  titleTemplate: string
  descTemplate: string
  keywordsTemplate: string
}

/** 18 种 SEO TDK 预设表 */
// R35-1C: 去 export — randomCombineTDK 内部采样 (0 外部 import)
const TDK_PRESETS: TDKPreset[] = [
  {
    id: 'classic-seo',
    name: '经典 SEO',
    titleTemplate: '{bookName} {chapterTitle} - {siteName}',
    descTemplate: '{bookName} {author}创作的{category}小说, {chapterTitle}在线阅读。{latestChapter} - {siteName}',
    keywordsTemplate: '{bookName}, {author}, {category}小说, {chapterTitle}, 在线阅读, {siteName}',
  },
  {
    id: 'keyword-rich',
    name: '关键词堆砌',
    titleTemplate: '{bookName} {author} {category} {chapterTitle} 在线阅读 - {siteName}',
    descTemplate: '{bookName}由{author}创作, 属于{category}小说, 当前章节{chapterTitle}。共{wordCount}, {status}, 提供{bookName}全文免费阅读, 找{bookName}最新章节就到{siteName}。',
    keywordsTemplate: '{bookName}, {author}, {category}, {chapterTitle}, {bookName}最新章节, {bookName}在线阅读, {bookName}txt下载, {bookName}全文, {siteName}',
  },
  {
    id: 'question-form',
    name: '疑问式',
    titleTemplate: '{bookName} {chapterTitle} 怎么样?好看吗? - {siteName}',
    descTemplate: '{bookName}的{chapterTitle}好看吗? {author}的{category}小说{bookName}怎么样? 在{siteName}免费阅读{bookName} {chapterTitle}, 看书友评价决定是否值得追读。',
    keywordsTemplate: '{bookName}怎么样, {bookName}好看吗, {chapterTitle}, {bookName}, {author}, {siteName}',
  },
  {
    id: 'list-style',
    name: '列表式',
    titleTemplate: 'Top{page}/{totalPages} | {bookName} {chapterTitle} - {siteName}',
    descTemplate: '当前阅读进度 第{page}页/共{totalPages}页 | {bookName} {chapterTitle} | {author}著, {category}小说 | {siteName}',
    keywordsTemplate: '{bookName}, {chapterTitle}, {author}, {category}小说, 第{page}页, 共{totalPages}页, {siteName}',
  },
  {
    id: 'brand-first',
    name: '品牌优先',
    titleTemplate: '{siteName} - {bookName} {chapterTitle}',
    descTemplate: '{siteName}提供{bookName} {chapterTitle}在线阅读, {author}创作的{category}小说, {status}。{latestChapter}',
    keywordsTemplate: '{siteName}, {bookName}, {chapterTitle}, {author}, {category}小说',
  },
  {
    id: 'chapter-focus',
    name: '章节聚焦',
    titleTemplate: '{chapterTitle} - 《{bookName}》by {author} - {siteName}',
    descTemplate: '《{bookName}》第{chapterTitle}章节, {author}著, {category}小说。{siteName}为您提供{bookName}全章节在线阅读, {status}。',
    keywordsTemplate: '{chapterTitle}, {bookName}, {author}, {category}小说, {siteName}',
  },
  {
    id: 'category-first',
    name: '分类优先',
    titleTemplate: '{category}小说 - {bookName} {chapterTitle} - {siteName}',
    descTemplate: '{category}小说推荐: {bookName} {chapterTitle}, {author}著, 共{wordCount}, {status}。{siteName}收录优质{category}小说。',
    keywordsTemplate: '{category}小说, {bookName}, {chapterTitle}, {author}, {siteName}',
  },
  {
    id: 'author-first',
    name: '作者优先',
    titleTemplate: '{author}作品 - {bookName} {chapterTitle} - {siteName}',
    descTemplate: '{author}作品{bookName} {chapterTitle}章节在线阅读, {category}小说, 共{wordCount}, {status}。{author}全部作品尽在{siteName}。',
    keywordsTemplate: '{author}, {author}作品, {bookName}, {chapterTitle}, {category}小说, {siteName}',
  },
  {
    id: 'download-focus',
    name: '下载导向',
    titleTemplate: '{bookName} TXT下载 {author} {chapterTitle} - {siteName}',
    descTemplate: '{bookName} {chapterTitle} TXT下载, {author}创作的{category}小说, 共{wordCount}, {status}。{siteName}提供{bookName}全本TXT下载和在线阅读。',
    keywordsTemplate: '{bookName}下载, {bookName}txt下载, {bookName}TXT, {chapterTitle}, {author}, {siteName}',
  },
  {
    id: 'read-online',
    name: '在线阅读',
    titleTemplate: '{bookName} {chapterTitle} 在线阅读 - {siteName}',
    descTemplate: '{bookName} {chapterTitle}在线阅读, {author}著, {category}小说, {status}。{siteName}为您提供{bookName}无弹窗免费在线阅读。',
    keywordsTemplate: '{bookName}在线阅读, {chapterTitle}, {bookName}, {author}, {category}小说, {siteName}',
  },
  {
    id: 'latest-chapter',
    name: '最新章节',
    titleTemplate: '{bookName}最新章节 {chapterTitle} - {siteName}',
    descTemplate: '{bookName}最新章节{chapterTitle}, {author}著, {category}小说, 更新至{latestChapter}, {status}。{siteName}及时更新{bookName}最新章节。',
    keywordsTemplate: '{bookName}最新章节, {chapterTitle}, {bookName}, {author}, {latestChapter}, {siteName}',
  },
  {
    id: 'complete-status',
    name: '完结状态',
    titleTemplate: '{bookName} {status} {chapterTitle} - {siteName}',
    descTemplate: '{bookName} {status} {chapterTitle}章节在线阅读, {author}著, {category}小说, 共{wordCount}。{siteName}为您提供{status}{bookName}全本阅读。',
    keywordsTemplate: '{bookName}{status}, {bookName}全本, {chapterTitle}, {author}, {category}小说, {siteName}',
  },
  {
    id: 'word-count',
    name: '字数导向',
    titleTemplate: '{bookName}({wordCount}) {chapterTitle} - {siteName}',
    descTemplate: '{bookName}({wordCount}) {chapterTitle}章节, {author}著, {category}小说, {status}。{siteName}提供《{bookName}》全章节阅读。',
    keywordsTemplate: '{bookName}, {wordCount}, {bookName}全本, {chapterTitle}, {author}, {siteName}',
  },
  {
    id: 'pinyin-style',
    name: '拼音风格',
    titleTemplate: '{bookName} {author} {category}小说 - {siteName}',
    descTemplate: '{bookName}({author}) {category}小说大全, {chapterTitle}章节阅读。{siteName}收录{category}类小说, 包含{bookName}等热门作品。',
    keywordsTemplate: '{bookName}, {author}, {category}小说大全, {category}小说, {chapterTitle}, {siteName}',
  },
  {
    id: 'mobile-seo',
    name: '移动 SEO',
    titleTemplate: '{chapterTitle} - {bookName} {siteName}',
    descTemplate: '{chapterTitle}-{bookName}, {author}著, {category}小说, {status}。手机阅读{bookName}, {siteName}提供移动端优化阅读体验。',
    keywordsTemplate: '{chapterTitle}, {bookName}, {author}, {category}, {siteName}',
  },
  {
    id: 'social-share',
    name: '社交分享',
    titleTemplate: '📖 {bookName} | {chapterTitle} | {siteName}',
    descTemplate: '推荐阅读《{bookName}》{chapterTitle}, {author}创作的{category}小说, {wordCount}, {status}。{siteName}好书分享, 转发收藏两不误。',
    keywordsTemplate: '{bookName}, {chapterTitle}, {author}, {category}小说, {siteName}, 推荐阅读',
  },
  {
    id: 'long-tail',
    name: '长尾词',
    titleTemplate: '{bookName} {author} {category} {chapterTitle} {status} - {siteName}',
    descTemplate: '{bookName} {author} {category}小说 {chapterTitle}章节 {status} 共{wordCount}。在{siteName}免费阅读{bookName} {chapterTitle}, {latestChapter}。',
    keywordsTemplate: '{bookName}, {author}, {category}, {chapterTitle}, {status}, {wordCount}, {latestChapter}, {siteName}',
  },
  {
    id: 'minimal',
    name: '极简',
    titleTemplate: '{bookName} {chapterTitle}',
    descTemplate: '{bookName} {chapterTitle} - {author}',
    keywordsTemplate: '{bookName}, {chapterTitle}, {author}',
  },
]

/** 从 18 个预设随机组合 title/desc/keywords 模板 (3 个独立采样, 可互不相同) */
export function randomCombineTDK(): {
  presetId: TDKPresetId
  titleTemplate: string
  descTemplate: string
  keywordsTemplate: string
  sourcePresets: { title: TDKPresetId; desc: TDKPresetId; keywords: TDKPresetId }
} {
  const titlePreset = TDK_PRESETS[Math.floor(Math.random() * TDK_PRESETS.length)]
  const descPreset = TDK_PRESETS[Math.floor(Math.random() * TDK_PRESETS.length)]
  const keywordsPreset = TDK_PRESETS[Math.floor(Math.random() * TDK_PRESETS.length)]
  return {
    presetId: titlePreset.id,
    titleTemplate: titlePreset.titleTemplate,
    descTemplate: descPreset.descTemplate,
    keywordsTemplate: keywordsPreset.keywordsTemplate,
    sourcePresets: { title: titlePreset.id, desc: descPreset.id, keywords: keywordsPreset.id },
  }
}
