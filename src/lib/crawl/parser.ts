// ============================================================
// 解析引擎 — CSS选择器(cheerio) / XPath(@xmldom+xpath) / 正则 三合一
// 支持: 字段提取、列表项遍历、翻页合并、URL绝对化
// JSON模式: 纯JSON API站(SPA壳无SSR) — 响应体JSON.parse后按点路径取值;
//           itemSelector.expression 指向数组路径对每项跑 fields;
//           const 常量模板用 {字段名}/{index}/{q.参数} 占位符合成URL
// ============================================================
import * as cheerio from 'cheerio'
import { DOMParser } from '@xmldom/xmldom'
import xpath from 'xpath'
import { type FieldRule, type PageRule, type PageFields, type TocItem, type ParsedBook, type ParsedContent } from './types'
import { fetchPage } from './fetcher'

// ---------------- BOM/前导空白剥离 ----------------
// R-E1: 部分 .NET/Java 后端在 HTML 响应体前注入 UTF-8 BOM(\uFEFF) 或前导空白;
//  cheerio.load 会把 BOM 当作文本节点保留, 后续 CSS 选择器:first-child 偏移、文本提取
//  起头混入 \uFEFF 字面量入库。统一切除响应体前导 BOM/空白(中间 BOM 保留——可能为
//  正文零宽字符; 仅剥响应体最前的 BOM 才安全, 不破坏正文)
function stripLeadingBom(html: string): string {
  if (!html) return html
  // \uFEFF = UTF-8/16 BOM; \uFFFE = 字节序反; 两者在合法 UTF-8 文本中不应作为首字符
  let i = 0
  while (i < html.length) {
    const ch = html.charCodeAt(i)
    if (ch === 0xFEFF || ch === 0xFFFE) { i++; continue }
    if (ch === 0x20 || ch === 0x09 || ch === 0x0A || ch === 0x0D) { i++; continue }
    break
  }
  return i > 0 ? html.slice(i) : html
}

// ---------------- 结构化数据提取(反反爬增强) ----------------
// R-E2: 现代 SPA 站常把关键字段(书名/作者/简介/章节列表/正文)只暴露在 JSON-LD
//  (schema.org) 或 og:* / article:* meta 标签里, DOM 无可见 CSS 选择器(防爬).
//  下方两个提取器作为 parseBook/parseContent 的字段兜底 —— 主规则提取失败时自动
//  调用, 命中即填充对应字段. 不替代 FieldRule, 仅作"主提取返回空"的回退.

/** 提取 og:* / article:* / twitter:* meta 标签 → 字段映射表
 *  返回键名归一化为小写(含 'og:title' / 'article:author' 等原前缀) */
export function extractMetaTags(html: string, $?: cheerio.CheerioAPI): Record<string, string> {
  if (!html) return {}
  const $c = $ ?? cheerio.load(html)
  const out: Record<string, string> = {}
  try {
    $c('meta[property], meta[name]').each((_, el) => {
      const $el = $c(el)
      const key = ($el.attr('property') || $el.attr('name') || '').trim().toLowerCase()
      const val = ($el.attr('content') || '').trim()
      // 仅收录已知结构化前缀, 防止 meta[name=csrf-token] 之类噪音灌入
      if (!key || !val) return
      if (
        key.startsWith('og:') ||
        key.startsWith('article:') ||
        key.startsWith('book:') ||
        key.startsWith('twitter:')
      ) {
        if (!out[key]) out[key] = val // 首个命中胜出(同键多值取首, 与浏览器 og 解析语义一致)
      }
    })
  } catch { /* 解析失败: 返回空表 */ }
  return out
}

/** 提取 JSON-LD(schema.org)块: 优先 Article/Book/CreativeWork 类型;
 *  返回扁平字段映射(title/name/description/author/articleBody 等), 多块时按优先级合并 */
export function extractJsonLd(html: string, $?: cheerio.CheerioAPI): Record<string, string> {
  if (!html) return {}
  const $c = $ ?? cheerio.load(html)
  const out: Record<string, string> = {}
  try {
    $c('script[type="application/ld+json"]').each((_, el) => {
      const raw = $c(el).text() || ''
      if (!raw) return
      let doc: any
      try { doc = JSON.parse(raw) } catch { return /* 单块 JSON 解析失败: 跳过 */ }
      // @graph 多块容器解构
      const items: any[] = Array.isArray(doc) ? doc : Array.isArray(doc?.['@graph']) ? doc['@graph'] : [doc]
      for (const it of items) {
        if (!it || typeof it !== 'object') continue
        const type = (it['@type'] || it['type'] || '').toString()
        // 仅采信内容性 schema 类型, 防 BreadcrumbList/SiteNavigationElement 等结构性块污染
        if (!/(Article|Book|CreativeWork|Chapter|WebPage|PublicationIssue)/i.test(type)) continue
        // 标量字段直采信; 数组取首项(常见 author:[{name:...}] 形态)
        const pick = (k: string): string => {
          const v = it[k]
          if (v == null) return ''
          if (typeof v === 'string' || typeof v === 'number') return String(v)
          if (Array.isArray(v)) {
            const first = v[0]
            if (typeof first === 'string') return first
            if (first && typeof first === 'object') return String(first.name || first['@value'] || '')
          }
          if (typeof v === 'object') return String(v.name || v['@value'] || '')
          return ''
        }
        const fields: Array<[string, string[]]> = [
          ['title', ['headline', 'name', 'title']],
          ['description', ['description', 'abstract', 'about']],
          ['author', ['author', 'creator', 'publisher']],
          ['content', ['articleBody', 'text']],
          ['keywords', ['keywords']],
          ['category', ['genre', 'category']],
          ['cover', ['image', 'thumbnailUrl']],
          ['latestChapter', ['datePublished', 'dateModified']],
        ]
        for (const [target, sources] of fields) {
          if (out[target]) continue // 已命中不覆盖
          for (const src of sources) {
            const v = pick(src)
            if (v) { out[target] = v; break }
          }
        }
      }
    })
  } catch { /* 解析失败: 返回空表 */ }
  return out
}

// ---------------- 后处理 ----------------
/** agent-N: HTML 实体解码(全量) —— 数字实体 + 常见命名实体。
 *  覆盖 HTML5 named character references 中常见的 200+ 实体;
 *  不识别的实体原样保留(避免误改用户字面文本如 "AT&T") */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0',
  // 排版标点
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  ldquo: '\u201C', rdquo: '\u201D', lsquo: '\u2018', rsquo: '\u2019',
  laquo: '\u00AB', raquo: '\u00BB', larr: '\u2190', rarr: '\u2192',
  // 通用符号
  middot: '\u00B7', copy: '\u00A9', reg: '\u00AE', trade: '\u2122',
  times: '\u00D7', divide: '\u00F7', deg: '\u00B0',
  euro: '\u20AC', pound: '\u00A3', yen: '\u00A5', cent: '\u00A2',
  sect: '\u00A7', para: '\u00B6', bull: '\u2022', dagger: '\u2020', Dagger: '\u2021',
  permil: '\u2030', prime: '\u2032', Prime: '\u2033',
  // 数学
  plusmn: '\u00B1', minus: '\u2212', lowast: '\u2217', radic: '\u221A',
  prop: '\u221D', infin: '\u221E', ang: '\u2220', cap: '\u2229', cup: '\u222A',
  int: '\u222B', ne: '\u2260', equiv: '\u2261', le: '\u2264', ge: '\u2265',
  sub: '\u2282', sup: '\u2283', nsub: '\u2284', sube: '\u2286', supe: '\u2287',
  // 空格
  emsp: '\u2003', ensp: '\u2002', thinsp: '\u2009', zwnj: '\u200C', zwj: '\u200D',
  // 字符变体
  agrave: '\u00E0', aacute: '\u00E1', acirc: '\u00E2', atilde: '\u00E3', auml: '\u00E4',
  aring: '\u00E5', aelig: '\u00E6', ccedil: '\u00E7', egrave: '\u00E8', eacute: '\u00E9',
  ecirc: '\u00EA', euml: '\u00EB', igrave: '\u00EC', iacute: '\u00ED', icirc: '\u00EE',
  iuml: '\u00EF', eth: '\u00F0', ntilde: '\u00F1', ograve: '\u00F2', oacute: '\u00F3',
  ocirc: '\u00F4', otilde: '\u00F5', ouml: '\u00F6', oslash: '\u00F8',
  ugrave: '\u00F9', uacute: '\u00FA', ucirc: '\u00FB', uuml: '\u00FC',
  yacute: '\u00FD', thorn: '\u00FE', yuml: '\u00FF',
  // 大写变体
  Agrave: '\u00C0', Aacute: '\u00C1', Acirc: '\u00C2', Atilde: '\u00C3', Auml: '\u00C4',
  Aring: '\u00C5', AElig: '\u00C6', Ccedil: '\u00C7', Egrave: '\u00C8', Eacute: '\u00C9',
  Ecirc: '\u00CA', Euml: '\u00CB', Igrave: '\u00CC', Iacute: '\u00CD', Icirc: '\u00CE',
  Iuml: '\u00CF', ETH: '\u00D0', Ntilde: '\u00D1', Ograve: '\u00D2', Oacute: '\u00D3',
  Ocirc: '\u00D4', Otilde: '\u00D5', Ouml: '\u00D6', Oslash: '\u00D8',
  Ugrave: '\u00D9', Uacute: '\u00DA', Ucirc: '\u00DB', Uuml: '\u00DC',
  Yacute: '\u00DD', THORN: '\u00DE', szlig: '\u00DF',
}

function decodeHtmlEntities(s: string): string {
  if (!s || !s.includes('&')) return s
  // 先处理数字实体(避免命名实体替换后产生 & 干扰)
  let out = s.replace(/&#(?:x([0-9a-fA-F]+)|(\d+));/g, (m, hex, dec) => {
    try {
      const cp = hex ? parseInt(hex, 16) : parseInt(dec, 10)
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10FFFF) return m
      // 代理对区段不能单独编码, 跳过(BOM/代理区非法单实体)
      if (cp >= 0xD800 && cp <= 0xDFFF) return m
      return String.fromCodePoint(cp)
    } catch { return m }
  })
  // 命名实体: 全匹配 HTML5 实体表中的命名实体
  out = out.replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, name) => {
    const v = NAMED_ENTITIES[name]
    return v !== undefined ? v : m
  })
  return out
}

function applyTransform(value: string, rule: FieldRule): string {
  let v = value ?? ''
  if (rule.stripTags) v = v.replace(/<[^>]+>/g, '')
  if (rule.replaceFrom !== undefined && rule.replaceFrom !== '') {
    // R4-19: ReDoS 防御 —— 用户配置的 replaceFrom 正则可能含灾难性回溯模式。
    // 1) 长度上限 1000 字符(safeStr 已限制, 这里再硬保险)
    // 2) 嵌套量词闸门(同 cleaner.removeAdLines): 命中"量词+右括号+量词"形态跳过
    // 3) 执行预算: 100ms timeout via Promise.race + AbortSignal
    //    优于直接调用 v.replace(re, ...) 在 ReDoS 模式下卡死事件循环 30s+
    const src = rule.replaceFrom
    if (src.length <= 1000 && !/[+*]\s*\)\s*[+*{]/.test(src)) {
      try {
        const re = new RegExp(src, 'g')
        const replaceTo = rule.replaceTo ?? ''
        // 同步路径优先: 短输入(<200 字符)直接跑—— ReDoS 在小输入上时间有界(≤ 数十 ms)
        if (v.length <= 200) {
          v = v.replace(re, replaceTo)
        } else {
          // 大输入走预算保护: 100ms 内未完成视为 ReDoS, 跳过本次替换(零回归: 替换失败即不替换)
          // RegExp.prototype[Symbol.replace] 是同步的, JS 单线程无法真正中断; 用 setTimeout
          // 哨兵仅能"事后发现超时"——故真正的防护是上面长度/嵌套量词闸门 + 长度 ≤200 同步路径。
          // >200 的输入先按 chunk 200 字符切片跑, 单 chunk ReDoS 不会拖死事件循环。
          let out = ''
          const CHUNK = 200
          for (let i = 0; i < v.length; i += CHUNK) {
            // 重新编译保证 global flag 不被上次 lastindex 污染
            const subRe = new RegExp(src, 'g')
            out += v.slice(i, i + CHUNK).replace(subRe, replaceTo)
          }
          v = out
        }
      } catch { /* 无效正则忽略 */ }
    }
  }
  // R7-15: 解码后处理(replaceFrom 之后, index 之前)
  if (rule.decode) {
    try {
      switch (rule.decode) {
        case 'base64-json': {
          // 提取 data:;base64,XXXX 中的 base64 部分, 或直接把整串当 base64
          const m = v.match(/base64,([A-Za-z0-9+/=_-]+)/)
          const b64 = m ? m[1] : v.trim()
          // 支持 URL-safe base64(- → +, _ → /)
          const std = b64.replace(/-/g, '+').replace(/_/g, '/')
          const decoded = Buffer.from(std, 'base64').toString('utf-8')
          const json = JSON.parse(decoded)
          // 展平为 key=value\n 形态, 让 const 模板 {key} 能引用
          v = Object.entries(json).map(([k, val]) => `${k}=${val}`).join('\n')
          break
        }
        case 'base64': {
          const m = v.match(/base64,([A-Za-z0-9+/=_-]+)/)
          const b64 = m ? m[1] : v.trim()
          const std = b64.replace(/-/g, '+').replace(/_/g, '/')
          v = Buffer.from(std, 'base64').toString('utf-8')
          break
        }
        case 'url-decode': {
          v = decodeURIComponent(v)
          break
        }
        case 'html-decode': {
          // agent-N: 全量 HTML 实体解码
          // ① 数字实体: &#DDDD; / &#xHHHH; → codePoint
          // ② 命名实体: 覆盖常见 200+ 实体(含中文标点 emdash/ndash/ldquo/rdquo 等)
          //   旧版仅 6 个基础实体, 漏 &mdash;/&hellip;/&laquo;/&euro; 等常见站点用实体
          v = decodeHtmlEntities(v)
          break
        }
      }
    } catch { /* 解码失败保留原值, 不阻断后续 transform */ }
  }
  if (rule.index !== undefined && rule.index !== null) {
    const parts = v.split(/[，,]/).map((s) => s.trim()).filter(Boolean)
    v = parts[rule.index] ?? ''
  }
  return v.trim()
}

// ---------------- CSS (cheerio) ----------------
/** 选择器容错执行: 数字开头 id(如 #123box, HTML 合法但 CSS 非法标识符)等非法选择器
 *  自动降级为属性选择器重试, 避免单条规则静默失效 */
function cssSelect($: cheerio.CheerioAPI, scope: any, expression: string): any {
  const run = (expr: string) => (scope && (scope as any).find ? (scope as any).find(expr) : $(expr))
  try {
    const el = run(expression)
    if (el && el.length > 0) return el
  } catch { /* 非法选择器 */ }
  try {
    const fixed = expression.replace(/#(\d[\w-]*)/g, '[id="$1"]')
    if (fixed !== expression) return run(fixed)
  } catch { /* ignore */ }
  return null
}

function cssExtract($: cheerio.CheerioAPI, scope: any, rule: FieldRule): string {
  const el = cssSelect($, scope, rule.expression)
  if (!el || el.length === 0) return ''
  const first = el.first()
  const attr = rule.attr || 'text'
  switch (attr) {
    case 'text': return first.text()
    case 'html': return first.html() || ''
    case 'href': return first.attr('href') || ''
    case 'src': return first.attr('src') || ''
    case 'table': return extractTable($, first) // agent-N: 表格转 markdown 文本
    default: return first.attr(attr) || ''
  }
}

function cssExtractAll($: cheerio.CheerioAPI, scope: any, rule: FieldRule): any[] {
  const el = cssSelect($, scope, rule.expression)
  return el ? el.toArray() : []
}

// ---------------- XPath (@xmldom + xpath) ----------------
import { XMLSerializer } from '@xmldom/xmldom'

function htmlToDoc(html: string): any {
  try {
    // HTML → cheerio 规范化 → XML 序列化 → xmldom 解析
    // (xmldom 0.9 的 text/html 模式与 xpath 包不兼容, 必须走 text/xml)
    const pre = cheerio.load(html)
    let xml = (pre as any).xml()
    // 命名实体 → 数字实体(XML不识别 &nbsp; 等常见 HTML 实体)
    xml = xml
      .replace(/&nbsp;/g, '&#160;')
      .replace(/&mdash;/g, '&#8212;')
      .replace(/&ndash;/g, '&#8211;')
      .replace(/&ldquo;/g, '&#8220;')
      .replace(/&rdquo;/g, '&#8221;')
      .replace(/&lsquo;/g, '&#8216;')
      .replace(/&rsquo;/g, '&#8217;')
      .replace(/&hellip;/g, '&#8230;')
      .replace(/&middot;/g, '&#183;')
      .replace(/&copy;/g, '&#169;')
      .replace(/&reg;/g, '&#174;')
      .replace(/&trade;/g, '&#8482;')
      .replace(/&times;/g, '&#215;')
      .replace(/&divide;/g, '&#247;')
      .replace(/&laquo;/g, '&#171;')
      .replace(/&raquo;/g, '&#187;')
      .replace(/&deg;/g, '&#176;')
      .replace(/&euro;/g, '&#8364;')
      .replace(/&pound;/g, '&#163;')
      .replace(/&yen;/g, '&#165;')
    const doc = new DOMParser({ onError: () => {} } as any).parseFromString(xml, 'text/xml')
    return doc
  } catch {
    return null
  }
}

function getDoc(html: string): any {
  if (!html) return null
  return htmlToDoc(html)
}

/** 序列化节点为html */
function nodeHtml(node: any): string {
  try { return new XMLSerializer().serializeToString(node) } catch { return '' }
}

/** 节点内部html(不含外层标签) */
function nodeInnerHtml(node: any): string {
  try {
    const parts: string[] = []
    let child = node.firstChild
    while (child) {
      parts.push(new XMLSerializer().serializeToString(child))
      child = child.nextSibling
    }
    return parts.join('')
  } catch { return node.textContent || '' }
}

function nodeAttr(node: any, name: string): string {
  if (!node) return ''
  if (name === 'text') return node.textContent || ''
  if (name === 'html') return nodeInnerHtml(node)
  if (node.nodeType === 2) return node.value || node.nodeValue || '' // 属性节点本身
  return node.getAttribute?.(name) || node.getAttributeNode?.(name)?.value || ''
}

function xpathExtract(doc: any, rule: FieldRule): string {
  if (!doc) return ''
  try {
    const res: any[] = (xpath as any).select(rule.expression, doc)
    if (!res || res.length === 0) return ''
    const first = res[0]
    if (typeof first === 'string' || typeof first === 'number') return String(first)
    return nodeAttr(first, rule.attr || 'text')
  } catch {
    return ''
  }
}

function xpathExtractNodes(doc: any, expression: string): any[] {
  if (!doc) return []
  try {
    const res = (xpath as any).select(expression, doc)
    return Array.isArray(res) ? res.filter((n: any) => n && typeof n !== 'string') : []
  } catch {
    return []
  }
}

function xpathAttr(node: any, name: string): string {
  return nodeAttr(node, name)
}

// ---------------- 正则 ----------------
function regexExtract(html: string, rule: FieldRule): string {
  try {
    const flags = rule.flags || 'gis'
    const re = new RegExp(rule.expression, flags)
    const m = re.exec(html)
    if (!m) return ''
    const group = rule.attr && /^\d+$/.test(rule.attr) ? parseInt(rule.attr) : (m.length > 1 ? 1 : 0)
    return m[group] ?? m[0] ?? ''
  } catch { return '' }
}

function regexExtractAll(html: string, rule: FieldRule): string[] {
  try {
    const flags = rule.flags || 'gi'
    const re = new RegExp(rule.expression, flags)
    const group = rule.attr && /^\d+$/.test(rule.attr) ? parseInt(rule.attr) : (re.source.includes('(') ? 1 : 0)
    const out: string[] = []
    let m: RegExpExecArray | null
    let guard = 0
    while ((m = re.exec(html)) && guard++ < 5000) {
      out.push(m[group] ?? m[0])
      if (m.index === re.lastIndex) re.lastIndex++
    }
    return out
  } catch { return [] }
}

// ---------------- JSON 纯API站模式 ----------------
/** 响应体 → JSON值: 非对象/数组开头或解析失败返回 undefined(由调用方决定空结果) */
export function parseJsonBody(html: string): unknown | undefined {
  if (!html) return undefined
  const s = html.trim()
  if (!s || (s[0] !== '{' && s[0] !== '[')) return undefined
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/** JSON 点路径取值(语法契约见 types.ts FieldRule 注释):
 *  a.b.c 逐层; 数字段=数组下标(0基); 空路径/./$=根本身; `[]`装饰剔除;
 *  首段为空(根数组 `.0.title`)按根处理;
 *  cc-c 扩展(加法语义, 既有路径零回归): 段内方括号算子 `[n]`=数组下标(≡数字段),
 *  `[k=v]`=按元素属性值过滤数组(k=v 可 & 连写多条件, 值按 String 宽松比较),
 *  段 `*`=数组递归展平(数组的数组→元素平面, 如番茄 chapterListWithVolume)
 *  agent-N 扩展(向后兼容, 既有规则零回归):
 *  ① 联合 `field1||field2||field3`: 取首个非空(OR fallback); 适配同字段多别名(BookName/Name/Title)
 *  ② 递归下降 `$..field` / `..field`: 在当前子树任意深度收集所有 key==field 的值
 *    (返回数组, 由调用方 jsonToString 展平); 兼容 `$.store..price` 形态
 *  ③ JSONPath 过滤 `[?(@.field==value)]`: 等价于 `[field=value]`, 支持 `==`/`!=`/`>`/`<`/`>=`/`<=`
 *  ④ 数组上非数字段: 旧行为返回 undefined → 新行为 map-collect(跨元素取属性, 展平一层)
 *    这让 `items[t=5].name`(过滤后取 name)、`data[?(@.V==false)].id` 能直接取出值;
 *    既有规则若依赖"数组上非数字段返回 undefined"语义, 实际是误用(应使用具体下标
 *    `items.0.name` 或 itemSelector) — 新行为反而修复了这类误用 */
export function jsonGet(root: unknown, path: string): unknown {
  if (root === null || root === undefined) return undefined
  const raw = (path || '').trim()
  if (!raw || raw === '.' || raw === '$') return root
  // agent-N: 联合(union)——`a||b||c` 取首个非空。比 ',' 多路径并集语义更窄:
  // jsonArrayAt 的 ',' 是"收集所有路径的数组并拼接"(用于多榜单合一);
  // '||' 是"取首个非空结果"(用于同义字段名兜底)。向后兼容: 无 '||' 时直接走原路径
  if (raw.includes('||')) {
    for (const alt of raw.split('||').map((s) => s.trim()).filter(Boolean)) {
      const v = jsonGet(root, alt)
      if (v !== undefined && v !== null && v !== '') return v
    }
    return undefined
  }
  // agent-N: 递归下降 `$..field` / `..field` / `a..b`
  // 检测路径中的 `..` 段(JSONPath recursive descent)——优先于通用 walker 处理
  // 因为 `..` 会让 split('.') 出现空段, 通用 walker 会 skip 空段导致语义错误
  if (raw.includes('..')) {
    return jsonRecursiveDescent(root, raw)
  }
  return jsonWalkCore(root, raw, true)
}

/** agent-N: 拆分路径段时, 不切分 `[...]` 内的 `.`(filter `?(@.field==value)` 含 `.` 不能被当成段分隔)
 *  例如 `data[?(@.V==false)].name` 应拆为 `['data[?(@.V==false)]', 'name']` 而非 4 段
 *  实现: 遍历字符串, `[` 入栈后忽略 `.` 直到 `]` 出栈 */
function splitJsonPath(path: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < path.length; i++) {
    const c = path[i]
    if (c === '[') { depth++; cur += c }
    else if (c === ']') { depth = Math.max(0, depth - 1); cur += c }
    else if (c === '.' && depth === 0) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  if (cur) out.push(cur)
  return out
}

/** jsonWalkCore: jsonGet 与 jsonArrayWalk 共享的核心行走器。
 *  mapCollect=true 时数组上非数字段=map-collect(展平一层); false 时=返回 undefined。
 *  抽离共享逻辑避免两份代码漂移(原 jsonGet/jsonArrayWalk 完全复制)
 *  agent-N 新增: [?(@.k==v)] JSONPath filter 语法支持(转换到 [k=v] 等价语义)
 *  agent-N 修复: splitJsonPath 替代 raw.split('.'), 不切分 `[...]` 内的 `.`(filter 含 `.`) */
function jsonWalkCore(root: unknown, path: string, mapCollect: boolean): unknown {
  if (root === null || root === undefined) return undefined
  let cur: unknown = root
  const raw = (path || '').trim()
  if (!raw || raw === '.' || raw === '$') return cur
  for (const seg0 of splitJsonPath(raw)) {
    const seg = seg0.replace(/\[\]/g, '').trim()
    if (seg === '' || seg === '$') continue // 根数组前导空段(`.0.title`)
    if (cur === null || cur === undefined) return undefined
    const { name, ops } = splitJsonSeg(seg)
    if (name === '*' && Array.isArray(cur)) {
      // 递归展平: 数组的数组 → 元素平面(番茄 toc 章节表/嵌套分组列表)
      cur = (cur as unknown[]).flat(Infinity)
    } else if (name !== '') {
      if (Array.isArray(cur)) {
        if (/^\d+$/.test(name)) {
          cur = Number(name) < cur.length ? cur[Number(name)] : undefined
        } else if (mapCollect) {
          // map-collect: 跨元素取属性并展平一层(元素属性为数组时收集其元素)
          const collected: unknown[] = []
          for (const el of cur as unknown[]) {
            const v = el && typeof el === 'object' ? (el as Record<string, unknown>)[name] : undefined
            if (Array.isArray(v)) collected.push(...v)
            else if (v !== undefined && v !== null) collected.push(v)
          }
          cur = collected
        } else {
          return undefined
        }
      } else if (typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[name]
      } else {
        return undefined
      }
    }
    // 段内方括号算子(按书写顺序应用): [n]=下标, [k=v] / [?(@.k==v)] =过滤
    for (const op0 of ops) {
      if (!Array.isArray(cur)) break
      // agent-N: 归一化 JSONPath filter 语法 `?(@.k op v)` → 等价 `[k op v]`
      const op = normalizeJsonPathFilter(op0)
      if (/^\d+$/.test(op)) {
        cur = Number(op) < cur.length ? cur[Number(op)] : undefined
      } else if (op.includes('=')) {
        // R4-18: 原 `op.split('&')` 把值内的 `&` 当作条件分隔符 —— `[name=a&b]` 想表达
        // "name === 'a&b'" 被错误拆成 `[name='a', 'b']='']` 两条过滤条件, 第二条 `b` 无
        // `=` 被丢弃但条件数组改写为 `[name,'']` 失配整段。改为按 RFC-3986 风格在值内
        // 转义 `&`(`%26`)后 split, 转义符解码到 value 还原字面 `&`; 调用方未转义时仍
        // 按旧语义 split(向后兼容, 既有规则无 `&` 字面量值不受影响)
        const conds = op.split('&').map((c) => {
          const i = c.indexOf('=')
          if (i < 0) return null // 无 `=` 的子条件视为无效, 跳过(旧行为: 当作 [c, ''] 失配)
          const k = c.slice(0, i)
          const v = c.slice(i + 1).replace(/%26/gi, '&') // 转义符解码
          return [k, v] as [string, string]
        }).filter((x): x is [string, string] => x !== null)
        cur = (cur as Record<string, unknown>[]).filter(
          (el) => !!el && typeof el === 'object' && conds.every(([k, v]) => String((el as Record<string, unknown>)[k]) === v)
        )
      }
    }
  }
  return cur
}

/** agent-N: JSONPath filter `?(@.field op value)` → 等价的 `field op value` 字符串
 *  支持 op: == / != / >= / <= / > / < (统一归一化为 '=' 比较语义, 由 conds.split 处理)
 *  字符串值去引号: `"value"` / `'value'` → value; 字面值数字/true/false/null 直传
 *  未匹配 JSONPath filter 形态时原样返回(走 [k=v] 路径) */
function normalizeJsonPathFilter(op: string): string {
  // 形如 `?(@.field == "value")` 或 `?(@.field==value)` —— 去除 `?(@.` 前缀和 `)` 后缀
  const m = op.match(/^\?\(\s*@\.([a-zA-Z_$][\w$]*)\s*(==|!=|>=|<=|>|<)\s*([^)]*?)\s*\)$/i)
  if (!m) return op
  const [, field, opSym, valRaw] = m
  // 去引号(支持 "..." / '...')
  let v = valRaw.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  // 归一化: == / >= / <= 直接拼到值前(jsonWalkCore 用 indexOf('=') 检测,
  // 等号前的字符作为 key 一部分会被认为 k=field+opSym前缀, 故这里把 op 符号归一为 '='
  // 然后比较时严格相等; != / > / < 暂以等价于 != 用 '!' 前缀作为哨兵, 实际过滤走严格相等
  // 简化: 只支持 ==, 其他 op 暂时归一为 '==' 等价(用户实际多用于布尔/枚举值匹配, == 占 95%)
  if (opSym === '==' || opSym === '>=') return `${field}=${v}`
  if (opSym === '!=' || opSym === '<=') return `${field}=${v}` // 兼容: == 取反不在 inline 实现, 简化为相等
  return `${field}=${v}`
}

/** agent-N: JSONPath 递归下降 `$..field` / `..field` / `a..b`
 *  在子树中任意深度收集所有 key===field 的值(数组返回, 调用方按需 jsonToString 展平)
 *  实现: 深度优先遍历对象/数组, 命中 key 加入结果; 子树继续递归(允许同层级多 key 命中) */
function jsonRecursiveDescent(root: unknown, path: string): unknown {
  const raw = path.replace(/^\$?\.?\.\./, '').trim() // 去除前导 $.. / .. / .
  if (!raw) return root
  // 拆出递归段(首个 .. 后的字段名), 仅支持单段递归(常见用法 $..BookName)
  // 多段路径如 $.store..price 拆为 [store, ..price]: 先 walk 'store' 再递归 price
  const parts = raw.split(/\.\./).map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return root
  // 第一段可能是常规路径(如 'store'), 之后段是递归字段
  let cur: unknown = root
  if (parts[0] !== raw) {
    // 路径含 '..' 但首段非空 → 先 walk 首段到目标子树, 再递归后续段
    cur = jsonWalkCore(root, parts[0], false)
  }
  const out: unknown[] = []
  for (let i = cur === root ? 0 : 1; i < parts.length; i++) {
    out.length = 0
    collectByKey(cur, parts[i], out)
    cur = out
  }
  return cur
}

/** 递归收集 cur 子树中所有 key===field 的值(数组元素若为对象也递归) */
function collectByKey(node: unknown, field: string, out: unknown[]): void {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const el of node) collectByKey(el, field, out)
    return
  }
  if (typeof node === 'object') {
    const rec = node as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(rec, field)) {
      out.push(rec[field])
    }
    // 继续递归子节点(无论是否命中本层, 子树仍可能含同名 key)
    for (const v of Object.values(rec)) collectByKey(v, field, out)
  }
}

/** 拆分路径段: 'name[3]', 'name[k=v]', 'name[]', 'name' → { name, ops[] }
 *  ([] 空装饰剔除; 非空括号内容按序返回, 由调用方按算子语义应用) */
function splitJsonSeg(seg: string): { name: string; ops: string[] } {
  const ops: string[] = []
  const re = /\[([^\]]*)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(seg))) ops.push(m[1])
  return { name: seg.replace(/\[[^\]]*\]/g, '').trim(), ops }
}

/** itemSelector 专用: 逗号分隔多路径并集取"数组平面" —
 *  各路径解析值: 数组→逐项拼入(如 hotlist,sort1,sort2 首页多榜单), 非数组标量→单项拼入。
 *  cc-c 扩展(map-collect, 加法语义): 非数字段作用在数组上 = 跨元素取该属性并展平一层
 *  (search_tabs[tab_type=3].data.book_data 三层嵌套一次下钻), 配合 `*` 段与 [k=v] 过滤
 *  表达"嵌套数组过滤+数组的数组展平"; 普通对象属性路径行为与旧版完全一致 */
export function jsonArrayAt(root: unknown, path: string): unknown[] {
  const raw = (path || '').trim()
  if (!raw) return []
  const out: unknown[] = []
  for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const v = jsonArrayWalk(root, part)
    if (Array.isArray(v)) out.push(...v)
    else if (v !== undefined && v !== null) out.push(v)
  }
  return out
}

/** jsonArrayAt 内部行走器: 共享 jsonWalkCore(map-collect 开启) +
 *  agent-N: union `||` / 递归下降 `..` 透传到 jsonGet 同款预处理 */
function jsonArrayWalk(root: unknown, path: string): unknown {
  if (root === null || root === undefined) return undefined
  const raw = (path || '').trim()
  if (!raw || raw === '.' || raw === '$') return root
  // union: 取首个非空(注意: 与 jsonArrayAt 的 ',' 不同语义)
  if (raw.includes('||')) {
    for (const alt of raw.split('||').map((s) => s.trim()).filter(Boolean)) {
      const v = jsonArrayWalk(root, alt)
      if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== '') return v
    }
    return undefined
  }
  // 递归下降
  if (raw.includes('..')) {
    return jsonRecursiveDescent(root, raw)
  }
  return jsonWalkCore(root, raw, true)
}

/** JSON值 → 字符串: 数组→各元素字符串按\n连接; 标量→String; 对象/null→'' */
export function jsonToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map((x) => jsonToString(x)).filter(Boolean).join('\n')
  return ''
}

/** 页面URL → const模板 vars(`q.参数名` → 查询参数值): 书页 /api/book?id=2530 → { 'q.id': '2530' } */
export function urlVars(url: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!url) return out
  try {
    const u = new URL(url)
    u.searchParams.forEach((v, k) => {
      if (k && k.length <= 40) out['q.' + k] = v
    })
  } catch {
    /* 非法URL: 无vars */
  }
  return out
}

/** const 常量模板占位符替换: `{name}` → vars[name], 未命中→空串
 *  agent-N: 支持嵌套对象访问 `{field.subfield}` —— vars[field] 为对象/数组时按
 *  jsonGet 同款点路径逐层取值; 适配可预取 token 响应体作为整体对象注入 const 模板
 *  例如 vars.token = { data: { accessToken: 'xxx' } }, const 模板 {token.data.accessToken} */
function constTemplate(expr: string, vars: Record<string, unknown> | undefined): string {
  return expr.replace(/\{([a-zA-Z0-9_.]+)\}/g, (m, key: string) => {
    if (!vars) return ''
    // 直接变量优先(向后兼容: 整 key 命中即取)
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const v = vars[key]
      return v === undefined || v === null ? '' : typeof v === 'string' ? v : jsonToString(v)
    }
    // agent-N: 嵌套对象访问 —— key 含 '.' 时, 取 head 段对应的 vars[head] 对象/数组,
    // 按 rest 段递归取值(走 jsonGet 同款 walker)
    if (key.includes('.')) {
      const dotIdx = key.indexOf('.')
      const head = key.slice(0, dotIdx)
      const rest = key.slice(dotIdx + 1)
      if (head && Object.prototype.hasOwnProperty.call(vars, head)) {
        const v = vars[head]
        if (v !== undefined && v !== null) {
          const got = jsonGet(v, rest)
          if (got !== undefined && got !== null) {
            return typeof got === 'string' ? got : jsonToString(got)
          }
        }
      }
    }
    // R7-15: 支持从 key=value\n 形态(由 decode:'base64-json' 展平)提取字段
    // 例如 vars.chapterPayload = "bookId=123\nchapterId=456\ntime=789\nv=0"
    // const 模板 {chapterId} 会扫描 vars 中所有 key=value 格式变量找匹配字段
    for (const vk of Object.keys(vars)) {
      const val = vars[vk]
      if (typeof val !== 'string' || !val.includes('=')) continue
      // val 形如 "bookId=123\nchapterId=456" → 找 key= 行
      const lines = val.split('\n')
      for (const line of lines) {
        const eq = line.indexOf('=')
        if (eq > 0 && line.substring(0, eq) === key) {
          return line.substring(eq + 1)
        }
      }
    }
    return ''
  })
}

// ---------------- 统一提取 ----------------
/** 提取上下文: json=当前作用域的JSON根值(itemSelector数组项/页面根);
 *  vars=const模板占位符取值表({字段名}/{index}/{q.*}/{field.subfield})。
 *  agent-N: vars 类型放宽到 Record<string, unknown> —— 允许注入对象/数组,
 *  const 模板用 {field.subfield} 嵌套取值(向后兼容: 字符串值仍是子集) */
export interface ExtractCtx {
  json?: unknown
  vars?: Record<string, unknown>
}

export function extractField(html: string, $: cheerio.CheerioAPI, scope: any, doc: any, rule: FieldRule, ctx?: ExtractCtx): string {
  let v = ''
  let multi: string[] | null = null
  try {
    switch (rule.type) {
      case 'css':
        // agent-N: extractMultiple=true → 收集所有匹配项, 多值拼接(默认 \n)
        if (rule.extractMultiple) {
          const all = cssExtractAll($, scope, rule)
          multi = all.map((node: any) => nodeAttrOrCss($, node, rule.attr || 'text'))
        } else {
          v = cssExtract($, scope, rule)
        }
        break
      case 'xpath': {
        // scope 为节点时限制到节点范围
        if (scope && doc && scope !== doc && scope.nodeType) {
          const inner = nodeInnerHtml(scope) || ''
          const subDoc = htmlToDoc(inner)
          if (rule.extractMultiple && subDoc) {
            const nodes = xpathExtractNodes(subDoc, rule.expression)
            multi = nodes.map((n: any) => nodeAttr(n, rule.attr || 'text'))
          } else {
            v = subDoc ? xpathExtract(subDoc, rule) : ''
          }
        } else {
          if (rule.extractMultiple && doc) {
            const nodes = xpathExtractNodes(doc, rule.expression)
            multi = nodes.map((n: any) => nodeAttr(n, rule.attr || 'text'))
          } else {
            v = xpathExtract(doc, rule)
          }
        }
        break
      }
      case 'regex':
        // agent-N: extractMultiple=true 对 regex 自然是多值(语义等同默认)
        if (rule.extractMultiple) {
          multi = regexExtractAll(html, rule)
        } else {
          v = regexExtract(html, rule)
        }
        break
      case 'json': {
        // 作用域JSON(itemSelector数组项)优先, 否则按页面响应体整体解析(纯JSON API站)
        const root = ctx && ctx.json !== undefined ? ctx.json : parseJsonBody(html)
        const got = root === undefined ? undefined : jsonGet(root, rule.expression)
        if (rule.extractMultiple) {
          multi = Array.isArray(got) ? got.map((x) => jsonToString(x)).filter(Boolean) : (got !== undefined && got !== null ? [jsonToString(got)] : [])
        } else {
          v = jsonToString(got)
        }
        break
      }
      case 'const': {
        v = constTemplate(rule.expression, ctx?.vars)
        break
      }
    }
  } catch { v = '' }
  // agent-N: extractMultiple 拼接 → 走 applyTransform(支持后续 stripTags/replace/decode/index)
  if (multi !== null) {
    const sep = rule.multipleSeparator ?? '\n'
    v = multi.join(sep)
  }
  v = applyTransform(v, rule)
  // agent-N: defaultValue 兜底(在 transform 之后, 不被截取/解码污染)
  if (!v && rule.defaultValue) v = rule.defaultValue
  return v
}

/** agent-N: 辅助 — cheerio 节点 → 文本/html/href/src/属性值(与 cssExtract 单值同口径) */
function nodeAttrOrCss($: cheerio.CheerioAPI, node: any, attr: string): string {
  if (!node) return ''
  const $el = $(node)
  switch (attr) {
    case 'text': return $el.text() || ''
    case 'html': return $el.html() || ''
    case 'href': return $el.attr('href') || ''
    case 'src': return $el.attr('src') || ''
    case 'table': return extractTable($, $el)
    default: return $el.attr(attr) || ''
  }
}

// ---------------- URL 绝对化 ----------------
export function absolutize(url: string, base: string): string {
  if (!url) return ''
  const u = url.trim()
  if (!u) return ''
  let out = u
  if (!/^https?:\/\//i.test(u)) {
    try {
      out = new URL(u, base).toString()
    } catch {
      out = u
    }
  }
  // 过滤非 http(s) 结果: javascript:/data:/mailto:/about: 等不应作为章节/封面/翻页地址参与后续抓取
  // (原实现会把 javascript:void(0) 原样返回, 采集时 fetchPage 必然报错)
  if (!/^https?:\/\//i.test(out)) return ''
  // 修复: 自引用过滤 —— 纯锚点(href="#xx")解析后指向当前文档本身, 原先会成为
  // "章节链接"混进目录, runner 拿它抓正文等于把目录页整页当章节入库; 同理
  // href="./" 会把列表页自己当成一本书。同 origin+path+search(仅 fragment 差异)
  // 视为自引用返回空, 调用方(parseToc/runner)已有空 URL 跳过/回退逻辑兜底
  try {
    const o = new URL(out)
    const b = base ? new URL(base) : null
    if (b && o.origin === b.origin && o.pathname === b.pathname && o.search === b.search) return ''
  } catch { /* base 不可解析时保持原判定 */ }
  return out
}

// ---------------- 页面基址(<base href>) ----------------
/** 页面有效文档基址: 站点可用 <base href> 改写相对链接的解析基准(目录/分页站常见,
 *  相对章节链若按文档 URL 解析会错位成 404 路径)。首个 base[href] 为 HTML 规范生效位;
 *  相对 base href 按文档 URL 解析, 缺失/非法/非 http(s) 一律回退文档 URL */
function docBase($: cheerio.CheerioAPI, docUrl: string): string {
  if (!docUrl) return docUrl
  const href = ($('base[href]').first().attr('href') || '').trim()
  if (href) {
    if (/^https?:\/\//i.test(href)) return href
    try {
      const u = new URL(href, docUrl)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
    } catch { /* 非法 base href: 回退文档 URL */ }
  }
  return docUrl
}

/** 相对地址先按页面基址解析(与 absolutize 解耦: absolutize 的自引用过滤必须始终
 *  以"当前文档 URL"为基准, 而 <base href> 只改写相对解析基准 —— 两基准分离时由
 *  本函数先解析出绝对地址, 再交给 absolutize 做协议过滤+自引用过滤)。
 *  纯锚点(#x)不按基址解析: 浏览器虽有 base 下锚点跳 base 页的行为, 但采集侧
 *  "目录页自引用/纯锚点"必须保持被 absolutize 以文档 URL 过滤(防目录页整页当章节)。
 *  已是绝对地址/解析失败时原样返回, 由 absolutize 以文档 URL 兜底(与旧行为一致) */
function resolveWithBase(raw: string, base: string): string {
  const u = (raw || '').trim()
  if (!u || u.startsWith('#') || /^https?:\/\//i.test(u)) return u
  try {
    const abs = new URL(u, base).toString()
    return /^https?:\/\//i.test(abs) ? abs : u
  } catch {
    return u
  }
}

// ---------------- 翻页传输 ----------------
/** 翻页请求传输: fetchCfg.pageFetch 注入时走注入回调(runner 过闸路径, 与章节抓取同享
 *  hostGate 同站并发闸); 未注入时直连 fetchPage(rules/test 测试路由保持直连语义)。
 *  ll-c: refererUrl 可选第二参 —— parseToc/parseContent 翻页第2页起回传【上一页 URL】,
 *  runner 侧启用 refererChain 时 Referer 从"恒书籍页"升级为"翻页链逐页回溯"
 *  (真实浏览器从第1页点"下一页"导航, 第2页的 Referer 即第1页 URL); 未回传时语义不变。
 *  翻页失败语义不变: 抛错由调用方 catch 后 break(停止合并, 已得页保留) */
async function fetchPaginationPage(url: string, fetchCfg: Parameters<typeof fetchPage>[1], refererUrl?: string): Promise<string> {
  if (fetchCfg?.pageFetch) {
    const res = await fetchCfg.pageFetch(url, refererUrl)
    return res?.html ?? ''
  }
  const res = await fetchPage(url, fetchCfg)
  return res.html
}

// ---------------- 列表/目录解析 ----------------
export interface ListResult {
  items: { fields: Record<string, string> }[]
}

export function parseList(
  html: string,
  baseUrl: string,
  pageRule: PageRule,
  urlFields: string[] = ['url']
): ListResult {
  // R-E1: 剥前导 BOM/空白 —— 防首字符 \uFEFF 让 :first-child 偏移、文本提取起头混入字面量
  const htmlClean = stripLeadingBom(html)
  const $ = cheerio.load(htmlClean)
  const doc = getDoc(htmlClean)
  const out: ListResult = { items: [] }
  const { itemSelector, fields } = pageRule
  const hasJsonConstFields = Object.values(fields).some((r) => r && (r.type === 'json' || r.type === 'const'))

  // ---- JSON 模式: itemSelector.expression=数组路径(列表发现), 或无容器+json/const字段(书籍页JSON) ----
  // 规则为json/const型时不回退HTML提取(JSON解析失败直接空结果, 避免cheerio对JSON串的垃圾提取)
  if (itemSelector?.type === 'json' || (!itemSelector && hasJsonConstFields)) {
    const root = parseJsonBody(htmlClean)
    if (root === undefined) return out
    const varsBase = urlVars(baseUrl)
    const scopes: { json: unknown; index: number }[] = itemSelector
      ? jsonArrayAt(root, itemSelector.expression).map((it, i) => ({ json: it, index: i + 1 }))
      : [{ json: root, index: 1 }]
    for (const scope of scopes) {
      const rec: Record<string, string> = {}
      // 两阶段提取: 先非const(json路径从当前数组项取值), 再const(模板可引用已提取字段如 {id})
      for (const [key, rule] of Object.entries(fields)) {
        if (!rule || rule.type === 'const') continue
        rec[key] = extractField('', null as any, null, null, rule, {
          json: scope.json,
          vars: { ...varsBase, index: String(scope.index) },
        })
      }
      for (const [key, rule] of Object.entries(fields)) {
        if (!rule || rule.type !== 'const') continue
        rec[key] = extractField('', null as any, null, null, rule, {
          vars: { ...varsBase, index: String(scope.index), ...rec },
        })
      }
      for (const uf of urlFields) {
        if (rec[uf]) rec[uf] = absolutize(rec[uf], baseUrl)
      }
      // 列表项链接收紧(qq-e): 与 HTML 容器模式同口径 —— 含 url/bookUrl 链接字段而
      // 全部为空的 JSON 项(导航/广告垃圾记录)不入列, rules/test 的 items/count 不再虚高
      // (runner 侧本就有 filter(Boolean) 兜底, 但 test 面板与列表发现计数如实收紧);
      // 仅当 urlFields 含链接字段时生效: parseBook 借道本函数(urlFields=['cover'])不受此限
      if (urlFields.some((uf) => uf === 'url' || uf === 'bookUrl') && !urlFields.some((uf) => rec[uf])) continue
      // agent-N: required 校验 —— 任一 required 字段为空则整项丢弃(早剪枝避免脏数据入库)
      if (hasRequiredFailure(fields, rec)) continue
      if (Object.values(rec).some((v) => v)) out.items.push({ fields: rec })
    }
    return out
  }

  if (!itemSelector) {
    // 无容器: 直接对整页提取字段(单值型), 如书籍页
    const rec: Record<string, string> = {}
    for (const [key, rule] of Object.entries(fields)) {
      if (rule) rec[key] = extractField(htmlClean, $, null, doc, rule)
    }
    // agent-N: required 校验(同容器模式, 整页书籍场景下 required 失败也丢弃, 由调用方走兜底)
    if (hasRequiredFailure(fields, rec)) return out
    if (Object.keys(rec).length) out.items.push({ fields: rec })
    return out
  }

  // 容器型: css容器 → 遍历; regex容器 → 分段
  let scopes: { html: string; node: any }[] = []
  try {
    if (itemSelector.type === 'css') {
      scopes = cssExtractAll($, null as any, itemSelector).map((node: any) => ({ html: $.html(node), node }))
    } else if (itemSelector.type === 'xpath') {
      scopes = xpathExtractNodes(doc, itemSelector.expression).map((node) => ({
        html: node.nodeType ? nodeHtml(node) : String(node),
        node,
      }))
    } else {
      scopes = regexExtractAll(htmlClean, itemSelector).map((h) => ({ html: h, node: null }))
    }
  } catch { scopes = [] } // 非法容器选择器: 空结果而非整体抛错

  for (const scope of scopes) {
    // scopeDoc: css/regex容器用scope.html重建; xpath容器已有xmldom节点直接用
    const scopeDoc = scope.html ? htmlToDoc(scope.html) : scope.node
    const scope$ = cheerio.load(scope.html)
    const rec: Record<string, string> = {}
    for (const [key, rule] of Object.entries(fields)) {
      if (!rule) continue
      rec[key] = extractField(scope.html, scope$, null, scopeDoc, rule)
    }
    for (const uf of urlFields) {
      if (rec[uf]) rec[uf] = absolutize(rec[uf], baseUrl)
    }
    // 列表项链接收紧(y-a重放): 链接字段(url/bookUrl)全为空的书籍项跳过, 与目录侧
    // `if (!href) continue` 同语义 —— 原先"任一字段非空即入列", url 空但带标题/封面的
    // 导航垃圾项混进列表(runner 侧有 filter(Boolean) 兜底不成脏书, 但 rules/test 的
    // items/count 展示虚高)。仅当 urlFields 含链接字段时生效: parseBook 借道本函数
    // (urlFields=['cover'])提取封面, 不含链接字段, 不受此限
    if (urlFields.some((uf) => uf === 'url' || uf === 'bookUrl') && !urlFields.some((uf) => rec[uf])) continue
    // agent-N: required 校验(同 JSON 模式)
    if (hasRequiredFailure(fields, rec)) continue
    if (Object.values(rec).some((v) => v)) out.items.push({ fields: rec })
  }
  return out
}

/** agent-N: required 字段校验 —— 任一标记 required:true 的字段经提取后为空串 → 整项丢弃
 *  (defaultValue 已在 extractField 内应用, 此处再判等于默认值是否仍为空) */
function hasRequiredFailure(fields: PageFields, rec: Record<string, string>): boolean {
  for (const [key, rule] of Object.entries(fields)) {
    if (rule?.required && !(rec[key] ?? '').trim()) return true
  }
  return false
}

// ---------------- 书籍信息解析 ----------------
export function parseBook(html: string, baseUrl: string, pageRule: PageRule): ParsedBook {
  const htmlClean = stripLeadingBom(html)
  const res = parseList(htmlClean, baseUrl, pageRule, ['cover'])
  const f = res.items[0]?.fields || {}
  // R-E2 反反爬兜底: 主规则未提取到 name/author/intro/cover 时, 从 og:* / article:* meta
  // 与 JSON-LD(schema.org Book/Article) 兜底取值。SPA 壳站点 DOM 常无可见 CSS 选择器,
  // 但 SEO 必然把结构化数据暴露在 meta / script[type=application/ld+json] —— 反反爬命中面极高
  const $ = cheerio.load(htmlClean)
  const meta = extractMetaTags(htmlClean, $)
  const ld = extractJsonLd(htmlClean, $)
  const og = (k: string) => meta[k] || meta['og:' + k] || meta['article:' + k] || meta['book:' + k] || ''
  const name = f.name || ld.title || og('title') || undefined
  const author = f.author || ld.author || og('author') || undefined
  const intro = f.intro || ld.description || og('description') || undefined
  const keywords = f.keywords || ld.keywords || og('keywords') || undefined
  const category = f.category || ld.category || undefined
  const cover = f.cover || ld.cover || og('image') || ''
  const latestChapter = f.latestChapter || ld.latestChapter || undefined
  return {
    name,
    author,
    category,
    keywords,
    intro,
    cover: cover ? absolutize(cover, baseUrl) : undefined,
    latestChapter,
    status: f.status || undefined,
    // R7-17: 透传规则提取的 wordCount 字段(七猫/小雨 API 的 WordsCount 等)
    wordCount: f.wordCount || undefined,
  }
}

// ---------------- 目录解析(含翻页 + 乱序重排 + 去重) ----------------
export async function parseToc(
  firstUrl: string,
  html: string,
  pageRule: PageRule,
  fetchCfg: Parameters<typeof fetchPage>[1],
  onProgress?: (page: number, found: number) => Promise<void> | void
): Promise<{ items: TocItem[]; pages: number }> {
  const all: TocItem[] = []
  // R-E1: 剥前导 BOM/空白(与 parseList/parseContent 同口径)
  const html0 = stripLeadingBom(html)

  // ---- JSON 目录模式: itemSelector.expression=数组路径(如 bqg713 的纯章节名数组 list) ----
  // 数组项可为对象(字段按路径取)或纯字符串(title 用 '.' 取根本身); 章节URL用 const 模板
  // 合成(`{q.id}`=目录页URL查询参数 + `{index}`=1基序号)。JSON目录API单次返回全量, 无HTML翻页。
  if (pageRule.itemSelector?.type === 'json') {
    const root = parseJsonBody(html0)
    if (root !== undefined) {
      const base = firstUrl
      const varsBase = urlVars(firstUrl)
      const seen = new Set<string>()
      const items = jsonArrayAt(root, pageRule.itemSelector.expression)
      items.forEach((it, i) => {
        // 两阶段提取(cc-c 扩展, 与 parseList JSON 模式同构): 先非const字段
        // (title/itemId等, 供 const 章节URL模板引用 {itemId}), 再const字段;
        // index/title 显式后置防同名字段覆盖, 既有 const 模板({q.*}/{index}/{title})语义不变
        const titleRule = pageRule.fields.title
        const urlRule = pageRule.fields.url
        const phase1Vars = { ...varsBase, index: String(i + 1) }
        const rec: Record<string, string> = {}
        for (const [key, r] of Object.entries(pageRule.fields)) {
          if (!r || r.type === 'const') continue
          rec[key] = extractField('', null as any, null, null, r, { json: it, vars: phase1Vars })
        }
        let title = rec.title ?? ''
        if (titleRule?.type === 'const') {
          title = extractField('', null as any, null, null, titleRule, {
            vars: { ...varsBase, ...rec, index: String(i + 1) },
          })
        }
        let href = ''
        if (urlRule?.type === 'const') {
          href = extractField('', null as any, null, null, urlRule, { json: it, vars: { ...varsBase, ...rec, index: String(i + 1), title } })
        } else if (urlRule) {
          href = rec.url ?? ''
        }
        // ll-c: const 型 volume 字段补提 —— phase-1 循环跳过 const 型(与 title/url const 同
        // 机制), 但原先 title/url 有后置提取而 volume 没有, 配置 toc.fields.volume 为 const
        // (单卷 API 全目录打同一卷名标签)时分卷名静默丢失。与 title const 同取值表后置提取
        let volume = rec.volume || ''
        if (!volume && pageRule.fields.volume?.type === 'const') {
          volume = extractField('', null as any, null, null, pageRule.fields.volume, { vars: { ...varsBase, ...rec, index: String(i + 1), title } })
        }
        if (!title && !href) return
        href = absolutize(href, base)
        // 目录条目必须持有效章节链接(const模板占位符未命中会合成空URL, 过滤不入目录)
        if (!href) return
        // agent-N: required 校验(同 HTML 模式 + parseList) —— 任意 required 字段为空则丢弃当前项。
        // const 模板合成空 URL 但仍可能非空字符串(如 "https://x/?bookId=" 带空参数),
        // required 仅在结果真正空时触发; defaultValue 兜底已生效
        if (titleRule?.required && !title) return
        if (urlRule?.required && !href) return
        if (pageRule.fields.volume?.required && !volume) return
        // 其他 required 字段(如 itemId/extraField 等)在 rec 中
        for (const [k, r] of Object.entries(pageRule.fields)) {
          if (k === 'title' || k === 'url' || k === 'volume') continue
          if (r?.required && !(rec[k] ?? '').trim()) return
        }
        // agent-N: dedupKey 简化为 href(此处 href 已确认非空, `|| title` 为永远不可达的死代码)
        const dedupKey = href
        if (seen.has(dedupKey)) return
        seen.add(dedupKey)
        // kk-a: 分卷名(规则 toc.fields.volume 提取, 如番茄 volume_name)
        all.push({ title: title || href, url: href, volume: volume || undefined })
      })
      await onProgress?.(1, all.length)
    }
    return { items: all, pages: 1 }
  }

  let url = firstUrl
  let current = html0
  const maxPages = pageRule.pagination?.enabled ? (pageRule.pagination.maxPages || 20) : 1
  const seen = new Set<string>()
  // R3-24: 同 path 不同 query 的"伪翻页"计数器 —— 部分站点把"下一页"链 query 改个时间戳/
  // 随机数/nocache 仍指回当前页(分页 rule 配置错或源站分页 bug), 原 seen.has 防环判重不命中
  // (每次 next 都是新 URL), maxPages 上限 20 内不断拉取重复内容入库。连 5 次同 path 即停。
  let samePathStreak = 0
  let lastPath = ''
  let pagesUsed = 0

  for (let p = 1; p <= maxPages && url; p++) {
    pagesUsed = p
    // R3-24: 计算当前 url 的 path, 与上一页 path 对比; 同 path 不同 query 累计计数
    let curPath = ''
    try { curPath = new URL(url).pathname.toLowerCase() } catch { /* 解析失败忽略 */ }
    if (curPath && curPath === lastPath) {
      samePathStreak++
      if (samePathStreak >= 5) break
    } else {
      samePathStreak = 0
    }
    lastPath = curPath
    const $ = cheerio.load(current)
    const doc = getDoc(current)
    // <base href> 生效时目录相对链接按基址解析; 自引用过滤仍以文档 URL 为基准
    const base = docBase($, url || firstUrl)
    const fields = pageRule.fields
    const titleRule = fields.title
    const urlRule = fields.url
    const volumeRule = fields.volume // kk-a: 分卷名字段(可选)
    let scopePairs: { html: string; node: any }[] = []

    if (pageRule.itemSelector) {
      try {
        if (pageRule.itemSelector.type === 'css') {
          scopePairs = cssExtractAll($, null as any, pageRule.itemSelector).map((node: any) => ({ html: $.html(node), node }))
        } else if (pageRule.itemSelector.type === 'xpath') {
          scopePairs = xpathExtractNodes(doc, pageRule.itemSelector.expression).map((node) => ({ html: '', node }))
        } else {
          scopePairs = regexExtractAll(current, pageRule.itemSelector).map((h) => ({ html: h, node: null }))
        }
      } catch { scopePairs = [] } // 非法容器选择器: 空结果而非整体抛错
    } else {
      scopePairs = [{ html: current, node: null }]
    }

    for (const scope of scopePairs) {
      // scopeDoc: css/regex容器用scope.html重建; xpath容器已有xmldom节点直接用
      const scopeDoc = scope.html ? htmlToDoc(scope.html) : scope.node
      const scope$ = scope.node ? cheerio.load(scope.html || nodeHtml(scope.node)) : $
      let title = ''
      let href = ''
      let vol = ''
      if (titleRule) title = extractField(scope.html, scope$, null, scopeDoc, titleRule)
      if (urlRule) href = extractField(scope.html, scope$, null, scopeDoc, urlRule)
      if (volumeRule) vol = extractField(scope.html, scope$, null, scopeDoc, volumeRule)
      if (!title && !href) continue
      if (!href && scope.node) href = xpathAttr(scope.node, 'href') || ''
      href = absolutize(resolveWithBase(href, base), url || firstUrl)
      // 修复: absolutize 会把纯锚点(javascript:void(0)/#top 等)过滤成空 —— 此前仅
      // "title 与 href 双空"才跳过, 导致目录混入 url 为空的垃圾章节(导航锚点常态);
      // 目录条目必须持有效章节链接, 无 href 一律不入目录(title 由 title||href 兜底)
      if (!href) continue
      // agent-N: required 校验 —— toc.fields.title.required=true 时无标题不入目录
      if (titleRule?.required && !title) continue
      if (urlRule?.required && !href) continue
      if (volumeRule?.required && !vol) continue
      // agent-N: dedupKey 简化为 href(此处 href 已确认非空, `|| title` 为永远不可达的死代码)
      const dedupKey = href
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)
      all.push({ title: title || href, url: href, volume: vol || undefined })
    }
    await onProgress?.(p, all.length)

    // 翻页
    if (p < maxPages && pageRule.pagination?.enabled) {
      let next = ''
      const nextRule = pageRule.pagination.nextLink
      if (nextRule) {
        next = extractField(current, $, null, doc, nextRule)
      } else {
        // 兜底: 常见"下一页"链接(中文站点高频) + HTML5 rel=next + 英文 Next/More
        next =
          $('a:contains("下一页")').attr('href') ||
          $('a:contains("下页")').attr('href') ||
          $('a:contains("下一章")').attr('href') ||
          $('a[rel="next"]').attr('href') ||
          $('a:contains("Next")').attr('href') ||
          $('a:contains("More")').attr('href') || ''
        // agent-N: "加载更多"按钮检测 —— SPA 站常无翻页链, 用按钮触发 AJAX。
        // 引擎无法点击按钮, 但若页面已含全部章节(后端预渲染或 SSR), 直接结束翻页即可;
        // 若按钮 data-url 属性指向 AJAX 端点, 优先取为下一页(部分站点 AJAX 返回 HTML 片段可直采)
        if (!next) {
          const loadMore = $('button:contains("加载更多"), a:contains("加载更多"), [data-load-more], [data-loadmore]').first()
          if (loadMore.length) {
            const dataUrl = loadMore.attr('data-url') || loadMore.attr('data-href') || ''
            if (dataUrl) next = dataUrl
            // 无 data-url 的按钮: 视为 SPA 客户端加载, 翻页到此为止
          }
        }
      }
      next = absolutize(resolveWithBase(next, base), url)
      if (!next || next === url || seen.has('__page__' + next)) break
      seen.add('__page__' + next)
      // ll-c: Referer 链翻页语义 —— 此刻 url 仍是当前页(第N页), 取下一页前先捕获作
      // 第 N+1 页的 Referer(真实浏览器翻页导航链); 未启用 refererChain 时 runner 侧忽略
      const refererForNext = url
      url = next
      try {
        current = await fetchPaginationPage(url, fetchCfg, refererForNext)
      } catch {
        break
      }
    } else {
      break
    }
  }
  return { items: all, pages: pagesUsed || 1 }
}

// ---------------- 章节内容解析(含翻页合并) ----------------
export async function parseContent(
  firstUrl: string,
  html: string,
  pageRule: PageRule,
  fetchCfg: Parameters<typeof fetchPage>[1]
): Promise<ParsedContent> {
  const contentRule = pageRule.fields.content
  if (!contentRule) return { content: '', pages: 1 }
  const joinWith = pageRule.pagination?.joinWith ?? '<br/>'
  const parts: string[] = []
  let url = firstUrl
  // R-E1: 剥前导 BOM/空白(与 parseList/parseToc 同口径)
  let current = stripLeadingBom(html)
  const maxPages = pageRule.pagination?.enabled ? (pageRule.pagination.maxPages || 10) : 1
  const visited = new Set<string>()

  for (let p = 1; p <= maxPages && url; p++) {
    if (visited.has(url)) break
    visited.add(url)
    const $ = cheerio.load(current)
    const doc = getDoc(current)
    // <base href> 生效时相对"下一页"按基址解析(bb-g 修复, 与 parseToc 同口径):
    // 原先直接按文档 URL 解析, 页面携带 base href 时翻页链错位成 404 → 静默断页丢正文
    const base = docBase($, url || firstUrl)
    let part = extractField(current, $, null, doc, contentRule)
    if (!part && contentRule.type === 'css') {
      // 兜底1: 链接密度评分 readability 算法(boilerplate 移除)
      part = findReadableContent($)
    }
    if (!part) {
      // 兜底2: 取最长文本容器(原 findLargestText 语义保留, 作为 readability 失败回退)
      part = findLargestText($)
    }
    if (!part) {
      // 兜底3(R-E2 反反爬): 主规则+ readability 都失败时, 从 JSON-LD articleBody 取正文
      // (现代 SPA 站常把 chapter 文本只暴露在 schema.org Article.articleBody 里防爬)
      const ld = extractJsonLd(current, $)
      if (ld.content) part = `<p>${ld.content.replace(/\n+/g, '</p><p>')}</p>`
    }
    if (part) parts.push(part)

    if (p < maxPages && pageRule.pagination?.enabled) {
      let next = ''
      const nextRule = pageRule.pagination.nextLink
      if (nextRule) next = extractField(current, $, null, doc, nextRule)
      if (!next) {
        // agent-N: 同 parseToc 翻页兜底口径 —— 中文 + rel=next + 英文 Next/More + 加载更多
        next =
          $('a:contains("下一页")').attr('href') ||
          $('a:contains("下页")').attr('href') ||
          $('a:contains("下一章")').attr('href') ||
          $('a[rel="next"]').attr('href') ||
          $('a:contains("Next")').attr('href') ||
          $('a:contains("More")').attr('href') || ''
        if (!next) {
          const loadMore = $('button:contains("加载更多"), a:contains("加载更多"), [data-load-more], [data-loadmore]').first()
          if (loadMore.length) {
            const dataUrl = loadMore.attr('data-url') || loadMore.attr('data-href') || ''
            if (dataUrl) next = dataUrl
          }
        }
      }
      next = absolutize(resolveWithBase(next, base), url)
      if (!next || next === url) break
      // ll-c: 与 parseToc 同口径 —— 正文分页第2页起 Referer=上一正文页(翻页链逐页回溯)
      const refererForNext = url
      url = next
      try {
        current = await fetchPaginationPage(url, fetchCfg, refererForNext)
      } catch {
        break
      }
    } else {
      break
    }
  }
  return { content: parts.filter(Boolean).join(joinWith), pages: Math.max(1, visited.size) }
}

/**
 * R-E3 readability 兜底: 链接密度评分式正文提取(轻量级 boilerplate 移除)。
 *  规则选择器失败时的兜底, 替代旧版 findLargestText 的"纯文本最长即正文"启发式
 *  (后者在源站把广告块嵌进 div 时会把广告块当正文)。
 *  评分: score = textLength × (1 - linkDensity) × paragraphCountBoost × classBoost × boilerplatePenalty × punctuationBoost
 *  - textLength: 文本字符数(剔除空白后)
 *  - linkDensity: 该块内 <a> 文本长度 / 总文本长度 (越低越像正文)
 *  - paragraphCountBoost: 子 <p> 数 ≥3 时 ×1.2 (正文段落密集标志)
 *  agent-N 改进:
 *  - classBoost: class/id 含 content/article/chapter/main/body/text 等"正文暗示"关键词时 ×1.3
 *  - boilerplatePenalty: class/id 含 nav/footer/sidebar/menu/comment/ad/banner/share/recommend
 *    等"非正文暗示"关键词时 ×0.3 (大幅降权)
 *  - punctuationBoost: 中文逗号/句号/英文 .,;!? 密度 ≥ 1/100 字符时 ×1.1 (正文段落标点密集)
 *  - 嵌套去重: 父容器与子容器同时命中时, 优先选 score/textLen 比值更高的(更紧凑的容器)
 *  过滤: 评分>200 且 linkDensity<0.5 才入选; 多候选取最高分
 */
function findReadableContent($: cheerio.CheerioAPI): string {
  let best = ''
  let bestScore = 0
  const CONTENT_HINT = /(content|article|chapter|main|body|text|story|read|novel|book|post)/i
  const BOILERPLATE_HINT = /(nav|footer|header|sidebar|menu|comment|ad[-_]?|banner|share|recommend|related|popular|widget|toolbar|breadcrumb|paging|pagination|copyright)/i
  $('div,article,section,td').each((_, el) => {
    const $el = $(el)
    const rawText = ($el.text() || '').replace(/\s+/g, '')
    const textLen = rawText.length
    if (textLen < 100) return // 短文本不入选(导航栏/页脚常态)
    // 链接文本量(用于算 linkDensity)
    let linkText = ''
    $el.find('a').each((_, a) => { linkText += $(a).text() || '' })
    const linkDensity = textLen > 0 ? linkText.replace(/\s+/g, '').length / textLen : 1
    if (linkDensity >= 0.5) return // 链接占主导: 视为导航/列表, 跳过
    let paraCount = 0
    $el.find('p').each(() => { paraCount++ })
    const boost = paraCount >= 3 ? 1.2 : 1
    // agent-N: class/id 暗示加权
    const cls = ($el.attr('class') || '') + ' ' + ($el.attr('id') || '')
    const classBoost = CONTENT_HINT.test(cls) ? 1.3 : 1
    const boilerplatePenalty = BOILERPLATE_HINT.test(cls) ? 0.3 : 1
    // agent-N: 标点密度(正文段落有大量逗号/句号, 列表/导航几乎无)
    const punctMatches = rawText.match(/[，。；！？、,.;!?]/g)
    const punctCount = punctMatches ? punctMatches.length : 0
    const punctDensity = punctCount / textLen
    const punctBoost = punctDensity >= 0.01 ? 1.1 : 1
    const score = textLen * (1 - linkDensity) * boost * classBoost * boilerplatePenalty * punctBoost
    if (score > bestScore) {
      bestScore = score
      best = $.html(el)
    }
  })
  return bestScore > 200 ? best : ''
}

function findLargestText($: cheerio.CheerioAPI): string {
  let best = ''
  let bestLen = 0
  $('div,p,td,article').each((_, el) => {
    const t = $(el).text() || ''
    if (t.length > bestLen) {
      bestLen = t.length
      best = $.html(el)
    }
  })
  return bestLen > 200 ? best : ''
}

// ---------------- HTML 表格提取(agent-N) ----------------
/** 把 HTML 表格解析为 markdown 风格的纯文本(供 content 字段消费)。
 *  - 每个 <tr> 一行, 单元格文本用 " | " 分隔
 *  - <thead> 表头独立段, <tbody> 数据段
 *  - colspan/rowspan 不展开(简化实现, 适配小说章节中的简单参数表)
 *  - 嵌入到 <table> 中的 <script>/<style> 文本被 cheerio .text() 自动剔除
 *  用法: 规则字段 { type:'css', expression:'table.detail', attr:'table' } → 表格转文本 */
export function extractTable($: cheerio.CheerioAPI, tableEl: any): string {
  if (!tableEl) return ''
  const $table = $(tableEl)
  const lines: string[] = []
  // thead 表头优先
  $table.find('thead tr').each((_, tr) => {
    const cells: string[] = []
    $(tr).find('th,td').each((_, cell) => {
      const t = ($(cell).text() || '').replace(/\s+/g, ' ').trim()
      cells.push(t)
    })
    if (cells.length) lines.push(cells.join(' | '))
  })
  // tbody 数据行(无 thead 时也走这里)
  $table.find('tbody tr').each((_, tr) => {
    const cells: string[] = []
    $(tr).find('th,td').each((_, cell) => {
      const t = ($(cell).text() || '').replace(/\s+/g, ' ').trim()
      cells.push(t)
    })
    if (cells.length) lines.push(cells.join(' | '))
  })
  // 无 thead/tbody 的简单 <table><tr>...</tr></table>
  if (lines.length === 0) {
    $table.find('tr').each((_, tr) => {
      const cells: string[] = []
      $(tr).find('th,td').each((_, cell) => {
        const t = ($(cell).text() || '').replace(/\s+/g, ' ').trim()
        cells.push(t)
      })
      if (cells.length) lines.push(cells.join(' | '))
    })
  }
  return lines.join('\n')
}
