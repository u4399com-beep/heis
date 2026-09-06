// ============================================================
// 种子脚本: 完本神站 (wanbenshenzhan.com) 采集规则
// 用法: bun run scripts/seed-rule-wanben.ts
//       (可选) WANBEN_PROBE=1 bun run scripts/seed-rule-wanben.ts — 入库前先跑四段 live 探针
//       (仅当站点对本沙箱出口解封后才有意义, 默认跳过 — 见下方未实测声明)
//
// 规则来源: Legado 书源 JSON 反译 (tmp/ee/7643.json, 书源"完本神站（登录）")
//  - search 段经 sososhu.com 需登录+每日限 8 次 → 跳过(本系统用 list 段发现书籍, 不需要搜索)
//  - explore(书库/排行榜) + 详情/目录/正文选择器 → 翻译为四段
//
// ⚠ 未实测声明(2026-08-31, 参照番茄聚合API规则的"未实测标记"先例):
//  - 沙箱出口 IP 8.212.10.159 被 GoEdge WAF 边缘级拒绝:
//      移动 UA(书源同款) → 403 297B 边缘拒绝页(全路径 /、/all/、/1/; www.与m.同;
//      HTTP/1.1(curl --http1.1)/带 Referer+Sec-Fetch 全头/http scheme 均同 403)
//      桌面 UA → 307 → /WAF/VERIFY/CAPTCHA?info=…(GoEdge 图形验证码页, 需人工输码,
//      引擎无 OCR 自动求解面; 且真渲染 Chromium(双 UA)实测直接 403, 非 CAPTCHA 决策面)
//  - 引擎三链路对抗实录: engine=http(移动UA) 403(curl 兜底链同 403) /
//      engine=browser(移动UA) 真渲染 403 / engine=browser(桌面UA) 真渲染 403
//    → IP 级拒绝, 与客户端指纹/UA/协议版本无关; 换出口 IP(FetchConfig.proxyUrl,
//      dd-a2 已实证的机制, 需真实代理)后可按 WANBEN_PROBE=1 路径续作四段验证
//  - 四段选择器为 Legado 书源反译(书源作者在可访问环境实测过), 结构可信但未在本系统
//    真网四段过线验证(list≥10/toc≥50/content≥2000 均未跑) — 诚实留档不硬凑
//
// 反译要点(★=引擎语义差异需注意):
//  - list: ruleExplore bookList "class.data-table@tag.tbody@tag.tr || class.rank-item"
//    (书库表格/排行榜卡片两种布局) → CSS 并集单一容器 .data-table tr, .rank-item;
//    ★表格布局的 tr 容器项经引擎碎片重解析会丢 td(parse5 表格上下文修正, 引擎缺口),
//    name/bookUrl 用正则字段作用于容器项原始 html 绕道, 双布局通吃; 其余字段 CSS(卡片布局)
//  - Legado tag.span.N → CSS :nth-of-type(N+1)(按 span 类型计数, 与 Legado 语义等价)
//  - book: ruleBookInfo 原样翻译; status 不入字段(交 smartCompleteDetect 从 intro 判定)
//  - toc: chapterList "id.chapter-list@class.chapter-list@tag.a" → itemSelector 钉在 a 上,
//    字段 title/url 用表达式 'a' 自匹配(parseList/parseToc 对每个容器项独立
//    cheerio.load(scope.html), 根级 'a' 恰命中容器自身 — 引擎既有语义, kanunu8 系同款用法);
//    nextTocUrl "text.下一页@href" → pagination.nextLink 'a:contains("下一页")'
//    (目录分页 ?chapter_page=N 形态, 引擎翻页链 absolutize 后自然续页)
//  - content: ruleContent "class.chapter-content@html##<p>【完本神站】[^<]*</p>|<p>\s*</p>"
//    → content 字段 attr 'html' + clean.adPatterns 原样翻译两条(第二条空 p 清洗引擎
//    normalize 亦兜底); 附加站名水印防御条目
const BASE = 'http://localhost:3000'

// Legado 书源 header 钉的移动 UA(必须钉住: 站点按 UA 分流反爬)
const WB_MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

// 测试探针(仅 WANBEN_PROBE=1 时执行; URL 已展开不经 {page} 占位符 — rules/test 接口
// 会对含 {page} 原串做 new URL() 规范化成 %7Bpage%7D 的坑, cc-b/dd-e 口径)
const PROBE = {
  list: 'https://www.wanbenshenzhan.com/all/0_lastupdate_0_0_1.html',
  book: 'https://www.wanbenshenzhan.com/1/',
  toc: 'https://www.wanbenshenzhan.com/1/',
  content: '',
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

// export 供离线验证脚本(verify-ee-a-wanben-offline.ts)复用四段规则 — 语义与入库内容同源防漂移
export const rule: RuleSeed = {
  name: '完本神站 (wanbenshenzhan.com)',
  description:
    'wanbenshenzhan.com GoEdge WAF 站(Legado 书源反译)。列表=书库 /all/{cat}_lastupdate_{完本}_{0}_{page}.html, 表格(.data-table tr)+卡片(.rank-item)双布局 CSS 并集(书名/作者剥"作者："/分类剥[]/最新章/封面/简介) / 书籍页 .book-info-detail h1(剥"编辑")+.book-meta span(作者/分类/字数)+.latest-chapter-link+.book-intro p+封面, status 不入字段交 smartCompleteDetect / 目录内嵌书籍页 #chapter-list .chapter-list a, 分页"下一页"链(?chapter_page=N) / 正文 .chapter-content html。搜索走 sososhu.com 需登录已跳过(list 段代替)。\n⚠ 未实测(2026-08-31): 沙箱出口 IP 被 GoEdge 边缘级拒绝(移动UA 403/桌面UA 307→图形验证码; http+curl+真渲染浏览器三链路均 403), 规则按 Legado 书源反译入库未经真网四段验证, 换出口 IP(配置 proxyUrl)解封后请 WANBEN_PROBE=1 重跑种子做四段复验。m./www. 双域 DNS 同边缘, 选 www. 基准。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 书库全部·按更新排序: /all/0_lastupdate_0_0_1.html 起(0=全分类, 末位0=含连载+完本);
      // 完本专属形态 /all/{cat}_lastupdate_1_0_{page}.html、排行榜 /top/{rank}.html 改路径即用;
      // runner 侧 listStart~listEnd 逐页展开 {page}, 每 N 本/页未实测(表格/卡片布局均有可能)
      urlTemplate: 'https://www.wanbenshenzhan.com/all/0_lastupdate_0_0_{page}.html',
      // 书库=表格布局(class.data-table 内 tr) / 排行榜=卡片布局(div.rank-item), CSS 并集兼容;
      // ★不写 tbody: 真实站 HTML 可能无显式 tbody(浏览器/Jsoup 自动补, 本引擎整页解析同样
      // 自动补), 后代选择器 .data-table tr 对有无 tbody 两种形态均命中(语义等价 tag.tr)
      itemSelector: { type: 'css', expression: '.data-table tr, .rank-item' },
      fields: {
        // ★name/bookUrl 用正则字段(引擎缺口绕道): itemSelector 命中 tr 时, 引擎对每个容器项
        // 独立 cheerio 重解析, parse5 碎片解析会丢弃表格上下文元素(td 剥壳文本逃逸), CSS 字段
        // 对表格布局全部落空 — 正则字段作用于容器项原始 html 字符串不经重解析, 双布局通吃
        // (非捕获前缀分支 + 单捕获组, 兼容 class 多类名与属性顺序变化);
        // 卡片布局下其余字段维持 Legado CSS 原样翻译(表格布局下为空, 信息性 —
        // 实采 runner 只消费列表 bookUrl, 元数据在书籍页重解析)
        name: {
          type: 'regex',
          expression:
            '(?:class="[^"]*book-name[^"]*"[^>]*>\\s*<a[^>]*>|class="[^"]*rank-book-info[^"]*"[\\s\\S]{0,400}?<h4>\\s*<a[^>]*>)([^<]+)',
        },
        bookUrl: {
          type: 'regex',
          expression:
            '(?:class="[^"]*book-name[^"]*"[^>]*>\\s*<a[^>]*href="|class="[^"]*rank-book-info[^"]*"[\\s\\S]{0,400}?href=")([^"]+)',
        },
        // 表格: class.author("作者：xxx") / 卡片: class.rank-book-info .meta 首个 span;
        // ★Legado tag.span.0 → :nth-of-type(1)
        author: {
          type: 'css',
          expression: '.author, .rank-book-info .meta span:nth-of-type(1)',
          attr: 'text',
          replaceFrom: '^作者[:：]\\s*',
          replaceTo: '',
        },
        // 表格: class.sort("[玄幻]")剥[] / 卡片: .meta 第二个 span("分类：玄幻")剥前缀
        category: {
          type: 'css',
          expression: '.sort, .rank-book-info .meta span:nth-of-type(2)',
          attr: 'text',
          replaceFrom: '^分类[:：]\\s*|\\[|\\]',
          replaceTo: '',
        },
        // 表格: class.chapter a / 卡片: class.latest a
        latestChapter: { type: 'css', expression: '.chapter a, .latest a', attr: 'text' },
        // 卡片布局封面(表格行无封面, 空值引擎自然降级)
        cover: { type: 'css', expression: '.rank-cover img', attr: 'src' },
        // 表格布局字数(class.words, 信息性字段)
        wordCount: { type: 'css', expression: '.words', attr: 'text' },
        // 表格布局简介(class.desc, 信息性字段; 实采 runner 不消费列表 intro)
        intro: { type: 'css', expression: '.desc', attr: 'text' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        // class.book-info-detail h1 文本去"编辑"字样(书源 ##编辑)
        name: { type: 'css', expression: '.book-info-detail h1', attr: 'text', replaceFrom: '编辑', replaceTo: '' },
        // class.book-meta 首个 span("作者：xxx")
        author: {
          type: 'css',
          expression: '.book-meta span:nth-of-type(1)',
          attr: 'text',
          replaceFrom: '^作者[:：]\\s*',
          replaceTo: '',
        },
        // class.book-meta 第二个 span("分类：xxx")
        category: {
          type: 'css',
          expression: '.book-meta span:nth-of-type(2)',
          attr: 'text',
          replaceFrom: '^分类[:：]\\s*',
          replaceTo: '',
        },
        // class.book-meta 第四个 span("字数：xxx", 信息性字段)
        wordCount: {
          type: 'css',
          expression: '.book-meta span:nth-of-type(4)',
          attr: 'text',
          replaceFrom: '^字数[:：]\\s*',
          replaceTo: '',
        },
        // class.latest-chapter-link 首个 a
        latestChapter: { type: 'css', expression: '.latest-chapter-link a', attr: 'text' },
        // class.book-intro 首个 p(★引擎 cssExtract 取首匹配语义; Legado 多 p 会拼接,
        // 若简介多段实测截断, 改 expression '.book-intro' 整容器即可)
        intro: { type: 'css', expression: '.book-intro p', attr: 'text' },
        // class.book-cover-large img
        cover: { type: 'css', expression: '.book-cover-large img', attr: 'src' },
      },
    },
    toc: {
      enabled: true,
      // 目录内嵌书籍页: id.chapter-list > .chapter-list > a(★itemSelector 钉在 a 上,
      // 字段表达式 'a' 依赖引擎"容器项独立重解析后根级自匹配"语义)
      itemSelector: { type: 'css', expression: '#chapter-list .chapter-list a' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      // 目录分页 ?chapter_page=N 形态, "下一页"链驱动(Legado nextTocUrl=text.下一页@href);
      // 单页目录无该锚 → extractField 空 → 翻页链自然收敛
      pagination: {
        enabled: true,
        maxPages: 20,
        nextLink: { type: 'css', expression: 'a:contains("下一页")', attr: 'href' },
      },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: '.chapter-content', attr: 'html' },
      },
      // Legado ruleContent 无翻页规则 → 单页章节
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      // auto: 移动 UA http 层 403 时自动升级浏览器真渲染(GoEdge 按 IP/UA 决策,
      // 解封后最可能通行的组合); 引擎对 "Verify Yourself"/403 Forbidden 页均正确判拦
      // (looksBlocked BLOCK_MARKERS 'captcha'/'forbidden'), 不会把盾页当内容入库
      engine: 'auto',
      // ★UA 钉移动(书源 header 同款): 站点按 UA 分流, 桌面 UA 直接落 CAPTCHA 挑战
      uaMode: 'custom',
      customUa: WB_MOBILE_UA,
      autoCookie: true,
      referer: true,
      timeout: 25000,
      retries: 2,
      waitMs: 1500,
      browserFallbackStatus: [403, 412, 429, 503],
      hostGateLimit: 3,
      // 换出口 IP 续作入口: 配置 proxyUrl(逗号分隔, ≤10 条)即可, 机制 dd-a2 已实证;
      // 本沙箱无真实代理可配, 留空
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
      adPatterns: [
        // Legado ruleContent ## 清洗规则原样翻译:
        '<p>【完本神站】[^<]*</p>',
        '<p>\\s*</p>',
        // 站名/域名水印防御(行级, 句中伴随 URL 时由 URL 保护掩码兜底不误伤正文链接)
        '完本神站[^<>]*',
        '(www\\.)?wanbenshenzhan\\.com\\S*',
        '请记住本站[^<>]*',
        '本站最新网址[^<>]*',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      normalize: true,
      plainText: false,
    },
  },
}

// ---------- 四段测试(仅 WANBEN_PROBE=1: 站点解封后手动跑, 默认跳过不烧请求) ----------
interface TestResp {
  ok: boolean
  message?: string
  data?: Record<string, unknown>
}

async function testSection(section: string, url: string, ruleSection: unknown, extra: Record<string, unknown> = {}): Promise<Record<string, any> | null> {
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section,
      url,
      rule: ruleSection,
      fetch: (rule.config as Record<string, unknown>).fetch,
      clean: (rule.config as Record<string, unknown>).clean,
      ...extra,
    }),
  })
  const json = (await res.json()) as TestResp
  if (!json.ok) {
    console.log(`  [${section}] ❌ ${json.message}`)
    return null
  }
  const d = json.data as Record<string, any>
  if (section === 'list') {
    console.log(`  [list] ✅ engine=${d.engine} count=${d.count} ${d.ms}ms`)
    for (const it of (d.sample || []).slice(0, 2)) console.log('    ', JSON.stringify(it).slice(0, 150))
  } else if (section === 'book') {
    console.log(`  [book] ✅ engine=${d.engine} fields=${JSON.stringify(d.fields).slice(0, 260)}`)
  } else if (section === 'toc') {
    console.log(`  [toc] ✅ engine=${d.engine} count=${d.count} pages=${d.pages}`)
    for (const it of (d.sample || []).slice(0, 2)) console.log('    ', JSON.stringify(it).slice(0, 130))
  } else {
    console.log(`  [content] ✅ engine=${d.engine} pages=${d.pages} raw=${d.rawLength} clean=${d.cleanedLength}`)
    console.log('    text:', JSON.stringify((d.cleanedText || '').slice(0, 120)))
  }
  return d
}

async function liveProbe(): Promise<boolean> {
  const cfg = rule.config as Record<string, any>
  let allPass = true
  console.log('== wanbenshenzhan.com 四段 live 探针(WANBEN_PROBE=1, 串行+引擎内置限速) ==')
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 10) allPass = false
  await new Promise((r) => setTimeout(r, 1200))

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) allPass = false
  await new Promise((r) => setTimeout(r, 1200))

  const toc = await testSection('toc', PROBE.toc, cfg.toc)
  if (!toc || (toc.count as number) < 50) allPass = false
  await new Promise((r) => setTimeout(r, 1200))

  if (PROBE.content) {
    const content = await testSection('content', PROBE.content, cfg.content)
    if (!content || (content.cleanedLength as number) < 2000) allPass = false
  }
  console.log(allPass ? '✅ 四段全部过线(list≥10, toc≥50, content≥2000)' : '❌ 存在未过线段落, 见上方日志')
  return allPass
}

async function main() {
  const probe = process.env.WANBEN_PROBE === '1'
  let allPass = true

  if (probe) {
    allPass = await liveProbe()
  } else {
    console.log('== 未实测模式(默认): 站点对沙箱出口 IP 不可达, 跳过 live 探针不烧请求 ==')
    console.log('   解封后: WANBEN_PROBE=1 bun run scripts/seed-rule-wanben.ts')
  }

  // 幂等入库: 同名规则(含历史重复)全部先删后建
  // 注: GET /api/admin/rules 信封为 {ok, data: Rule[]} — data 直接是数组
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`)
  const listJson = (await listRes.json()) as { ok: boolean; data?: { id: string; name: string }[] | { rules?: { id: string; name: string }[] } }
  const raw = Array.isArray(listJson.data) ? listJson.data : (listJson.data as { rules?: { id: string; name: string }[] })?.rules || []
  const duplicates = raw.filter((r) => r.name === rule.name)
  for (const d of duplicates) {
    const del = await fetch(`${BASE}/api/admin/rules/${d.id}`, { method: 'DELETE' })
    const delJson = (await del.json()) as { ok: boolean }
    console.log('旧规则已删除:', d.id, delJson.ok)
  }
  const res = await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  })
  const json = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)

  if (!allPass) process.exit(2)
}

// 直接执行时才入库; 被 import(离线验证脚本复用 rule)时不触发副作用
if (import.meta.main) main()

export {}
