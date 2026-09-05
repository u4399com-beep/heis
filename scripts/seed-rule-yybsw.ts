// 种子脚本: 夜伴书屋 (www.yybsw.com) CF前置直连采集规则
// 用法: bun run scripts/seed-rule-yybsw.ts
// 侦察结论(实测 curl 2026-08, CF 前置域名 https://www.yybsw.com/ 直连):
//  - 站点形态: DedeCMS 模板站(壳页品牌"完美书库", 正站品牌"夜伴书屋"), UTF-8, Cloudflare 前置
//    (源站 38.34.172.127, 与 ybsw8/ybswa/ybsws/yeban360 同站族; sitemap.xml 2001 条指向已迁的
//    www.ybswo.com —— 迁站旧壳, 本规则只认活着的 CF 前置 www.yybsw.com)
//  - ★UA 门禁(本站核心坑): 桌面 Chrome UA 访问内容路径 /book/*、/list/* 被 Apache 403
//    (303B 标准拦截页, 首页/sitemap/static 正常 200) —— bb-c 在源站 IP 上观察到的同款配置;
//    实测 UA 矩阵: 桌面Chrome=403 / bingbot=403 / Sogou=403 / **Android 移动 Chrome=200** /
//    Baiduspider=200 / Googlebot=200。判定为源站按 UA 放行移动端+主流搜索蜘蛛。
//    → 规则 fetch.uaMode='custom' 钉 Android 移动 Chrome UA(内容与桌面模板完全一致,
//      首页字节级同款 51694B, 选择器无差异)
//  - 四层(实测全通, 移动 UA):
//    * 列表 = 分类页 /list/{slug}.html 为精选落地页(6本), 真分页列表 /list/{slug}{page}.html
//      (page 1 起, 每页 10 本; dushi 116 页 / yanqing 1053 页; 9 分类 slug:
//      qihuan/kehuan/wuxia/yanqing/dushi/lishi/xuanyi/chunai/lightnovel)
//      列表项 div.media(.media-title h4 a 书名+bookUrl / .media-info 简介 / img 封面)。
//      注意: 真分页页(dushi1.html)列表项无作者元素且封面类名为 book-img-small, 与精选落地页
//      (dushi.html, img.book-img+span.dark 作者)略异 —— 作者统一从书籍页取, 列表不采 author;
//      侧栏"小说推荐"是 .item 非 .media, 选择器天然隔离
//    * 书籍页 = /book/{id}(301→/book/{id}/): h1.book-name a + a[href*="/author/"] 作者 +
//      "状态：完结|连载中"(regex 交 smartCompleteDetect) + "最近更新：<a>末章</a>"(regex) +
//      div.book-detail 简介 + img.book-img-middel 封面 + reader-bar(开始阅读/电子书下载 /txt/{id}.html
//      —— 混合形态站: 在线阅读可用, 目录正文走在线层)
//    * 目录 = 内嵌书籍页 div#all-chapter .col-md-6.item > a, 全量单页(实测 224 章无翻页标记;
//      书籍页无"下一页"锚点, 翻页开启亦零请求, 防御性保留)
//    * 正文 = div#cont-body(p 段落); 章节内分页 _2.html/_3.html 由"下一页"锚驱动(页顶+页底各一,
//      末页变"没有了"无锚 → parseContent 兜底 a:contains("下一页") 自然收敛), 上一章/回目录
//      导航行在容器外不污染正文
//  - 正文实测干净(老书 876/新书 27714 抽查均无站名/域名/推广残留), #cont-body 内嵌
//    play("neiwen") 脚本由 removeSelectors 清除
const BASE = 'http://localhost:3000'

// 测试探针:
//  - list: 都市分类真分页列表第 1 页(10 本 ≥10)
//  - book: /book/27714/ 死遁的亡夫们都回来了(全字段)
//  - toc: 同书籍页(82 章 ≥50)
//  - content: 第82章(3 子页分页合并, ≥2000 清洗字符)
//  - 兼容性附加探针(仅报告不设门槛): 老书 /book/876/(与凤行, 25 章/短章无分页)
const PROBE = {
  list: 'https://www.yybsw.com/list/dushi{page}.html',
  book: 'https://www.yybsw.com/book/27714/',
  toc: 'https://www.yybsw.com/book/27714/',
  content: 'https://www.yybsw.com/book/27714/7701301.html',
  bookOld: 'https://www.yybsw.com/book/876/',
  tocOld: 'https://www.yybsw.com/book/876/',
  contentOld: 'https://www.yybsw.com/book/876/166268.html',
}

// Android 移动 Chrome UA —— 源站 UA 门禁下唯一稳定的"真实浏览器"通行证(桌面 UA 全 403)
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '夜伴书屋 (yybsw.com)',
  description:
    'yybsw.com CF前置直连, DedeCMS 模板 UTF-8。核心坑: 源站 UA 门禁 —— 桌面浏览器 UA 在 /book/*、/list/* 被 Apache 403, 需 uaMode=custom 钉 Android 移动 Chrome UA(实测放行, 模板与桌面一致)。列表=分类真分页页 /list/{slug}{page}.html 的 div.media(书名/作者/简介/封面, 每页10本; dushi{page}.html 116页) / 书籍页 /book/{id} h1.book-name+a[href*=/author/]+状态regex+最近更新regex+div.book-detail 简介+img.book-img-middel 封面 / 目录内嵌书籍页 #all-chapter .col-md-6.item 全量单页 / 正文 #cont-body, 章节子页 _2/_3.html 由"下一页"锚翻页(末页"没有了"自然收敛)。混合形态站(在线阅读+TXT下载), 走在线层。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 分类真分页列表: /list/dushi1.html ~ dushi116.html(每页 10 本)。
      // 其他分类变体(改 slug 即可): yanqing(1053页)/qihuan/kehuan/wuxia/lishi/xuanyi/chunai/lightnovel
      urlTemplate: 'https://www.yybsw.com/list/dushi{page}.html',
      itemSelector: { type: 'css', expression: 'div.media' },
      fields: {
        name: { type: 'css', expression: '.media-title h4 a', attr: 'text' },
        bookUrl: { type: 'css', expression: '.media-title h4 a', attr: 'href' },
        intro: { type: 'css', expression: '.media-info', attr: 'text' },
        // 真分页页封面类名 book-img-small / 精选落地页 book-img, 双类名兼容
        cover: { type: 'css', expression: 'img.book-img, img.book-img-small', attr: 'src' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: 'h1.book-name a', attr: 'text' },
        author: { type: 'css', expression: 'a[href*="/author/"]', attr: 'text' },
        // "状态：完结/连载中" 原文提取, 交 smartCompleteDetect 归一化
        status: { type: 'regex', expression: '状态[:：]\\s*([^\\s<]{1,12})', attr: '1', flags: 'gs' },
        latestChapter: { type: 'regex', expression: '最近更新：\\s*<a[^>]*>([^<]{1,80})</a>', attr: '1', flags: 'gs' },
        intro: { type: 'css', expression: 'div.book-detail', attr: 'text' },
        cover: { type: 'css', expression: 'img.book-img-middel', attr: 'src' },
      },
    },
    toc: {
      enabled: true,
      // 全部章节内嵌书籍页 #all-chapter(实测 224 章全量单页); 章节链 /book/{bid}/{cid}.html。
      // 最新章节面板/开始阅读/最近更新链接都在 #all-chapter 外, 选择器天然隔离不产生重复
      itemSelector: { type: 'css', expression: '#all-chapter .col-md-6.item' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      // 书籍页无"下一页"锚(实测 0 处), 翻页开启零请求, 防御未来大书分页变体
      pagination: { enabled: true, maxPages: 20 },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: '#cont-body', attr: 'html' },
      },
      // 章节内分页: 7701301.html → _2.html → _3.html("下一页"锚, 末页"没有了"无锚收敛);
      // kanunu8 式"下一页=下一章"陷阱在本站不存在(下一页永远是同章子页)
      pagination: { enabled: true, maxPages: 10 },
    },
    fetch: {
      engine: 'http',
      // UA 门禁: 桌面 UA 内容路径 403, 必须钉移动 UA(侦察证据见文件头)
      uaMode: 'custom',
      customUa: MOBILE_UA,
      autoCookie: true,
      referer: true,
      timeout: 25000,
      retries: 2,
      waitMs: 800,
      browserFallbackStatus: [403, 412, 429, 503],
      hostGateLimit: 3,
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
      adPatterns: [
        '(www\\.)?yybsw\\.com\\S*',
        '(www\\.)?ybsw[o8aws]?\\.com\\S*',
        '夜伴书屋[^<>]*',
        '完美书库[^<>]*',
        '本站内容来源于网络[^。<>]*',
        '本站所收录作品[^<>]*',
        '请记住本站[^<>]*',
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

  console.log('== yybsw.com 四段测试 ==')
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 10) allPass = false

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) allPass = false

  const toc = await testSection('toc', PROBE.toc, cfg.toc)
  if (!toc || (toc.count as number) < 50) { allPass = false; console.log('  !! toc<50 未过线') }

  const content = await testSection('content', PROBE.content, cfg.content)
  if (!content || (content.cleanedLength as number) < 2000) { allPass = false; console.log('  !! content<2000 未过线') }

  console.log('== 布局兼容性附加探针(不设门槛, 仅报告: 老书/book/876/ 与凤行) ==')
  await testSection('book', PROBE.bookOld, cfg.book)
  await testSection('toc', PROBE.tocOld, cfg.toc)
  await testSection('content', PROBE.contentOld, cfg.content)

  // 幂等入库: 同名规则(含历史重复)全部先删后建
  // 注: GET /api/admin/rules 信封为 {ok, data: Rule[]} —— data 直接是数组
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

  console.log(allPass ? '✅ 四段测试全部过线(list≥10, toc≥50, content≥2000)' : '❌ 存在未过线段落, 见上方日志')
  if (!allPass) process.exit(2)
}

main()

export {}
