// ============================================================
// 规则模板库 (feat-round-8: Feature A)
// 预置 8 类常见小说站点结构的 RuleConfig 模板, 供模板库 UI 一键创建规则。
// 全部使用占位域名 https://example.com/ (不绑真实站点), 安装后由管理员改 url/host。
//
// 模板与既有种子脚本(scripts/seed-rule-*.ts)的关系:
//   - 种子脚本针对具体站点(实测+逆向), 域名/字段/编码/token 都是精确真实值
//   - 模板覆盖常见结构形态(笔趣阁CSS / GBK / XPath / 正则 / JSON API / JS渲染 / 番茄聚合 / 七猫带token),
//     让操作员 0→1 起步时不必从空白页规则手敲字段类型与表达式
//   - 同一站点结构可被多个种子脚本命中, 模板仅是"形状模板", 不替代站点精确适配
// ============================================================
import { type RuleConfig, defaultRuleConfig } from './types'

export type RuleTemplateCategory = 'biquge' | 'api' | 'forum' | 'wiki' | 'custom'
export type RuleTemplateDifficulty = 'easy' | 'medium' | 'hard'

export interface RuleTemplate {
  /** 模板 id (英文 kebab-case, 模板库 UI 不透传给规则, 仅用于 React key / 调试) */
  id: string
  /** 显示名 (中文, 用户可见) */
  name: string
  /** 适配什么站点结构, 1~2 句话 */
  description: string
  /** 分类(决定颜色徽章): biquge 笔趣阁系 / api 纯JSON API / forum 论坛体 / wiki 维基型 / custom 通用 */
  category: RuleTemplateCategory
  /** 标签(筛选用), 短词 */
  tags: string[]
  /** 难度: easy CSS+列表 / medium 字段重组或GBK / hard token/JS渲染/正则兜底 */
  difficulty: RuleTemplateDifficulty
  /** 完整 4 段规则配置, 直接 POST /api/admin/rules 作为 config 入库 */
  config: RuleConfig
  /** 使用备注/坑点(可选, 模板库预览时一并展示) */
  notes?: string
}

// ---- 工具: 基于 defaultRuleConfig() 增量构造, 保证缺省字段(如 fetch.browserFallbackStatus)
//       不丢; 字段层(ReplaceFrom 等)手填 expression 时务必先验证规则侧 sanitize 通过 ----
function baseConfig(): RuleConfig {
  return JSON.parse(JSON.stringify(defaultRuleConfig())) as RuleConfig
}

// ============================================================
// 模板 1: 笔趣阁标准模板 (biquge-standard)
// 经典笔趣阁系 CSS 选择器形态: 列表分页 {page} / 书籍信息卡 / 目录 dd>a / 内容 div#content
// 适用站点: 笔趣阁系(biquge/*.cc/com/net)、各类 dedecms 改的小说站、3G 段内容站
// ============================================================
const biqugeStandardTemplate: RuleTemplate = {
  id: 'biquge-standard',
  name: '笔趣阁标准模板',
  description: '经典笔趣阁系 CSS 选择器结构: 列表分页 {page}, 书籍信息卡, 目录 dd>a, 正文 div#content。绝大多数 biquge 系站点可直接套用。',
  category: 'biquge',
  tags: ['笔趣阁系', 'CSS选择器', '分页', 'GBK可选'],
  difficulty: 'easy',
  config: (() => {
    const cfg = baseConfig()
    // 列表页: 每页 30 本, .item .image a 取书籍链接, .image img 取封面, .title 取书名
    cfg.list.urlTemplate = 'https://example.com/modules/article/articlelist.php?page={page}'
    cfg.list.itemSelector = { type: 'css', expression: '.item' }
    cfg.list.fields = {
      name: { type: 'css', expression: '.title a', attr: 'text' },
      bookUrl: { type: 'css', expression: '.image a', attr: 'href' },
      author: { type: 'css', expression: '.info .author', attr: 'text' },
      cover: { type: 'css', expression: '.image img', attr: 'src' },
      intro: { type: 'css', expression: '.intro', attr: 'text' },
    }
    cfg.list.pagination = { enabled: true, maxPages: 20 }
    // 书籍页: 经典 .info 块, #intro 简介, #fmimg 封面
    cfg.book.fields = {
      name: { type: 'css', expression: 'h1', attr: 'text' },
      author: { type: 'css', expression: '#info p:nth-child(2) a', attr: 'text' },
      category: { type: 'css', expression: '#info p:nth-child(1) a', attr: 'text' },
      intro: { type: 'css', expression: '#intro', attr: 'text' },
      cover: { type: 'css', expression: '#fmimg img', attr: 'src' },
      latestChapter: { type: 'css', expression: '#info p:nth-child(4) a', attr: 'text' },
    }
    // 目录页: 与书籍页同 URL, dd>a 列表为章节链接
    cfg.toc.itemSelector = { type: 'css', expression: '#list dd' }
    cfg.toc.fields = {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    }
    cfg.toc.pagination = { enabled: false, maxPages: 20 }
    // 内容页: div#content 经典正文容器
    cfg.content.fields = {
      content: { type: 'css', expression: '#content', attr: 'html' },
    }
    cfg.content.pagination = { enabled: false, maxPages: 10, joinWith: '<br/>' }
    // 抓取: HTTP 引擎 + UA 轮换 + Referer + Cookie 自动跟随
    cfg.fetch.engine = 'auto'
    cfg.fetch.uaMode = 'rotate'
    cfg.fetch.referer = true
    cfg.fetch.autoCookie = true
    cfg.fetch.timeout = 20000
    cfg.fetch.retries = 2
    cfg.fetch.waitMs = 800
    cfg.fetch.browserFallbackStatus = [403, 412, 429, 503]
    cfg.fetch.hostGateLimit = 3
    // 清洗: 剔脚本/广告, 保留段落标签
    cfg.clean.removeSelectors = ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle', '.ad', '#ad']
    cfg.clean.adPatterns = [
      '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      '本章未完.*?点击下一页继续阅读',
      '请记住本书.*?域名',
      '最新章节请到.*?查看',
      '一秒记住.*?免费读',
    ]
    cfg.clean.whitelist = ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']
    cfg.clean.normalize = true
    cfg.clean.plainText = false
    return cfg
  })(),
  notes: '使用前必改: cfg.list.urlTemplate 改成目标站列表页 URL; 站点若是 GBK 编码请改用「笔趣阁GBK变体」模板; 章节分卷结构需自行扩展 toc.fields.volume 字段。',
}

// ============================================================
// 模板 2: 笔趣阁GBK变体 (biquge-gbk)
// 同 biquge-standard 结构, fetch.headers 强制声明 Accept-Charset: gbk +
// fetch 加 GBK 标记(由 fetcher 自动按响应体 charset meta / 头识别 gb18030, 此处仅提示)
// 实际 GBK 解码由 fetcher.decodeBuffer 三级探测承担(charset 头 + meta + 头段字节嗅探)
// ============================================================
const biqugeGbkTemplate: RuleTemplate = {
  id: 'biquge-gbk',
  name: '笔趣阁变体(GBK)',
  description: '结构同标准模板, 适用于 GBK/GB2312/GB18030 编码的老派笔趣阁系站点。引擎按响应 charset 头与 meta 自动解码, 无需手动转码。',
  category: 'biquge',
  tags: ['笔趣阁系', 'CSS选择器', 'GBK', 'GB18030'],
  difficulty: 'medium',
  config: (() => {
    const cfg = biqugeStandardTemplate.config
    // 深拷贝避免改到原模板
    const copy: RuleConfig = JSON.parse(JSON.stringify(cfg))
    // GBK 提示头: 服务端按头协商 charset; 引擎 decodeBuffer 仍走三级探测兜底
    copy.fetch.headers = {
      ...(copy.fetch.headers || {}),
      'Accept-Charset': 'gb18030,utf-8;q=0.7,*;q=0.3',
    }
    // GBK 站常有 .bqg 或者 .box_con 容器变体, 此处维持标准选择器, 用户按需调整
    return copy
  })(),
  notes: 'GBK 站点常见坑: 响应头没带 charset 时引擎按响应体前 2KB 的 meta charset 嗅探, 若站用 script document.write 后期注入 charset 仍可能误读为 UTF-8(乱码); 此时可在 cfg.fetch.headers 强制 Accept-Charset 让服务端协商返回 GBK。',
}

// ============================================================
// 模板 3: XPath 结构化站点 (xpath-structured)
// 面向 well-structured 站点: 列表用 //div[@class="book-item"], 书籍用 //table/tr,
// 目录用 //ul[@class="chapter-list"]/li/a, 内容用 //div[@id="content"]
// 适用: 自建 CMS / dedecms 完整版 / 起点/纵横早期 HTML 段
// ============================================================
const xpathStructuredTemplate: RuleTemplate = {
  id: 'xpath-structured',
  name: 'XPath 结构化站点',
  description: 'XPath 表达式抓取结构清晰的 HTML 站点: 列表 div.book-item, 书籍信息 table, 目录 ul.chapter-list, 正文 div#content。适合自建 CMS / dedecms / 早期起点风格 HTML。',
  category: 'custom',
  tags: ['XPath', '结构化', 'HTML'],
  difficulty: 'medium',
  config: (() => {
    const cfg = baseConfig()
    cfg.list.urlTemplate = 'https://example.com/list/{page}.html'
    cfg.list.itemSelector = { type: 'xpath', expression: '//div[@class="book-item"]' }
    cfg.list.fields = {
      name: { type: 'xpath', expression: './/h3/a/text()' },
      bookUrl: { type: 'xpath', expression: './/h3/a/@href' },
      author: { type: 'xpath', expression: './/span[@class="author"]/text()' },
      cover: { type: 'xpath', expression: './/img/@src' },
      intro: { type: 'xpath', expression: './/p[@class="intro"]/text()' },
    }
    cfg.list.pagination = { enabled: true, maxPages: 30 }
    cfg.book.fields = {
      name: { type: 'xpath', expression: '//h1[@class="book-title"]/text()' },
      author: { type: 'xpath', expression: '//span[@class="author-name"]/a/text()' },
      category: { type: 'xpath', expression: '//span[@class="category"]/a/text()' },
      intro: { type: 'xpath', expression: '//div[@class="book-intro"]/p/text()' },
      cover: { type: 'xpath', expression: '//div[@class="book-cover"]/img/@src' },
      status: { type: 'xpath', expression: '//span[@class="status"]/text()' },
    }
    cfg.toc.itemSelector = { type: 'xpath', expression: '//ul[@class="chapter-list"]/li' }
    cfg.toc.fields = {
      title: { type: 'xpath', expression: './a/text()' },
      url: { type: 'xpath', expression: './a/@href' },
    }
    cfg.toc.pagination = { enabled: false, maxPages: 20 }
    cfg.content.fields = {
      content: { type: 'xpath', expression: '//div[@id="content"]', attr: 'html' },
    }
    cfg.content.pagination = { enabled: false, maxPages: 10, joinWith: '<br/>' }
    cfg.fetch.engine = 'auto'
    cfg.fetch.uaMode = 'rotate'
    cfg.fetch.referer = true
    cfg.fetch.autoCookie = true
    cfg.fetch.timeout = 20000
    cfg.fetch.retries = 2
    cfg.fetch.waitMs = 800
    cfg.fetch.browserFallbackStatus = [403, 412, 429, 503]
    cfg.fetch.hostGateLimit = 3
    cfg.clean.removeSelectors = ['script', 'style', 'iframe', 'ins', 'noscript', '.ad', '#ad']
    cfg.clean.adPatterns = [
      '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      '本章未完.*?点击下一页继续阅读',
    ]
    cfg.clean.whitelist = ['p', 'br', 'b', 'strong', 'em', 'i', 'u']
    cfg.clean.normalize = true
    cfg.clean.plainText = false
    return cfg
  })(),
  notes: 'XPath 适配器在 parser.xpathExtract: 表达式必须以 ./ 或 .// 开头(节点内查找)或 / 或 //(文档级查找); attr=html 取整个节点 outerHTML, attr=text 取纯文本。',
}

// ============================================================
// 模板 4: 正则兜底模板 (regex-fallback)
// 面向 HTML 极不规范的站点(混杂标签 / 内容无容器 / 服务器侧渲染破损)
// 用正则捕获组从 HTML 流中抠出字段, 容错强但维护难(站点改版需重写正则)
// ============================================================
const regexFallbackTemplate: RuleTemplate = {
  id: 'regex-fallback',
  name: '正则兜底模板',
  description: 'HTML 极不规范 / 服务器渲染破损 / 无清晰容器的站点兜底方案: 用正则捕获组抠出字段。容错强但维护难, 站点改版需重写正则。',
  category: 'custom',
  tags: ['正则', '兜底', '容错', '乱码HTML'],
  difficulty: 'hard',
  config: (() => {
    const cfg = baseConfig()
    cfg.list.urlTemplate = 'https://example.com/list/{page}.html'
    // 列表项: <div class="item">...</div> 用正则切分(每条 <div class="item">)
    cfg.list.itemSelector = { type: 'regex', expression: '<div\\s+class="item"[^>]*>([\\s\\S]*?)(?=<div\\s+class="item"|</body>)', flags: 'gis' }
    cfg.list.fields = {
      name: { type: 'regex', expression: '<h3[^>]*><a[^>]*>([^<]+)</a>', flags: 'is' },
      bookUrl: { type: 'regex', expression: '<h3[^>]*><a[^>]+href="([^"]+)"', flags: 'is' },
      author: { type: 'regex', expression: '作者[：:]\\s*([^<\\s]+)', flags: 'is' },
    }
    cfg.list.pagination = { enabled: true, maxPages: 20 }
    cfg.book.fields = {
      name: { type: 'regex', expression: '<h1[^>]*>([^<]+)</h1>', flags: 'is' },
      author: { type: 'regex', expression: '作[者者][：:]\\s*<a[^>]*>([^<]+)</a>', flags: 'is' },
      category: { type: 'regex', expression: '类[别型][：:]\\s*<a[^>]*>([^<]+)</a>', flags: 'is' },
      intro: { type: 'regex', expression: '<div[^>]*id="intro"[^>]*>([\\s\\S]*?)</div>', flags: 'is', stripTags: true },
      cover: { type: 'regex', expression: '<img[^>]+src="([^"]+)"[^>]*id="fmimg"', flags: 'is' },
    }
    // 目录: <dd><a href="...">章节名</a></dd> 列表
    cfg.toc.itemSelector = { type: 'regex', expression: '<dd[^>]*>\\s*<a[^>]*>[\\s\\S]*?</a>\\s*</dd>', flags: 'gis' }
    cfg.toc.fields = {
      title: { type: 'regex', expression: '<a[^>]*>([^<]+)</a>', flags: 'is' },
      url: { type: 'regex', expression: '<a[^>]+href="([^"]+)"', flags: 'is' },
    }
    cfg.toc.pagination = { enabled: false, maxPages: 20 }
    // 正文: <div id="content">...</div> 非贪婪
    cfg.content.fields = {
      content: { type: 'regex', expression: '<div[^>]*id="content"[^>]*>([\\s\\S]*?)</div>\\s*<div', flags: 'is' },
    }
    cfg.content.pagination = { enabled: false, maxPages: 10, joinWith: '<br/>' }
    cfg.fetch.engine = 'auto'
    cfg.fetch.uaMode = 'rotate'
    cfg.fetch.referer = true
    cfg.fetch.autoCookie = true
    cfg.fetch.timeout = 20000
    cfg.fetch.retries = 2
    cfg.fetch.waitMs = 800
    cfg.fetch.browserFallbackStatus = [403, 412, 429, 503]
    cfg.fetch.hostGateLimit = 3
    cfg.clean.removeSelectors = ['script', 'style', 'iframe', 'ins', 'noscript']
    cfg.clean.adPatterns = [
      '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      '本章未完.*?点击下一页继续阅读',
    ]
    cfg.clean.whitelist = ['p', 'br', 'b', 'strong', 'em', 'i']
    cfg.clean.normalize = true
    cfg.clean.plainText = false
    return cfg
  })(),
  notes: '正则模板的坑: ①API 层有正则安全校验(collectRegexIssues)禁灾难型嵌套量词((a+)+ / (a|aa)+), 写表达式时避坑; ②flags 默认 gis 全局+多行+点通配, 单行模式自己改 flags; ③正则改版时维护成本高, 优先用 CSS/XPath, 此模板仅作兜底。',
}

// ============================================================
// 模板 5: API JSON 站点 (api-json)
// 面向 SPA + JSON API 站点(页面是空壳, 数据全靠 /api/*.json 返回)
// 字段类型用 'json'(JSON 点路径) + 'const'(常量模板合成 URL), 适配 bqg713 系纯 API 站
// ============================================================
const apiJsonTemplate: RuleTemplate = {
  id: 'api-json',
  name: 'API JSON 站点',
  description: 'SPA壳+JSON API 站点: 列表/书籍/目录/正文全部 JSON 端点。字段用 json 点路径提取, URL 用 const 模板合成。适合 bqg713 系纯 API 站、阅读(legado)书源逆向出来的 API。',
  category: 'api',
  tags: ['JSON API', 'const 模板', 'SPA', '点路径'],
  difficulty: 'medium',
  config: (() => {
    const cfg = baseConfig()
    // 列表 API: 单次返回 { books: [{id,title,author,intro,cover}] }
    cfg.list.urlTemplate = 'https://example.com/api/books?page={page}'
    cfg.list.itemSelector = { type: 'json', expression: 'books' }
    cfg.list.fields = {
      id: { type: 'json', expression: 'id' },
      name: { type: 'json', expression: 'title' },
      author: { type: 'json', expression: 'author' },
      intro: { type: 'json', expression: 'intro' },
      cover: { type: 'json', expression: 'cover' },
      // const 模板合成书籍 API URL: {id} 替换为同作用域提取的 id 字段
      bookUrl: { type: 'const', expression: 'https://example.com/api/book?id={id}' },
    }
    cfg.list.pagination = { enabled: false, maxPages: 20 }
    // 书籍 API: { data: { title, author, category, intro, cover, status, latest_chapter } }
    cfg.book.fields = {
      name: { type: 'json', expression: 'data.title' },
      author: { type: 'json', expression: 'data.author' },
      category: { type: 'json', expression: 'data.category' },
      keywords: { type: 'json', expression: 'data.tags' },
      intro: { type: 'json', expression: 'data.intro' },
      cover: { type: 'json', expression: 'data.cover' },
      status: { type: 'json', expression: 'data.status' },
      latestChapter: { type: 'json', expression: 'data.latest_chapter' },
    }
    // 目录: tocLink 用 const 模板, {q.id} 取书籍页 URL 的查询参数
    cfg.toc.tocLink = { type: 'const', expression: 'https://example.com/api/toc?book_id={q.id}' }
    cfg.toc.itemSelector = { type: 'json', expression: 'data.chapters' }
    cfg.toc.fields = {
      title: { type: 'json', expression: 'title' },
      // 章节序号用于 const 模板合成 URL: {index} = 1基序号, {q.book_id} = 书籍页URL查询参数
      chapterId: { type: 'json', expression: 'id' },
      url: { type: 'const', expression: 'https://example.com/api/chapter?book_id={q.book_id}&chapter_id={chapterId}' },
    }
    cfg.toc.pagination = { enabled: false, maxPages: 20 }
    // 正文 API: { data: { content, title } }, content 是 \n 分段纯文本
    cfg.content.fields = {
      content: { type: 'json', expression: 'data.content' },
    }
    cfg.content.pagination = { enabled: false, maxPages: 10, joinWith: '' }
    cfg.fetch.engine = 'http'
    cfg.fetch.uaMode = 'rotate'
    cfg.fetch.headers = { Accept: 'application/json' }
    cfg.fetch.referer = true
    cfg.fetch.autoCookie = true
    cfg.fetch.timeout = 20000
    cfg.fetch.retries = 2
    cfg.fetch.waitMs = 500
    cfg.fetch.browserFallbackStatus = [403, 429, 503]
    cfg.fetch.hostGateLimit = 3
    // JSON API 正文为 \n 分段纯文本: plainText 模式剥标签保段落
    cfg.clean.removeSelectors = ['script', 'style', 'iframe', 'ins', 'noscript']
    cfg.clean.adPatterns = ['(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?']
    cfg.clean.whitelist = ['p', 'br', 'b', 'strong', 'em', 'i']
    cfg.clean.normalize = true
    cfg.clean.plainText = true
    return cfg
  })(),
  notes: 'json/const 字段类型由引擎 Task aa-c 扩展: ①json expression 为点路径(data.a.b.c, 数字段=数组下标 items.0.title); ②const expression 为常量模板, {字段名} 同作用域替换, {q.参数名} 当前页 URL 查询参数, {index} 1基序号; ③itemSelector json 数组路径支持逗号并集(hotlist,sort1,sort2)。详见 src/lib/crawl/types.ts 头注释。',
}

// ============================================================
// 模板 6: 静态 HTML + JS 渲染 (js-render)
// 面向纯客户端渲染站点: 页面 HTML 是壳, 内容由 JS 注入(React/Vue/AJAX)
// 强制 browser 引擎, waitSelector 等正文容器渲染完成
// ============================================================
const jsRenderTemplate: RuleTemplate = {
  id: 'js-render',
  name: '静态 HTML + JS 渲染',
  description: '页面 HTML 是壳, 内容由 JS 注入(React/Vue/AJAX 站)。强制 browser 引擎 + waitSelector 等正文容器渲染完成。Obscura 隐身优先, 失败降级裸 Playwright。',
  category: 'custom',
  tags: ['JS渲染', 'browser引擎', 'SPA', 'AJAX'],
  difficulty: 'hard',
  config: (() => {
    const cfg = biqugeStandardTemplate.config
    const copy: RuleConfig = JSON.parse(JSON.stringify(cfg))
    // 强制浏览器渲染: HTML 抓到的壳没数据, 必须等 JS 注入
    copy.fetch.engine = 'browser'
    copy.fetch.waitSelector = '#content'  // 等正文容器渲染出现
    copy.fetch.waitMs = 2500              // 渲染稳定等待
    copy.fetch.clickSelector = '.load-more' // 可选: 点击展开懒加载目录
    copy.fetch.browserFallbackStatus = [403, 412, 429, 503]
    copy.fetch.timeout = 30000            // 浏览器渲染慢, 加大超时
    copy.fetch.retries = 1
    return copy
  })(),
  notes: 'browser 引擎路径: 优先 Obscura(--stealth 隐身 + CF 挑战自动等待), 不可用降级裸 Playwright; 配置了出口代理时跳过 Obscura 直接走裸 Playwright per-context proxy。waitSelector 是渲染完成哨兵, 必须是 JS 注入后才出现的元素(非壳内已有元素)。',
}

// ============================================================
// 模板 7: 番茄/番茄风格 (fanqie-style)
// 番茄小说聚合 API 风格: 列表 search API 嵌套数组(map-collect 展平), 书籍 detail 多字段,
// toc 数组的数组递归展平(* 段), content 纯文本 \n 分段
// 依据: scripts/seed-rule-fanqie.ts 真实站点结构(改占位域名)
// ============================================================
const fanqieStyleTemplate: RuleTemplate = {
  id: 'fanqie-style',
  name: '番茄/番茄风格',
  description: '番茄小说聚合 API 风格: 列表 search 嵌套数组(tab_type 过滤+map-collect 展平), 书籍 detail 多字段, toc 数组的数组递归展平(* 段), content 纯文本 \\n 分段。',
  category: 'api',
  tags: ['番茄', '聚合API', '嵌套数组', 'map-collect', '递归展平'],
  difficulty: 'hard',
  config: (() => {
    const cfg = baseConfig()
    // 列表 API: search 返回 search_tabs 数组, tab_type=3 频道的 data.book_data 才是书数组
    // 引擎扩展: [tab_type=3] 过滤 + map-collect(跨数组元素取属性展平一层)
    cfg.list.urlTemplate = 'https://example.com/api/search?key=%E5%89%91&tab_type=3&offset={offset:10}'
    cfg.list.itemSelector = { type: 'json', expression: 'data.search_tabs[tab_type=3].data.book_data' }
    cfg.list.fields = {
      name: { type: 'json', expression: 'book_name' },
      author: { type: 'json', expression: 'author' },
      intro: { type: 'json', expression: 'abstract' },
      category: { type: 'json', expression: 'category' },
      cover: { type: 'json', expression: 'thumb_url' },
      // book_id 数字 → 合成详情 API URL(正则后处理)
      bookUrl: {
        type: 'json',
        expression: 'book_id',
        replaceFrom: '^(\\d+)$',
        replaceTo: '/api/detail?book_id=$1',
      },
    }
    cfg.list.pagination = { enabled: false, maxPages: 1 }
    // 书籍详情 API: data.data 层(注意双层 data 嵌套)
    cfg.book.fields = {
      name: { type: 'json', expression: 'data.data.book_name' },
      author: { type: 'json', expression: 'data.data.author' },
      category: { type: 'json', expression: 'data.data.category' },
      keywords: { type: 'json', expression: 'data.data.tags' },
      intro: { type: 'json', expression: 'data.data.abstract' },
      cover: { type: 'json', expression: 'data.data.thumb_url' },
      // creation_status '0'=连载中, 其余=完结
      status: { type: 'json', expression: 'data.data.creation_status', replaceFrom: '^0$', replaceTo: '连载中' },
    }
    // 目录 API: detail → book + &bid=; tocLink 用 const 模板合成
    cfg.toc.tocLink = { type: 'const', expression: '/api/book?book_id={q.book_id}&bid={q.book_id}' }
    // 章节列表是数组的数组(卷→章), * 段递归展平成章节平面
    cfg.toc.itemSelector = { type: 'json', expression: 'data.data.chapterListWithVolume.*' }
    cfg.toc.fields = {
      title: { type: 'json', expression: 'title' },
      itemId: { type: 'json', expression: 'itemId' },
      // const 模板合成章节 URL: {itemId} 同作用域替换, {q.book_id} 书籍页 URL 查询参数
      url: {
        type: 'const',
        expression: '/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id={itemId}&bid={q.book_id}',
      },
    }
    cfg.toc.pagination = { enabled: false, maxPages: 1 }
    // 正文 API: data.content 是 \n 分段纯文本
    cfg.content.fields = {
      content: { type: 'json', expression: 'data.content' },
    }
    cfg.content.pagination = { enabled: false, maxPages: 1 }
    cfg.fetch.engine = 'http'
    cfg.fetch.uaMode = 'custom'
    // 番茄类站点常需移动 UA(参考 legado 书源 Android SearchCraft UA)
    cfg.fetch.customUa =
      'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'
    cfg.fetch.headers = { Accept: 'application/json' }
    cfg.fetch.autoCookie = true
    cfg.fetch.referer = true
    cfg.fetch.timeout = 20000
    cfg.fetch.retries = 2
    cfg.fetch.waitMs = 500
    cfg.fetch.hostGateLimit = 3
    // API 正文为纯文本 \n 分段: plainText 模式剥标签保段落
    cfg.clean.removeSelectors = ['script', 'style', 'iframe', 'ins', 'noscript']
    cfg.clean.adPatterns = [
      '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      '一秒记住.*?免费读',
    ]
    cfg.clean.whitelist = ['p', 'br', 'b', 'strong', 'em', 'i']
    cfg.clean.normalize = true
    cfg.clean.plainText = true
    return cfg
  })(),
  notes: '引擎扩展依赖(Task cc-c): ①json [k=v] 过滤算子(search_tabs[tab_type=3]); ②map-collect 非数字段作用在数组上(跨元素取属性展平一层); ③* 段递归展平(chapterListWithVolume.* → 章节平面); ④runner {offset:N} = (page-1)*N。详见 scripts/seed-rule-fanqie.ts。',
}

// ============================================================
// 模板 8: 七猫/Qimao 风格 (qimao-style)
// 七猫系 API 风格: 接口需要动态 token, tokenUrl 钩子预取后注入查询参数
// 依据: scripts/seed-rule-qimao.ts 真实站点结构(改占位域名)
// ============================================================
const qimaoStyleTemplate: RuleTemplate = {
  id: 'qimao-style',
  name: '七猫/七猫风格',
  description: '七猫系 API 风格: 接口需动态 token, 通过 fetch.tokenUrl 钩子预取后注入查询参数(tokenInjection=url 自动追加 &token=)。适合七猫、(部分)番茄、阅读(legado)书源需 token 的 API。',
  category: 'api',
  tags: ['七猫', 'tokenUrl', 'token注入', 'API', '签名'],
  difficulty: 'hard',
  config: (() => {
    const cfg = baseConfig()
    // 列表 API: 需 token(由 tokenUrl 钩子预取, tokenInjection=url 自动追加 &token=)
    cfg.list.urlTemplate = 'https://example.com/api/bookstore/list?gender=1&page={page}'
    cfg.list.itemSelector = { type: 'json', expression: 'data.list' }
    cfg.list.fields = {
      id: { type: 'json', expression: 'book_id' },
      name: { type: 'json', expression: 'book_name' },
      author: { type: 'json', expression: 'author' },
      intro: { type: 'json', expression: 'abstract' },
      cover: { type: 'json', expression: 'cover' },
      bookUrl: { type: 'const', expression: 'https://example.com/api/book/info?book_id={id}' },
    }
    cfg.list.pagination = { enabled: true, maxPages: 20 }
    // 书籍详情 API
    cfg.book.fields = {
      name: { type: 'json', expression: 'data.book_name' },
      author: { type: 'json', expression: 'data.author' },
      category: { type: 'json', expression: 'data.category' },
      keywords: { type: 'json', expression: 'data.tag' },
      intro: { type: 'json', expression: 'data.abstract' },
      cover: { type: 'json', expression: 'data.cover' },
      status: { type: 'json', expression: 'data.book_status', replaceFrom: '^0$', replaceTo: '连载中' },
      latestChapter: { type: 'json', expression: 'data.last_chapter_name' },
    }
    // 目录 API
    cfg.toc.tocLink = { type: 'const', expression: 'https://example.com/api/book/ChapterList?book_id={q.book_id}' }
    cfg.toc.itemSelector = { type: 'json', expression: 'data.list' }
    cfg.toc.fields = {
      title: { type: 'json', expression: 'name' },
      chapterId: { type: 'json', expression: 'id' },
      url: { type: 'const', expression: 'https://example.com/api/book/Content?book_id={q.book_id}&chapter_id={chapterId}' },
    }
    cfg.toc.pagination = { enabled: false, maxPages: 20 }
    cfg.content.fields = {
      content: { type: 'json', expression: 'data.content' },
    }
    cfg.content.pagination = { enabled: false, maxPages: 1 }
    // 关键: token 预取钩子(bb-d)
    //   tokenUrl: 预取地址(响应体含 token 的任意端点); 支持 {url} 占位符=当前请求URL encodeURIComponent
    //   tokenPattern: 'regex:' 前缀=正则第一捕获组, 否则 JSON 点路径
    //   tokenInjection: 'url'=替换 URL 中 {token} 占位符, 无占位符时追加 ?token=/&token= 查询参数
    cfg.fetch.engine = 'http'
    cfg.fetch.uaMode = 'rotate'
    cfg.fetch.headers = { Accept: 'application/json' }
    cfg.fetch.autoCookie = true
    cfg.fetch.referer = true
    cfg.fetch.timeout = 20000
    cfg.fetch.retries = 2
    cfg.fetch.waitMs = 500
    cfg.fetch.hostGateLimit = 3
    // 示例: 预取 /api/sign?url=<enc(当前URL)> → JSON .data.token → 自动追加 &token=<value>
    cfg.fetch.tokenUrl = 'https://example.com/api/sign?url={url}'
    cfg.fetch.tokenPattern = 'data.token'
    cfg.fetch.tokenInjection = 'url'
    // 镜像域名(可选): 主域失败时按序切换镜像组
    cfg.fetch.mirrorDomains = 'api1.example.com,api2.example.com,api3.example.com'
    // API 正文纯文本: plainText 模式
    cfg.clean.removeSelectors = ['script', 'style', 'iframe', 'ins', 'noscript']
    cfg.clean.adPatterns = ['(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?']
    cfg.clean.whitelist = ['p', 'br', 'b', 'strong', 'em', 'i']
    cfg.clean.normalize = true
    cfg.clean.plainText = true
    return cfg
  })(),
  notes: 'tokenUrl 钩子只适配"可预取 token"形态(会话级/短时级 token); 按章变化的加密参数型(如 bqg713 AES-CBC 签名)需外置转换代理(tokenUrl 可用 {url} 占位符对接, 见 mini-services/bqg713-proxy)。预取结果 30s 进程内缓存, 缓存键含 real URL 防逐章串台。',
}

/**
 * 全部规则模板(8 个)
 * 顺序即模板库 UI 展示顺序: 易→难, CSS→XPath→正则→JSON→JS渲染→具体站点风格
 */
export const RULE_TEMPLATES: RuleTemplate[] = [
  biqugeStandardTemplate,
  biqugeGbkTemplate,
  xpathStructuredTemplate,
  regexFallbackTemplate,
  apiJsonTemplate,
  jsRenderTemplate,
  fanqieStyleTemplate,
  qimaoStyleTemplate,
]

/** 按分类筛选 + 关键字搜索(name/description/tags 任意命中) */
export function filterTemplates(
  templates: RuleTemplate[],
  opts: { category?: RuleTemplateCategory | 'all'; keyword?: string },
): RuleTemplate[] {
  const cat = opts.category ?? 'all'
  const kw = (opts.keyword ?? '').trim().toLowerCase()
  return templates.filter((t) => {
    if (cat !== 'all' && t.category !== cat) return false
    if (!kw) return true
    if (t.name.toLowerCase().includes(kw)) return true
    if (t.description.toLowerCase().includes(kw)) return true
    if (t.tags.some((tag) => tag.toLowerCase().includes(kw))) return true
    return false
  })
}

/** 分类徽章颜色(Tailwind class 段, 模板库 UI 直接拼到 Badge className):
 *  biquge=violet / api=sky / forum=amber / wiki=emerald / custom=zinc */
export const TEMPLATE_CATEGORY_COLORS: Record<RuleTemplateCategory, { badge: string; dot: string; label: string }> = {
  biquge: { badge: 'border-violet-700/60 bg-violet-900/40 text-violet-300', dot: 'bg-violet-400', label: '笔趣阁系' },
  api: { badge: 'border-sky-700/60 bg-sky-900/40 text-sky-300', dot: 'bg-sky-400', label: 'API JSON' },
  forum: { badge: 'border-amber-700/60 bg-amber-900/40 text-amber-300', dot: 'bg-amber-400', label: '论坛体' },
  wiki: { badge: 'border-emerald-700/60 bg-emerald-900/40 text-emerald-300', dot: 'bg-emerald-400', label: '维基型' },
  custom: { badge: 'border-zinc-700/60 bg-zinc-800/60 text-zinc-300', dot: 'bg-zinc-400', label: '通用' },
}

/** 难度徽章颜色 */
export const TEMPLATE_DIFFICULTY_COLORS: Record<RuleTemplateDifficulty, { badge: string; label: string }> = {
  easy: { badge: 'border-emerald-700/60 bg-emerald-900/40 text-emerald-300', label: '简单' },
  medium: { badge: 'border-amber-700/60 bg-amber-900/40 text-amber-300', label: '中等' },
  hard: { badge: 'border-red-700/60 bg-red-900/40 text-red-300', label: '困难' },
}
