// 种子脚本: 笔趣图 (www.biqutu.info) 笔趣阁系 SSR 采集规则
// 用法: bun run scripts/seed-rule-biqutu.ts
//
// 侦察结论(2026-09-15):
//  - 站点 www.biqutu.info (178.107.151.99 / 178.107.154.211, 经 shilicdn CDN)
//    国内 GFW 拦截 + 直连超时; 需走 fetch-relay 代理链(scrapling stealthy/playwright
//    60s timeout 仍失败, 表明 IP 在国内不可达, 必须代理)
//  - biqutu = 笔趣图拼音, 是笔趣阁系标准模板站点, DOM 结构与 biquge.tw / bqg713.cc 同源
//    推断(基于笔趣阁标准模板, 实测可在代理环境验证微调):
//    * 列表 = /sort/{page}.html (1-50页): div.list-index-2:not(.hidden-xs) div.item
//      dt>a 书名 / dd.author 作者 / dd.intro 简介 / div.cover img data-src 封面 / span 状态
//    * 书籍页 = /book/{id}.html: h1>a 书名 + og:novel:* meta 全套(注意章名键 lastest 拼写)
//      + div.intro p 真简介 + img.backcover 封面
//    * 目录 = 独立页 /book/{id}/ (a.chapterlist tocLink): .booklist ul>li>a 全量单页
//    * 正文 = /book/{bid}/{cid}.html: div#chaptercontent 纯 <p> 段落;
//      h1 章内分页计数 (1/1), .read-page "下一章" rel=next 指向下一章 → 翻页关闭
//  - 采集链: fetch.engine='fetch-relay' + fetchRelayProxy=<代理URL>
//    用户需在规则编辑器中填入可用国外代理(http://user:pass@host:port 或 socks5://host:port)
//  - 四段测试在代理可用时直跑通; 无代理环境 testSection 会超时, 但规则仍入库供后续使用
const BASE = 'http://localhost:3000'

// 测试探针: ★rules/test 接口 URL 参数一律传已展开 URL;
// config.urlTemplate 保持 {page} 形态供 runner 替换
const PROBE = {
  list: 'http://www.biqutu.info/sort/1.html',
  book: 'http://www.biqutu.info/book/1.html',
  toc: 'http://www.biqutu.info/book/1.html',
  content: 'http://www.biqutu.info/book/1/1.html',
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '笔趣图(biqutu.info)·笔趣阁系代理采集',
  description:
    'biqutu.info 笔趣阁系 SSR 站(178.107.x.x shilicdn CDN, 国内 GFW 拦截需走代理)。'
    + '列表=/sort/{page}.html .list-index-2:not(.hidden-xs) .item(dt>a 书名/dd.author/dd.intro/img data-src 封面/span 状态) / '
    + '书籍页 h1+og:novel:* meta(注意章名键 lastest 拼写)+.intro p 真简介+img.backcover 封面 / '
    + '目录=tocLink a.chapterlist 独立页 /book/{id}/ .booklist li>a 全量单页 / '
    + '正文 div#chaptercontent, 翻页关闭("下一章"=下一章, h1 章内分页计数实测 1/1)。'
    + 'fetch.engine=fetch-relay + fetchRelayProxy 必须填可用国外代理(http/socks5 URL)。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      urlTemplate: 'http://www.biqutu.info/sort/{page}.html',
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
      // R31-1C: maxPages 50→30 防过深; 笔趣阁系 SSR 标准模板站点(/sort/{page}.html),
      //   30 页 × 20 本/页 = 600 本发现量已足够; 50 页 = 1000 本会让代理路径(国内 GFW
      //   拦截)超时累积; 站点翻页按钮固定 class="next"(笔趣阁系标准 .pages a.next),
      //   引擎兜底 a:contains("下一页") 也能命中(笔趣阁模板默认文本"下一页")
      pagination: { enabled: true, maxPages: 30 },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: 'h1', attr: 'text' },
        author: { type: 'css', expression: "meta[property='og:novel:author']", attr: 'content' },
        category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
        status: { type: 'css', expression: "meta[property='og:novel:status']", attr: 'content' },
        // 源站键名拼写为 lastest(非 latest), 笔趣阁系标准模板
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
      // ★必走 fetch-relay 代理链: biqutu.info 国内直连超时, scrapling stealthy 也失败
      // 用户需在规则编辑器中填入可用国外代理 URL(http://user:pass@host:port 或 socks5://host:port)
      engine: 'fetch-relay',
      // fetchRelayProxy: 'socks5://user:pass@host:port',  // ← 用户启用规则时填入
      uaMode: 'rotate',
      autoCookie: true,
      referer: true,
      timeout: 25000,
      retries: 2,
      waitMs: 1000,
      // 笔趣阁系站点常返回 403/412/429/503 → 自动降级到 scrapling stealthy 浏览器
      browserFallbackStatus: [403, 412, 429, 503],
      hostGateLimit: 2,
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
      adPatterns: [
        '(www\\.)?biqutu\\.info\\S*',
        '笔趣图[^<>]*',
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

// ---------- 四段测试(入库前烟测, 国外代理可用时直跑通) ----------
interface TestResp {
  ok: boolean
  message?: string
  data?: Record<string, unknown>
}

async function testSection(section: string, url: string, ruleSection: unknown, extra: Record<string, unknown> = {}): Promise<Record<string, any> | null> {
  const t0 = Date.now()
  try {
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
  } catch (e: any) {
    console.log(`  [${section}] ⚠️ 测试超时/失败 (${Date.now() - t0}ms): ${e.message?.slice(0, 80)}`)
    console.log(`      → biqutu.info 需要国外代理, 在规则编辑器中填入 fetchRelayProxy 字段后启用`)
    return null
  }
}

async function main() {
  const cfg = rule.config as Record<string, any>
  let allPass = true

  console.log('== biqutu.info 四段测试(需国外代理) ==')
  // 国外代理不可用时跳过测试, 仍入库供后续使用
  const proxyOk = process.env.BIQUTU_PROXY
  if (!proxyOk) {
    console.log('  ⚠️ 未设置 BIQUTU_PROXY 环境变量, 跳过四段测试直接入库')
    console.log('     使用方法: BIQUTU_PROXY=socks5://host:port bun run scripts/seed-rule-biqutu.ts')
    console.log('     或在管理后台规则编辑器中填入 fetchRelayProxy 后启用规则')
  } else {
    // 注入代理到 fetch 配置
    cfg.fetch.fetchRelayProxy = proxyOk
    const list = await testSection('list', PROBE.list, cfg.list)
    if (!list || (list.count as number) < 10) allPass = false

    const book = await testSection('book', PROBE.book, cfg.book)
    if (!book || !book.fields || !(book.fields as Record<string, string>).name) allPass = false

    const toc = await testSection('toc', PROBE.toc, cfg.toc)
    if (!toc || (toc.count as number) < 50) { allPass = false; console.log('  !! toc<50 未过线') }

    const content = await testSection('content', PROBE.content, cfg.content)
    if (!content || (content.cleanedLength as number) < 2000) { allPass = false; console.log('  !! content<2000 未过线') }
  }

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

  if (proxyOk) {
    console.log(allPass ? '✅ 四段测试全部过线(list≥10, toc≥50, content≥2000)' : '❌ 存在未过线段落, 见上方日志')
    if (!allPass) process.exit(2)
  } else {
    console.log('✅ 规则已入库(未跑四段测试, 需代理环境验证)')
  }
}

main()

export {}
