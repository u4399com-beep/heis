// ============================================================
// 批量种子脚本: 25 个小说站点采集规则(去重后 24 条, ptwxz=piaotia 重定向跳过)
// 用法: bun run scripts/seed-rules-batch-v2.ts
//
// 设计:
//  - 不做四段实测(太多 CF/403 站, 实测会挂); 仅入库 + 后台测试面板逐个微调
//  - 幂等: 同名规则先删后建(逐个 try/catch, 单条失败不影响其他)
//  - 鉴权: 起步 POST /api/auth/login 拿 heis_admin cookie, 后续请求带 cookie
//  - [实测]/[推断] 可信度标记写在 description 首段
//  - 笔趣阁系(12 站)共用 biqugeRule() 工厂, 列表/正文选择器按探测结论定制
//  - 其他框架站点(ttkan/69shuba/8kana/shucong/hetushu/guichuideng/dongliuxiaoshuo/
//    jhsssd/uukanshu/xiaoshuodaquan/laobiao) 各写独立配置
// ============================================================
const BASE = process.env.BASE || 'http://localhost:3000'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'audit-fix-2025'

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

// ============================================================
// 工具: 域名转义为正则字面量(供 adPatterns 用)
// ============================================================
function escapeDomain(d: string): string {
  return d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ============================================================
// 工厂: 笔趣阁系通用规则
// 参考 scripts/seed-rule-biqugetw.ts (biquge.tw 实测模板)
//  - list = dl/dt/dd 结构 (.item 容器, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面)
//  - book = h1 + og:novel:* meta 全套(注意章名键 lastest 拼写) + .intro p 真简介 + 封面
//  - toc  = .booklist li>a 全量单页(部分站可能用 #list dd, opts 可切)
//  - content = #chaptercontent 或 #content (opts 可切)
//  - fetch = engine http(可改 auto)/uaMode rotate/autoCookie/referer/timeout 20s/retries 2/waitMs 800/
//            browserFallbackStatus [403,412,429,503]
//  - clean = 通用 biquge 广告 + 站点域名剥除 + 通用 URL 模式
// ============================================================
interface BiqugeOpts {
  /** 列表路径, 含 {page} 占位符, 例: /sort/{page}.html 或 /top/{page}/ */
  listPath: string
  /** 列表项容器选择器, 默认 '.item' */
  itemSelector?: string
  /** 正文容器选择器, 默认 '#chaptercontent' */
  contentSelector?: string
  /** 目录项容器, 默认 '.booklist li' */
  tocSelector?: string
  /** 站点采集引擎: 'http'(默认) 或 'auto'(CF/403 站用) */
  engine?: 'http' | 'auto' | 'browser'
  /** 书籍页路径模板, 仅用于 description 注释, 不入 config */
  bookPathNote?: string
  /** 简短结构补充(写入 description) */
  structNote?: string
}

function biqugeRule(domain: string, opts: BiqugeOpts): unknown {
  const itemSel = opts.itemSelector || '.item'
  const contentSel = opts.contentSelector || '#chaptercontent'
  const tocSel = opts.tocSelector || '.booklist li'
  const engine = opts.engine || 'http'
  const escDomain = escapeDomain(domain)
  return {
    list: {
      enabled: true,
      urlTemplate: `https://${domain}${opts.listPath}`,
      itemSelector: { type: 'css', expression: itemSel },
      fields: {
        name: { type: 'css', expression: 'dl dt a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'dl dt a', attr: 'href' },
        author: { type: 'css', expression: 'dd.author', attr: 'text' },
        intro: { type: 'css', expression: 'dd.intro', attr: 'text' },
        cover: { type: 'css', expression: 'img', attr: 'data-src' },
        status: {
          type: 'css', expression: 'span', attr: 'text',
          replaceFrom: '^\\s*/\\s*', replaceTo: '',
        },
      },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: 'h1', attr: 'text' },
        author: { type: 'css', expression: "meta[property='og:novel:author']", attr: 'content' },
        category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
        status: { type: 'css', expression: "meta[property='og:novel:status']", attr: 'content' },
        // 笔趣阁系源站普遍用 lastest 拼写(非 latest), 沿用 biquge.tw 实测口径
        latestChapter: {
          type: 'css',
          expression: "meta[property='og:novel:lastest_chapter_name']",
          attr: 'content',
        },
        intro: { type: 'css', expression: '.intro p', attr: 'html' },
        cover: { type: 'css', expression: 'img.backcover', attr: 'src' },
      },
    },
    toc: {
      enabled: true,
      itemSelector: { type: 'css', expression: tocSel },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: contentSel, attr: 'html' },
      },
      // "下一章"指向下一章(h1 章内分页计数实测多数笔趣阁系为 1/1), 翻页关闭防多章并一章
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      engine,
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
        `(www\\.)?${escDomain}\\S*`,
        '笔趣阁[^<>]*转载收集',
        '本站所有小说为转载作品[^<>]*',
        '本章未完.*?点击下一页继续阅读',
        '一秒记住.*?免费读',
        '请记住本书.*?域名',
        '最新章节请到.*?查看',
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      normalize: true,
      plainText: false,
    },
  }
}

// ============================================================
// 24 条规则(25 站点去重后; ptwxz.com 重定向到 www.piaotia.com 不重复入库)
// ============================================================
const RULES: RuleSeed[] = [
  // ---------- Group 1: 笔趣阁系 (12 站) ----------
  {
    name: '格格党(gegedangbook.com)·笔趣阁系采集',
    description:
      '[实测] 笔趣阁系 dl/dt/dd 结构。列表=/sort/{cat}/{page}.html(.item 容器, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面, span 状态) / 书籍页=/txt/{id}.html(h1+og:novel:* meta 简体套件, 注意章名键 lastest 拼写, .intro p 真简介, img.backcover 封面) / 目录=.booklist li>a 全量单页 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer, browserFallbackStatus [403,412,429,503]。原文未实测内容长度, 请后台测试面板微调选择器。',
    enabled: true,
    config: biqugeRule('gegedangbook.com', {
      listPath: '/sort/1/{page}.html',
      itemSelector: '.item',
      contentSelector: '#chaptercontent',
      tocSelector: '.booklist li',
      bookPathNote: '/txt/{id}.html',
    }),
  },
  {
    name: '笔趣阁5200(biqu5200.com)·笔趣阁系采集',
    description:
      '[实测] biqu5200 笔趣阁系结构。列表=/top/{page}/(.item 或 dl 容器, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页=/{xxx}/{yyy}/(h1+og:novel:* meta, .intro p 简介, 封面 img) / 目录=同书籍页 .booklist li>a 或 #list dd>a 全量 / 正文=/{xxx}/{yyy}/{zzz}.html div#content。fetch http+uaMode rotate+autoCookie+referer。原文段未实测, 请后台测试面板微调选择器。',
    enabled: true,
    config: biqugeRule('biqu5200.com', {
      listPath: '/top/{page}/',
      itemSelector: '.item',
      contentSelector: '#content',
      tocSelector: '#list dd',
    }),
  },
  {
    name: '笔趣阁5200镜像(biquge5200.com)·笔趣阁系采集',
    description:
      '[推断] 假定与 biqu5200.com 同结构(镜像站)。列表=/top/{page}/(.item, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 #list dd>a 全量 / 正文 div#content。fetch http+uaMode rotate+autoCookie+referer。镜像站结构可能漂移, 入库后请后台测试面板实测并微调 urlTemplate/选择器。',
    enabled: true,
    config: biqugeRule('biquge5200.com', {
      listPath: '/top/{page}/',
      itemSelector: '.item',
      contentSelector: '#content',
      tocSelector: '#list dd',
    }),
  },
  {
    name: '笔趣阁gse(biqugse.com)·笔趣阁系采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点选择器可能漂移, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('biqugse.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '笔趣阁宝(xbiqubao.com)·笔趣阁系采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta(注意章名键 lastest 拼写)+.intro p 真简介+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('xbiqubao.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: 'i笔趣阁(ibiquges.com)·笔趣阁系采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('ibiquges.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: 'i笔趣wx(ibiquwx.com)·笔趣阁系采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('ibiquwx.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '笔趣wx(biquwx.com)·笔趣阁系采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('biquwx.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '多看笔趣(duokanbiqu.com)·笔趣阁系采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('duokanbiqu.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '中文小说网(zhongwenzw.com)·笔趣阁系采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('zhongwenzw.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '123读(123duw.com)·笔趣阁系采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('123duw.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '丽芭号(libahao2.com)·笔趣阁系采集',
    description:
      '[实测403] 裸 curl 403, 推断为笔趣阁系变体。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch engine=auto 启用 browserFallback(403 触发浏览器降级)。源站 403 防护较强, 实采可能需浏览器引擎或代理, 请后台测试面板实测并调整。',
    enabled: true,
    config: biqugeRule('libahao2.com', {
      listPath: '/sort/{page}.html',
      engine: 'auto',
    }),
  },

  // ---------- Group 2: ttkan.co (custom pure-g framework) ----------
  {
    name: 'ttkan中文(cn.ttkan.co)·自定义pure-g框架采集',
    description:
      '[实测] ttkan 自定义 modern framework(pure-g 网格布局), 非笔趣阁系。列表=/novel/class/{category}(如 xuanhuan/科幻/历史, 1页20本): .novel_info 卡片(pure-g 容器, 内 .novel_info_name>a 书名/书链, .novel_info_author 作者, .novel_info_intro 简介, img 封面) / 书籍页=/novel/page?novel_id={slug}(h1 书名+表格 meta 作者/分类/状态, .novel_info简介, 封面 img) / 目录=独立页 /novel/chapters/{slug} .novel_chapters_item>a 全量(实测可达数千章) / 正文=/novel/chapters/{slug}/{cid}.html div#content класса article-content。fetch engine=http(站点无 CF 但有 UA 校验)+uaMode rotate+autoCookie+referer, browserFallbackStatus [403,412,429,503]。原文段实测未跑, 请后台测试面板微调选择器(尤其 .novel_info 子类名)。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://cn.ttkan.co/novel/class/xuanhuan?page={page}',
        itemSelector: { type: 'css', expression: '.novel_info' },
        fields: {
          name: { type: 'css', expression: '.novel_info_name a', attr: 'text' },
          bookUrl: { type: 'css', expression: '.novel_info_name a', attr: 'href' },
          author: { type: 'css', expression: '.novel_info_author', attr: 'text' },
          intro: { type: 'css', expression: '.novel_info_intro', attr: 'text' },
          cover: { type: 'css', expression: 'img', attr: 'src' },
        },
      },
      book: {
        enabled: true,
        fields: {
          name: { type: 'css', expression: 'h1', attr: 'text' },
          author: { type: 'css', expression: '.novel_info_author a', attr: 'text' },
          category: { type: 'css', expression: '.novel_info_tag a', attr: 'text' },
          status: {
            type: 'css', expression: '.novel_info_status', attr: 'text',
            replaceFrom: '状态[：:]\\s*', replaceTo: '',
          },
          latestChapter: { type: 'css', expression: '.novel_info_last_chapter a', attr: 'text' },
          intro: { type: 'css', expression: '.novel_info_intro', attr: 'html' },
          cover: { type: 'css', expression: '.novel_info img', attr: 'src' },
        },
      },
      toc: {
        enabled: true,
        // 书籍页 → 独立目录页 /novel/chapters/{slug}(全量单页)
        tocLink: { type: 'css', expression: 'a:contains("查看全部章节")', attr: 'href' },
        itemSelector: { type: 'css', expression: '.novel_chapters_item' },
        fields: {
          title: { type: 'css', expression: 'a', attr: 'text' },
          url: { type: 'css', expression: 'a', attr: 'href' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      content: {
        enabled: true,
        fields: {
          content: { type: 'css', expression: '#content, .article-content', attr: 'html' },
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
        waitMs: 800,
        browserFallbackStatus: [403, 412, 429, 503],
      },
      clean: {
        removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
        adPatterns: [
          '(www\\.)?ttkan\\.co\\S*',
          '(www\\.)?cn\\.ttkan\\.co\\S*',
          '本章未完.*?点击下一页继续阅读',
          '一秒记住.*?免费读',
          '请记住本书.*?域名',
          '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
        ],
        whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        normalize: true,
        plainText: false,
      },
    },
  },

  // ---------- Group 3: 69shuba / 8kana / 101kks (CF protected) ----------
  {
    name: '69书吧(69shuba.com)·CF挑战站采集',
    description:
      '[实测CF] 69shuba.com Cloudflare "Just a moment" 挑战, 裸 curl 落 CF 拦截页。推断结构: 列表=/sort/{page}.html 或 /top/(.bookitem 或 .item, dt/dd 结构) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#content 或 #chaptercontent。fetch engine=auto, browserFallbackStatus [403,412,429,503] 触发 Obscura 浏览器降级通过 CF。CF 站实采成功率不稳, 强烈建议后台测试面板用浏览器引擎重跑确认选择器。',
    enabled: true,
    config: biqugeRule('69shuba.com', {
      listPath: '/sort/{page}.html',
      itemSelector: '.bookitem, .item',
      contentSelector: '#content, #chaptercontent',
      tocSelector: '.booklist li',
      engine: 'auto',
    }),
  },
  {
    name: '8kana(8kana.com, 原SF轻小说)·笔趣阁系推断采集',
    description:
      '[推断] 8kana(原 SF轻小说)自有框架, 列表疑似 /sort/ 或 /top/ 笔趣阁系风格。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#content。fetch engine=http+uaMode rotate+autoCookie+referer。8kana 框架与笔趣阁系可能不完全一致(尤其目录/正文选择器), 入库后请后台测试面板实测并微调选择器(可能需改用 #list dd / .chapter-list li 等容器)。',
    enabled: true,
    config: biqugeRule('8kana.com', {
      listPath: '/sort/{page}.html',
      contentSelector: '#content',
      tocSelector: '.booklist li',
    }),
  },
  {
    name: '101kks(101kks.com)·CF挑战站采集',
    description:
      '[实测CF] 101kks.com Cloudflare "Just a moment" 挑战。推断笔趣阁系结构: 列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch engine=auto, browserFallbackStatus [403,412,429,503] 触发浏览器降级过 CF。CF 站实采成功率不稳, 请后台测试面板用浏览器引擎实测确认选择器。',
    enabled: true,
    config: biqugeRule('101kks.com', {
      listPath: '/sort/{page}.html',
      engine: 'auto',
    }),
  },

  // ---------- Group 4: shucong.com (GBK, 403) ----------
  {
    name: '书丛(shucong.com)·GBK编码403站采集',
    description:
      '[实测403+GBK] shucong.com 裸 curl 返回 403 + 响应 charset=gbk。引擎 fetcher.decodeBuffer 三级探测(响应头 charset + meta charset + 字节嗅探)自动 GBK→UTF-8, 规则侧无需手动转码。推断笔趣阁系结构: 列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch engine=auto, browserFallbackStatus [403,412,429,503] 触发浏览器降级过 403。GBK 站点选择器不变, 但若源站 meta charset 缺失可能乱码(可在 fetch.headers 强制 Accept-Charset), 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('shucong.com', {
      listPath: '/sort/{page}.html',
      engine: 'auto',
    }),
  },

  // ---------- Group 5: hetushu / guichuideng / dongliuxiaoshuo (403 protected) ----------
  {
    name: '和图书(hetushu.com)·403站采集',
    description:
      '[实测403] hetushu.com 裸 curl 返回 403。推断笔趣阁系结构: 列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch engine=auto, browserFallbackStatus [403,412,429,503] 触发浏览器降级。源站 403 防护较强, 实采可能需代理或浏览器引擎, 请后台测试面板实测微调选择器。',
    enabled: true,
    config: biqugeRule('hetushu.com', {
      listPath: '/sort/{page}.html',
      engine: 'auto',
    }),
  },
  {
    name: '鬼吹灯(guichuideng.info)·专站403采集',
    description:
      '[实测403] guichuideng.info 鬼吹灯小说专属站, 裸 curl 403 + charset=utf8。推断结构: 列表=/book/{page}.html 或 /(书籍卡片, .item 或 .book-item 容器, dt/dd 结构) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 或 #list dd>a 全量 / 正文 div#content。fetch engine=auto, browserFallbackStatus [403,412,429,503]。专属站结构可能非标准笔趣阁系, 列表 urlTemplate(/book/{page}.html)为推断默认, 入库后请后台测试面板实测并修正。',
    enabled: true,
    config: biqugeRule('guichuideng.info', {
      listPath: '/book/{page}.html',
      itemSelector: '.item, .book-item',
      contentSelector: '#content',
      tocSelector: '.booklist li',
      engine: 'auto',
    }),
  },
  {
    name: '东流小说(dongliuxiaoshuo.com)·403站采集',
    description:
      '[实测403] dongliuxiaoshuo.com 裸 curl 返回 403(text/plain)。推断笔趣阁系结构: 列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch engine=auto, browserFallbackStatus [403,412,429,503] 触发浏览器降级。403 站点实采成功率不稳, 请后台测试面板实测并微调选择器。',
    enabled: true,
    config: biqugeRule('dongliuxiaoshuo.com', {
      listPath: '/sort/{page}.html',
      engine: 'auto',
    }),
  },

  // ---------- Group 6: 其他独立站点 ----------
  {
    name: 'UU看书(uukanshu.com)·笔趣阁系推断采集',
    description:
      '[实测SSL000] uukanshu.com 裸 curl 探测返回 000(疑似 SSL/TLS 协商失败或临时不可达)。推断结构: 列表=/xiaoshuo/ 或 /sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch engine=http+uaMode rotate+autoCookie+referer。SSL 失败可能源站证书过期或 SNI 严格, 实采可能需浏览器引擎; 请后台测试面板实测并微调选择器。',
    enabled: true,
    config: biqugeRule('uukanshu.com', {
      listPath: '/sort/{page}.html',
      engine: 'auto',
    }),
  },
  {
    name: '小说大全(xiaoshuodaquan.com)·笔趣阁系推断采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点选择器可能漂移, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('xiaoshuodaquan.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '老表(laobiao.cc)·笔趣阁系推断采集',
    description:
      '[推断] 标准笔趣阁系结构。列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img data-src 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch http+uaMode rotate+autoCookie+referer。推断站点选择器可能漂移, 请后台测试面板实测微调。',
    enabled: true,
    config: biqugeRule('laobiao.cc', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '江湖神算(jhsssd.com, 移动端)·笔趣阁系移动站采集',
    description:
      '[实测200] jhsssd.com 探测 200, 疑似移动端(m.)小说站。推断结构: 列表=/class/ 或 /sort/{page}.html(.item 或 .book-item 移动端卡片, dt/dd 结构, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#content 或 #chaptercontent。fetch uaMode=mobile(移动端 UA)+engine http+autoCookie+referer。移动站选择器可能与桌面站差异较大, 入库后请后台测试面板实测并微调选择器。',
    enabled: true,
    config: (() => {
      // 移动端站点用 mobile UA; 选择器复用笔趣阁系标准
      const cfg = biqugeRule('jhsssd.com', {
        listPath: '/sort/{page}.html',
        itemSelector: '.item, .book-item',
        contentSelector: '#content, #chaptercontent',
        tocSelector: '.booklist li',
      }) as Record<string, unknown>
      const fetch = cfg.fetch as Record<string, unknown>
      fetch.uaMode = 'mobile'
      return cfg
    })(),
  },
]

// ============================================================
// 主流程
// ============================================================
interface ListResp {
  ok: boolean
  data?: Array<{ id: string; name: string }> | { rules?: Array<{ id: string; name: string }> }
  message?: string
}
interface CreateResp {
  ok: boolean
  data?: { id?: string }
  message?: string
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  })
  // 取 Set-Cookie 头(可能多组, 仅需 heis_admin 那条)
  const setCookie = res.headers.get('set-cookie') || ''
  const m = /heis_admin=([^;]+)/.exec(setCookie)
  if (!m) {
    const text = await res.text().catch(() => '')
    throw new Error(`登录失败: 无 heis_admin cookie (status=${res.status}, body=${text.slice(0, 200)})`)
  }
  return `heis_admin=${m[1]}`
}

async function fetchAllRuleNames(cookie: string): Promise<Map<string, string[]>> {
  // 返回 name→[id, id...] (同名可能多条, 全删)
  const out = new Map<string, string[]>()
  const res = await fetch(`${BASE}/api/admin/rules?take=500`, {
    headers: { Cookie: cookie },
  })
  const json = (await res.json()) as ListResp
  const raw = Array.isArray(json.data)
    ? json.data
    : (json.data as { rules?: Array<{ id: string; name: string }> })?.rules || []
  for (const r of raw) {
    const arr = out.get(r.name) || []
    arr.push(r.id)
    out.set(r.name, arr)
  }
  return out
}

async function deleteRule(cookie: string, id: string): Promise<boolean> {
  const res = await fetch(`${BASE}/api/admin/rules/${id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  })
  const json = (await res.json()) as { ok: boolean }
  return json.ok === true
}

async function createRule(cookie: string, seed: RuleSeed): Promise<string> {
  const res = await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(seed),
  })
  const json = (await res.json()) as CreateResp
  if (!json.ok) {
    throw new Error(json.message || `HTTP ${res.status}`)
  }
  return json.data?.id || '?'
}

async function main() {
  console.log(`== 批量种子脚本 (BASE=${BASE}, ${RULES.length} 条规则) ==`)
  console.log('Tip: ptwxz.com 重定向到 www.piaotia.com, 已跳过(走 seed-rule-piaotia.ts)')
  console.log()

  // 1. 登录拿 cookie
  let cookie: string
  try {
    cookie = await login()
    console.log(`✓ 登录成功, 拿到 heis_admin cookie\n`)
  } catch (e) {
    console.error('✗ 登录失败:', (e as Error).message)
    process.exit(1)
  }

  // 2. 拉一次规则全表(name→ids), 用于幂等删除
  const existing = await fetchAllRuleNames(cookie)

  // 3. 逐条 upsert
  let okCount = 0
  let failCount = 0
  const failures: string[] = []
  for (const rule of RULES) {
    try {
      // 删除同名旧规则(含历史重复)
      const olds = existing.get(rule.name) || []
      for (const id of olds) {
        await deleteRule(cookie, id)
        console.log(`  ↻ 旧规则已删: ${rule.name} (id=${id})`)
      }
      // 创建
      const newId = await createRule(cookie, rule)
      console.log(`✓ ${rule.name} (id=${newId})`)
      okCount++
    } catch (e) {
      const msg = (e as Error).message
      console.log(`✗ ${rule.name}: ${msg}`)
      failCount++
      failures.push(`${rule.name}: ${msg}`)
    }
  }

  // 4. 汇总
  console.log()
  console.log(`入库 ${okCount}/${RULES.length} 条`)
  if (failures.length) {
    console.log(`失败 ${failCount} 条:`)
    for (const f of failures) console.log('  -', f)
  }
  console.log()
  console.log('规则已入库, 请在后台 采集规则 → 编辑 → 测试面板 逐个验证微调选择器')
  console.log('(CF/403/SSL 站点实采可能需切浏览器引擎或加代理, 见各规则 description 标记)')
}

main().catch((e) => {
  console.error('未捕获异常:', e)
  process.exit(1)
})

export {}
