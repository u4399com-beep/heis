// 规则四段测试路由(列表页/书籍页/目录页/章节内容页) — 后台规则编辑器内嵌测试面板的引擎入口
// 规格(与 worklog n1/n3/主控(cc)/cc-d2 交付口径一致):
//   入参 { section,url,rule,fetch,clean,engine,limit } → 引擎抓取+解析 → 200 信封;
//   空 body/非法 section/非法 URL → 400; 抓取/解析失败 → 502 信封;
//   90s 硬护栏(Promise 定局 clearTimeout, 不挂定时器); tocLink 流程与 runner.extractToc 同序
//   (tocLink → 书籍页本页 → 目录链接嗅探回退, tocLink 解析 0 章回退书籍页重解析);
//   列表段 URL 占位符展开与 runner 同口径({page}=页号, {offset:N}=(页号-1)*N, 测试固定第 1 页,
//   兼容 httpUrl 规范化产生的 %7B%7D 编码形态); 深消毒入参(sanitize* 白名单, 与 types.ts 单源);
//   cleanedText/cleanedHtml 按码点截断 1500(emoji 代理对不斩半)
//
// feat-c 可视化调试扩展(纯 ADDITIVE, 调用方不消费新字段时无回归):
//   每段在原有解析结果基础上, 用 cheerio 重新加载原始 HTML, 对 CSS 型字段规则:
//     · 列表/目录段: 给每个 itemSelector 命中容器加 .heis-debug-item + data-idx 属性;
//                   每个字段规则在容器内首个命中的元素 wrapInner 一个 <mark class="heis-debug-match"
//                   data-field data-idx>, 与 parser cssExtract().first() 的提取口径一致
//     · 书籍段: 整页范围内每个字段规则首个命中元素套 <mark>
//     · 内容段: contentRule 首个命中元素套 <mark>
//   非 CSS 型字段(xpath/regex/json/const)无法在 HTML DOM 上定位元素 → 仅入 debugMatches 不做高亮
//   debugHtml/rawHtml 各 200KB 截断; 整段构建包 try/catch, 任何异常三字段回退 null
//   (调用方按 null 隐藏调试视图, 不影响既有提取结果展示)
import { ok, fail, readBody } from '@/lib/api'
import { sleep } from '@/lib/utils'
import { withGuard, httpUrl, clampInt, isPlainObject } from '../../../_lib/http'
import {
  sanitizeFetchConfig,
  sanitizePageRule,
  sanitizeCleanConfig,
  type CleanConfig,
  type FetchConfig,
  type FieldRule,
  type PageRule,
} from '@/lib/crawl/types'
import { fetchPage } from '@/lib/crawl/fetcher'
import {
  parseList,
  parseBook,
  parseToc,
  parseContent,
  parseJsonBody,
  extractField,
  urlVars,
  absolutize,
} from '@/lib/crawl/parser'
import { cleanContentHtml } from '@/lib/crawl/cleaner'
import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'

const TEST_GUARD_MS = 90_000
const PREVIEW_MAX_CHARS = 1500
const DEBUG_HTML_MAX = 200_000

/** feat-c: 单条匹配记录(与前端 helpers.ts DebugMatch 同形, 此处独立定义避免跨文件耦合) */
interface DebugMatch {
  field: string
  selector: string
  idx: number
  value: string
  preview: string
}

/** feat-c: 调试构建结果(三字段可独立 null — 全 null 表示调试构建整体失败) */
interface DebugData {
  debugHtml: string | null
  rawHtml: string | null
  debugMatches: DebugMatch[] | null
}

/** feat-c: 调试构建入参: 由各段 runTest 分支统一规整为 {items?, fields?, content?} 形态 */
interface DebugExtracted {
  /** 列表/目录段: 每项的字段字典; book 段不用 */
  items?: { fields?: Record<string, string> }[]
  /** book 段: 整页字段字典 */
  fields?: Record<string, string>
  /** content 段: 抽取到的原始正文(清洗前) */
  content?: string
}

/**
 * 反反爬韧性接线(qq-e): fetcher 对拦截页(验证码/JS挑战/极短空壳)不抛错而是返回
 * blocked 标记, runner 侧已按 blocked 拒收不入库 —— 测试面板原先忽略该标记, 拦截页
 * 被当正常 HTML 喂给解析器, 四段测试一律静默 0 本/0 章(用户无法区分"规则写错"与
 * "站点拦截")。此处统一转 502 友好报错; resolveToc 内 tocLink/嗅探抓取同样接线,
 * 抛错走既有回退链(tocLink失败→书籍页→目录嗅探), 语义与 runner 同构。
 * qq-e2 修正: 补齐 runner 同款 JSON 豁免 —— fetcher.looksBlocked 对 <200 字符响应
 * 一律判拦, 纯 JSON API 站(番茄/七猫代理/bqg713)的短响应必中; runner 以
 * "blocked && parseJsonBody===undefined" 放行合法 JSON(runner.ts:480 同款), 本面板
 * 缺该豁免时 JSON 规则四段测试全部误报"反爬拦截页"502(对生产规则的直接回归)。
 */
function assertNotBlocked(res: Awaited<ReturnType<typeof fetchPage>>): void {
  if (res.blocked && parseJsonBody(res.html) === undefined) {
    throw new Error('目标站点返回了反爬拦截页(验证码/JS挑战/空壳响应), 请更换引擎(如 browser)或稍后重试')
  }
}

type TestSection = 'list' | 'book' | 'toc' | 'content'
const SECTIONS: TestSection[] = ['list', 'book', 'toc', 'content']

/** 按码点截断(Array.from 迭代码点而非 UTF-16 单元, emoji 代理对不斩半) */
function cutText(s: string, max = PREVIEW_MAX_CHARS): string {
  return Array.from(s).slice(0, max).join('')
}

/** 列表段 URL 占位符展开(固定测试第 1 页, 与 runner 列表页展开同口径):
 *  {offset:N} → (p-1)*N = 0; {page} → 1; 同时兼容 new URL() 规范化后的
 *  %7Bpage%7D/%7Boffset:N%7D 编码形态(cc-b 排障结论: 展开必须发生在规范化之前, 双形态兼容) */
function expandListPlaceholders(raw: string): string {
  const p1Offset = (_m: string, n: string) => String((1 - 1) * Math.max(1, parseInt(n, 10) || 1))
  return raw
    .replace(/\{offset:(\d+)\}/gi, p1Offset)
    .replace(/%7Boffset%3A(\d+)%7D/gi, p1Offset)
    .replace(/%7Boffset:(\d+)%7D/gi, p1Offset)
    .replace(/\{page\}/gi, '1')
    .replace(/%7Bpage%7D/gi, '1')
}

/** 剩余护栏预算 → 本次抓取超时钳制(首抓耗时与总已耗时只扣减一次, n3 修正公式) */
function budgetTimeout(fetchCfg: Partial<FetchConfig>, started: number): Partial<FetchConfig> {
  const remaining = TEST_GUARD_MS - (Date.now() - started)
  const base = typeof fetchCfg.timeout === 'number' ? fetchCfg.timeout : 20_000
  return { ...fetchCfg, timeout: Math.max(1000, Math.min(base, remaining - 500)) }
}

/** feat-c: 字段规则 → 选择器摘要字符串(用于 debugMatches.selector 展示):
 *  css/xpath/regex/json/const 各型给出可读表示, attr 附加在 [..] 中 */
function selectorSummary(fr: FieldRule): string {
  const attr = fr.attr ? `[${fr.attr}]` : ''
  return `${fr.type}:${fr.expression}${attr}`
}

/** feat-c: 短预览(按码点截断, 避免代理对斩半) — 与 cutText 同语义但更短 */
function previewText(s: string, max = 80): string {
  return Array.from(s || '').slice(0, max).join('')
}

/** feat-c: 截断 HTML 至 DEBUG_HTML_MAX 字符并附注释 */
function truncateHtml(s: string, max = DEBUG_HTML_MAX): string {
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, max) + '\n<!-- heis-debug: truncated at 200KB -->'
}

/**
 * feat-c: 构建可视化调试数据 — 在原 HTML 上注入 <mark> 高亮 + <span> 容器标记,
 * 并产出每条匹配的字段/选择器/索引/值/预览清单。
 *
 * 实现要点:
 *  - 仅 CSS 型字段规则可在 DOM 上定位元素并 wrapInner; xpath/regex/json/const 各型
 *    无法在不重写解析器的前提下回放其"命中元素", 故只记录到 debugMatches 不做高亮。
 *  - 列表/目录段: 容器命中后 addClass('heis-debug-item') + attr('data-idx'),
 *    不用 <span> 包裹(原容器可能是 <li>/<tr>/<dd>, span 嵌入会破坏合法 HTML);
 *    iframe 端 CSS 用 `.heis-debug-item` 选择器(outline 紫色虚线)即可识别。
 *  - 字段元素: 与 parser cssExtract().first() 同口径, 仅首个命中元素套 <mark>,
 *    避免多匹配时高亮过度淹没视图(实际提取只用首个)。
 *  - 值提取: 对 CSS 型字段在 per-item 隔离 cheerio 实例上跑 extractField(与 parseList 同口径),
 *    让 debugMatches.value 与 itemNodes 索引严格对齐 — 直接用 parsed.items 会因 parseList
 *    的 urlFields 过滤使索引错位("匹配行的值"与"iframe mark 的 idx"对不上)。
 *  - 任何异常(cheerio load 失败/选择器非法/wrapInner 出错)→ 整体回退 null,
 *    不影响既有解析结果, 调用方按 null 隐藏调试视图。
 */
function buildDebugData(
  section: TestSection,
  html: string,
  rule: PageRule,
  extracted: DebugExtracted,
  pageUrl: string,
): DebugData {
  try {
    const $ = cheerio.load(html)
    const matches: DebugMatch[] = []

    /** 在 scope 内查找 CSS 型字段规则的首个命中元素并 wrapInner 一个 <mark> 标签 */
    const highlightCssField = (
      scope: cheerio.Cheerio<AnyNode>,
      fr: FieldRule,
      field: string,
      idx: number,
    ): void => {
      if (fr.type !== 'css' || !fr.expression) return
      try {
        // 与 parser.cssExtract 行为对齐: 优先在后代中查找; 若后代无, 检查 scope 自身
        // (字段选择器可能直接命中容器, 如 toc 段 itemSelector=a + 字段 selector=a, 此时
        //  parser 用 fresh cheerio.load(scope.html)→$(expr) 找到顶层元素, 等价于"scope 自身")
        const descendants = scope.find(fr.expression)
        const found = descendants.length > 0
          ? descendants.first()
          : (scope.is(fr.expression) ? scope.first() : null)
        if (!found || found.length === 0) return
        // wrapInner 接受 HTML 字符串, cheerio 会创建 mark 节点并嵌入到 found 内部
        found.wrapInner(
          `<mark class="heis-debug-match" data-field="${field}" data-idx="${idx}"></mark>`,
        )
      } catch {
        /* 非法 CSS 选择器 / wrapInner 失败: 跳过该字段高亮, 不影响其它字段 */
      }
    }

    if (section === 'list' || section === 'toc') {
      const itemSelector = rule.itemSelector
      // 仅 CSS 型容器可在 DOM 上回放定位; 其它型容器只记录 debugMatches
      if (itemSelector?.type === 'css' && itemSelector.expression) {
        let itemNodes: cheerio.Cheerio<AnyNode>[] = []
        try {
          itemNodes = $(itemSelector.expression).toArray().map((n) => $(n))
        } catch {
          itemNodes = [] // 非法容器选择器 → 0 项, 仅记录字段无高亮
        }
        itemNodes.forEach((node, idx) => {
          // 容器标记(addClass + data-idx, 不破坏原 HTML 结构)
          node.addClass('heis-debug-item')
          node.attr('data-idx', String(idx))
          // 取容器 HTML 用于 per-item 字段提取(与 parseList 同口径:
          //  fresh cheerio.load(scope.html)→extractField 让 top-level 元素也被命中,
          //  避免 scope 自身=字段目标时被 scope.find 漏掉, 同时让 debugMatches 的 value
          //  与 itemNodes 索引严格对齐 — parseList 在生产链路会按 urlFields 过滤,
          //  其 parsed.items 与 itemNodes 索引脱钩, 直接用 parsed.items 会造成"匹配行
          //  显示的值"与"iframe 中 mark 的 idx"对不上)
          const nodeHtml = $.html(node)
          let node$: cheerio.CheerioAPI | null = null
          const getNode$ = (): cheerio.CheerioAPI => {
            if (!node$) node$ = cheerio.load(nodeHtml)
            return node$
          }
          for (const [fieldKey, fr] of Object.entries(rule.fields)) {
            if (!fr) continue
            highlightCssField(node, fr, fieldKey, idx)
            // 提取本项本字段的真实值(对齐 parseList 的 cssExtract 语义)
            let value = ''
            try {
              if (fr.type === 'css' || fr.type === 'xpath' || fr.type === 'regex') {
                value = extractField(nodeHtml, getNode$(), null, null, fr)
              } else if (fr.type === 'const') {
                // const 模板用 pageUrl 的查询参数作为 vars; $ 参数实际不被消费但 TS 类型要求传
                value = extractField('', cheerio.load(''), null, null, fr, {
                  vars: { ...urlVars(pageUrl), index: String(idx + 1) },
                })
              } else if (fr.type === 'json') {
                // JSON 项容器场景较少见; 此处退化为整页 JSON 解析
                value = extractField(html, $, null, null, fr)
              }
            } catch { /* 提取失败: 值留空 */ }
            matches.push({
              field: fieldKey,
              selector: selectorSummary(fr),
              idx,
              value,
              preview: previewText(value),
            })
          }
        })
      } else {
        // 无 CSS 容器(xpath/regex/json/const 型 / 缺容器): 仍记录每项每字段
        const items = extracted.items || []
        // 至少记录一条零项空记录, 让前端匹配面板不显空(便于用户区分"无匹配"与"调试失败")
        if (items.length === 0) {
          for (const [fieldKey, fr] of Object.entries(rule.fields)) {
            if (!fr) continue
            matches.push({
              field: fieldKey, selector: selectorSummary(fr), idx: 0, value: '', preview: '',
            })
          }
        } else {
          items.forEach((item, idx) => {
            for (const [fieldKey, fr] of Object.entries(rule.fields)) {
              if (!fr) continue
              const value = item.fields?.[fieldKey] || ''
              matches.push({
                field: fieldKey, selector: selectorSummary(fr), idx, value, preview: previewText(value),
              })
            }
          })
        }
      }
    } else if (section === 'book') {
      // 书籍段: 整页范围内每个字段规则首个命中元素套 <mark>
      for (const [fieldKey, fr] of Object.entries(rule.fields)) {
        if (!fr) continue
        if (fr.type === 'css' && fr.expression) {
          try {
            const found = $(fr.expression).first()
            if (found.length > 0) {
              found.wrapInner(
                `<mark class="heis-debug-match" data-field="${fieldKey}" data-idx="0"></mark>`,
              )
            }
          } catch { /* 非法 CSS: 跳过 */ }
        }
        const value = extracted.fields?.[fieldKey] || ''
        matches.push({
          field: fieldKey, selector: selectorSummary(fr), idx: 0, value, preview: previewText(value),
        })
      }
    } else {
      // content 段: contentRule 首个命中元素套 <mark>
      const contentRule = rule.fields.content
      if (contentRule) {
        if (contentRule.type === 'css' && contentRule.expression) {
          try {
            const found = $(contentRule.expression).first()
            if (found.length > 0) {
              found.wrapInner(
                `<mark class="heis-debug-match" data-field="content" data-idx="0"></mark>`,
              )
            }
          } catch { /* 非法 CSS: 跳过 */ }
        }
        const value = extracted.content || ''
        matches.push({
          field: 'content', selector: selectorSummary(contentRule), idx: 0,
          value, preview: previewText(value),
        })
      }
    }

    // 序列化修改后的 DOM; 优先取 <body> 内部(去掉原始 head/script 等), 给前端干净注入
    let debugHtml = ''
    try {
      debugHtml = $('body').html() || $.html() || ''
    } catch {
      debugHtml = $.html() || ''
    }
    return {
      debugHtml: truncateHtml(debugHtml),
      rawHtml: truncateHtml(html),
      debugMatches: matches,
    }
  } catch {
    // 任何异常(cheerio load 失败 / 序列化失败): 三字段回退 null, 不影响主流程
    return { debugHtml: null, rawHtml: null, debugMatches: null }
  }
}

export async function POST(req: Request) {
  return withGuard(() => withTestGuard(req))
}

/** 90s 硬护栏: 超时 resolve 502 信封; Promise 定局(PASS/FAIL/超时)一律 clearTimeout
 *  API-9: 增加 AbortController —— 超时分支先 controller.abort() 再 resolve, 触发 runTest
 *  内的 fetchPage 包裹层(raceAbort)立即 reject, 避免 runTest 在响应已返回后仍后台
 *  跑空转(继续抓取/解析、占用 socket/CPU); fetcher 内部仍持自有 controller 兜底 20s 超时 */
async function withTestGuard(req: Request): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      runTest(req, controller.signal),
      new Promise<Response>((resolve) => {
        timer = setTimeout(
          () => {
            controller.abort()
            resolve(fail(`测试超时(${TEST_GUARD_MS / 1000}s护栏): 站点响应过慢或引擎等待时间过长`, 502))
          },
          TEST_GUARD_MS
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 包裹 fetchPage Promise: 在 AbortSignal 触发时立即 reject, 让 runTest 短路退出
 * (fetcher 自身不接受外部 signal, 此 wrapper 在外层模拟取消语义; fetcher 的内部
 *  controller 仍会在 cfg.timeout 到点后真正关闭 socket, wrapper 仅让 runTest 早一步返回) */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (r) => { signal.removeEventListener('abort', onAbort); resolve(r) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

async function runTest(req: Request, signal: AbortSignal): Promise<Response> {
  const started = Date.now()
  const body = await readBody(req)

  // ---- 入参校验与深消毒 ----
  const section = body?.section as TestSection
  if (!SECTIONS.includes(section)) return fail('非法测试段(应为 list/book/toc/content)')

  const rawUrl = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!rawUrl) return fail('缺少测试 URL')
  const normalized = httpUrl(section === 'list' ? expandListPlaceholders(rawUrl) : rawUrl)
  if (!normalized) return fail('URL 非法(仅支持 http/https)')

  const rule: PageRule | undefined = sanitizePageRule(body?.rule)
  if (!rule) return fail('规则配置非法')

  // fetch 配置深消毒 + 可选 engine 覆盖(测试面板临时切换引擎, 不改规则本体)
  const fetchInput: Record<string, unknown> = { ...(isPlainObject(body?.fetch) ? body.fetch : {}) }
  if (body?.engine === 'http' || body?.engine === 'browser' || body?.engine === 'auto') {
    fetchInput.engine = body.engine
  }
  const fetchCfg = sanitizeFetchConfig(fetchInput)

  const cleanCfg: CleanConfig | undefined = sanitizeCleanConfig(body?.clean)
  const limit = clampInt(body?.limit, 20, 1, 200)

  try {
    if (section === 'list') {
      const res = await raceAbort(fetchPage(normalized, fetchCfg), signal)
      assertNotBlocked(res)
      // 双链接字段与实采 runner.parseList 同口径(url 优先, bookUrl 兜底, 双双 absolutize)
      const parsed = parseList(res.html, normalized, rule, ['url', 'bookUrl'])
      const items = parsed.items.map((i) => i.fields)
      // feat-c: 在原始 HTML 上注入高亮, 仅基于本段 rule 与提取结果(items)
      const debug = buildDebugData(section, res.html, rule, { items: parsed.items }, normalized)
      return ok({
        engine: res.engine,
        htmlSize: res.html.length,
        ms: Date.now() - started,
        type: section,
        count: items.length,
        sample: items.slice(0, limit),
        debugHtml: debug.debugHtml,
        rawHtml: debug.rawHtml,
        debugMatches: debug.debugMatches,
      })
    }

    if (section === 'book') {
      const res = await raceAbort(fetchPage(normalized, fetchCfg), signal)
      assertNotBlocked(res)
      const parsed = parseBook(res.html, normalized, rule)
      // feat-c: ParsedBook 是对象({name?, author?, ...}), 直接作为 fields 传入
      const debug = buildDebugData(section, res.html, rule, {
        fields: parsed as unknown as Record<string, string>,
      }, normalized)
      return ok({
        engine: res.engine,
        htmlSize: res.html.length,
        ms: Date.now() - started,
        type: section,
        fields: parsed,
        debugHtml: debug.debugHtml,
        rawHtml: debug.rawHtml,
        debugMatches: debug.debugMatches,
      })
    }

    if (section === 'toc') {
      const res = await raceAbort(fetchPage(normalized, fetchCfg), signal)
      assertNotBlocked(res)
      const r = await resolveToc(normalized, res.html, rule, fetchCfg, started, res.engine, signal)
      // feat-c: 目录项是 {title, url, volume?}, 规整为 {fields: {title, url, volume}} 与 list 段同构
      // (resolveToc 返回类型签名上未含 volume, 但运行时 parseToc 已写入 TocItem.volume, 见 parser.ts)
      const tocAsItems = r.items.map((it) => ({
        fields: {
          title: it.title,
          url: it.url,
          volume: (it as { volume?: string }).volume || '',
        },
      }))
      const debug = buildDebugData(section, res.html, rule, { items: tocAsItems }, normalized)
      return ok({
        engine: r.engine,
        htmlSize: res.html.length,
        ms: Date.now() - started,
        type: section,
        count: r.items.length,
        pages: r.pages,
        sample: r.items.slice(0, limit),
        debugHtml: debug.debugHtml,
        rawHtml: debug.rawHtml,
        debugMatches: debug.debugMatches,
      })
    }

    // content
    const res = await raceAbort(fetchPage(normalized, budgetTimeout(fetchCfg, started)), signal)
    assertNotBlocked(res)
    const parsed = await parseContent(normalized, res.html, rule, budgetTimeout(fetchCfg, started))
    const cleaned = cleanContentHtml(parsed.content, cleanCfg)
    // feat-c: 内容段用 parsed.content 作为 extracted.content, 供 debugMatches 预览展示
    const debug = buildDebugData(section, res.html, rule, { content: parsed.content }, normalized)
    return ok({
      engine: res.engine,
      htmlSize: res.html.length,
      ms: Date.now() - started,
      type: section,
      pages: parsed.pages,
      rawLength: parsed.content.length,
      cleanedLength: cleaned.length,
      cleanedText: cutText(cleaned),
      cleanedHtml: cutText(parsed.content),
      debugHtml: debug.debugHtml,
      rawHtml: debug.rawHtml,
      debugMatches: debug.debugMatches,
    })
  } catch (e) {
    // 超时取消时 signal 已 aborted —— 友好消息替代裸 'aborted' 字面量(withTestGuard
    // 的 race 通常已先一步返回 fail('测试超时...'), 此分支仅兜底未被 race 抢先的极端窗口)
    if (signal.aborted) return fail(`测试超时(${TEST_GUARD_MS / 1000}s护栏): 站点响应过慢或引擎等待时间过长`, 502)
    const msg = e instanceof Error ? e.message : String(e)
    return fail(`测试失败: ${cutText(msg, 200)}`, 502)
  }
}

/** 目录解析(tocLink 流程模拟, 与 runner.extractToc 同序): tocLink 抓目录页 → 书籍页本页 →
 *  目录链接自动嗅探回退; tocLink 页解析 0 章回退书籍页重解析(n3), tocLink 抓取失败退避重试一次 */
async function resolveToc(
  bookUrl: string,
  bookHtml: string,
  rule: PageRule,
  fetchCfg: Partial<FetchConfig>,
  started: number,
  bookEngine: string,
  signal: AbortSignal
): Promise<{ items: { title: string; url: string }[]; pages: number; engine: string }> {
  const tocCfg = budgetTimeout(fetchCfg, started)

  // 1) 显式配置 tocLink: 从书籍页提取目录页地址(const 模板占位符取值表同 runner: urlVars)
  if (rule.tocLink?.expression) {
    try {
      const $ = cheerio.load(bookHtml)
      const link = extractField(bookHtml, $, null, null, rule.tocLink, { vars: urlVars(bookUrl) })
      const abs = absolutize(link, bookUrl)
      if (abs && /^https?:\/\//.test(abs) && abs !== bookUrl) {
        let page: Awaited<ReturnType<typeof fetchPage>>
        try {
          page = await raceAbort(fetchPage(abs, tocCfg), signal)
          assertNotBlocked(page)
        } catch {
          await sleep(800) // 瞬态韧性: 与 runner 同款退避重试一次
          page = await raceAbort(fetchPage(abs, tocCfg), signal)
          assertNotBlocked(page)
        }
        const r1 = await parseToc(abs, page.html, rule, tocCfg)
        if (r1.items.length) return { ...r1, engine: page.engine }
        // 0 章 → 回退书籍页本页重解析(不直接返回 0)
      }
    } catch {
      // tocLink 解析失败 → 回退书籍页本页(与 runner 一致)
    }
  }

  // 2) 书籍页即目录页
  const r2 = await parseToc(bookUrl, bookHtml, rule, tocCfg)
  if (r2.items.length) return { ...r2, engine: bookEngine }

  // 3) 兜底: 自动嗅探"目录"链接(与 runner.extractToc 同款文案白名单)
  try {
    const $ = cheerio.load(bookHtml)
    let guess = ''
    $('a').each((_, el) => {
      if (guess) return
      const t = ($(el).text() || '').trim()
      if (/^(查看目录|章节目录|最新章节列表|章节列表|点击查看目录|全文目录|目录)$/.test(t)) {
        guess = $(el).attr('href') || ''
      }
    })
    const abs = absolutize(guess, bookUrl)
    if (abs && /^https?:\/\//.test(abs) && abs !== bookUrl) {
      const page = await raceAbort(fetchPage(abs, tocCfg), signal)
      assertNotBlocked(page)
      const r3 = await parseToc(abs, page.html, rule, tocCfg)
      if (r3.items.length) return { ...r3, engine: page.engine }
    }
  } catch {
    // 嗅探失败 → 返回书籍页结果(可能 0 章)
  }
  return { ...r2, engine: bookEngine }
}
