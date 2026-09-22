// ============================================================
// scripts/seed-rule-yueyouxs.ts
// ============================================================
// 站点: sma.yueyouxs.com (阅友·神马小说, SPA + zepto.js + autoLazy.js)
// 采集规则: 四段式 list/book/toc/content + fetch(http) + clean
//
// 站点结构 (R44-1A curl + agent-browser 实测):
//   - 首页 "/": v-list-item onclick="newWebView('/b/{id}.html')", .v-title/.v-intro/.v-cover-img
//   - 列表 API (JSON): /api/book/classify?site_id=&classify_id={catId}&page={page}
//       返回 {code:0, data:{count, list:[{wapBookId, bookName, authorName, bookPic, intro,
//       classifySecondName, latestChapterName, fullFlag, ...}]}}
//   - 书页 "/b/{id}.html" (SSR HTML): p.face-info-title / .v-words span(作者/分类/字数)
//       / .content-label(状态) / img.face-cover-img / #intro / #idNewIds .chapter-entrance(最新章)
//       / .sumchapter a[href="/c/{id}.html"](目录链接)
//   - 目录页 "/c/{bookId}.html" (SSR HTML, 全量章节单页, 1.1MB/6500+章):
//       ul.catalog_ls li a[href="/r/{bookId}/{chapterId}.html"]
//   - 章节页 "/r/{bookId}/{chapterId}.html" (SSR HTML, 单章多页 5 sub-sections):
//       div.book > div.section (5 个, 第一个无 .none 类) > h2(章名(N/M)) + div.con(<p>正文</p>)
//       章节翻页 JS 内联切换 .section 显隐, 同 URL 内全 5 页内容均在 SSR HTML
//
// 采集策略:
//   list: JSON API (干净结构, 无需 HTML 解析; classify_id=1100=都市人生男频, 可改)
//   book: HTML 书页 (CSS + regex 混合提取, 作者/分类用 regex 锁定 v-words span)
//   toc: HTML 目录页 (/c/{bookId}.html, tocLink const 占位符 {q.bookId} 取自 book 段)
//   content: HTML 章节页 (div.book 整块 HTML, clean.removeSelectors 剥 nav/广告/h2)
//
// fetch: engine=http (站点 SSR 完整, 无 JS 渲染依赖; UA rotate + autoCookie + referer)
// clean: 剥 script/style/iframe/nav/ad 容器 + h2(分页标题) + 广告文案(本章未完/本章完/下载提示)
//
// 运行: cd /home/z/my-project && bun run scripts/seed-rule-yueyouxs.ts
// ============================================================
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const RULE_NAME = '神马小说 (sma.yueyouxs.com)'

const RULE_CONFIG = {
  list: {
    enabled: true,
    // classify_id=1100 = 都市人生 (男频). 其他常见: 1101=玄幻奇幻, 1102=武侠仙侠,
    // 1103=都市异能, 1104=历史军事, 1105=网游动漫, 1107=科幻末世, 1108=灵异悬疑
    // site_id 留空 (走默认站). {page} 占位符 runner.go:1041 ReplaceAll 展开 1..maxPages
    urlTemplate: 'https://sma.yueyouxs.com/api/book/classify?site_id=&classify_id=1100&page={page}',
    itemSelector: { type: 'json', expression: 'data.list' },
    fields: {
      name: { type: 'json', expression: 'bookName' },
      author: { type: 'json', expression: 'authorName' },
      intro: { type: 'json', expression: 'intro' },
      category: { type: 'json', expression: 'classifySecondName' },
      cover: { type: 'json', expression: 'bookPic' },
      latestChapter: { type: 'json', expression: 'latestChapterName' },
      // wapBookId 是 URL 用的书 ID (注意不是 id 字段, id 是内部 ID)
      bookUrl: {
        type: 'json',
        expression: 'wapBookId',
        replaceFrom: '^(\\d+)$',
        replaceTo: 'https://sma.yueyouxs.com/b/$1.html',
      },
    },
    pagination: { enabled: true, maxPages: 20 },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: 'css', expression: 'p.face-info-title' },
      // 三段 .v-words span (作者/分类/字数), CSS first-match 只取首段; regex 锁定关键字段
      author: {
        type: 'regex',
        expression: '作者：([^<\\n]+)',
        attr: '1',
      },
      category: {
        type: 'regex',
        expression: '分类：([^<\\n]+)',
        attr: '1',
      },
      status: { type: 'css', expression: 'div.content-label' },
      cover: { type: 'css', expression: 'img.face-cover-img', attr: 'src' },
      intro: { type: 'css', expression: '#intro', stripTags: true },
      latestChapter: { type: 'css', expression: '#idNewIds .chapter-entrance' },
      // 目录链接 /c/{bookId}.html, 提取 bookId 供 toc.tocLink 占位符 {q.bookId} 用
      bookId: {
        type: 'css',
        expression: 'div.sumchapter a',
        attr: 'href',
        replaceFrom: '^/c/(\\d+)\\.html$',
        replaceTo: '$1',
      },
    },
  },
  toc: {
    enabled: true,
    // 目录独立页 (不在书页内), 用 const 占位符引用 book 段提取的 bookId
    tocLink: {
      type: 'const',
      expression: 'https://sma.yueyouxs.com/c/{q.bookId}.html',
    },
    // 全量章节单页 (无分页, 1.1MB/6500+章 SSR 完整)
    itemSelector: { type: 'css', expression: 'ul.catalog_ls li' },
    fields: {
      // a 文本含 <span class="type">免费</span> 前缀, regex 剥离
      title: {
        type: 'css',
        expression: 'a',
        replaceFrom: '^(免费|付费|VIP|收费)\\s*',
        replaceTo: '',
      },
      url: { type: 'css', expression: 'a', attr: 'href' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: {
      // 章节页含 5 个 .section (同章分页), 第一个 h2 = 章名(N/M), 剥 (N/M) 后缀
      title: {
        type: 'css',
        expression: 'div.section h2',
        replaceFrom: '\\s*\\(\\d+/\\d+\\)\\s*',
        replaceTo: '',
      },
      // div.book 整块含 5 section + nav/广告, clean.removeSelectors 剥非正文元素
      content: { type: 'css', expression: 'div.book', attr: 'html' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  fetch: {
    engine: 'http',
    uaMode: 'rotate',
    autoCookie: true,
    referer: true,
    timeout: 20000,
    retries: 2,
    waitMs: 500,
    hostGateLimit: 3,
  },
  clean: {
    removeSelectors: [
      'script',
      'style',
      'iframe',
      'ins',
      'noscript',
      // 章节页头部/底部 nav + 浮窗广告
      '.r-header',
      '.nav',
      '.xcyjgnLfeL',
      '.dJoicqeaQqOgbgC',
      '.wanzheng-dl',
      '.bookfunbtn',
      '.foot-img-down',
      '#advert_up',
      '#advert_down1',
      '#advert_down2',
      '.tips',
      // 5 个 section 的 h2 分页标题 (章名(N/M)), 已在 content.title 单独提取
      'h2',
    ],
    adPatterns: [
      '（本章未完，请翻页）',
      '（本章完）',
      '页面篇幅有限.*?下载安装客户端.*?算我输！',
      '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      '一秒记住.*?免费读',
      '请记住本书.*?域名',
    ],
    whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u'],
    normalize: true,
    plainText: true,
  },
}

const RULE_DESCRIPTION = [
  '神马小说 (sma.yueyouxs.com) 阅友系 SPA+zepto.js 四段采集: list=JSON API(/api/book/classify)',
  '/book=SSR HTML/CSS+regex/toc=独立目录页(/c/{id}.html 全量章节单页)/content=章节页(div.book 整块+clean 剥 nav/ad/h2)。',
  '结构依据 R44-1A curl+agent-browser 实测 (/b/24240.html 无上神帝 6518 章 + /c/24240.html 全量目录 + /r/24240/24241.html 5-sub-section 章节页)。',
  '站点 SSR 完整 (无 JS 渲染依赖), fetch engine=http + UA rotate + autoCookie + referer 即可。',
  'list 默认 classify_id=1100 (都市人生男频), 可改 1101 玄幻/1102 武侠/1103 都市异能/1104 历史军事/1105 网游/1107 科幻/1108 灵异。',
  '章节页同 URL 内含 5 sub-section (同章分页, JS 切换显隐), content 段取 div.book 整块 HTML + clean.removeSelectors 剥 nav/广告/h2,',
  'plainText 输出全 5 页正文 (adPatterns 剥 "本章未完请翻页"/"本章完"/下载提示)。',
  'toc.title 剥 "免费/付费/VIP" span 前缀; book.author/category 用 regex 锁定 v-words span (CSS first-match 不够)。',
].join(' ')

async function main() {
  const configStr = JSON.stringify(RULE_CONFIG)
  const existing = await db.rule.findFirst({
    where: { name: RULE_NAME },
    select: { id: true },
  })

  if (existing) {
    await db.rule.update({
      where: { id: existing.id },
      data: {
        description: RULE_DESCRIPTION,
        config: configStr,
        enabled: true,
      },
    })
    console.log(`[seed-rule-yueyouxs] updated existing rule (id=${existing.id}): ${RULE_NAME}`)
  } else {
    const created = await db.rule.create({
      data: {
        name: RULE_NAME,
        description: RULE_DESCRIPTION,
        config: configStr,
        enabled: true,
      },
    })
    console.log(`[seed-rule-yueyouxs] created new rule (id=${created.id}): ${RULE_NAME}`)
  }

  // 自检: 回读确认 config 可解析
  const reloaded = await db.rule.findFirst({
    where: { name: RULE_NAME },
    select: { id: true, name: true, enabled: true, config: true },
  })
  if (!reloaded) {
    throw new Error('self-check failed: rule not found after upsert')
  }
  const parsed = JSON.parse(reloaded.config)
  const stages = ['list', 'book', 'toc', 'content', 'fetch', 'clean'].filter(
    (k) => parsed[k] != null,
  )
  console.log(
    `[seed-rule-yueyouxs] self-check OK: enabled=${reloaded.enabled}, stages=[${stages.join(',')}]`,
  )
  console.log(
    `[seed-rule-yueyouxs] list.urlTemplate=${parsed.list.urlTemplate}`,
  )
  console.log(
    `[seed-rule-yueyouxs] book.fields=${Object.keys(parsed.book.fields).join(',')}`,
  )
  console.log(
    `[seed-rule-yueyouxs] toc.tocLink=${parsed.toc.tocLink.expression}`,
  )
  console.log(
    `[seed-rule-yueyouxs] content.content=${parsed.content.fields.content.expression} attr=${parsed.content.fields.content.attr}`,
  )
}

main()
  .catch((e) => {
    console.error('[seed-rule-yueyouxs] FAILED:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
