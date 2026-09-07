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
// 工厂: 69shuba/101kks 共用框架(leftmenu/menu2/menu1 headbox + listright/newbox
// /newnav/imgbox/labelbox/ellipsis_2/zxzj 卡片列表 + og:novel:* meta 书籍页 +
// .catalog#catalog/.catalog ul li 目录 + .txtnav/#txtcontent 正文)
// feat-rules-probe 实测结论: 两站框架同源, 差异仅在字符集(gbk/utf-8) 与 URL 后缀
//   - 69shuba: charset=gbk, 书籍页 .htm, 正文 /txt/{bid}/{cid} 无后缀, 容器 .txtnav
//   - 101kks : charset=utf-8, 书籍页 .html, 正文 /txt/{bid}/{cid}.html, 容器 #txtcontent
// ============================================================
interface CdnshuOpts {
  /** 站点域名(不含 https://) */
  domain: string
  /** 列表路径, 含 {page} 占位符, 例: /novels/hot 或 /novels/class/{cat}_{page}.htm */
  listPath: string
  /** 正文容器选择器, 69shuba=.txtnav, 101kks=#txtcontent */
  contentSelector: string
  /** 目录页 li 选择器, 69shuba=.catalog#catalog li, 101kks=.catalog ul li */
  tocSelector: string
  /** 采集引擎: 'http'(默认) 或 'auto'(CF/403 站用) */
  engine?: 'http' | 'auto' | 'browser'
}

function cdnshuRule(opts: CdnshuOpts): unknown {
  const escDomain = escapeDomain(opts.domain)
  const engine = opts.engine || 'http'
  return {
    list: {
      enabled: true,
      urlTemplate: `https://${opts.domain}${opts.listPath}`,
      // ul 的 class 为 " clearfix listbox"(前导空格), 用 [class~=listbox] 兼容;
      // 101kks 用 ul#article_list_content, 兜底用两个选择器
      itemSelector: { type: 'css', expression: 'ul#article_list_content li, ul[class~=listbox] li' },
      fields: {
        name: { type: 'css', expression: 'h3 a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'h3 a', attr: 'href' },
        // .labelbox 内两个 label: 第一个是作者(可能含 <a>), 第二个是状态(连载/完本)
        author: {
          type: 'css', expression: '.labelbox label:first-child', attr: 'text',
          replaceFrom: '^\\s*作者[：:]?\\s*', replaceTo: '',
        },
        status: { type: 'css', expression: '.labelbox label:last-child', attr: 'text' },
        intro: { type: 'css', expression: '.ellipsis_2', attr: 'text' },
        cover: { type: 'css', expression: 'a.imgbox img', attr: 'data-src' },
      },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: "meta[property='og:novel:book_name']", attr: 'content' },
        author: { type: 'css', expression: "meta[property='og:novel:author']", attr: 'content' },
        category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
        status: { type: 'css', expression: "meta[property='og:novel:status']", attr: 'content' },
        // 69shuba/101kks 拼写为 latest_chapter_name(标准拼写, 非 lastest)
        latestChapter: {
          type: 'css', expression: "meta[property='og:novel:latest_chapter_name']", attr: 'content',
        },
        intro: { type: 'css', expression: "meta[property='og:description']", attr: 'content' },
        cover: { type: 'css', expression: "meta[property='og:image']", attr: 'content' },
      },
    },
    toc: {
      enabled: true,
      // 书籍页 og:novel:read_url 指向独立目录页(/book/{id}/ 或 /book/{id}/index.html)
      tocLink: { type: 'css', expression: "meta[property='og:novel:read_url']", attr: 'content' },
      itemSelector: { type: 'css', expression: opts.tocSelector },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: opts.contentSelector, attr: 'html' },
      },
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
      // .txtnav 容器内 h1/txtinfo/tools/bread 等非正文元素需剥离(主要针对 69shuba)
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle',
        '#txtright', '.txtinfo', '.tools', '.bread', 'h1.hide720'],
      adPatterns: [
        `(www\\.)?${escDomain}\\S*`,
        `(www\\.)?cdn\\.cdnshu\\.com\\S*`,
        '本章未完.*?点击下一页继续阅读',
        '一秒记住.*?免费读',
        '请记住本书.*?域名',
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
      '[实测JS挑战] biquge5200.com 裸 curl 探测返回 200 但响应仅 2104 字节, 内容为百度 JS 反爬挑战页(混淆代码 btoa(btoa(location.href)) 重定向到 keys8*.qwt*.fe 反爬网关)。推断结构沿用 biquge5200.com 同款笔趣阁系(.item/dl/dt/dd, #content, #list dd): 列表=/top/{page}/ / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 #list dd>a 全量 / 正文 div#content。fetch engine=auto + browserFallbackStatus [403,412,429,503] 触发浏览器引擎过 JS 挑战。源站 JS 强制跳转, 选择器未实测确认, 请后台测试面板用浏览器引擎重跑确认选择器。',
    enabled: true,
    config: biqugeRule('biquge5200.com', {
      listPath: '/top/{page}/',
      itemSelector: '.item',
      contentSelector: '#content',
      tocSelector: '#list dd',
      engine: 'auto',
    }),
  },
  {
    name: '笔趣阁gse(biqugse.com)·域名失效',
    description:
      '[域名失效-出售] biqugse.com 域名已过期在售, 裸 curl http/https 均返回 200 但实际为 4.cn 域名交易页(title=笔趣阁_书友最值得收藏的网络小说阅读网, body 含"biqugse.com 您正在访问的域名可以转让! This domain name is for sale! 售价 CNY 90998.00", 链接 http://www.4.cn/search/detail/pid/35200957)。原推断笔趣阁系规则失效, 规则保留但 enabled=false 以免污染活跃规则列表。运营方恢复运营后需重新探测结构。',
    enabled: false,
    config: biqugeRule('biqugse.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '笔趣阁宝(xbiqubao.com)·域名不可达',
    description:
      '[域名不可达] xbiqubao.com 裸 curl 探测 https/http 均 000(连接超时)。已尝试变体域名 xbiqubao.cc / .net / .info 均不可达。原推断笔趣阁系结构(列表 /sort/{page}.html + .item 容器 + #chaptercontent 正文 + .booklist 目录)保留待运营方恢复 DNS/服务后验证。规则 enabled=true 以便域名恢复后立即生效; 请运营方定期复查域名状态并重测选择器。',
    enabled: true,
    config: biqugeRule('xbiqubao.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: 'i笔趣阁(ibiquges.com)·域名不可达',
    description:
      '[域名不可达] ibiquges.com 裸 curl 探测 https/http 均 000。已尝试变体域名 ibiquges.cc / .net 均 000; ibiquges.info 301 重定向到无关站点 www.xbiqugu.la(不视为有效镜像)。原推断笔趣阁系结构(列表 /sort/{page}.html + .item + #chaptercontent + .booklist)保留待运营方恢复 DNS 后验证。规则 enabled=true 以便域名恢复后立即生效。',
    enabled: true,
    config: biqugeRule('ibiquges.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: 'i笔趣wx(ibiquwx.com)·域名不可达',
    description:
      '[域名不可达] ibiquwx.com 裸 curl 探测 https/http 均 000。已尝试变体域名 ibiquwx.cc / .net 均不可达。原推断笔趣阁系结构(列表 /sort/{page}.html + .item + #chaptercontent + .booklist)保留待运营方恢复 DNS 后验证。规则 enabled=true 以便域名恢复后立即生效。',
    enabled: true,
    config: biqugeRule('ibiquwx.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '笔趣wx(biquwx.com)·域名失效',
    description:
      '[域名失效-出售] biquwx.com 域名已过期在售, 裸 curl http/https 均返回 200 但实际为 4.cn 域名交易页(title=笔趣文学_书友最理想的免费小说无弹窗阅读txt下载网站-官网首页, body 含"biquwx.com 您正在访问的域名可以转让! This domain name is for sale! 售价 CNY 7797.00", 链接 http://www.4.cn/search/detail/pid/34906881)。原推断笔趣阁系规则失效, enabled=false。',
    enabled: false,
    config: biqugeRule('biquwx.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '多看笔趣(duokanbiqu.com)·域名不可达',
    description:
      '[域名不可达] duokanbiqu.com 裸 curl 探测 https/http 均 000。已尝试变体域名 duokanbiqu.cc / .net 均不可达。原推断笔趣阁系结构保留待运营方恢复 DNS 后验证。规则 enabled=true 以便域名恢复后立即生效。',
    enabled: true,
    config: biqugeRule('duokanbiqu.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '中文小说网(zhongwenzw.com)·域名不可达',
    description:
      '[域名不可达] zhongwenzw.com 裸 curl 探测 https/http 均 000(IP 140.188.162.133 连接超时 12s)。已尝试变体域名 zhongwenzw.cc / .net 均不可达。原推断笔趣阁系结构保留待运营方恢复 DNS 后验证。规则 enabled=true 以便域名恢复后立即生效。',
    enabled: true,
    config: biqugeRule('zhongwenzw.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '123读(123duw.com)·域名不可达',
    description:
      '[域名不可达] 123duw.com 裸 curl 探测: http 301 重定向到 https://www.123duw.com/, 但 https 请求返回空响应(0 字节)。已尝试变体域名 123duw.cc / .net 均不可达。原推断笔趣阁系结构保留待运营方恢复 HTTPS 服务后验证。规则 enabled=true 以便域名恢复后立即生效。',
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

  // ---------- Group 3: 69shuba / 8kana / 101kks (CDN shu 系框架) ----------
  {
    name: '69书吧(69shuba.com)·cdnshu框架GBK站采集',
    description:
      '[实测] 69shuba.com 裸 curl 探测 https://www.69shuba.com/ 直连 200, charset=gbk, fetcher 自动 GBK→UTF-8 解码, 非笔趣阁系, 为 CDN 书系(cdnshu.com 静态资源)自定义框架(leftmenu/menu2/menu1 headbox)。列表=/novels/hot(排行榜, 50本/页): ul.clearfix.listbox li 卡片(h3>a 书名/书链, .labelbox label:first-child 作者(可能含<a>)/label:last-child 状态(连载|完本), ol.ellipsis_2 简介, a.imgbox img[data-src] 封面) / 书籍页=/book/{id}.htm(og:novel:* meta 全套, 注意拼写为 latest_chapter_name 标准键): book_name/author/category/status/latest_chapter_name/read_url/update_time + og:image 封面 + og:description 简介 / 目录页=og:novel:read_url 即 /book/{id}/ .catalog#catalog li>a 全量(实测王国血脉 794 章) / 正文=/txt/{bid}/{cid}(无扩展名) div.txtnav(h1 章名+txtinfo日期作者+#txtright 广告+正文 loose text+<br>)。fetch engine=auto(裸 curl 抓 /txt/* 会触发 CF 挑战, 但 engine=http 走 fetcher UA 轮换 + cookie 自动可绕过; 加 browserFallbackStatus [403,412,429,503] 兜底)+uaMode rotate+autoCookie+referer。clean.removeSelectors 需剥离 #txtright/.txtinfo/.tools/.bread/h1.hide720 非正文元素。feat-rules-probe 实测四段全过线: list=50本/book=王国血脉(无主之剑/玄幻魔法/连载)/toc=794章/content=9225字符。',
    enabled: true,
    config: cdnshuRule({
      domain: 'www.69shuba.com',
      listPath: '/novels/hot',
      contentSelector: '.txtnav',
      tocSelector: '.catalog#catalog li',
      engine: 'auto',
    }),
  },
  {
    name: '8kana(8kana.com, 原SF轻小说)·非笔趣阁系创客平台',
    description:
      '[实测非笔趣阁系] 8kana.com 裸 curl 探测 https://www.8kana.com/ 直连 200(title=最大的二次元小说平台_晨星盛世), 但站点为 Phalcon + Vue.js 框架的创客写作平台(原 SF轻小说/晨星盛世), 非笔趣阁系爬虫采集目标: ① /book/ 路由 Phalcon 抛 Fatal error(Module book  isn registered); ② 书籍页 /book/{id}.html 无 og:novel:* meta, 章节列表通过 Vue 异步加载, 无静态 li/dd 容器; ③ 列表页 /www/bookclass/serial/{cat1}-{cat2} 实际展示"热门书评"而非书卡; ④ 无 #content/#chaptercontent/.booklist 等笔趣阁系标准选择器。enabled=false: 不符合当前采集引擎的爬虫框架(需专用 Vue SSR/接口逆向), 入库仅为占位, 后续如需支持请单独实现 8kana 接口适配层。',
    enabled: false,
    config: biqugeRule('8kana.com', {
      listPath: '/www/bookclass/serial/1-101',
      contentSelector: '#content',
      tocSelector: '.booklist li',
    }),
  },
  {
    name: '101kks(101kks.com)·cdnshu框架UTF8站采集',
    description:
      '[实测] 101kks.com 裸 curl 探测 https://101kks.com/ 直连 200(title=101看書-無廣告彈窗-全免費繁體小說網), charset=utf-8, 与 69shuba 同源 CDN 书系框架(cdnshu.com), 仅字符集与 URL 后缀不同。列表=/novels/hot(新書榜, 30本/页): ul#article_list_content li 卡片(h3>a 书名/书链, .labelbox label:first-child a 作者/label:last-child 状态, ol.ellipsis_2 简介, a.imgbox img[data-src] 封面) / 书籍页=/book/{id}.html(og:novel:* meta 全套 latest_chapter_name 标准键 + read_url=/book/{id}/index.html 独立目录页) / 目录页=og:novel:read_url .catalog ul li>a 全量(实测食戟 36 章, 大书可达数千章) / 正文=/txt/{bid}/{cid}.html div#txtcontent(纯 <br> 段落)。fetch engine=http+uaMode rotate+autoCookie+referer, browserFallbackStatus [403,412,429,503]。feat-rules-probe 实测四段全过线: list=30本/book=食戟(佚名/動漫同人/連載)/toc=36章/content=2638字符。',
    enabled: true,
    config: cdnshuRule({
      domain: '101kks.com',
      listPath: '/novels/hot',
      contentSelector: '#txtcontent',
      tocSelector: '.catalog ul li',
      engine: 'http',
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
      '[实测403] hetushu.com 裸 curl https://www.hetushu.com/ 返回 403 + Cloudflare "Attention Required!" 拦截页。推断笔趣阁系结构: 列表=/sort/{page}.html(.item, dt>a 书名/书链, dd.author/dd.intro, img 封面) / 书籍页 h1+og:novel:* meta+.intro p+封面 / 目录 .booklist li>a 全量 / 正文 div#chaptercontent。fetch engine=auto, browserFallbackStatus [403,412,429,503] 触发 Obscura 浏览器降级过 CF。源站 403 防护较强, 实采可能需代理或浏览器引擎, 请后台测试面板实测微调选择器。',
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
    name: 'UU看书(uukanshu.cc)·自定义框架繁体站采集',
    description:
      '[实测] uukanshu.cc 裸 curl 探测 https://uukanshu.cc/ 直连 200(title=UU看書 -免費繁體小說網), charset=utf-8, www 子域名 301 重定向到根域。非笔趣阁系, 自定义框架(header/container01/class header-nav, content/book, class fengtui)。列表=/class_{cat}_{page}.html(cat 1-10: 1玄幻奇幻/2武俠仙俠/3現代都市/4歷史軍事/5科幻小說/6遊戲競技/7恐怖靈異/8言情小說/9動漫同人/10其他類型, 30本/页): div.bookbox 卡片(h4.bookname>a 书名/书链, div.author:nth-of-type(1) 作者(前缀"作者："), div.cat>a 最新章节, div.update 简介) / 书籍页=同 URL /book/{id}/ 即目录页(og:novel:* meta 全套 latest_chapter_name 标准键 + og:image 封面=https://image.uukanshu.cc/...s.jpg + og:description 简介) / 目录=dl.chapterlist dd>a 全量(实测 1907 章) / 正文=/book/{bid}/{cid}.html div.readcotent.bbb.font-normal(纯 <br> 段落)。fetch engine=http+uaMode rotate+autoCookie+referer, browserFallbackStatus [403,412,429,503]。clean.adPatterns 加 uukanshu.cc 域名剥离。feat-rules-probe 实测四段全过线: list=30本/book=領主(佚名/玄幻奇幻/連載)/toc=1907章/content=2441字符(简繁字形混合, cleaner t2s 已介入)。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://uukanshu.cc/class_1_{page}.html',
        itemSelector: { type: 'css', expression: 'div.bookbox' },
        fields: {
          name: { type: 'css', expression: 'h4.bookname a', attr: 'text' },
          bookUrl: { type: 'css', expression: 'h4.bookname a', attr: 'href' },
          author: {
            type: 'css', expression: 'div.author:nth-of-type(1)', attr: 'text',
            replaceFrom: '^\\s*作者[：:]?\\s*', replaceTo: '',
          },
          intro: {
            type: 'css', expression: 'div.update', attr: 'text',
            replaceFrom: '^\\s*簡介[：:]?\\s*', replaceTo: '',
          },
          latestChapter: { type: 'css', expression: 'div.cat a', attr: 'text' },
        },
      },
      book: {
        enabled: true,
        fields: {
          name: { type: 'css', expression: "meta[property='og:novel:book_name']", attr: 'content' },
          author: { type: 'css', expression: "meta[property='og:novel:author']", attr: 'content' },
          category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
          status: { type: 'css', expression: "meta[property='og:novel:status']", attr: 'content' },
          latestChapter: {
            type: 'css', expression: "meta[property='og:novel:latest_chapter_name']", attr: 'content',
          },
          intro: { type: 'css', expression: "meta[property='og:description']", attr: 'content' },
          cover: { type: 'css', expression: "meta[property='og:image']", attr: 'content' },
        },
      },
      toc: {
        enabled: true,
        // 书籍页即目录页(同 URL /book/{id}/), 无独立 tocLink
        itemSelector: { type: 'css', expression: 'dl.chapterlist dd' },
        fields: {
          title: { type: 'css', expression: 'a', attr: 'text' },
          url: { type: 'css', expression: 'a', attr: 'href' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      content: {
        enabled: true,
        fields: {
          content: { type: 'css', expression: 'div.readcotent', attr: 'html' },
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
          '(www\\.)?uukanshu\\.cc\\S*',
          '(www\\.)?image\\.uukanshu\\.cc\\S*',
          'UU看書',
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
  {
    name: '小说大全(xiaoshuodaquan.com)·域名失效',
    description:
      '[域名失效] xiaoshuodaquan.com 域名已过期未解析到站点。裸 curl 探测 https://www.xiaoshuodaquan.com/ 返回 000; http://www.xiaoshuodaquan.com/ 返回 200 但实际为宝塔面板默认页(title=没有找到站点, body BaoTa "您请求的文件不存在"), 表明域名 DNS 仍指向某 IP 但 Web 服务器未配置该域名 vhost。原推断笔趣阁系规则失效, enabled=false。',
    enabled: false,
    config: biqugeRule('xiaoshuodaquan.com', { listPath: '/sort/{page}.html' }),
  },
  {
    name: '老表(laobiao.cc)·域名失效',
    description:
      '[域名失效-博彩劫持] laobiao.cc 裸 curl 探测: https TLSv1.3 握手失败(证书过期, alert certificate expired); http 直连 200 但实际为博彩劫持页(title=BBIN·宝盈集团(搜狐)—值得信赖让您放心的选择, 链接 /aiyingyong/ /aizixun/ /guanyuwomen/ 等博彩引流路径), 域名已不在小说站运营方手中。已尝试变体域名 laobiao.com(Cloudflare 521 错误)/laobiao.net/.info 均 000。原推断笔趣阁系规则失效, enabled=false。',
    enabled: false,
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
