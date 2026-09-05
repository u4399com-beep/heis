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
import { type FieldRule, type PageRule, type TocItem, type ParsedBook, type ParsedContent } from './types'
import { fetchPage } from './fetcher'

// ---------------- 后处理 ----------------
function applyTransform(value: string, rule: FieldRule): string {
  let v = value ?? ''
  if (rule.stripTags) v = v.replace(/<[^>]+>/g, '')
  if (rule.replaceFrom !== undefined && rule.replaceFrom !== '') {
    try {
      v = v.replace(new RegExp(rule.replaceFrom, 'g'), rule.replaceTo ?? '')
    } catch { /* 无效正则忽略 */ }
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
 *  首段为空(根数组 `.0.title`)按根处理; 数组上非数字段/标量上继续取路径 → undefined;
 *  cc-c 扩展(加法语义, 既有路径零回归): 段内方括号算子 `[n]`=数组下标(≡数字段),
 *  `[k=v]`=按元素属性值过滤数组(k=v 可 & 连写多条件, 值按 String 宽松比较),
 *  段 `*`=数组递归展平(数组的数组→元素平面, 如番茄 chapterListWithVolume) */
export function jsonGet(root: unknown, path: string): unknown {
  if (root === null || root === undefined) return undefined
  let cur: unknown = root
  const raw = (path || '').trim()
  if (!raw || raw === '.' || raw === '$') return cur
  for (const seg0 of raw.split('.')) {
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
        } else {
          return undefined
        }
      } else if (typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[name]
      } else {
        return undefined
      }
    }
    // 段内方括号算子(按书写顺序应用): [n]=下标, [k=v(&k2=v2)…]=过滤
    for (const op of ops) {
      if (!Array.isArray(cur)) break
      if (/^\d+$/.test(op)) {
        cur = Number(op) < cur.length ? cur[Number(op)] : undefined
      } else if (op.includes('=')) {
        const conds = op.split('&').map((c) => {
          const i = c.indexOf('=')
          return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)]
        })
        cur = (cur as Record<string, unknown>[]).filter(
          (el) => !!el && typeof el === 'object' && conds.every(([k, v]) => String((el as Record<string, unknown>)[k]) === v)
        )
      }
    }
  }
  return cur
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

/** jsonArrayAt 内部行走器: jsonGet 语法 + map-collect(数组上非数字段=跨元素取属性展平一层) */
function jsonArrayWalk(root: unknown, path: string): unknown {
  if (root === null || root === undefined) return undefined
  let cur: unknown = root
  const raw = (path || '').trim()
  if (!raw || raw === '.' || raw === '$') return cur
  for (const seg0 of raw.split('.')) {
    const seg = seg0.replace(/\[\]/g, '').trim()
    if (seg === '' || seg === '$') continue
    if (cur === null || cur === undefined) return undefined
    const { name, ops } = splitJsonSeg(seg)
    if (name === '*' && Array.isArray(cur)) {
      cur = (cur as unknown[]).flat(Infinity)
    } else if (name !== '') {
      if (Array.isArray(cur)) {
        if (/^\d+$/.test(name)) {
          cur = Number(name) < cur.length ? cur[Number(name)] : undefined
        } else {
          // map-collect: 跨元素取属性并展平一层(元素属性为数组时收集其元素)
          const collected: unknown[] = []
          for (const el of cur as unknown[]) {
            const v = el && typeof el === 'object' ? (el as Record<string, unknown>)[name] : undefined
            if (Array.isArray(v)) collected.push(...v)
            else if (v !== undefined && v !== null) collected.push(v)
          }
          cur = collected
        }
      } else if (typeof cur === 'object') {
        cur = (cur as Record<string, unknown>)[name]
      } else {
        return undefined
      }
    }
    for (const op of ops) {
      if (!Array.isArray(cur)) break
      if (/^\d+$/.test(op)) {
        cur = Number(op) < cur.length ? cur[Number(op)] : undefined
      } else if (op.includes('=')) {
        const conds = op.split('&').map((c) => {
          const i = c.indexOf('=')
          return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)]
        })
        cur = (cur as Record<string, unknown>[]).filter(
          (el) => !!el && typeof el === 'object' && conds.every(([k, v]) => String((el as Record<string, unknown>)[k]) === v)
        )
      }
    }
  }
  return cur
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

/** const 常量模板占位符替换: `{name}` → vars[name], 未命中→空串 */
function constTemplate(expr: string, vars: Record<string, string> | undefined): string {
  return expr.replace(/\{([a-zA-Z0-9_.]+)\}/g, (m, key: string) => {
    const v = vars?.[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

// ---------------- 统一提取 ----------------
/** 提取上下文: json=当前作用域的JSON根值(itemSelector数组项/页面根);
 *  vars=const模板占位符取值表({字段名}/{index}/{q.*}) */
export interface ExtractCtx {
  json?: unknown
  vars?: Record<string, string>
}

export function extractField(html: string, $: cheerio.CheerioAPI, scope: any, doc: any, rule: FieldRule, ctx?: ExtractCtx): string {
  let v = ''
  try {
    switch (rule.type) {
      case 'css': v = cssExtract($, scope, rule); break
      case 'xpath': {
        // scope 为节点时限制到节点范围
        if (scope && doc && scope !== doc && scope.nodeType) {
          const inner = nodeInnerHtml(scope) || ''
          const subDoc = htmlToDoc(inner)
          v = subDoc ? xpathExtract(subDoc, rule) : ''
        } else {
          v = xpathExtract(doc, rule)
        }
        break
      }
      case 'regex': v = regexExtract(html, rule); break
      case 'json': {
        // 作用域JSON(itemSelector数组项)优先, 否则按页面响应体整体解析(纯JSON API站)
        const root = ctx && ctx.json !== undefined ? ctx.json : parseJsonBody(html)
        v = root === undefined ? '' : jsonToString(jsonGet(root, rule.expression))
        break
      }
      case 'const': {
        v = constTemplate(rule.expression, ctx?.vars)
        break
      }
    }
  } catch { v = '' }
  return applyTransform(v, rule)
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
  const $ = cheerio.load(html)
  const doc = getDoc(html)
  const out: ListResult = { items: [] }
  const { itemSelector, fields } = pageRule
  const hasJsonConstFields = Object.values(fields).some((r) => r && (r.type === 'json' || r.type === 'const'))

  // ---- JSON 模式: itemSelector.expression=数组路径(列表发现), 或无容器+json/const字段(书籍页JSON) ----
  // 规则为json/const型时不回退HTML提取(JSON解析失败直接空结果, 避免cheerio对JSON串的垃圾提取)
  if (itemSelector?.type === 'json' || (!itemSelector && hasJsonConstFields)) {
    const root = parseJsonBody(html)
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
      if (Object.values(rec).some((v) => v)) out.items.push({ fields: rec })
    }
    return out
  }

  if (!itemSelector) {
    // 无容器: 直接对整页提取字段(单值型), 如书籍页
    const rec: Record<string, string> = {}
    for (const [key, rule] of Object.entries(fields)) {
      if (rule) rec[key] = extractField(html, $, null, doc, rule)
    }
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
      scopes = regexExtractAll(html, itemSelector).map((h) => ({ html: h, node: null }))
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
    if (Object.values(rec).some((v) => v)) out.items.push({ fields: rec })
  }
  return out
}

// ---------------- 书籍信息解析 ----------------
export function parseBook(html: string, baseUrl: string, pageRule: PageRule): ParsedBook {
  const res = parseList(html, baseUrl, pageRule, ['cover'])
  const f = res.items[0]?.fields || {}
  return {
    name: f.name || undefined,
    author: f.author || undefined,
    category: f.category || undefined,
    keywords: f.keywords || undefined,
    intro: f.intro || undefined,
    cover: f.cover ? absolutize(f.cover, baseUrl) : undefined,
    latestChapter: f.latestChapter || undefined,
    status: f.status || undefined,
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

  // ---- JSON 目录模式: itemSelector.expression=数组路径(如 bqg713 的纯章节名数组 list) ----
  // 数组项可为对象(字段按路径取)或纯字符串(title 用 '.' 取根本身); 章节URL用 const 模板
  // 合成(`{q.id}`=目录页URL查询参数 + `{index}`=1基序号)。JSON目录API单次返回全量, 无HTML翻页。
  if (pageRule.itemSelector?.type === 'json') {
    const root = parseJsonBody(html)
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
        const dedupKey = href || title
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
  let current = html
  const maxPages = pageRule.pagination?.enabled ? (pageRule.pagination.maxPages || 20) : 1
  const seen = new Set<string>()
  let pagesUsed = 0

  for (let p = 1; p <= maxPages && url; p++) {
    pagesUsed = p
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
      const dedupKey = href || title
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
        // 兜底: 常见"下一页"链接
        next =
          $('a:contains("下一页")').attr('href') ||
          $('a:contains("下页")').attr('href') ||
          $('a:contains("下一章")').attr('href') || ''
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
  let current = html
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
      // 兜底: 取最长文本容器
      part = findLargestText($)
    }
    if (part) parts.push(part)

    if (p < maxPages && pageRule.pagination?.enabled) {
      let next = ''
      const nextRule = pageRule.pagination.nextLink
      if (nextRule) next = extractField(current, $, null, doc, nextRule)
      if (!next) {
        next =
          $('a:contains("下一页")').attr('href') ||
          $('a:contains("下页")').attr('href') || ''
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
