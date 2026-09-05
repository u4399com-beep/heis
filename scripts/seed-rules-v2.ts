// 种子脚本: 五个真实站点采集规则 (uukanshu.cc / 23.225.66.244 / 23qb.net / ixdzs8.com / 101kks.com)
// 用法: bun run scripts/seed-rules-v2.ts
const BASE = 'http://localhost:3000'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const baseClean = {
  removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
  adPatterns: [
    '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
    '本章未完.*?点击下一页继续阅读',
    '请记住本书.*?域名',
    '最新章节请到.*?查看',
    '一秒记住.*?免费读',
    '[（(]?完?本[网站站][）)]?',
  ],
  whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u'],
  normalize: true,
  plainText: false,
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rules: RuleSeed[] = [
  // ============ 1. UU看書 uukanshu.cc ============
  {
    name: 'UU看書(uukanshu.cc)·真实站点采集',
    description:
      '真实站点演示: 繁体站+纯静态HTML(HTTP引擎直连)。列表.item四字段+书籍页og:meta元信息+#list-chapterAll单页全量目录(千章级)+.readcotent正文。正文内嵌loadAdv广告脚本由清洗段剥离。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://uukanshu.cc/class_1_{page}.html',
        itemSelector: { type: 'css', expression: '.item' },
        fields: {
          name: { type: 'css', expression: 'dl dt a', attr: 'text' },
          author: { type: 'css', expression: 'dl dt span', attr: 'text' },
          bookUrl: { type: 'css', expression: '.image a', attr: 'href' },
          cover: { type: 'css', expression: '.image img', attr: 'src' },
          intro: { type: 'css', expression: 'dl dd', attr: 'text', stripTags: true },
        },
      },
      book: {
        enabled: true,
        fields: {
          name: { type: 'css', expression: 'h1.booktitle', attr: 'text' },
          author: { type: 'css', expression: 'p.booktag a.red', attr: 'text' },
          category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
          status: { type: 'css', expression: 'p.booktag span.red', attr: 'text' },
          keywords: { type: 'css', expression: "meta[name='keywords']", attr: 'content' },
          intro: { type: 'css', expression: "meta[property='og:description']", attr: 'content' },
          cover: { type: 'css', expression: "meta[property='og:image']", attr: 'content' },
          latestChapter: { type: 'css', expression: 'a.bookchapter', attr: 'text' },
        },
      },
      toc: {
        enabled: true,
        itemSelector: { type: 'css', expression: '#list-chapterAll dd' },
        fields: {
          title: { type: 'css', expression: 'a', attr: 'text' },
          url: { type: 'css', expression: 'a', attr: 'href' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      content: {
        enabled: true,
        fields: { content: { type: 'css', expression: '.readcotent', attr: 'html' } },
        pagination: { enabled: false, maxPages: 1 },
      },
      fetch: {
        engine: 'http',
        uaMode: 'custom',
        customUa: UA,
        autoCookie: true,
        referer: true,
        timeout: 20000,
        retries: 2,
        browserFallbackStatus: [403, 412, 429, 503],
      },
      clean: {
        ...baseClean,
        adPatterns: [
          ...baseClean.adPatterns,
          'uu看書.*?c(?=\\s|$)',
          '請記住本站.*?網址',
          '請收藏.*?(網址|首页)',
        ],
      },
    },
  },

  // ============ 2. 二三阅读 23.225.66.244 ============
  {
    name: '二三阅读(23.225.66.244)·真实站点采集',
    description:
      '真实站点演示: IP直连站+作/类/状实体间隔(作者信息用正则提取)+正文分页(第1/2页→_2.html翻页合并)+双目录盒(URL去重+乱序重排)。与鬼吹灯网同模板族。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'http://23.225.66.244/sort/{page}/1.html',
        itemSelector: { type: 'css', expression: '.item' },
        fields: {
          name: { type: 'css', expression: 'dl dt a', attr: 'text' },
          author: { type: 'css', expression: 'dl dt span', attr: 'text' },
          bookUrl: { type: 'css', expression: '.image a', attr: 'href' },
          cover: { type: 'css', expression: '.image img', attr: 'src' },
          intro: { type: 'css', expression: 'dl dd a', attr: 'text', stripTags: true },
        },
      },
      book: {
        enabled: true,
        fields: {
          name: { type: 'css', expression: '.info .top h1', attr: 'text' },
          author: { type: 'regex', expression: '<p>作(?:&nbsp;|\\s)*者：([^<]+)</p>', attr: '1' },
          category: { type: 'regex', expression: '<p class="xs-show">类(?:&nbsp;|\\s)*别：([^<]+)</p>', attr: '1' },
          status: { type: 'regex', expression: '<p class="xs-show">状(?:&nbsp;|\\s)*态：([^<]+)</p>', attr: '1' },
          keywords: { type: 'css', expression: "meta[name='keywords']", attr: 'content' },
          intro: { type: 'css', expression: "meta[property='og:description']", attr: 'content' },
          cover: { type: 'css', expression: '.imgbox img', attr: 'src' },
        },
      },
      toc: {
        enabled: true,
        itemSelector: { type: 'css', expression: 'ul.section-list li' },
        fields: {
          title: { type: 'css', expression: 'a', attr: 'text' },
          url: { type: 'css', expression: 'a', attr: 'href' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      content: {
        enabled: true,
        fields: { content: { type: 'css', expression: '#content', attr: 'html' } },
        pagination: { enabled: true, maxPages: 5, joinWith: '<br/>', nextLink: { type: 'css', expression: "a:contains('下一页')", attr: 'href' } },
      },
      fetch: {
        engine: 'http',
        uaMode: 'custom',
        customUa: UA,
        autoCookie: true,
        referer: true,
        timeout: 20000,
        retries: 2,
        browserFallbackStatus: [403, 412, 429, 503],
      },
      clean: {
        ...baseClean,
        adPatterns: [
          ...baseClean.adPatterns,
          '\\(第\\s*\\d+\\s*/\\s*\\d+\\s*页\\)',
          '二三阅读.*?阅读网',
          'read2\\(\\);?',
        ],
      },
    },
  },

  // ============ 3. 铅笔小说 23qb.net ============
  {
    name: '铅笔小说(23qb.net)·真实站点采集',
    description:
      '真实站点演示: 目录独立页(tocLink提取og:novel:read_url→/book/N/catalog 133行全量目录)+懒加载封面(data-src属性提取)+module卡片列表。og:novel系列meta提供作者/状态。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://www.23qb.net/book/lastupdate_{page}_0_0_0_0_0_0_0_0.html',
        itemSelector: { type: 'css', expression: '.module-item' },
        fields: {
          name: { type: 'css', expression: 'a.module-item-title', attr: 'text' },
          author: { type: 'css', expression: '.module-item-text', attr: 'text' },
          bookUrl: { type: 'css', expression: '.module-item-pic a', attr: 'href' },
          cover: { type: 'css', expression: '.module-item-pic img', attr: 'data-src' },
        },
      },
      book: {
        enabled: true,
        fields: {
          name: { type: 'css', expression: "meta[property='og:title']", attr: 'content' },
          author: { type: 'css', expression: "meta[property='og:novel:author']", attr: 'content' },
          category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
          status: { type: 'css', expression: "meta[property='og:novel:status']", attr: 'content' },
          keywords: { type: 'css', expression: "meta[name='keywords']", attr: 'content' },
          intro: { type: 'css', expression: "meta[property='og:description']", attr: 'content' },
          cover: { type: 'css', expression: "meta[property='og:image']", attr: 'content' },
        },
      },
      toc: {
        enabled: true,
        tocLink: { type: 'css', expression: "meta[property='og:novel:read_url']", attr: 'content' },
        itemSelector: { type: 'css', expression: '.module-row-info' },
        fields: {
          title: { type: 'css', expression: '.module-row-title span', attr: 'text' },
          url: { type: 'css', expression: 'a.module-row-text', attr: 'href' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      content: {
        enabled: true,
        fields: { content: { type: 'css', expression: '.article-content', attr: 'html' } },
        pagination: { enabled: false, maxPages: 1 },
      },
      fetch: {
        engine: 'auto',
        uaMode: 'custom',
        customUa: UA,
        autoCookie: true,
        referer: true,
        timeout: 20000,
        retries: 2,
        browserFallbackStatus: [403, 412, 429, 503],
      },
      clean: {
        ...baseClean,
        adPatterns: [...baseClean.adPatterns, '铅笔小说.*?阅读网', '\\(完\\)$'],
      },
    },
  },

  // ============ 4. 爱下电子书 ixdzs8.com ============
  {
    name: '爱下电子书(ixdzs8.com)·真实站点采集',
    description:
      '真实站点演示: JS挑战站(token重定向)+AJAX全量目录(/novel/clist/ 渲染后1663章)→Obscura --stealth浏览器引擎强渲染。列表li.burl卡片+og:meta书籍信息+article.page-content正文。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://ixdzs8.com/sort/1/?t=1&page={page}',
        itemSelector: { type: 'css', expression: 'li.burl' },
        fields: {
          name: { type: 'css', expression: 'h3.bname a', attr: 'text' },
          author: { type: 'css', expression: 'p.l-p1 .bauthor', attr: 'text' },
          bookUrl: { type: 'css', expression: 'h3.bname a', attr: 'href' },
          cover: { type: 'css', expression: '.l-img img', attr: 'src' },
          intro: { type: 'css', expression: 'p.l-p2', attr: 'text', stripTags: true },
        },
      },
      book: {
        enabled: true,
        fields: {
          name: { type: 'css', expression: "meta[property='og:title']", attr: 'content' },
          author: { type: 'css', expression: "meta[property='og:novel:author']", attr: 'content' },
          category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
          status: { type: 'css', expression: "meta[property='og:novel:status']", attr: 'content' },
          intro: { type: 'css', expression: "meta[property='og:description']", attr: 'content' },
          cover: { type: 'css', expression: "meta[property='og:image']", attr: 'content' },
        },
      },
      toc: {
        enabled: true,
        itemSelector: { type: 'css', expression: 'div.clist ul.u-chapter li' },
        fields: {
          title: { type: 'css', expression: 'a', attr: 'text' },
          url: { type: 'css', expression: 'a', attr: 'href' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      content: {
        enabled: true,
        fields: { content: { type: 'css', expression: 'article.page-content', attr: 'html' } },
        pagination: { enabled: false, maxPages: 1 },
      },
      fetch: {
        engine: 'browser',
        uaMode: 'custom',
        customUa: UA,
        autoCookie: true,
        referer: true,
        timeout: 40000,
        retries: 1,
        waitMs: 2500,
        browserFallbackStatus: [403, 412, 429, 503],
      },
      clean: {
        ...baseClean,
        adPatterns: [...baseClean.adPatterns, '爱下电子书.*?乐趣', '^(作者：|类型：|字数：).*$'],
      },
    },
  },

  // ============ 5. 101看書 101kks.com ============
  {
    name: '101看書(101kks.com)·真实站点采集',
    description:
      '真实站点演示: 繁体站+AJAX分批目录(index页36章→/ajax_novels/chapterlist/ 全量808章, 浏览器渲染合批)+og:novel:read_url目录页提取+txtad广告位清洗+#txtcontent正文。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://101kks.com/novels/class/{page}_1.html',
        itemSelector: { type: 'css', expression: '.newnovels ul li' },
        fields: {
          name: { type: 'css', expression: 'h3', attr: 'text' },
          author: { type: 'css', expression: 'h4', attr: 'text' },
          bookUrl: { type: 'css', expression: 'a', attr: 'href' },
          cover: { type: 'css', expression: '.imgbox img', attr: 'src' },
        },
      },
      book: {
        enabled: true,
        fields: {
          name: { type: 'css', expression: 'h1 a', attr: 'text' },
          author: { type: 'css', expression: 'p:contains("作者：") a', attr: 'text' },
          category: { type: 'css', expression: 'p:contains("分類：") a', attr: 'text' },
          status: { type: 'regex', expression: '<p>\\s*[\\d.]+萬字\\s*\\|\\s*([^<]+)</p>', attr: '1' },
          keywords: { type: 'css', expression: "meta[name='keywords']", attr: 'content' },
          intro: { type: 'css', expression: "meta[property='og:description']", attr: 'content' },
          cover: { type: 'css', expression: "meta[property='og:image']", attr: 'content' },
        },
      },
      toc: {
        enabled: true,
        tocLink: { type: 'css', expression: "meta[property='og:novel:read_url']", attr: 'content' },
        itemSelector: { type: 'css', expression: '#allchapter ul li' },
        fields: {
          title: { type: 'css', expression: 'a', attr: 'text' },
          url: { type: 'css', expression: 'a', attr: 'href' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      content: {
        enabled: true,
        fields: { content: { type: 'css', expression: '#txtcontent', attr: 'html' } },
        pagination: { enabled: false, maxPages: 1 },
      },
      fetch: {
        engine: 'browser',
        uaMode: 'custom',
        customUa: UA,
        autoCookie: true,
        referer: true,
        timeout: 40000,
        retries: 1,
        waitMs: 2500,
        browserFallbackStatus: [403, 412, 429, 503],
      },
      clean: {
        ...baseClean,
        adPatterns: [...baseClean.adPatterns, '101看書.*?小說網', '感謝書友.*?支持'],
      },
    },
  },
]

async function main() {
  for (const r of rules) {
    // 幂等: 同名规则先删后建
    const listRes = await fetch(`${BASE}/api/admin/rules`).then((x) => x.json())
    const old = (listRes.data || []).find((x: any) => x.name === r.name)
    if (old) {
      await fetch(`${BASE}/api/admin/rules/${old.id}`, { method: 'DELETE' })
      console.log(`[seed] 删除旧规则 ${r.name}`)
    }
    const res = await fetch(`${BASE}/api/admin/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: r.name, description: r.description, enabled: r.enabled, config: JSON.stringify(r.config) }),
    })
    const j = await res.json()
    if (!j.ok) {
      console.error(`[seed] 失败 ${r.name}:`, j.message)
      process.exit(1)
    }
    console.log(`[seed] 已创建 ${r.name} -> ${j.data.id}`)
  }
}

main()

export {}
