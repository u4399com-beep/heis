// 种子脚本: 知轩藏书 (www.zxcs.click) 直连 SSR 采集规则(TXT 资源站)
// 用法: bun run scripts/seed-rule-zxcs.ts
// 侦察结论(实测 curl 2025):
//  - 直连 200 无防护, UTF-8 SSR(Nuxt 风格 data-v-* 属性); 站点为 TXT 下载站,
//    书籍页只有 "立即下载"(#download → /download/{id}, 实测为 JS 跳转桥页, 4.6KB,
//    location.href=result) —— 全站无在线阅读/章节目录(书籍页零 "章节/目录" 字样),
//    故 toc/content 段 enabled:false(任务口径), 只采 list+book 两段入库书源信息
//  - 四层(实存两层):
//    * 列表 = 分类页 li.book-li(每页 20 本; 首页 42 本为推荐+更新混排): a(封面壳, href=书链)
//      + div.cover.w90/w130 style=background-image:url(封面) + .book-head>a(.book-title 书名)
//      + .book-intro 简介 + .book-survey>span.author 作者 + span.rect>a 标签
//      分页 /dushi/list_{page}.html(实测 list_1.html 200 与 /dushi/ 同内容, 共 20 页/分类)
//    * 书籍页 = /{cate}/{id}.html: h1.book-info__title + a.book-info__author +
//      p.book-info__categories a.category(标签) + div.intro-content(简介含 <p>) +
//      img.book-cover__img(封面) + #download 下载链接
//    * 目录/正文: 不存在(见上) —— 站点只提供整本 TXT 下载, 无 per-chapter 页面
//  - 测试探针: list=都市分类第1页(20本) / book=华娱1981(全字段); toc/content 段禁用不测
const BASE = 'http://localhost:3000'

const PROBE = {
  list: 'https://www.zxcs.click/dushi/list_1.html',
  book: 'https://www.zxcs.click/dushi/2463.html',
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '知轩藏书(www.zxcs.click)·TXT资源站采集',
  description:
    'zxcs.click 直连无防护 UTF-8 SSR 站(TXT 下载站)。列表=分类页 li.book-li(.book-title 书名/span.author 作者/.book-intro 简介/.cover style 封面, /dushi/list_{page}.html 分页) / 书籍页 h1.book-info__title+a.book-info__author+div.intro-content 简介+img.book-cover__img 封面 / 目录与正文段 enabled:false —— 全站无在线阅读与章节页(仅整本 TXT 下载 /download/{id} JS桥页), 不提供 per-chapter 采集。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      urlTemplate: 'https://www.zxcs.click/dushi/list_{page}.html',
      itemSelector: { type: 'css', expression: 'li.book-li' },
      fields: {
        name: { type: 'css', expression: '.book-title', attr: 'text' },
        bookUrl: { type: 'css', expression: 'div.book-head a', attr: 'href' },
        author: { type: 'css', expression: 'span.author', attr: 'text' },
        intro: { type: 'css', expression: '.book-intro', attr: 'text' },
        cover: {
          type: 'css', expression: 'div.cover', attr: 'style',
          // style="background-image:url(/uploads/xx.jpeg)" → 提取 url 内容
          replaceFrom: '^.*url\\(([^)]*)\\).*$', replaceTo: '$1',
        },
        category: { type: 'css', expression: 'span.rect a', attr: 'text' },
      },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: 'h1.book-info__title', attr: 'text' },
        author: { type: 'css', expression: 'a.book-info__author', attr: 'text' },
        category: { type: 'css', expression: 'p.book-info__categories a.category', attr: 'text' },
        intro: { type: 'css', expression: 'div.intro-content', attr: 'html' },
        cover: { type: 'css', expression: 'img.book-cover__img', attr: 'src' },
      },
    },
    // 站点无章节目录页(仅整本 TXT 下载), 目录段禁用
    toc: {
      enabled: false,
      fields: {},
      pagination: { enabled: false, maxPages: 1 },
    },
    // 站点无在线正文页(/download/{id} 为 JS 跳转桥页非正文), 内容段禁用
    content: {
      enabled: false,
      fields: {},
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      engine: 'http',
      uaMode: 'rotate',
      autoCookie: true,
      referer: true,
      timeout: 20000,
      retries: 2,
      waitMs: 800,
      browserFallbackStatus: [403, 412, 429, 503],
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
      adPatterns: [
        '(www\\.)?zxcs\\.click\\S*',
        '知轩藏书[^<>]*',
        '本站所有小说[^<>]*',
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      normalize: true,
      plainText: false,
    },
  },
}

// ---------- 段测试(仅 list/book —— toc/content 段站点无对应页面, 已禁用) ----------
interface TestResp {
  ok: boolean
  message?: string
  data?: Record<string, unknown>
}

async function testSection(section: string, url: string, ruleSection: unknown, extra: Record<string, unknown> = {}): Promise<Record<string, any> | null> {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section, url, rule: ruleSection,
      fetch: (rule.config as Record<string, unknown>).fetch,
      clean: (rule.config as Record<string, unknown>).clean,
      ...extra,
    }),
  })
  const json = (await res.json()) as TestResp
  const ms = Date.now() - t0
  if (!json.ok) {
    console.log(`  [${section}] ❌ ${json.message} (${ms}ms)`)
    return null
  }
  const d = json.data as Record<string, any>
  if (section === 'list') {
    console.log(`  [list] ✅ engine=${d.engine} count=${d.count} ${d.ms}ms`)
    for (const it of (d.sample || []).slice(0, 2)) console.log('    ', JSON.stringify(it).slice(0, 170))
  } else {
    console.log(`  [book] ✅ engine=${d.engine} ${d.ms}ms fields=${JSON.stringify(d.fields).slice(0, 300)}`)
  }
  return d
}

async function main() {
  const cfg = rule.config as Record<string, any>
  let allPass = true

  console.log('== zxcs.click 两段测试(toc/content 站点不存在, 已禁用) ==')
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 10) allPass = false

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) allPass = false

  // 幂等入库: 同名规则(含历史重复)全部先删后建
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

  console.log(allPass ? '✅ list/book 测试过线(list≥10, book 全字段; toc/content 按任务口径禁用)' : '❌ 存在未过线段落, 见上方日志')
  if (!allPass) process.exit(2)
}

main()

export {}
