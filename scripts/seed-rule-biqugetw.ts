// 种子脚本: 笔趣阁 (www.biquge.tw) 直连 SSR 采集规则
// 用法: bun run scripts/seed-rule-biqugetw.ts
// 侦察结论(实测 curl 2025):
//  - 直连 200 无防护, UTF-8 SSR; 页面声明 hreflang="zh-hans"(简体), m.biquge.tw 才是繁体
//    (zh-hant) 镜像 —— 本规则抓 www 简体站, 实测正文简繁字形比对: 简体 81 处/繁体 0 处,
//    无需 t2s 转换(cleaner t2s 强信号门也不会误触发)
//  - 四层:
//    * 列表 = 书库 /sort/{page}.html(1~20): div.list-index-2 div.item(dt>a 书名 /
//      dd.author / dd.intro / dd.more 字数+日期 / div.cover>a>img lazy 封面 data-src +
//      span " / 连载|全本"); 页面有两个 .list-index-2(推荐 hidden-xs + 最近更新), 选择器
//      :not(.hidden-xs) 只取后者(20 本/页)
//    * 书籍页 = /book/{id}.html: h1>a + og:novel:* meta 全套(注意章名键是 lastest 拼写)
//      + div.intro 内 "小说简介：<p>真简介</p>"(AI 无关, 直接取 .intro p) + img.backcover 封面
//    * 目录 = 独立页 /book/{id}/ (书籍页 a.chapterlist "章节目录"): .booklist ul>li>a
//      全量单页(实测异界龙神 1869 章, 275KB, 无翻页)
//    * 正文 = /book/{bid}/{cid}.html: div#chaptercontent 纯 <p> 段落; h1 带 "（1 / 1）"
//      章内分页计数器, 实测抽查全部为 1/1 且 .read-page "下一章" rel=next 指向下一章 →
//      content 翻页必须关闭(防多章并一章; 若未来出现 (1/2) 分页章, 需另行评估)
//  - 测试探针: list=书库第1页 / book=异界龙神 / toc=经 tocLink 的目录页(1869 章) / content=第1章(3260字符)
const BASE = 'http://localhost:3000'

const PROBE = {
  list: 'https://www.biquge.tw/sort/1.html',
  book: 'https://www.biquge.tw/book/9002.html',
  toc: 'https://www.biquge.tw/book/9002.html',
  content: 'https://www.biquge.tw/book/9002/286409.html',
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '笔趣阁(www.biquge.tw)·直连SSR采集',
  description:
    'biquge.tw 直连无防护 UTF-8 SSR 简体站(m.biquge.tw 为繁体镜像不采用, 实测 www 正文简体字形无需 t2s)。列表=书库 /sort/{page}.html .list-index-2:not(.hidden-xs) .item(dt>a 书名/dd.author/dd.intro/img data-src 封面/span 状态) / 书籍页 h1+og:novel:* meta(注意章名键 lastest 拼写)+.intro p 真简介+img.backcover 封面 / 目录=tocLink a.chapterlist 独立页 /book/{id}/ .booklist li>a 全量单页(1869章实测) / 正文 div#chaptercontent, "下一章"=下一章故翻页关闭(h1 带章内分页计数器 1/1, 抽查无分页章)。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      urlTemplate: 'https://www.biquge.tw/sort/{page}.html',
      itemSelector: { type: 'css', expression: 'div.list-index-2:not(.hidden-xs) div.item' },
      fields: {
        name: { type: 'css', expression: 'dl dt a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'dl dt a', attr: 'href' },
        author: { type: 'css', expression: 'dd.author', attr: 'text' },
        intro: { type: 'css', expression: 'dd.intro', attr: 'text' },
        cover: { type: 'css', expression: 'div.cover img', attr: 'data-src' },
        // " / 连载" / " / 全本" → 剥前缀得 连载|全本(smart 词表可直接识别)
        status: { type: 'css', expression: 'div.cover span', attr: 'text', replaceFrom: '^\\s*/\\s*', replaceTo: '' },
      },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: 'h1', attr: 'text' },
        author: { type: 'css', expression: "meta[property='og:novel:author']", attr: 'content' },
        category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
        status: { type: 'css', expression: "meta[property='og:novel:status']", attr: 'content' },
        // 源站键名拼写为 lastest(非 latest)
        latestChapter: { type: 'css', expression: "meta[property='og:novel:lastest_chapter_name']", attr: 'content' },
        intro: { type: 'css', expression: 'div.intro p', attr: 'html' },
        cover: { type: 'css', expression: 'img.backcover', attr: 'src' },
      },
    },
    toc: {
      enabled: true,
      // 书籍页 "章节目录" → 独立目录页 /book/{id}/(全量单页)
      tocLink: { type: 'css', expression: 'a.chapterlist', attr: 'href' },
      itemSelector: { type: 'css', expression: '.booklist li' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: '#chaptercontent', attr: 'html' },
      },
      // "下一章" rel=next 指向下一章(h1 章内分页计数实测全为 1/1), 开启翻页会多章并一章
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
        '(www\\.)?biquge\\.tw\\S*',
        '笔趣阁[^<>]*转载收集',
        '本站所有小说为转载作品[^<>]*',
        '本站小说由程序自动索引',
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
        '本章未完.*?点击下一页继续阅读',
        '一秒记住.*?免费读',
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

  console.log('== biquge.tw 四段测试 ==')
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
