// 规则四段测试路由(列表页/书籍页/目录页/章节内容页) — 后台规则编辑器内嵌测试面板的引擎入口
// 规格(与 worklog n1/n3/主控(cc)/cc-d2 交付口径一致):
//   入参 { section,url,rule,fetch,clean,engine,limit } → 引擎抓取+解析 → 200 信封;
//   空 body/非法 section/非法 URL → 400; 抓取/解析失败 → 502 信封;
//   90s 硬护栏(Promise 定局 clearTimeout, 不挂定时器); tocLink 流程与 runner.extractToc 同序
//   (tocLink → 书籍页本页 → 目录链接嗅探回退, tocLink 解析 0 章回退书籍页重解析);
//   列表段 URL 占位符展开与 runner 同口径({page}=页号, {offset:N}=(页号-1)*N, 测试固定第 1 页,
//   兼容 httpUrl 规范化产生的 %7B%7D 编码形态); 深消毒入参(sanitize* 白名单, 与 types.ts 单源);
//   cleanedText/cleanedHtml 按码点截断 1500(emoji 代理对不斩半)
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, httpUrl, clampInt, isPlainObject } from '../../../_lib/http'
import {
  sanitizeFetchConfig,
  sanitizePageRule,
  sanitizeCleanConfig,
  type CleanConfig,
  type FetchConfig,
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

const TEST_GUARD_MS = 90_000
const PREVIEW_MAX_CHARS = 1500

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(req: Request) {
  return withGuard(() => withTestGuard(req))
}

/** 90s 硬护栏: 超时 resolve 502 信封; Promise 定局(PASS/FAIL/超时)一律 clearTimeout */
async function withTestGuard(req: Request): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      runTest(req),
      new Promise<Response>((resolve) => {
        timer = setTimeout(
          () => resolve(fail(`测试超时(${TEST_GUARD_MS / 1000}s护栏): 站点响应过慢或引擎等待时间过长`, 502)),
          TEST_GUARD_MS
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runTest(req: Request): Promise<Response> {
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
      const res = await fetchPage(normalized, fetchCfg)
      assertNotBlocked(res)
      // 双链接字段与实采 runner.parseList 同口径(url 优先, bookUrl 兜底, 双双 absolutize)
      const parsed = parseList(res.html, normalized, rule, ['url', 'bookUrl'])
      const items = parsed.items.map((i) => i.fields)
      return ok({
        engine: res.engine,
        htmlSize: res.html.length,
        ms: Date.now() - started,
        type: section,
        count: items.length,
        sample: items.slice(0, limit),
      })
    }

    if (section === 'book') {
      const res = await fetchPage(normalized, fetchCfg)
      assertNotBlocked(res)
      const parsed = parseBook(res.html, normalized, rule)
      return ok({
        engine: res.engine,
        htmlSize: res.html.length,
        ms: Date.now() - started,
        type: section,
        fields: parsed,
      })
    }

    if (section === 'toc') {
      const res = await fetchPage(normalized, fetchCfg)
      assertNotBlocked(res)
      const r = await resolveToc(normalized, res.html, rule, fetchCfg, started, res.engine)
      return ok({
        engine: r.engine,
        htmlSize: res.html.length,
        ms: Date.now() - started,
        type: section,
        count: r.items.length,
        pages: r.pages,
        sample: r.items.slice(0, limit),
      })
    }

    // content
    const res = await fetchPage(normalized, budgetTimeout(fetchCfg, started))
    assertNotBlocked(res)
    const parsed = await parseContent(normalized, res.html, rule, budgetTimeout(fetchCfg, started))
    const cleaned = cleanContentHtml(parsed.content, cleanCfg)
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
    })
  } catch (e) {
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
  bookEngine: string
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
          page = await fetchPage(abs, tocCfg)
          assertNotBlocked(page)
        } catch {
          await sleep(800) // 瞬态韧性: 与 runner 同款退避重试一次
          page = await fetchPage(abs, tocCfg)
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
      const page = await fetchPage(abs, tocCfg)
      assertNotBlocked(page)
      const r3 = await parseToc(abs, page.html, rule, tocCfg)
      if (r3.items.length) return { ...r3, engine: page.engine }
    }
  } catch {
    // 嗅探失败 → 返回书籍页结果(可能 0 章)
  }
  return { ...r2, engine: bookEngine }
}
