// 种子脚本: 速读谷 (www.shudugu.org) 直连采集规则
// 用法: bun run scripts/seed-rule-shudugu.ts
// 侦察结论(实测 curl 2026-08-31, 桌面 Chrome UA 直连):
//  - 站点形态: IIS/10.0 + ASP.NET(x-aspnet-version 4.0.30319), UTF-8, 传统多页 HTML 站;
//    首页/内容路径全 200 直连 —— 无 WAF/无 UA 门禁/无编码陷阱/无 Set-Cookie 挑战
//  - URL 体系: 书籍 /{bid}/(如 /51/), 章节 /{bid}/{cid}.html(如 /51/3194.html),
//    章节子页 /{bid}/{cid}-{n}.html(3194-2.html...); 分类 /xuanhuan/ 等 7 类同模板(10本/页分页)
//  - ★目录形态: 全量目录内嵌书籍页 div#list.dir li, 每页 999 章; 超过 999 章的大书在
//    ul 后的 div.menu 区出翻页锚 <a class="gr" href="p-{n}.html#dir">下一页</a>
//    (实测 /3299/ 3652 章 = p-1~p-4 四页, p-2.html 首条=第一千章 接续无误) ——
//    toc 段显式 nextLink=css a.gr(单页书无该锚自然收敛); 早期误判"999截断无翻页入口"
//    的 3 个候选 URL(/2.html /dir.html /index_2.html)全 302 是探测路径错误, 真实形态 p-{n}.html
//  - ★list 段避坑: /zuixin/{page}.html 第 1 页是 302→/zuixin/, 且在 dev server 引擎环境
//    (fetch 层 manual 重定向链 + curl 层)实测对 302 目标稳定 500(独立 bun 进程同配置却 200,
//    源站 ASP.NET 对重定向链路存在 UA/环境相关 500, 详见 worklog cc-b); 分类页
//    /xuanhuan/{page}.html 第 1 页 200 直达无 302 → list urlTemplate 钉分类页形态更稳
//    (10 本/页×83 页, 与 zuixin 同一 div.item 模板)
//  - ★正文翻页: 章节子页 {cid}-{n}.html 由 div.prenext "下一页"锚驱动, 末页 prenext 变
//    "下一章"(无"下一页"锚) → parseContent 兜底 a:contains("下一页") 不含"下一章" 自然收敛,
//    kanunu8 式"下一页=下一章"陷阱不存在(实测 /51/3194.html 共 4 子页, 末页 3194-4 prenext
//    = 上一页/目录/下一章)
//  - 正文纯净(自称纯手打): div.con 内纯 <p> 段落, 无站名/域名/推广残留; 书籍页有两块
//    div.des.bb(简介+页尾推广文), intro 用 first() 语义取第一块, 不污染
//  - 四层(实测全通):
//    * 列表 = 分类页 /xuanhuan/{page}.html div.item(.itemtxt h3 a 书名+bookUrl /
//      .itemtxt p a 作者"作者：xxx" replaceFrom 剥前缀 / .itemtxt p span 状态 / img 封面绝对地址;
//      10 本/页×83 页; 其他分类同模板变体)
//    * 书籍页 = /{bid}/: .itemtxt h1 a 书名 + a[href*="/zuozhe/"] 作者 + .itemtxt p span
//      状态(连载中|已完结 原文交 smartCompleteDetect) + .itemtxt ul li a 最新章(倒序第1) +
//      div.des.bb 简介 + div.item img 封面
//    * 目录 = 内嵌书籍页 #list li > a, 每页 999 章, 大书经 a.gr 翻页链(p-{n}.html#dir)采全
//    * 正文 = div.con(p 段落), 子页分页 maxPages 10
const BASE = 'http://localhost:3000'

// 测试探针:
//  - list: 玄幻分类列表第 1 页(/xuanhuan/1.html 200 直达无 302, 10 本 ≥10)
//    ★rules/test 接口占位符坑: POST url 传含 {page} 原串时会被 httpUrl 的 new URL().toString()
//    规范化成 %7Bpage%7D, 接口内 replace('{page}','1') 不命中 → 源站对占位符路径 500;
//    故本脚本测试探针一律传已展开 URL(实采 runner 侧用 config.urlTemplate 自行 replace, 无此坑)
//  - book: /51/ 捞尸人(纯洁滴小龙, 648.3万字, 连载中, 全字段)
//  - toc: 同书籍页(781 章 ≥50)
//  - content: 第一章 /51/3194.html(4 子页分页合并, ≥2000 清洗字符)
//  - 兼容性附加探针(仅报告不设门槛): 大书 /3299/(目录翻页链 3652 章采全样本) + 完结书 /128/(已完结)
const PROBE = {
  // 注: test 探针传已展开 URL(见上方 test 接口占位符坑注释); config.urlTemplate 仍用 {page} 形态供实采
  list: 'https://www.shudugu.org/xuanhuan/1.html',
  book: 'https://www.shudugu.org/51/',
  toc: 'https://www.shudugu.org/51/',
  content: 'https://www.shudugu.org/51/3194.html',
  bookBig: 'https://www.shudugu.org/3299/',
  tocBig: 'https://www.shudugu.org/3299/',
  bookFin: 'https://www.shudugu.org/128/',
  tocFin: 'https://www.shudugu.org/128/',
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '速读谷 (shudugu.org)',
  description:
    'shudugu.org IIS+ASP.NET 传统多页站, UTF-8 直连无挑战(无WAF/无UA门禁)。列表=/zuixin/{page}.html(483页每页11本, 第1页302→/zuixin/自动跟随) div.item(书名/作者剥"作者："前缀/状态/封面) / 书籍页 /{bid}/ 内嵌 .itemtxt(h1 a 书名+a[href*=zuozhe] 作者+p span 状态原文+ul li 最新章)+div.des.bb 简介+img 封面 / 目录内嵌书籍页 #list li 单页(★站点内嵌目录有~1000章截断上限, 超千章大书只露前999章且无翻页入口, 硬约束) / 正文 div.con, 章节子页 {cid}-{n}.html 由 prenext"下一页"锚翻页(末页变"下一章"无锚自然收敛, 陷阱不存在)。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 分类列表: /xuanhuan/1.html ~ 83.html(每页 10 本, 第 1 页 200 直达无 302);
      // 注: /zuixin/{page}.html 第 1 页 302→/zuixin/ 且引擎环境实测 500(见文件头避坑注释), 不采用;
      // 其他分类同模板变体(改路径即可): /xianxia/ /dushi/ /lishi/ /junshi/ /kehuan/ /yanqing/
      urlTemplate: 'https://www.shudugu.org/xuanhuan/{page}.html',
      itemSelector: { type: 'css', expression: 'div.item' },
      fields: {
        // 首页置顶项书名在 h1, 常规项在 h3, 双选择器兼容(文档序 first)
        name: { type: 'css', expression: '.itemtxt h3 a, .itemtxt h1 a', attr: 'text' },
        bookUrl: { type: 'css', expression: '.itemtxt h3 a, .itemtxt h1 a', attr: 'href' },
        // "作者：xxx" 链接文本, 剥"作者："前缀
        author: {
          type: 'css',
          expression: '.itemtxt p a',
          attr: 'text',
          replaceFrom: '^作者[:：]\\s*',
          replaceTo: '',
        },
        status: { type: 'css', expression: '.itemtxt p span', attr: 'text' },
        // 封面已是绝对地址 https://www.shudugu.org/files/cover/...
        cover: { type: 'css', expression: 'img', attr: 'src' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: '.itemtxt h1 a', attr: 'text' },
        author: { type: 'css', expression: 'a[href*="/zuozhe/"]', attr: 'text', replaceFrom: '^作者[:：]\\s*', replaceTo: '' },
        // "连载中/已完结" 原文提取(.item 内首个 p span), 交 smartCompleteDetect 归一化
        status: { type: 'css', expression: '.itemtxt p span', attr: 'text' },
        // 最新三章列表倒序, 首个 li = 最新章
        latestChapter: { type: 'css', expression: '.itemtxt ul li a', attr: 'text' },
        // 书籍页有两块 div.des.bb(第一块=简介 p 段落, 页尾第二块=推广文), first() 语义天然取简介
        intro: { type: 'css', expression: 'div.des.bb', attr: 'text' },
        cover: { type: 'css', expression: 'div.item img', attr: 'src' },
      },
    },
    toc: {
      enabled: true,
      // 全部章节内嵌书籍页 div#list.dir, 每页 999 章; 超页大书翻页锚 = ul 后 div.menu 区
      // <a class="gr" href="p-{n}.html#dir">下一页</a>(实测 /3299/ 3652 章 4 页采全)。
      // 显式 nextLink 而非"下一页"文字兜底: 单页书(如 /51/ 781 章)无 a.gr 锚 extractField 空 → 收敛
      itemSelector: { type: 'css', expression: '#list li' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: {
        enabled: true,
        maxPages: 20,
        nextLink: { type: 'css', expression: 'a.gr', attr: 'href' },
      },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: 'div.con', attr: 'html' },
      },
      // 章节内分页: {cid}.html → {cid}-2.html → ...("下一页"锚, 末页 prenext 变"下一章"无锚
      // 收敛; parseContent 兜底 a:contains("下一页") 不含"下一章", 跨章连锁陷阱不存在)
      pagination: { enabled: true, maxPages: 10 },
    },
    fetch: {
      engine: 'http',
      // 直连站: 无挑战/无 UA 门禁, 常规 rotate UA 池 + autoCookie 防御性保留
      uaMode: 'rotate',
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
        '(www\\.)?shudugu\\.org\\S*',
        '(www\\.)?sudugu\\.org\\S*',
        '速读谷[^<>]*',
        '谷内无错[^<>]*',
        '请记住本站[^<>]*',
        '本站内容来源于网络[^。<>]*',
        '本站所收录作品[^<>]*',
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

  console.log('== shudugu.org 四段测试 ==')
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 10) allPass = false

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) allPass = false

  const toc = await testSection('toc', PROBE.toc, cfg.toc)
  if (!toc || (toc.count as number) < 50) { allPass = false; console.log('  !! toc<50 未过线') }

  const content = await testSection('content', PROBE.content, cfg.content)
  if (!content || (content.cleanedLength as number) < 2000) { allPass = false; console.log('  !! content<2000 未过线') }

  console.log('== 布局兼容性附加探针(不设门槛, 仅报告: 大书3299目录999截断样本/完结书128) ==')
  await testSection('book', PROBE.bookBig, cfg.book)
  await testSection('toc', PROBE.tocBig, cfg.toc)
  await testSection('book', PROBE.bookFin, cfg.book)
  await testSection('toc', PROBE.tocFin, cfg.toc)

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
