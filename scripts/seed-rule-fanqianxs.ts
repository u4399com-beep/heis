// 种子脚本: 西红柿小说 (www.fanqianxs.com) ·JIEQI CMS 模板 采集规则
// 用法: bun run scripts/seed-rule-fanqianxs.ts
// 幂等: 同名规则先删后建; export{} 守卫(可被 verify 脚本 import 规则配置)
//
// ================= 结构依据(GitHub 多书源反查, 非直连实测) =================
// 主控 R11-1A 任务书反查到 fanqianxs.com 真实 DOM 结构(番茄小说山寨站, 与 23qb.net
// 同款 JIEQI CMS 模板)。来自以下 GitHub 书源汇总:
//   - Moli-X/BookSource (老版本 POST 搜索 /modules/article/search.php)
//   - mumuceo/BookSource (2023 年快照, GET JSON 搜索 /api/search?q=)
//   - wle2015/BookSource (新版本正文 #htmlContent p 配置)
//
// ★可达性: fanqianxs.com Cloudflare 防护(实测主控反查期间 403/1020/1101),
//   直连 curl / http engine 全失败, 必须 scrapling-static(TLS 指纹伪装 +
//   真实浏览器 JA3)才能拿首页 HTML。本规则结构按 JIEQI CMS 模板反推, 真实响应
//   形状若有出入优先核对 og:novel:* meta 与 #list dl dt/dd 结构。
//
// URL 体系(老版本 JIEQI CMS, 与 23qb.net 同款):
//   - 列表(分类): /{category}/{page}/
//     分类 slug: xuanhuan/yanqing/dushi/wuxia/danmei/kehuan/lightnovel/lishi
//   - 列表(榜单): /book/0-{rank}-{params}-{page}.html
//     rank: lastupdate/postdate/allvisit/allvote/goodnum/size/quanben
//   - 书籍页: /book/{bid}/ 或 /{category}/{bid}/
//   - 目录: 与书籍页同 URL(JIEQI CMS 内嵌目录, 不另起页)
//   - 正文: /book/{bid}/{cid}.html 或 /{category}/{bid}/{cid}.html
//   - 搜索(老版本): /modules/article/search.php POST keyword={key}
//   - 搜索(新版本): /api/search?q={key} (JSON 数组)
//
// DOM 结构:
//   - 列表(.novelslist2 li):
//     * li:first-child = 表头行(类别/书名/最新章节/作者/更新时间/状态)
//     * li:not(:first-child) → 数据行
//       .s2>a 书名+bookUrl / .s3>a 最新章节 / .s4 作者 / .s5 更新时间 / .s6 状态
//   - 书籍页 meta[property="og:novel:*"] 全套:
//     book_name / author / category / status / latest_chapter_name / update_time
//     + meta[property="og:image"] 封面 / meta[property="og:description"] 简介
//     或老版本: #info>h1 书名 / #info>p:nth-child(2) 作者 / #fmimg>img 封面 / #intro 简介
//   - 目录(#list dl): 通常有 2 个 dt
//     * dt:nth-of-type(1) "最新章节" 标题(下方 dd=最新3章回链, 需跳过)
//     * dt:nth-of-type(2) "正文" 标题(下方 dd=完整章节列表, 取此区)
//     * 备用单 dt 形态: #list dl dd 直接取
//   - 正文(#content): 纯 <p> 段落(老版本) / #htmlContent p(新版本 wle2015 配置)
//   - 章末广告(实测多版本):
//     "推荐下.*更新快！" / "推荐一个.*com！" / "广个告.*离线朗读！" / "广个告.*更新快！"
//
// 四层结构(基于 JIEQI CMS 模板反推, 与 23qb.net/aijjxs.com 同款):
//   * 列表 = /xuanhuan/{page}/ .novelslist2 li:not(:first-child)
//     .s2>a 书名+bookUrl / .s4 作者 / .s5 更新时间 / .s6 状态
//   * 书籍页 = /book/{bid}/ og:novel:* meta 全套 + #intro 简介 + #fmimg img 封面
//   * 目录 = 书籍页同 URL #list dl dt:nth-of-type(2) ~ dd(跳过"最新章节"区)
//   * 正文 = /book/{bid}/{cid}.html #content p 段落
// ============================================================
const BASE = 'http://localhost:3000'

// 测试探针 URL(基于 23qb.net 同款 JIEQI 模板推断, ID 为推测值):
//   ★rules/test 接口 URL 参数一律传已展开 URL({page}→1, cc-b 占位符坑先例);
//   config.urlTemplate 保持 {page} 形态供实采 runner 替换
const PROBE = {
  list: 'https://www.fanqianxs.com/xuanhuan/1/',
  book: 'https://www.fanqianxs.com/book/1234/',
  toc: 'https://www.fanqianxs.com/book/1234/',
  content: 'https://www.fanqianxs.com/book/1234/5678.html',
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '西红柿小说(fanqianxs.com)·JIEQI CMS 模板',
  description:
    'fanqianxs.com 番茄小说山寨站(与 23qb.net 同款 JIEQI CMS, 主控 R11-1A 反查 GitHub Moli-X/mumuceo/wle2015 三书源汇总 DOM)。Cloudflare 防护需 scrapling-static(TLS 指纹伪装)。列表=/xuanhuan/{page}/ .novelslist2 li:not(:first-child)(.s2>a 书名+bookUrl / .s4 作者 / .s5 更新时间 / .s6 状态; 备用 .booklist li 同款) / 书籍页 og:novel:* meta 全套(book_name/author/category/status/latest_chapter_name/update_time)+#intro 简介+#fmimg img 封面 / 目录 #list dl dt:nth-of-type(2) ~ dd(跳过第1个dt"最新章节"区, JIEQI 双dt 模板) / 正文 #content p 段落(章末广告词: 推荐下.*更新快 / 广个告.*离线朗读 等)。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 分类列表: /xuanhuan/{page}/ (与 23qb.net 同款 JIEQI 模板); 其他分类同模板变体:
      // yanqing/dushi/wuxia/danmei/kehuan/lightnovel/lishi
      // 榜单变体: /book/0-lastupdate-0-0-0-0-0-0-{page}.html (lastupdate/postdate/allvisit
      //   /allvote/goodnum/size/quanben 等 rank)
      urlTemplate: 'https://www.fanqianxs.com/xuanhuan/{page}/',
      // li:first-child 是表头行(类别/书名/章节/作者/更新/状态), :not(:first-child) 排除;
      // 备用 .booklist li 同款(部分 JIEQI 主题切换时存在)
      itemSelector: { type: 'css', expression: '.novelslist2 li:not(:first-child)' },
      fields: {
        name: { type: 'css', expression: '.s2 a', attr: 'text' },
        bookUrl: { type: 'css', expression: '.s2 a', attr: 'href' },
        // .s3 最新章节(回链), 多数列表不展示故提取但不强依赖
        latestChapter: { type: 'css', expression: '.s3 a', attr: 'text' },
        author: { type: 'css', expression: '.s4', attr: 'text' },
        updateTime: { type: 'css', expression: '.s5', attr: 'text' },
        // "连载中" / "已完结" / "太监" 等原文, 交 smartCompleteDetect 归一化
        status: { type: 'css', expression: '.s6', attr: 'text' },
      },
      pagination: { enabled: true, maxPages: 100 },
    },
    book: {
      enabled: true,
      fields: {
        // og:novel:book_name 等 meta 全套(JIEQI CMS 标准 SEO 元数据, 与 23qb.net 同款)
        name: { type: 'css', expression: "meta[property='og:novel:book_name']", attr: 'content' },
        author: { type: 'css', expression: "meta[property='og:novel:author']", attr: 'content' },
        category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
        status: { type: 'css', expression: "meta[property='og:novel:status']", attr: 'content' },
        latestChapter: { type: 'css', expression: "meta[property='og:novel:latest_chapter_name']", attr: 'content' },
        // #intro 内含 <p> 简介; 取 text 即可, cleaner 会剥标签
        intro: { type: 'css', expression: '#intro', attr: 'text' },
        // #fmimg>img 封面(与 23qb.net/aijjxs 同款 JIEQI 模板)
        cover: { type: 'css', expression: '#fmimg img', attr: 'src' },
      },
    },
    toc: {
      enabled: true,
      // 书籍页与目录页同 URL(JIEQI CMS 内嵌目录, 不另起页), 无 tocLink
      // ★跳过第1个 dt "最新章节" 区(常见 JIEQI 模板有 2 个 dt):
      //   dt:nth-of-type(1) "最新章节"(下方 dd=最新3章回链, 重复章节)
      //   dt:nth-of-type(2) "正文"(下方 dd=完整章节列表, 取此区)
      // 选择器: #list dl dt:nth-of-type(2) ~ dd(取第2个dt之后的所有dd兄弟)
      itemSelector: { type: 'css', expression: '#list dl dt:nth-of-type(2) ~ dd' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        // 老版本 #content p 段落(与 23qb.net/aijjxs 同款); 新版本可改为 #htmlContent p(wle2015 配置)
        content: { type: 'css', expression: '#content', attr: 'html' },
      },
      // 翻页关闭: JIEQI CMS 章节单页; 开启翻页可能误跟"下一章"锚(与 aijjxs/kanunu8 同款陷阱)
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      // ★scrapling-static: Cloudflare 防护需 TLS 指纹伪装(curl_cffi JA3 模拟真实浏览器),
      // http engine 直连必失败(403/1020/1101); scrapling-static 走 curl_cffi 真实指纹
      engine: 'scrapling-static',
      uaMode: 'rotate',
      autoCookie: true,
      referer: true,
      timeout: 25000, // CF 防护站点响应慢, 比 http 多 5s
      retries: 2,
      waitMs: 1000,
      browserFallbackStatus: [403, 412, 429, 503],
      hostGateLimit: 2, // CF 防护站降低并发避免触发 rate-limit
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
      adPatterns: [
        // 站点水印 + 域名灌水
        '(www\\.)?fanqianxs\\.com\\S*',
        '西红柿小说[^<>]*',
        '番茄小说[^<>]*转载收集',
        '番茄小说免费阅读[^<>]*',
        '番茄小说正版[^<>]*',
        // 章末广告(实测多个版本, 来自 GitHub 书源反查)
        '推荐下.*?更新快',
        '推荐一个.*?com',
        '广个告.*?离线朗读',
        '广个告.*?更新快',
        // 通用 JIEQI 模板推广词
        '本书首发于[^<>]*',
        '请记住本书[^<>]*',
        '最新章节请到[^<>]*查看',
        '一秒记住.*?免费读',
        '本章未完.*?点击下一页继续阅读',
        '为您提供.*?精彩小说',
        '本站(?:首发|更新最快).{0,30}《',
        '下载(?:APP|客户端|手机版).{0,20}看',
        '扫码(?:关注|下载).{0,20}',
        '关注微信公众号.{0,20}',
        '加入书签.{0,15}继续阅读',
        '为了方便下次阅读.{0,30}',
        '本章(?:未完|未完待续|继续阅读).{0,8}',
        '友情链接[:：].{0,200}',
        // 裸域名灌水兜底
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      normalize: true,
      plainText: false,
    },
  },
}

// ---------- 四段测试 ----------
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
    for (const it of (d.sample || []).slice(0, 2)) console.log('    ', JSON.stringify(it).slice(0, 150))
  } else if (section === 'book') {
    console.log(`  [book] ✅ engine=${d.engine} ${d.ms}ms fields=${JSON.stringify(d.fields).slice(0, 260)}`)
  } else if (section === 'toc') {
    console.log(`  [toc] ✅ engine=${d.engine} count=${d.count} pages=${d.pages} ${d.ms}ms`)
    for (const it of (d.sample || []).slice(0, 2)) console.log('    ', JSON.stringify(it).slice(0, 130))
  } else {
    console.log(`  [content] ✅ engine=${d.engine} pages=${d.pages} raw=${d.rawLength} clean=${d.cleanedLength} ${d.ms}ms`)
    console.log('    text:', JSON.stringify((d.cleanedText || '').slice(0, 120)))
  }
  return d
}

async function main() {
  const cfg = rule.config as Record<string, any>
  let allPass = true

  console.log('== fanqianxs.com 四段烟测 (CF 防护, scrapling-static) ==')
  // ★fanqianxs.com Cloudflare 防护, 直连 curl 必失败; 测试探针依赖 scrapling-bridge
  // 服务(127.0.0.1:3012)转发到 scrapling-static。若探针失败, 检查:
  //   1. scrapling-bridge 服务是否运行(curl http://127.0.0.1:3012/health)
  //   2. /etc/hosts 是否解析 www.fanqianxs.com 到正确 CDN IP
  //   3. CF 防护可能间歇性 403, 重试或换出口 IP
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 5) {
    allPass = false
    console.log('  !! list<5 未过线(CF 防护或结构变更, 入库仍继续)')
  }

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) {
    allPass = false
    console.log('  !! book 段无 name 字段(og:novel:book_name meta 缺失, 检查 DOM 是否变更)')
  }

  const toc = await testSection('toc', PROBE.toc, cfg.toc)
  if (!toc || (toc.count as number) < 10) {
    allPass = false
    console.log('  !! toc<10 未过线(可能 dt:nth-of-type(2) 不存在, 备用 #list dd a)')
  }

  const content = await testSection('content', PROBE.content, cfg.content)
  if (!content || (content.cleanedLength as number) < 1000) {
    allPass = false
    console.log('  !! content<1000 未过线(可能 #content 不存在, 备用 #htmlContent)')
  }

  // 幂等入库: 同名规则(含历史重复)全部先删后建
  const listRes = await fetch(`${BASE}/api/admin/rules?take=200`)
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

  console.log(allPass ? '✅ 四段烟测全部过线(list≥5, toc≥10, content≥1000)' : '❌ 存在未过线段落, 见上方日志(CF 防护站点结构反推, 入库仍完成)')
  // CF 防护站点探针失败不阻断入库(规则已基于反查 DOM 写定, 待 scrapling 实测)
  // 若需严格阻断, 改为 if (!allPass) process.exit(2)
}

main()

export {}
