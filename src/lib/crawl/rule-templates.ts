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
      // R31-1C: 笔趣阁系标准 .image img 直接 SSR src; 懒加载站点(用 jquery.lazyload.js)
      //   改 attr 为 'data-original', lazysizes.js 站点改 attr 为 'data-src'; 实采前
      //   在测试面板核对封面 URL 是否为占位图(nocover.svg/blank.gif 即懒加载未触发)
      cover: { type: 'css', expression: '.image img', attr: 'src' },
      intro: { type: 'css', expression: '.intro', attr: 'text' },
    }
    // R31-1C: 笔趣阁系标准翻页按钮 = .pages a.next(文本"下一页"), 引擎兜底
    //   a:contains("下一页") 同样命中(中文站点惯例); maxPages 20 适中, 过深会触发
    //   部分笔趣阁系站点 IP 限流(单 IP 连续抓 50+ 页易被 nginx 限速 429)
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
  notes: '使用前必改: cfg.list.urlTemplate 改成目标站列表页 URL; 站点若是 GBK 编码请改用「笔趣阁GBK变体」模板。R27-1A: 章节分卷结构(源站目录显示卷标题分组)时, 在 cfg.toc.fields 添加 volume 字段提取卷名, 例: volume: { type: "css", expression: ".volume-name", attr: "text" }; 卷名随章节落库后, BookView 目录会按卷分组渲染(卷头独立区块 + 卷内 3 列剧集列表)。',
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
    // R31-1C: 结构化站点翻页按钮常为 ul.pagination li a.next(Bootstrap 系) 或
    //   .pager a.next(自建 CMS); 引擎兜底 a:contains("Next") 命中英文站; 中文站
    //   a:contains("下一页") 命中. maxPages 30 适中(英文站常无 WAF, 30 页 ×
    //   50 本/页 = 1500 本发现量充足)
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
    // R31-1C: 正则兜底模板翻页按钮无固定 class(站点 HTML 不规范, 翻页按钮各异);
    //   引擎兜底 a:contains("下一页") 命中绝大多数中文站; maxPages 20 适中(此模板
    //   用于 HTML 极不规范站, 翻页链常畸形, 过深易触发死循环保护)
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
    // R27-1B 修复 P2: 原正则 `<div[^>]*id="content"[^>]*>([\\s\\S]*?)</div>\\s*<div` 要求
    // 在 </div> 之后必须有另一个 <div, 章末 EOF(</body></html>) 场景匹配失败 → 内容提取
    // 空字符串, 用户看到"四段测试全部 0 字"误以为规则写错。修法: 用非捕获 alternation
    // 允许 </div> 之后跟: 另一个 <div(原语义), </body(常见 EOF 结构), 或 $(EOF)。
    // 嵌套 div 内容选择器仍走原语义(第一个 </div>+<div 之间); EOF 兜底仅在末尾 div 场景触发
    cfg.content.fields = {
      content: { type: 'regex', expression: '<div[^>]*id="content"[^>]*>([\\s\\S]*?)</div>(?:\\s*<div|\\s*</body|$)', flags: 'is' },
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
    // R31-1C: JSON API 列表通常单页返回固定量(bqg713 /api/index 单页 58 本, fanqie
    //   search 单页 10 本); 启用翻页需源站支持 ?page={page} 分页参数, 但 jqg713 类
    //   并集 hotlist,sort1~6 一次返回无分页 → 默认关闭. 若源站真分页(如七猫 rank
    //   page 参数被忽略也是单页), 操作员改 enabled:true + maxPages:20 即可
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
      // R27-1A: 分卷名提取 —— * 递归展平后, 章节对象本身的 volume_name 字段会被保留(同名
      // 卷下每章同名, 重复无害; 不同卷的章带不同卷名 → 在 BookView.tsx 按 volume 字段连续
      // 相同分组显示卷头). 真实番茄 API 若 chapter 对象无 volume_name 字段(平行数组
      // volumeNameList[] 模式), 需自定义转换层(mini-services 重组 JSON 把卷名注入每章);
      // 当前模板按 verify-ll-c-listfields.ts 验证过的模式配置, 待 API 恢复后按实际响应调整.
      // 不配置此字段时, 章节落库 volume 为空 → BookView 渲染为单卷不分组的目录(零回归)
      volume: { type: 'json', expression: 'volume_name' },
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
  notes: '引擎扩展依赖(Task cc-c): ①json [k=v] 过滤算子(search_tabs[tab_type=3]); ②map-collect 非数字段作用在数组上(跨元素取属性展平一层); ③* 段递归展平(chapterListWithVolume.* → 章节平面); ④runner {offset:N} = (page-1)*N。详见 scripts/seed-rule-fanqie.ts。R27-1A: 已预置 toc.fields.volume(volume_name 字段提取)以保留分卷名, 真实 API 若章节对象本身无 volume_name(平行 volumeNameList[] 模式)需改用 mini-services 转换层重组 JSON。',
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
    // R31-1C: 七猫 rank/leader-board 类 API 的 page 参数实测被忽略(单页 50 本), 但
    //   模板默认 enabled=true + maxPages:20 留作通用配置: 若操作员对接真实分页 API
    //   (?page={page} 真翻页)可保留; 若发现 page 参数无效(单页重复)可关掉. 引擎
    //   R3-24 同 path 不同 query 5 次累计即停, 防过深. JSON API 无 HTML 翻页按钮,
    //   pagination.nextLink 不配置, 引擎只跑 maxPages 次同模板 URL(每页 {page} 替换)
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

// ============================================================
// 模板 9: TLS 指纹伪装 (tls-impersonate)  R29-1A 新增
// 适用: WAF 按 JA3/JA4 TLS 指纹封锁常见 HTTP 客户端的站点(uukanshu.cc / DataDome /
//       Akamai 等)。引擎 fetchViaCurl 在 cfg.fetch.curlImpersonateProfile='chrome' 时,
//       若系统已装 curl-impersonate-chrome 二进制则切换(完整模拟 Chrome TLS 握手);
//       未装则静默降级系统 curl(零回归)。
// 注: 与 R29-1B curl-impersonate-bridge(3018 Python curl_cffi)互补 —— 本模板走二进制级
//       集成(0 额外进程, 4GB 沙箱友好), R29-1B 走 Python 桥级集成(更细版本控制)
// ============================================================
const tlsImpersonateTemplate: RuleTemplate = {
  id: 'tls-impersonate',
  name: 'TLS 指纹伪装(curl-impersonate)',
  description: 'WAF 按 JA3/JA4 TLS 指纹封锁的站点(uukanshu/DataDome/Akamai 系)。引擎在 curl 链切换为 curl-impersonate-chrome 二进制, 完整模拟 Chrome TLS ClientHello + HTTP/2 SETTINGS 帧。二进制未装时静默降级系统 curl, 失败后再降级到 curl-impersonate 桥(Python curl_cffi, 端口 3018)。',
  category: 'custom',
  tags: ['TLS指纹', 'curl-impersonate', 'JA3', 'JA4', 'WAF', 'Chrome伪装'],
  difficulty: 'medium',
  config: (() => {
    const cfg = biqugeStandardTemplate.config
    const copy: RuleConfig = JSON.parse(JSON.stringify(cfg))
    // R29-1A 核心: 在 fetchViaCurl 层切换二进制(系统 curl → curl-impersonate-chrome)
    // 二进制可寻性由 fetcher.pickCurlBinary 探测 + 60s 缓存, 不可寻时静默降级(零回归)
    copy.fetch.curlImpersonateProfile = 'chrome'
    // R29-1B 核心: 配 tlsProfile='chrome120' 让 curl-impersonate 桥(curl_cffi Python 绑定)
    // 在 R29-1A 二进制不可寻 / curl 失败后自动启用时使用 Chrome 120 的 TLS 指纹
    // (curl_cffi 提供 chrome99~131 精确版本号, 与 R29-1A 二进制的 chrome profile 互补)
    // 形成双保险: 二进制可寻 → R29-1A 走二进制(0 进程开销); 不可寻 → R29-1B 走 Python 桥
    // (curl_cffi 库, 30s 超时上限, 桥内 venv 自带无需系统装二进制)
    copy.fetch.tlsProfile = 'chrome120'
    // 同站并发收敛到 2(TLS-strict WAF 对并发敏感, 高并发易触发 IP 封禁)
    copy.fetch.hostGateLimit = 2
    copy.fetch.perHostConcurrency = 2
    // 退避策略: 403 直接升级浏览器(TLS 指纹虽伪装但源站仍可能用其他维度判爬)
    copy.fetch.smartBackoff = true
    // 指纹抖动启用(每请求 sec-ch-ua 末位版本号随机, 防 WAF 字面精确匹配)
    copy.fetch.fingerprintJitter = true
    return copy
  })(),
  notes: `依赖: ①系统装 curl-impersonate-chrome 二进制(R29-1A 走二进制路径, 0 额外进程, 4GB 沙箱友好, 见 lwthiker/curl-impersonate); ②mini-services/curl-impersonate-bridge:3018 + .venv 装 curl_cffi(R29-1B 走 Python 桥, curl_cffi 库提供 chrome99~131/firefox102~120/safari15_3~17_2_ios 精确版本号)。两者互补: 二进制可寻时 R29-1A 优先(更省内存), 不可寻时 R29-1B 兜底; 任一可用即可绕过 JA3-strict WAF。两者都不可用时不破坏 8 级降级链(静默降级 fetch-relay/scrapling/Obscura/uc-bridge/moli-bridge)。tlsProfile="chrome120" 同时被 R29-1B fetchViaCurlImpersonate(桥内 curl_cffi)与引擎既有的 h2Fingerprint observe-vs-expected 对照消费。`,
}

// ============================================================
// 模板 10: Hard-WAF 站点 (hard-waf-cloak)  R29-1A 新增
// 适用: Obscura / uc-bridge / scrapling-stealthy 都失败的 hard-WAF 站点
//       (hetushu/shucong/wanbenshenzhan 系)。显式 fetchMode='cloak-browser' 走
//       puppeteer-extra + stealth plugin + 自研 12 stealth flags(3-tier 隐身)。
// 注: cloak-browser 是 opt-in 通道, 不参与 native 8 级降级链(操作员显式选择)
// ============================================================
const hardWafCloakTemplate: RuleTemplate = {
  id: 'hard-waf-cloak',
  name: 'Hard-WAF 站点(cloak-browser 最大档)',
  description: 'Obscura/uc-bridge/scrapling-stealthy 都失败的 hard-WAF 站(hetushu/shucong 系)。显式 fetchMode=cloak-browser 走 puppeteer-extra + stealth plugin + 3-tier 隐身(canvas/audio/WebGL/IMEI-like device ID noise)。cloak-browser 端口 3020。',
  category: 'custom',
  tags: ['WAF', 'cloak-browser', 'puppeteer', 'stealth', 'CF挑战', 'hard-WAF'],
  difficulty: 'hard',
  config: (() => {
    const cfg = biqugeStandardTemplate.config
    const copy: RuleConfig = JSON.parse(JSON.stringify(cfg))
    // R29-1A 核心: 显式 opt-in cloak-browser 引擎(与 moli/scrapling-* 同级并列)
    // 不破坏 8 级降级链: fetchMode='cloak-browser' 时整次抓取走桥, 桥不可达/失败 → 落 native 链一次
    copy.fetch.fetchMode = 'cloak-browser'
    // maximum 档: 12 stealth flags 全开(canvas/audio/WebGL noise + request 拦截 +
    //   font/screen color 指纹 + hardware concurrency + device memory + IMEI-like device ID)
    // 适用: hetushu/shucong/wanbenshenzhan 等 DataDome/CF Pro 级 WAF
    copy.fetch.cloakTier = 'maximum'
    // 浏览器渲染慢, 加大超时到 60s(maximum 档含 request 拦截 + 挑战求解常需 10~25s)
    copy.fetch.timeout = 60000
    copy.fetch.retries = 1
    // 同站并发收敛到 1(cloak-browser MAX_CONCURRENT=2, hard WAF 站点对并发极敏感)
    copy.fetch.hostGateLimit = 1
    copy.fetch.perHostConcurrency = 1
    // 浏览器路径不需要 fallbackStatus 升级(已经是最高级引擎)
    copy.fetch.browserFallbackStatus = []
    // 指纹轮换: 每 50 请求换 UA + viewport + timezone + language
    copy.fetch.fingerprintRotationInterval = 50
    // 思考时间: 模拟人类阅读节奏(每请求前 1~3s 随机等待)
    copy.fetch.thinkTimeMs = 3000
    return copy
  })(),
  notes: '依赖: mini-services/cloak-browser(端口 3020, R29-1A 修复原与 uc-bridge 3016 端口冲突 → 3020)。puppeteer + puppeteer-extra + puppeteer-extra-plugin-stealth 全装在 mini-services/cloak-browser/。cloak-browser 用持久 browser 实例 + per-session 噪声种子 + LRU 200 会话上限防内存泄漏(4GB 沙箱友好)。3-tier 档位: lite(快, 低安全站点) / standard(中, CF 站点) / maximum(慢, hard WAF); 本模板用 maximum。cloak-browser 失败时降级 native 链一次(零回归)。',
}

// ============================================================
// 模板 11: Trafilatura 正文兜底 (trafilatura-fallback)  R29-1A 新增, R29-1C 修复
// 适用: 规则选择器易失效的站点(源站改版频繁 / 反爬诱饵内容 / 模板变更未及时更新规则)。
//       cleaner 标准清洗产出过短(<200 字符)时, 调 trafilatura 桥做规则无关提取兜底。
// 注: 与标准 cleaner 互补 —— 规则命中走规则(保真度最高), 规则失效走 trafilatura(启发式
//     兜底), 避免规则未及时更新导致整章节空入库。
// R29-1C 修复: 字段名 trafilaturaFallback → trafilaturaFallback(修正 R29-1A 拼写错误
//   "o"→"i") + 桥 URL 3021 → 3019(R29-1C 实际占用 3019, 3018 已被 curl-impersonate 占)
// ============================================================
const trafilaturaFallbackTemplate: RuleTemplate = {
  id: 'trafilatura-fallback',
  name: 'Trafilatura 正文兜底',
  description: '规则选择器易失效的站点(源站改版频繁/反爬诱饵内容)。cleaner 标准清洗产出过短(<200 字符)时, 调 trafilatura 桥(端口 3019)做规则无关提取兜底。规则命中走规则, 规则失效走 trafilatura, 避免空入库。',
  category: 'custom',
  tags: ['trafilatura', '正文提取', '规则无关', '兜底', '反爬诱饵', '源站改版'],
  difficulty: 'medium',
  config: (() => {
    const cfg = biqugeStandardTemplate.config
    const copy: RuleConfig = JSON.parse(JSON.stringify(cfg))
    // R29-1A → R29-1C 修复: 启用 trafilatura 兜底开关(修正拼写错误 "o"→"i")
    // rule.clean.trafilaturaFallback=true 时, runner 在 cleanContentHtml 调用后,
    // 若 plain text length < 200 且原 HTML > 2KB, 调 tryTrafilaturaExtract 兜底.
    // 桥返回的纯文本(显著长于标准结果 2 倍以上)→ 转 <p> 包裹后入库
    copy.clean.trafilaturaFallback = true
    // 桥 URL 可显式覆盖(缺省 http://127.0.0.1:3019, 由 mini-services/trafilatura-bridge 提供)
    // R29-1C 修正端口 3021 → 3019(实际占用, 3018 已被 curl-impersonate-bridge R29-1B 占)
    copy.fetch.trafilaturaBridgeUrl = 'http://127.0.0.1:3019'
    return copy
  })(),
  notes: '依赖: mini-services/trafilatura-bridge(端口 3019, R29-1C 新增; 纯 Python + lxml, ~10MB RSS, 4GB 沙箱友好)。trafilatura 已装在系统 Python 3.12(v2.2.0+), 桥启动命令 `bash mini-services/start-all.sh` 自动拉起。触发条件保守: 仅在标准结果疑似失效时启用(plain text < 200 + 原 HTML > 2KB), 桥不可达/失败 → 静默回退原结果(零回归)。采用条件: trafilatura 结果 > 标准结果 2 倍以上才用(防误判: trafilatura 也可能提取到导航/侧栏短文本)。R29-1C 修复 R29-1A 两处 P0 BUG: ① 字段名 trafilaturaFallback(拼写错误 "o"→"i" 修正)② 桥端口 3021 → 3019(实际占用)。',
}

// ============================================================
// 模板 12: Trafilatura 正文优先 (trafilatura-first)  R29-1C 新增
// 适用: 结构复杂 / 无清晰容器 / 混杂标签 / 模板渲染破损的源站 — Trafilatura 段落分类
//       算法优于手动 cheerio DOM 剥壳 + adPatterns 正则清洗链。cleanContentHtmlAsync
//       入口先调 trafilatura 桥提取正文, 失败 → 自动降级回 cheerio 链(零回归)。
// 注: 与 trafilatura-fallback 模板互补:
//   - 本模板(useTrafilatura=true "先"模式): trafilatura first, cheerio fallback
//   - trafilatura-fallback(trafilaturaFallback=true "兜底"模式): cheerio first,
//     trafilatura 仅在结果过短时兜底
// 适合"trafilatura 比 cleaner 更准"的源站; 不适合简单结构源站(cheerio 链更可控)
// ============================================================
const trafilaturaFirstTemplate: RuleTemplate = {
  id: 'trafilatura-first',
  name: 'Trafilatura 正文优先',
  description: '结构复杂/无清晰容器/混杂标签/模板渲染破损的源站。Trafilatura 启发式段落分类算法优于手动 cheerio DOM 剥壳 + adPatterns 正则清洗链。cleanContentHtmlAsync 入口先调 trafilatura 桥(端口 3019)提取正文, 失败自动降级回 cheerio 链(零回归)。',
  category: 'custom',
  tags: ['trafilatura', '正文提取', '规则无关', '先模式', '混杂HTML', '模板破损'],
  difficulty: 'medium',
  config: (() => {
    const cfg = biqugeStandardTemplate.config
    const copy: RuleConfig = JSON.parse(JSON.stringify(cfg))
    // R29-1C 核心: 启用 trafilatura 先模式(useTrafilatura=true)
    // runner 在 cleanContentHtmlAsync 入口先调 trafilatura 桥提取正文;
    // 桥返回非空文本 → 喂入既有 plainText 段落规整链(跳过 cheerio DOM 剥壳)
    // 桥不可达/失败/空文本 → 自动降级回同步 cleanContentHtml(cheerio 链)
    copy.clean.useTrafilatura = true
    // pruneXPath: 可选预剥常见噪声节点(与 removeSelectors 互补; trafilatura 在算法
    // 阶段剥, cheerio 在 DOM 阶段剥; 两者叠加防遗漏)
    // 不在此模板默认配 pruneXPath(留给操作员按站点实际配置), 仅启用 useTrafilatura
    // 桥 URL 可显式覆盖(缺省 http://127.0.0.1:3019)
    copy.fetch.trafilaturaBridgeUrl = 'http://127.0.0.1:3019'
    return copy
  })(),
  notes: '依赖: mini-services/trafilatura-bridge(端口 3019, R29-1C 新增)。trafilatura 已装在系统 Python 3.12(v2.2.0+)。Trafilatura 是 Leipzig 信息学院开源的纯 Python + lxml 正文提取库, 无 ML 模型, ~10MB RSS, 4GB 沙箱友好。cleanContentHtmlAsync 走 trafilatura first 时: ① 调桥 POST /extract 提取正文文本(60s 可用性缓存)② 把纯文本喂入既有 plainText 段落规整链(removeAdLines + 缩进规整 + 控制字符剥离 + 繁简转换)③ 跳过 cheerio DOM 剥壳阶段(trafilatura 已剥离干净, 重复剥壳反而破坏段落结构)。桥不可达/失败/空文本 → 降级回 cheerio 链(零回归)。与 trafilatura-fallback 模板互斥: useTrafilatura=true 时 trafilaturaFallback 字段被忽略(先模式优先)。可选 cfg.clean.trafilaturaPruneXPath 配置 XPath 列表(如 ["//div[@class=ad]", "//nav"])让 trafilatura 在正文提取前从 DOM 删除指定节点(与 cfg.clean.removeSelectors 互补, 防遗漏)。',
}

/**
 * 全部规则模板(12 个, R29-1A 新增 3 个反反爬增强模板 + R29-1C 新增 1 个 trafilatura 先模式)
 * 顺序即模板库 UI 展示顺序: 易→难, CSS→XPath→正则→JSON→JS渲染→具体站点风格→反反爬增强
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
  tlsImpersonateTemplate,
  hardWafCloakTemplate,
  trafilaturaFallbackTemplate,
  trafilaturaFirstTemplate,
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
