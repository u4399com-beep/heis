// 种子脚本: Probe batch 1 - 首页"最近更新"采集规则 (list-only, book/toc/content 全闭)
// 用法: bun run scripts/seed-rule-homepage-latest-batch1.ts
//
// 侦察结论:
//   - 共 15 站探针, 9 站首页有清晰"最新/最近/最新小说"板块 → 建 list-only 规则
//   - 6 站跳过: 101kks/69shuba/8kana 首页无对应板块; yybsw 仅"最新入库"价值低;
//     wanben GoEdge WAF 验证码拦截(HTTP 直连拿不到首页)需浏览器引擎
//   - ttkan 首页 amp-list 动态渲染, 但底层有公开 JSON API → JSON 型规则指向 API URL
//   - kanunu8 GBK 编码, 引擎 auto 已自动 charset 转 UTF-8(cheerio load 默认按 meta 解)
//   - yybsw 首页对桌面 UA 开放(内容路径 403 才需移动 UA), 故 list 段 fetch.uaMode=desktop
import { db } from '/home/z/my-project/src/lib/db'
import { fetchPage } from '/home/z/my-project/src/lib/crawl/fetcher'
import { parseList } from '/home/z/my-project/src/lib/crawl/parser'
import { sanitizePageRule, sanitizeFetchConfig, sanitizeCleanConfig, type PageRule, type FetchConfig, type CleanConfig } from '/home/z/my-project/src/lib/crawl/types'

interface SiteRule {
  site: string
  homepage: string
  sectionTitle: string
  description: string
  fetchOverride?: Partial<FetchConfig>
  list: {
    urlTemplate: string
    itemSelector: { type: 'css' | 'json'; expression: string }
    fields: Record<string, any>
  }
}

const COMMON_FETCH: Partial<FetchConfig> = {
  engine: 'auto',
  uaMode: 'desktop',
  autoCookie: true,
  referer: true,
  timeout: 20000,
  retries: 2,
  waitMs: 800,
  hostGateLimit: 2,
}

const COMMON_CLEAN: CleanConfig = {
  removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle', '.ad', '#ad', '.ads'],
  adPatterns: [],
  whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u'],
  normalize: true,
  plainText: false,
}

const SITES: SiteRule[] = [
  // 1. uukanshu — 繁体, div#gengxin ul li (s1=cat / s2 a=name / s3 a=latestChapter / s4=author)
  {
    site: 'uukanshu',
    homepage: 'https://uukanshu.cc',
    sectionTitle: '最近更新',
    description: '采集首页"最近更新"板块(div#gengxin ul li)。每项含 s1 分类/s2 书名+bookUrl/s3 最新章节+章节链/s4 作者。繁体站。',
    list: {
      urlTemplate: 'https://uukanshu.cc/',
      itemSelector: { type: 'css', expression: 'div#gengxin ul li' },
      fields: {
        name: { type: 'css', expression: 'span.s2 a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'span.s2 a', attr: 'href' },
        author: { type: 'css', expression: 'span.s4', attr: 'text' },
        category: { type: 'css', expression: 'span.s1', attr: 'text' },
        latestChapter: { type: 'css', expression: 'span.s3 a', attr: 'text' },
        latestChapterUrl: { type: 'css', expression: 'span.s3 a', attr: 'href' },
      },
    },
  },
  // 2. deqixs — 同框架(GBK), div#gengxin ul li
  {
    site: 'deqixs',
    homepage: 'https://www.deqixs.cc',
    sectionTitle: '最近更新',
    description: '采集首页"最近更新"板块(div#gengxin ul li)。每项含 s1 分类/s2 书名+bookUrl/s3 最新章节+章节链/s4 作者/s5 更新时间。GBK 编码。',
    list: {
      urlTemplate: 'https://www.deqixs.cc/',
      itemSelector: { type: 'css', expression: 'div#gengxin ul li' },
      fields: {
        name: { type: 'css', expression: 'span.s2 a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'span.s2 a', attr: 'href' },
        author: { type: 'css', expression: 'span.s4', attr: 'text' },
        category: { type: 'css', expression: 'span.s1', attr: 'text' },
        latestChapter: { type: 'css', expression: 'span.s3 a', attr: 'text' },
        latestChapterUrl: { type: 'css', expression: 'span.s3 a', attr: 'href' },
        updateTime: { type: 'css', expression: 'span.s5', attr: 'text' },
      },
    },
  },
  // 3. hodei — 笔趣阁系, div#newscontent .l ul li (s1=cat/s2 a=name/s3 a=latestChapter/s4 a=author/s5=time)
  {
    site: 'hodei',
    homepage: 'https://www.hodei.net',
    sectionTitle: '最近更新小说列表',
    description: '采集首页"最近更新小说列表"板块(div#newscontent .l ul li)。每项含 s1 分类/s2 书名+bookUrl/s3 最新章节+章节链/s4 作者链接/s5 更新日期。',
    list: {
      urlTemplate: 'https://www.hodei.net/',
      itemSelector: { type: 'css', expression: 'div#newscontent .l ul li' },
      fields: {
        name: { type: 'css', expression: 'span.s2 a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'span.s2 a', attr: 'href' },
        author: { type: 'css', expression: 'span.s4 a', attr: 'text' },
        category: { type: 'css', expression: 'span.s1', attr: 'text' },
        latestChapter: { type: 'css', expression: 'span.s3 a', attr: 'text' },
        latestChapterUrl: { type: 'css', expression: 'span.s3 a', attr: 'href' },
        updateTime: { type: 'css', expression: 'span.s5', attr: 'text' },
      },
    },
  },
  // 4. gegedang — ul.txt-list.txt-list-row5 li (s1/s2/s3/s4/s5 同 hodei)
  {
    site: 'gegedang',
    homepage: 'https://gegedangbook.com',
    sectionTitle: '最近更新小说列表',
    description: '采集首页"最近更新小说列表"板块(ul.txt-list.txt-list-row5 li)。每项含 s1 分类/s2 书名+bookUrl/s3 最新章节+章节链/s4 作者/s5 更新日期。',
    list: {
      urlTemplate: 'https://gegedangbook.com/',
      itemSelector: { type: 'css', expression: 'ul.txt-list.txt-list-row5 li' },
      fields: {
        name: { type: 'css', expression: 'span.s2 a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'span.s2 a', attr: 'href' },
        author: { type: 'css', expression: 'span.s4', attr: 'text' },
        category: { type: 'css', expression: 'span.s1', attr: 'text' },
        latestChapter: { type: 'css', expression: 'span.s3 a', attr: 'text' },
        latestChapterUrl: { type: 'css', expression: 'span.s3 a', attr: 'href' },
        updateTime: { type: 'css', expression: 'span.s5', attr: 'text' },
      },
    },
  },
  // 5. jhsssd — div.right div.block4_list li (p1=cat/p2 a=name/p3 a=latestChapter/p4=author/p5=time)
  {
    site: 'jhsssd',
    homepage: 'https://jhsssd.com',
    sectionTitle: '最新小说',
    description: '采集首页"最新小说"板块(div.right div.block4_list li, 标题旁附"最近更新小说列表"更多链)。每项含 p1 分类/p2 书名+bookUrl/p3 最新章节+章节链/p4 作者/p5 更新日期。',
    list: {
      urlTemplate: 'https://jhsssd.com/',
      itemSelector: { type: 'css', expression: 'div.right div.block4_list li' },
      fields: {
        name: { type: 'css', expression: 'p.p2 a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'p.p2 a', attr: 'href' },
        author: { type: 'css', expression: 'p.p4', attr: 'text' },
        category: { type: 'css', expression: 'p.p1', attr: 'text' },
        latestChapter: { type: 'css', expression: 'p.p3 a', attr: 'text' },
        latestChapterUrl: { type: 'css', expression: 'p.p3 a', attr: 'href' },
        updateTime: { type: 'css', expression: 'p.p5', attr: 'text' },
      },
    },
  },
  // 6. xjp — ul.update.list-84c1078c li.list-item-84c1078c (5 个 span: cat / book / chapter / author / time)
  {
    site: 'xjp',
    homepage: 'https://www.xinjianpan.com',
    sectionTitle: '最近更新',
    description: '采集首页"最近更新"板块(ul.update.list-84c1078c li.list-item-84c1078c)。每项 5 个 span: [1]分类 / [2]书名+bookUrl / [3]最新章节+章节链 / [4]作者 / [5]相对时间。类名带部署哈希, 取稳定前缀。',
    list: {
      urlTemplate: 'https://www.xinjianpan.com/',
      itemSelector: { type: 'css', expression: 'ul.update.list-84c1078c li.list-item-84c1078c' },
      fields: {
        category: { type: 'css', expression: 'span:nth-child(1)', attr: 'text' },
        name: { type: 'css', expression: 'span:nth-child(2) a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'span:nth-child(2) a', attr: 'href' },
        latestChapter: { type: 'css', expression: 'span:nth-child(3) a', attr: 'text' },
        latestChapterUrl: { type: 'css', expression: 'span:nth-child(3) a', attr: 'href' },
        author: { type: 'css', expression: 'span:nth-child(4) a', attr: 'text' },
        updateTime: { type: 'css', expression: 'span:nth-child(5)', attr: 'text' },
      },
    },
  },
  // 7. kanunu8 — GBK, div.box:has(h2.box-title a[href*="book7"]) div.box-list li (仅书名链, 无作者/章节)
  {
    site: 'kanunu8',
    homepage: 'https://www.kanunu8.com',
    sectionTitle: '最新更新',
    description: '采集首页"最新更新"板块(div.box:has(h2.box-title a[href*="book7"]) div.box-list li)。GBK 编码老站, 该板块仅列书名链(无作者/最新章节)。每项 a=书名+bookUrl, 链接指向 /book7/{slug}/。',
    list: {
      urlTemplate: 'https://www.kanunu8.com/',
      itemSelector: { type: 'css', expression: 'div.box:has(h2.box-title a[href*="/book7/"]) div.box-list li' },
      fields: {
        name: { type: 'css', expression: 'a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'a', attr: 'href' },
      },
    },
  },
  // 8. 80ge — dl#tab dd#Tabs li (类别+书名+日期; 书名 a[href*="txtxz"], 类别 a[href*="sort"])
  {
    site: '80ge',
    homepage: 'http://www.80ge.info',
    sectionTitle: '最新TXT电子书',
    description: '采集首页"最新TXT电子书"板块(dl#tab dd#Tabs li)。每项含 [类别 a[href*=sort]] + [书名 a[href*=txtxz] + bookUrl] + [更新日期 em.newDate]。TXT 下载站无最新章节字段。',
    list: {
      urlTemplate: 'http://www.80ge.info/',
      itemSelector: { type: 'css', expression: 'dl#tab dd#Tabs li' },
      fields: {
        name: { type: 'css', expression: 'a[href*="txtxz"]', attr: 'text' },
        bookUrl: { type: 'css', expression: 'a[href*="txtxz"]', attr: 'href' },
        category: { type: 'css', expression: 'a[href*="sort"]', attr: 'text' },
        updateTime: { type: 'css', expression: 'em.newDate', attr: 'text' },
      },
    },
  },
  // 9. aijjxs — article.latest-upload ul.lines-books li (line-main 内含 cat/a/author, date span.new)
  {
    site: 'aijjxs',
    homepage: 'https://www.aijjxs.com',
    sectionTitle: '最新上传',
    description: '采集首页"最新上传"板块(article.latest-upload ul.lines-books li)。每项含 line-main 内 span.cat 分类 / a 书名+bookUrl / span.author 作者, 以及 span.date span.new 更新日期。',
    list: {
      urlTemplate: 'https://www.aijjxs.com/',
      itemSelector: { type: 'css', expression: 'article.latest-upload ul.lines-books li' },
      fields: {
        name: { type: 'css', expression: 'span.line-main > a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'span.line-main > a', attr: 'href' },
        author: { type: 'css', expression: 'span.line-main > span.author', attr: 'text' },
        category: { type: 'css', expression: 'span.line-main > span.cat', attr: 'text' },
        updateTime: { type: 'css', expression: 'span.date span.new', attr: 'text' },
      },
    },
  },
  // 10. ttkan — 首页 amp-list 动态渲染, 但底层有公开 JSON API
  {
    site: 'ttkan',
    homepage: 'https://cn.ttkan.co',
    sectionTitle: '最近更新',
    description: '采集首页"最近更新"板块(amp-list 动态渲染, 底层 API /api/nq/amp_last_serial_novel_updates)。JSON 型规则指向 API URL, items 数组含 novel_id/novel_name/author/view_type/chapter_name。bookUrl 由 novel_id 经 const 模板拼接为 /novel/chapters/{novel_id}。',
    list: {
      urlTemplate: 'https://cn.ttkan.co/api/nq/amp_last_serial_novel_updates?page=1&limit=50&language=cn',
      itemSelector: { type: 'json', expression: 'items' },
      fields: {
        name: { type: 'json', expression: 'novel_name' },
        novel_id: { type: 'json', expression: 'novel_id' },
        bookUrl: { type: 'const', expression: 'https://cn.ttkan.co/novel/chapters/{novel_id}' },
        author: { type: 'json', expression: 'author' },
        category: { type: 'json', expression: 'view_type' },
        latestChapter: { type: 'json', expression: 'chapter_name' },
      },
    },
  },
]

async function testRule(s: SiteRule): Promise<{ ok: boolean; count: number; sample?: any; error?: string; engine?: string }> {
  try {
    const fetchCfg = { ...COMMON_FETCH, ...(s.fetchOverride || {}) }
    const sanitizedFetch = sanitizeFetchConfig(fetchCfg)
    const result = await fetchPage(s.list.urlTemplate, sanitizedFetch)
    if (result.blocked) {
      return { ok: false, count: 0, error: `blocked (captcha=${result.captchaType || 'n/a'})`, engine: result.engine }
    }
    if (!result.html || result.html.length < 200) {
      return { ok: false, count: 0, error: `empty html (len=${result.html?.length || 0})`, engine: result.engine }
    }
    const pageRule: PageRule = {
      enabled: true,
      urlTemplate: s.list.urlTemplate,
      itemSelector: s.list.itemSelector,
      fields: s.list.fields,
      pagination: { enabled: false, maxPages: 1 },
    }
    const sanitized = sanitizePageRule(pageRule)
    if (!sanitized) return { ok: false, count: 0, error: 'invalid pageRule' }
    const parsed = parseList(result.html, s.list.urlTemplate, sanitized, ['bookUrl', 'url'])
    return {
      ok: parsed.items.length > 0,
      count: parsed.items.length,
      sample: parsed.items[0],
      engine: result.engine,
    }
  } catch (e: any) {
    return { ok: false, count: 0, error: e?.message || String(e) }
  }
}

function ruleName(s: SiteRule): string {
  // 与既有规则命名风格保持一致: <站点名>(<域名>)·首页<板块名>
  let host = s.homepage.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
  // 中文站点名映射(用于规则名前缀)
  const NAME_MAP: Record<string, string> = {
    uukanshu: 'UU看书',
    deqixs: '得奇小说网',
    hodei: '好读小说网',
    gegedang: '格格党',
    jhsssd: '江湖神算',
    xjp: '新键盘小说网',
    kanunu8: '努努书坊',
    '80ge': '八零电子书',
    aijjxs: '久久小说网',
    ttkan: 'ttkan中文',
  }
  const cnName = NAME_MAP[s.site] || s.site
  return `${cnName}(${host})·首页${s.sectionTitle}`
}

async function main() {
  console.log('=== Probe batch 1: 首页最近更新规则创建 + 测试 ===\n')
  let okCount = 0
  let failCount = 0
  const results: Array<{ site: string; name: string; ok: boolean; count: number; error?: string; engine?: string }> = []
  for (const s of SITES) {
    const name = ruleName(s)
    console.log(`[${s.site}] ${name}`)
    console.log(`  URL: ${s.list.urlTemplate}`)
    console.log(`  Selector: ${s.list.itemSelector.type}:${s.list.itemSelector.expression}`)
    // 先测一次, 确认能取到数据
    const t0 = Date.now()
    const test = await testRule(s)
    const ms = Date.now() - t0
    if (test.ok) {
      console.log(`  ✅ 测试通过 engine=${test.engine} count=${test.count} ${ms}ms`)
      if (test.sample) {
        const sampleStr = JSON.stringify(test.sample).slice(0, 200)
        console.log(`  sample: ${sampleStr}`)
      }
      okCount++
    } else {
      console.log(`  ❌ 测试失败 count=${test.count} error=${test.error} engine=${test.engine} ${ms}ms`)
      failCount++
    }
    // 不论测试是否通过都入库(便于人工调试/后续优化), 但只在测试通过时 enabled=true
    const config = {
      list: {
        enabled: true,
        urlTemplate: s.list.urlTemplate,
        itemSelector: s.list.itemSelector,
        fields: s.list.fields,
        pagination: { enabled: false, maxPages: 1 },
      },
      book: { enabled: false, fields: {} },
      toc: { enabled: false, itemSelector: { type: 'css', expression: '' }, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      content: { enabled: false, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      fetch: { ...COMMON_FETCH, ...(s.fetchOverride || {}) },
      clean: COMMON_CLEAN,
      enabled: test.ok,
    }
    const rule = {
      name,
      description: s.description + (test.ok ? '' : ' [⚠ 测试未通过, 已置 enabled=false 待人工排查]'),
      enabled: test.ok,
      config: JSON.stringify(config),
    }
    const existing = await db.rule.findFirst({ where: { name } })
    if (existing) {
      await db.rule.update({ where: { id: existing.id }, data: rule })
      console.log(`  📝 已更新规则 id=${existing.id}`)
    } else {
      const created = await db.rule.create({ data: rule })
      console.log(`  ✨ 已创建规则 id=${created.id}`)
    }
    results.push({ site: s.site, name, ok: test.ok, count: test.count, error: test.error, engine: test.engine })
    console.log('')
  }
  console.log('=== 汇总 ===')
  console.log(`成功: ${okCount} / ${SITES.length}, 失败: ${failCount}`)
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.site.padEnd(10)} count=${r.count}  ${r.error ? 'err=' + r.error : ''}  (${r.name})`)
  }
  await db.$disconnect()
  process.exit(0)
}

main().catch(async (e) => {
  console.error('FATAL:', e)
  await db.$disconnect()
  process.exit(1)
})
