// 种子脚本: 飘天文学 (www.piaotia.com) 直连 GBK 老式 XHTML 站采集规则
// 用法: bun run scripts/seed-rule-piaotia.ts
// 侦察结论(实测 curl 2025):
//  - 直连 200 无防护(站点挂 Cloudflare 但 HTTP 引擎直连可达), GBK 编码(meta charset=gbk,
//    fetcher.decodeBuffer 自动解码, 无需规则侧处理)
//  - 四层:
//    * 列表 = 分类页 /booksort1/0/{page}.html(1~134, 九大分类 booksort1~9): 老式表格
//      table.grid tr(td1 书名链 /bookinfo/{s}/{id}.html, td2 最新章链, td3 作者, td6 状态);
//      页首同 class 的"首字母检索表"行(articlelist.php 链接)用 bookUrl replaceFrom 置空剔除
//    * 书籍页 = /bookinfo/{s}/{id}.html: h1 + 表格 td 文本(类别/作者/文章状态, 含 &nbsp; 实体
//      → regex 兼容) + 内容简介：<br> 块(regex 截到双 <br>) + img[src*=files/article/image] 封面
//    * 目录 = 独立页 /html/{s}/{id}/index.html (书籍页 a:contains("查看全部章节")), 全量单页
//      (实测仙工开物 1047 章): 多段 <ul><li><a href="相对数字.html">, 尾部 <li>&nbsp;</li>
//      填充行无链接被空 url 收紧自然剔除
//    * 正文 = /html/{s}/{id}/{cid}.html: 站点 HTML 严重不闭合(#shop 提前闭合), 正文是
//      body 级裸文本+<br>(无 #content 容器) → 用 regex 从 toplink 导航后截到 bottomlink 前,
//      段内广告表(script)由 cleaner 白名单剥除; "下一章"指向下一章 → content 翻页关闭
//  - 已知源站瑕疵: 正文末尾有孤立 ">" 残留(模板 bug, clean.adPatterns '^>\s*$' 剥除);
//    正文首行重复章节标题(源站模板, 保留无害)
const BASE = 'http://localhost:3000'

const PROBE = {
  list: 'https://www.piaotia.com/booksort1/0/1.html',
  book: 'https://www.piaotia.com/bookinfo/15/15701.html',
  toc: 'https://www.piaotia.com/bookinfo/15/15701.html',
  content: 'https://www.piaotia.com/html/15/15701/11638587.html',
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '飘天文学(www.piaotia.com)·直连GBK采集',
  description:
    'piaotia.com 直连无防护 GBK 老式 XHTML 站(fetcher 按 meta charset 自动解码)。列表=分类表格 table.grid tr(booksort1~9 /0/{page}.html, td1 书名/td2 最新章/td3 作者/td6 状态; 首字母检索行 articlelist.php 链接置空剔除) / 书籍页 h1+表格 td regex(类别/作者/文章状态, &nbsp; 实体兼容)+内容简介 regex+封面 / 目录=tocLink a:contains(查看全部章节) 独立页 /html/{s}/{id}/index.html li>a 相对链全量单页 / 正文 regex 截 toplink→bottomlink(body 级裸文本无容器), 翻页关闭。源站正文末尾孤立 ">" 已由 adPatterns 剥除。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      urlTemplate: 'https://www.piaotia.com/booksort1/0/{page}.html',
      // 注意: 容器必须是 tr —— 但 tr 范围的 $.html() 重载后 htmlparser2 会丢弃脱离
      // <table> 上下文的 <tr>/<td> 结构, css 字段全失效 → 字段统一用 regex 直接对
      // tr 的原始 html 串提取(regexExtract 不走 DOM 重载)
      itemSelector: { type: 'css', expression: 'table.grid tr' },
      fields: {
        name: { type: 'regex', expression: '<td class="odd"><a href="[^"]*bookinfo/\\d+/\\d+\\.html"[^>]*>\\s*([^<]+)</a>', attr: '1' },
        // articlelist.php(首字母检索链)行无 bookinfo 链接 → url 空, 被空 url 收紧剔除
        bookUrl: { type: 'regex', expression: 'href="([^"]*bookinfo/\\d+/\\d+\\.html)"', attr: '1' },
        latestChapter: {
          type: 'regex',
          expression: '<td class="even"><a href="[^"]*"[^>]*>\\s*([^<]+)</a>', attr: '1',
          replaceFrom: '^\\s+', replaceTo: '',
        },
        author: { type: 'regex', expression: '<td class="odd">([^<]+)</td>', attr: '1' },
        status: { type: 'regex', expression: '<td class="even" align="center">([^<]+)</td>', attr: '1' },
      },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: 'h1', attr: 'text' },
        category: {
          type: 'regex',
          // td 文本形如 "类&nbsp;&nbsp;&nbsp;别：玄幻魔法"
          expression: '类(?:&nbsp;|\\s)*别[：:]\\s*([^&<\\s]{1,12})', attr: '1', flags: 'i',
        },
        author: {
          type: 'regex',
          expression: '作(?:&nbsp;|\\s)*者[：:]\\s*([^&<\\s]{1,30})', attr: '1', flags: 'i',
        },
        status: {
          type: 'regex',
          expression: '文章状态[：:]\\s*([^&<\\s]{1,10})', attr: '1', flags: 'i',
        },
        latestChapter: {
          type: 'regex',
          expression: '最新章节：</span><a href="[^"]*"[^>]*>([^<]+)</a>', attr: '1', flags: 'i',
        },
        intro: {
          type: 'regex',
          // 内容简介后到双 <br> 为止(含行间单 <br>), 源站简介以 <br /><br /> 收尾
          expression: '内容简介：</span>(?:\\s|<br\\s*/?>)*([\\s\\S]*?)<br\\s*/?>\\s*<br', attr: '1', flags: 'i',
        },
        cover: { type: 'css', expression: 'img[src*="files/article/image"]', attr: 'src' },
      },
    },
    toc: {
      enabled: true,
      // 书籍页 "(查看全部章节)" → 独立目录页 /html/{s}/{id}/index.html
      tocLink: { type: 'css', expression: 'a:contains("查看全部章节")', attr: 'href' },
      itemSelector: { type: 'css', expression: 'li' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        // 正文无容器(body 级裸文本): 从 toplink 导航 div 之后截到 bottomlink 之前
        content: {
          type: 'regex',
          expression: '<div class="toplink">[\\s\\S]*?</div>([\\s\\S]*?)<div class="bottomlink">', attr: '1', flags: 'i',
        },
      },
      // "下一章"指向下一章(非章内分页), 开启翻页会把多章并进一章
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
        '(www\\.)?piaotia\\.com\\S*',
        '飘天文学[^。<>]*',
        'PT文学网?[^。<>]*',
        '本站只为书友提供阅读平台[^<>]*',
        '^>\\s*$', // 源站正文末尾模板残留的孤立 ">"
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
        '本章未完.*?点击下一页继续阅读',
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
    console.log(`  [book] ✅ engine=${d.engine} ${d.ms}ms fields=${JSON.stringify(d.fields).slice(0, 300)}`)
  } else if (section === 'toc') {
    console.log(`  [toc] ✅ engine=${d.engine} count=${d.count} pages=${d.pages} ${d.ms}ms`)
    for (const it of (d.sample || []).slice(0, 2)) console.log('    ', JSON.stringify(it).slice(0, 130))
  } else {
    console.log(`  [content] ✅ engine=${d.engine} pages=${d.pages} raw=${d.rawLength} clean=${d.cleanedLength} ${d.ms}ms`)
    console.log('    text:', JSON.stringify((d.cleanedText || '').slice(0, 120)))
    console.log('    tail:', JSON.stringify((d.cleanedText || '').slice(-80)))
  }
  return d
}

async function main() {
  const cfg = rule.config as Record<string, any>
  let allPass = true

  console.log('== piaotia.com 四段测试 ==')
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 10) allPass = false

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) allPass = false

  const toc = await testSection('toc', PROBE.toc, cfg.toc)
  if (!toc || (toc.count as number) < 50) { allPass = false; console.log('  !! toc<50 未过线') }

  const content = await testSection('content', PROBE.content, cfg.content)
  if (!content || (content.cleanedLength as number) < 2000) { allPass = false; console.log('  !! content<2000 未过线') }

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

  console.log(allPass ? '✅ 四段测试全部过线(list≥10, toc≥50, content≥2000)' : '❌ 存在未过线段落, 见上方日志')
  if (!allPass) process.exit(2)
}

main()

export {}
