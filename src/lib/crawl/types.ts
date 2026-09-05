// ============================================================
// 小说采集系统 — 核心类型定义
// 规则同时支持 CSS选择器 / XPath / 正则表达式 / JSON点路径(json) / 常量模板(const)
// (json/const 适配纯JSON API站: SPA壳+hash路由无SSR, 页面即JSON响应)
// ============================================================

/**
 * 字段提取规则
 *
 * JSON 站点(json/const 类型)专用语法约定(与 parser.ts 实现严格对齐):
 *
 * type='json': expression 为 JSON 点路径, 从响应体(JSON.parse 后)取值 ——
 *   - 点分逐层: `a.b.c` → data.a.b.c; 数字段=数组下标(0基): `items.0.title`
 *   - 空路径或 `.` → 当前根值本身(数组项为纯字符串时用, 如纯章节名数组)
 *   - `[]` 为装饰可剔: `hotlist[].id` ≡ `hotlist.id`
 *   - 首段为空按根处理: 根数组取 `.0.title` ≡ `[0].title`
 *   - 取值结果: 数组→各元素转字符串按\n连接; 标量→String; null/undefined/对象→''
 *   - cc-c 扩展(加法语义, 既有路径零回归):
 *     `[n]` 段内方括号下标: `tabs[0].title` ≡ `tabs.0.title`
 *     `[k=v]` 过滤算子: `search_tabs[tab_type=3]` 保留元素属性值(可 & 连写多条件,
 *           值按 String 宽松比较, 数字/字符串通吃); 非数组值上为无操作
 *     `*` 段: 数组递归展平(数组的数组→元素平面): `chapterListWithVolume.*` → 章节数组
 *
 * type='const': expression 为常量模板字符串, `{name}` 占位符替换后作为字段值 ——
 *   - `{字段名}`  → 同一作用域已提取的同名字段值(列表项/书籍页字段, 如 `{id}`)
 *   - `{index}`   → 1基序号(列表项/目录数组项遍历时; 章节API chapterid=下标+1 场景直接可用)
 *   - `{q.参数名}` → 当前页面 URL 的查询参数(如书页URL /api/book?id=2530 → `{q.id}`)
 *   - 未命中的占位符替换为空串; 后处理(replaceFrom/stripTags等)照常生效
 *   - 典型: bookUrl=`https://x/api/book?id={id}`; 章节URL=`https://x/api/chapter?id={q.id}&chapterid={index}`
 *
 * itemSelector.type='json' 时 expression 指向"数组路径": 支持逗号分隔多路径并集
 * (`hotlist,sort1,uplist` → 各数组顺序拼接, 适配首页多榜单API), 对数组每项跑 fields 提取。
 * cc-c 扩展: 数组路径另支持 map-collect(非数字段作用在数组上=跨元素取该属性并展平一层,
 * 三层嵌套一次下钻: `search_tabs[tab_type=3].data.book_data`)与 `*` 递归展平段
 * (数组的数组→章节平面: `chapterListWithVolume.*`), 语法与 jsonGet 同一契约。
 */
export interface FieldRule {
  /** 提取方式 (json/const 语法见接口头注释) */
  type: 'css' | 'xpath' | 'regex' | 'json' | 'const'
  /** css: 选择器 | xpath: 表达式 | regex: 正则 | json: JSON点路径 | const: 常量模板 */
  expression: string
  /** css/xpath: 取值方式 text/html/href/src/属性名; regex: 捕获组序号; json/const: 无意义 */
  attr?: string
  /** regex 使用标志 (默认 gis) */
  flags?: string
  /** 后处理: 是否剔除HTML标签 */
  stripTags?: boolean
  /** 后处理: 替换规则 源→目标 (支持正则) */
  replaceFrom?: string
  replaceTo?: string
  /** 后处理: 截取第N项(逗号分隔结果) */
  index?: number
}

/** 列表项提取的字段集 */
export interface PageFields {
  [key: string]: FieldRule | undefined
}

/** 页面级规则(列表页/书籍页/目录页/内容页) */
export interface PageRule {
  /** 是否启用该段 */
  enabled: boolean
  /** 列表页专用: 列表地址模板, 支持 {page} 占位符;
   *  cc-c 另支持 {offset:N}(= 第p页偏移量(p-1)*N, 适配番茄聚合API的 offset=(page-1)*10 分页) */
  urlTemplate?: string
  /** 列表项容器规则(列表页/目录页), 从中再提取字段 */
  itemSelector?: FieldRule
  /** 字段规则 */
  fields: PageFields
  /** 目录页专用: 目录在独立页面时, 从书籍页提取"目录页链接" */
  tocLink?: FieldRule
  /** 详情页/内容页翻页规则(预留分页设置): 从当前页提取"下一页"链接 */
  pagination?: {
    enabled: boolean
    /** 下一页链接规则, 若未配置则尝试 a:contains("下一页") */
    nextLink?: FieldRule
    /** 最大合并页数, 防止死循环 */
    maxPages: number
    /** 合并分隔符(内容页用) */
    joinWith?: string
  }
}

/** 反反爬抓取配置 */
export interface FetchConfig {
  /** auto: HTTP失败自动切浏览器渲染; http: 纯HTTP; browser: 强制浏览器 */
  engine: 'auto' | 'http' | 'browser'
  /** ua: rotate 每次随机UA | fixed 固定随机一次 | custom 自定义UA |
   *  mobile 移动UA子集(池内 iPhone/iPad/Android, 同域钉扎) |
   *  desktop 桌面UA子集(池内 Windows/Mac/Linux, 同域钉扎)。
   *  mobile/desktop 两档会按所选 UA 自动配套完整浏览器指纹头组
   *  (sec-ch-ua/sec-ch-ua-mobile/sec-ch-ua-platform/Sec-Fetch-*, ff-b),
   *  rotate/fixed/custom 亦按实际命中的 UA 自动推导(移动 UA 配移动平台指纹) */
  uaMode: 'rotate' | 'fixed' | 'custom' | 'mobile' | 'desktop'
  /** uaMode=fixed 时使用 pool 内随机, =custom 时使用 customUa */
  customUa?: string
  /** 附加请求头 */
  headers?: Record<string, string>
  /** Cookie 字符串 (k=v; k2=v2) */
  cookies?: string
  /** 是否自动跟随 Set-Cookie */
  autoCookie?: boolean
  /** 是否携带 Referer (自动为站点首页) */
  referer?: boolean
  /** Referer 链伪造(ff-b): 开启后各请求优先携带"来源页"Referer 而非站点首页 origin——
   *  目录页带书籍页 Referer、章节页带目录页 Referer、翻页带当前页 Referer
   *  (很多站校验 Referer 同域/同链路, 固定 origin 的裸 Referer 本身是爬虫指纹)。
   *  来源页由 runner/parser 运行时经 refererUrl 逐请求注入; 未注入时回退 origin(零回归) */
  refererChain?: boolean
  /** 当前请求的来源页 URL(refererChain 启用时作 Referer; 运行时逐请求注入, 同 pageFetch
   *  属运行时项 —— sanitizeFetchConfig 白名单不透传, 规则 JSON 同名键自然丢弃) */
  refererUrl?: string
  /** 超时 ms */
  timeout: number
  /** 失败重试次数 */
  retries: number
  /** 浏览器渲染等待选择器(可选) */
  waitSelector?: string
  /** 浏览器渲染等待 ms */
  waitMs?: number
  /** 浏览器渲染后需要点击以展开懒加载内容的选择器(如"点击展开全部目录");
   *  页面无该元素时静默跳过, 适配 AJAX 预取+点击注入型目录站 */
  clickSelector?: string
  /** 触发浏览器渲染的状态码 */
  browserFallbackStatus?: number[]
  /** 同站并发闸门(hostGate)在飞上限, 缺省 3; 1~10 钳制(sanitizeFetchConfig 同步);
   *  同 host 连续失败自动降额(最低1)/连续成功回升(不超过此基准) */
  hostGateLimit?: number
  /** 翻页请求传输回调(可选, 运行时注入): parseToc/parseContent 内部"下一页"抓取的传输实现。
   *  runner 注入过闸版 gateFetch(翻页请求与章节抓取同享同站并发闸, aa-f 已知边界闭环);
   *  未注入时 parser 直连 fetchPage —— rules/test 测试路由保持直连语义不变。
   *  注: 仅运行时注入项, sanitizeFetchConfig 白名单不透传(函数无法 JSON 序列化,
   *  规则 JSON 中的同名键会被白名单自然丢弃, 无注入面) */
  /** 翻页请求注入回调(bb-d, 运行时项): runner 侧过闸抓取。ll-c 扩展可选第二参 refererUrl
   *  —— parseToc/parseContent 翻页第2页起回传上一页 URL, 启用 refererChain 的调用方可把
   *  Referer 从"恒书籍页"升级为"翻页链逐页回溯"(真实浏览器翻页导航语义) */
  pageFetch?: (url: string, refererUrl?: string) => Promise<{ html: string }>
  /** 通用 token 预取钩子(bb-d): 请求前先从 tokenUrl 预取动态 token 再注入请求。
   *  面向"可预取 token"形态(会话级/短时级); 按章变化的加密参数型(如 bqg713 AES)
   *  不属此形态, 需站点专属解密或外置转换代理(tokenUrl 可用 {url} 占位符对接) */
  /** 预取地址: 响应体含 token 的任意端点(通常 JSON API); 支持 {url} 占位符=
   *  当前请求 URL 的 encodeURIComponent(外部转换代理形态) */
  tokenUrl?: string
  /** 提取表达式: 'regex:' 前缀=正则(取第一捕获组, 无捕获组取全匹配), 否则按 JSON 点路径
   *  (语法同 parser.jsonGet, 如 'data.token') */
  tokenPattern?: string
  /** 注入方式: 'url'=替换请求 URL 中 {token}/%7Btoken%7D 占位符(无占位符时追加
   *  ?token=/&token= 查询参数); 'header'=注入请求头 tokenHeaderName(默认 X-Token) */
  tokenInjection?: 'url' | 'header'
  /** tokenInjection='header' 时的请求头名, 缺省 X-Token */
  tokenHeaderName?: string
  /** 出口代理池(dd-a, 反反爬核心): 逗号分隔多条代理, 如
   *  "http://u:p@host:port,http://host2:port2"; 多条时每请求随机轮换(与 UA 池同款
   *  random 模式, 分布可测试验证); 失败按池逐条重试, 全部失败降级直连重试一次。
   *  目标为回环地址(localhost/127.x/::1)时自动豁免直连(本地 mock/token 代理
   *  tokenUrl 经代理转发会出不去)。支持矩阵(fetcher.ts 代理池段实测记录):
   *  bun 运行时 fetch 仅 http/https(socks5 落 curl 链); node 运行时(next dev/prod
   *  实测以 node 运行)fetch 静默忽略 proxy → 代理尝试直接走 curl 链(-x 全形态);
   *  裸 Playwright per-context 全形态/Obscura 路径不支持(配置代理时自动改走裸 Playwright) */
  proxyUrl?: string
  /** 镜像域名自动故障切换(dd-b): 逗号分隔域名列表(可选带端口), 顺序=优先级, 如
   *  "apibi.cc,apiqu.cc,apige.cc"。语义: URL 自身 host + 本列表全部视为同一镜像组,
   *  请求失败且错误为网络层/超时/403/5xx 时按组序重写 host 重试(从下一镜像起, 至多组大小次);
   *  404/2xx/3xx 不触发(404=资源不存在换镜像无意义, 存档裁定)。重写后 URL 走完整
   *  fetch 流程(代理池/回环豁免/UA/Cookie 逻辑照常), token 预取 {url} 占位符自动拿到
   *  重写后 URL → 逐章 token 天然按镜像域重签; 镜像重试在 transport 层不经 hostGate 闸门 */
  mirrorDomains?: string
  /** 采集传输模式(hh-c, 第三方抓取工具接入): 'native'(缺省)=既有引擎链路(bun
   *  fetch/curl/Obscura 全家桶, 零回归); 'scrapling-static'=经 scrapling-bridge 静态
   *  传输(curl_cffi TLS 指纹伪装+浏览器头组); 'scrapling-stealthy'=经 scrapling-bridge
   *  隐身浏览器(patchright 反检测+CF 挑战自动求解); 'scrapling-playwright'=经
   *  scrapling-bridge 裸 Playwright chromium JS 渲染。
   *  scrapling-* 语义: 整次抓取交本机桥服务代发, 目标侧响应(含 4xx/5xx)如实返回 ——
   *  token 预取/autoCookie/Cookie 挑战重试/浏览器升级链等 native 专有步骤跳过(隐身能力
   *  由桥内 Scrapling Fetcher 自身承担); 桥不可达或桥内异常时降级既有 native 链一次。
   *  引擎侧对非法值(非白名单枚举)一律回退 native(sanitize 白名单枚举校验 + fetcher
   *  scraplingModeOf 双重防线); 与 mirrorDomains 组合时逐镜像 host 各走一次桥分流 */
  fetchMode?: string
  /** scrapling 桥地址(fetchMode=scrapling-* 时生效), 缺省 http://127.0.0.1:3012
   *  (可用环境变量 SCRAPLING_BRIDGE_URL 改全局缺省); 桥服务见 mini-services/scrapling-bridge */
  scraplingBridgeUrl?: string
}

/** 内容清洗配置 */
export interface CleanConfig {
  /** 移除的css选择器列表 */
  removeSelectors: string[]
  /** 移除的广告正则(逐行匹配) */
  adPatterns: string[]
  /** 白名单标签, 其余标签剥掉保留文本 */
  whitelist: string[]
  /** 规范段落: 空段落合并/缩进清理 */
  normalize: boolean
  /** 转换为纯文本(去掉所有标签只留换行) */
  plainText: boolean
}

/** 完整规则配置 */
export interface RuleConfig {
  list: PageRule   // 列表页采集(发现书籍)
  book: PageRule   // 书籍信息页(书名/作者/分类/关键词/简介/封面)
  toc: PageRule    // 章节目录页(预留分页设置)
  content: PageRule // 章节内容页(预留分页设置)
  fetch: FetchConfig
  clean: CleanConfig
}

/** 目录项 */
export interface TocItem {
  title: string
  url: string
  /** 分卷名(kk-a): 规则 toc.fields.volume 提取(如番茄 API volume_name); 重排/落库/UI 分组用 */
  volume?: string
}

/** 书籍解析结果 */
export interface ParsedBook {
  name?: string
  author?: string
  category?: string
  keywords?: string
  intro?: string
  cover?: string
  latestChapter?: string
  status?: string
}

/** 章节内容解析结果 */
export interface ParsedContent {
  content: string
  pages: number
}

export const DEFAULT_FETCH_CONFIG: FetchConfig = {
  engine: 'auto',
  uaMode: 'rotate',
  autoCookie: true,
  referer: true,
  timeout: 20000,
  retries: 2,
  waitMs: 800,
  browserFallbackStatus: [403, 412, 429, 503],
  hostGateLimit: 3,
}

export const DEFAULT_CLEAN_CONFIG: CleanConfig = {
  removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle', '.ad', '#ad'],
  adPatterns: [
    '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
    '本章未完.*?点击下一页继续阅读',
    '请记住本书.*?域名',
    '最新章节请到.*?查看',
    '[（(]?完?本[网站站][）)]?',
    '一秒记住.*?免费读',
  ],
  whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  normalize: true,
  plainText: false,
}

export function defaultRuleConfig(): RuleConfig {
  return {
    list: { enabled: true, urlTemplate: '', fields: {}, itemSelector: undefined },
    book: { enabled: true, fields: {} },
    toc: {
      enabled: true,
      fields: {},
      pagination: { enabled: false, maxPages: 20, joinWith: '' },
    },
    content: {
      enabled: true,
      fields: {},
      pagination: { enabled: false, maxPages: 10, joinWith: '<br/>' },
    },
    fetch: { ...DEFAULT_FETCH_CONFIG },
    clean: JSON.parse(JSON.stringify(DEFAULT_CLEAN_CONFIG)),
  }
}

export function parseRuleConfig(raw: string | null | undefined): RuleConfig {
  const base = defaultRuleConfig()
  if (!raw) return base
  try {
    const cfg = JSON.parse(raw)
    // 防脏数据: JSON 根不是纯对象(数组/数字/字符串)时直接回退默认配置,
    // 避免展开数组把 "0"/"1" 数字索引键扩散进结果对象
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return base
    // 深消毒: 各段逐字段白名单重建(脏 JSON 序列化残留/字符串数字/未知键全部剔除),
    // 与实采 fetcher/解析器期望的形状严格对齐 —— 浅合并会让 cfg.fetch 里的未知键
    // (如运行时对象误存)与脏类型直通引擎
    const sFetch = sanitizeFetchConfig(cfg.fetch)
    const sClean = sanitizeCleanConfig(cfg.clean)
    const sList = sanitizePageRule(cfg.list)
    const sBook = sanitizePageRule(cfg.book)
    const sToc = sanitizePageRule(cfg.toc)
    const sContent = sanitizePageRule(cfg.content)
    return {
      ...base,
      fetch: { ...base.fetch, ...sFetch },
      clean: sClean ?? base.clean,
      list: sList ?? base.list,
      book: sBook ?? base.book,
      toc: sToc ?? base.toc,
      content: sContent ?? base.content,
    }
  } catch {
    return base
  }
}

// ============================================================
// 深消毒(白名单重建): 任务/规则数据经 JSON.parse 后类型不可信 —— 脏值
// (字符串数字 "3"/signal 引用序列化残留/数组根/超长串)曾造成 retries 按
// 字符串拼接("3"+1="31" 次)、fetch 参数 TypeError 等真实缺陷。此处以
// "逐字段白名单+钳制"重建, 未知键全部丢弃, 供 runner 实采链路与
// rules/test 测试路由共用
// ============================================================

/** 安全数字: 非数字/NaN/Infinity 返回 undefined; 字符串数字("20000")按 Number 转换 */
function safeNum(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return undefined
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 安全布尔: 仅接受真布尔(防 "false" 字符串恒真) */
function safeBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

/** 安全字符串: 非字符串丢弃, 钳长度 */
function safeStr(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.slice(0, max)
  return s
}

/**
 * 单行头值安全化(ee-d): 剥除 CR/LF/NUL 等控制字符 —— 防护面:
 * ① 请求头/UA/Cookie 注入拼接(HTTP 请求走私/断链) ② 入库规则被测试路由/引擎双出口消费,
 * 修复必须在 sanitize 层而非仅 fetch 构造层(defense in depth, bb 轮 fetch 层修复的补全面)。
 * 保留空格化语义: CR/LF 置空而非丢弃前后文(与 bb 轮 fetch 层同口径), NUL 直接剥除。
 */
function safeSingleLine(v: string): string {
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?|\n/g, ' ')
}

/** HTTP 头键安全化(ee-d): 仅保留 RFC 7230 token 字符, 非法键返回 undefined(丢弃) */
function safeHeaderKey(v: string): string | undefined {
  const s = v.replace(/[^!#$%&'*+\-.^_`|~0-9A-Za-z]/g, '')
  return s.length > 0 ? s : undefined
}

/** 安全字符串数组: 过滤非字符串项, 钳项数与单项长度 */
function safeStrArr(v: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v
    .filter((x): x is string => typeof x === 'string')
    .slice(0, maxItems)
    .map((x) => x.slice(0, maxLen))
  return out
}

/** FieldRule 消毒: type 白名单/表达式/属性/后处理参数逐字段重建 */
export function sanitizeFieldRule(v: unknown): FieldRule | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const r = v as Record<string, unknown>
  const type = r.type
  if (type !== 'css' && type !== 'xpath' && type !== 'regex' && type !== 'json' && type !== 'const') return undefined
  const expression = safeStr(r.expression, 1000)
  if (expression === undefined || !expression.trim()) return undefined
  const out: FieldRule = { type, expression }
  const attr = safeStr(r.attr, 100)
  if (attr !== undefined) out.attr = attr
  const flags = safeStr(r.flags, 10)
  if (flags !== undefined) out.flags = flags
  const replaceFrom = safeStr(r.replaceFrom, 1000)
  if (replaceFrom !== undefined) out.replaceFrom = replaceFrom
  const replaceTo = safeStr(r.replaceTo, 1000)
  if (replaceTo !== undefined) out.replaceTo = replaceTo
  const stripTags = safeBool(r.stripTags)
  if (stripTags !== undefined) out.stripTags = stripTags
  const index = safeNum(r.index, 0, 100)
  if (index !== undefined) out.index = index
  return out
}

/** PageRule 消毒: 四段页面规则(itemSelector/tocLink/fields/pagination)白名单重建 */
export function sanitizePageRule(v: unknown): PageRule | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const r = v as Record<string, unknown>
  const enabled = safeBool(r.enabled)
  const out: PageRule = { enabled: enabled ?? true, fields: {} }
  const urlTemplate = safeStr(r.urlTemplate, 1000)
  if (urlTemplate !== undefined) out.urlTemplate = urlTemplate
  const itemSelector = sanitizeFieldRule(r.itemSelector)
  if (itemSelector) out.itemSelector = itemSelector
  const tocLink = sanitizeFieldRule(r.tocLink)
  if (tocLink) out.tocLink = tocLink
  if (r.fields && typeof r.fields === 'object' && !Array.isArray(r.fields)) {
    const src = r.fields as Record<string, unknown>
    const fields: PageFields = {}
    let n = 0
    for (const [k, fr] of Object.entries(src)) {
      if (n >= 16) break // 字段数上限(正常规则 ≤8 字段)
      const sanitized = sanitizeFieldRule(fr)
      if (sanitized) { fields[k.slice(0, 40)] = sanitized; n++ }
    }
    out.fields = fields
  }
  if (r.pagination && typeof r.pagination === 'object' && !Array.isArray(r.pagination)) {
    const p = r.pagination as Record<string, unknown>
    const nextLink = sanitizeFieldRule(p.nextLink)
    out.pagination = {
      enabled: safeBool(p.enabled) ?? false,
      maxPages: safeNum(p.maxPages, 1, 500) ?? 20,
      joinWith: safeStr(p.joinWith, 200) ?? '',
      ...(nextLink ? { nextLink } : {}),
    }
  }
  return out
}

/** FetchConfig 消毒: 引擎/UA模式白名单 + 数值钳制(字符串数字转真数字) */
export function sanitizeFetchConfig(v: unknown): Partial<FetchConfig> {
  const out: Partial<FetchConfig> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  const r = v as Record<string, unknown>
  if (r.engine === 'auto' || r.engine === 'http' || r.engine === 'browser') out.engine = r.engine
  if (
    r.uaMode === 'rotate' || r.uaMode === 'fixed' || r.uaMode === 'custom' ||
    r.uaMode === 'mobile' || r.uaMode === 'desktop'
  ) out.uaMode = r.uaMode
  const customUaRaw = safeStr(r.customUa, 300)
  if (customUaRaw !== undefined) {
    const customUa = safeSingleLine(customUaRaw)
    if (customUa) out.customUa = customUa
  }
  if (r.headers && typeof r.headers === 'object' && !Array.isArray(r.headers)) {
    const src = r.headers as Record<string, unknown>
    const headers: Record<string, string> = {}
    let n = 0
    for (const [k, val] of Object.entries(src)) {
      if (n >= 30) break
      const key = safeHeaderKey(k.slice(0, 100))
      const s = safeStr(val, 1000)
      if (key && s !== undefined) {
        const value = safeSingleLine(s)
        if (value) { headers[key] = value; n++ }
      }
    }
    if (n > 0) out.headers = headers
  }
  const cookiesRaw = safeStr(r.cookies, 4000)
  if (cookiesRaw !== undefined) {
    const cookies = safeSingleLine(cookiesRaw)
    if (cookies) out.cookies = cookies
  }
  const autoCookie = safeBool(r.autoCookie)
  if (autoCookie !== undefined) out.autoCookie = autoCookie
  const referer = safeBool(r.referer)
  if (referer !== undefined) out.referer = referer
  // Referer 链伪造(ff-b): 规则级开关可序列化入库; refererUrl 为运行时逐请求注入项
  // (同 pageFetch 口径)刻意不进白名单
  const refererChain = safeBool(r.refererChain)
  if (refererChain !== undefined) out.refererChain = refererChain
  const timeout = safeNum(r.timeout, 1000, 120_000)
  if (timeout !== undefined) out.timeout = timeout
  const retries = safeNum(r.retries, 0, 5)
  if (retries !== undefined) out.retries = retries
  const waitSelector = safeStr(r.waitSelector, 300)
  if (waitSelector !== undefined) out.waitSelector = waitSelector
  const waitMs = safeNum(r.waitMs, 0, 60_000)
  if (waitMs !== undefined) out.waitMs = waitMs
  const clickSelector = safeStr(r.clickSelector, 300)
  if (clickSelector !== undefined) out.clickSelector = clickSelector
  if (Array.isArray(r.browserFallbackStatus)) {
    const statuses = r.browserFallbackStatus
      .map((x) => safeNum(x, 100, 599))
      .filter((x): x is number => x !== undefined)
      .slice(0, 10)
    if (statuses.length) out.browserFallbackStatus = statuses
  }
  // hostGate 同站并发闸门上限: 1~10 钳制(与 hostgate.clampLimit 口径一致),
  // parseRuleConfig 经 base.fetch 合并缺省 3
  const hostGateLimit = safeNum(r.hostGateLimit, 1, 10)
  if (hostGateLimit !== undefined) out.hostGateLimit = hostGateLimit
  // 通用 token 预取钩子(bb-d): 白名单同步(字符串钳长/枚举白名单), 非法类型丢弃。
  // pageFetch 为运行时注入项刻意不进白名单(函数不可 JSON 序列化, 规则 JSON 同名键自然丢弃)
  const tokenUrl = safeStr(r.tokenUrl, 1000)
  if (tokenUrl !== undefined) out.tokenUrl = tokenUrl
  const tokenPattern = safeStr(r.tokenPattern, 300)
  if (tokenPattern !== undefined) out.tokenPattern = tokenPattern
  if (r.tokenInjection === 'url' || r.tokenInjection === 'header') out.tokenInjection = r.tokenInjection
  const tokenHeaderName = safeStr(r.tokenHeaderName, 100)
  if (tokenHeaderName !== undefined) out.tokenHeaderName = tokenHeaderName
  // 出口代理池(dd-a): 钳长 2000(多条列表形态) + 逐条 scheme 白名单校验
  // (http/https/socks5(h)/socks4(a) + host:port 形态, 与 fetcher.parseProxyPool 同口径);
  // 合法条目去空去重上限 10 条后回写, 全部非法则整字段丢弃
  const proxyUrl = safeStr(r.proxyUrl, 2000)
  if (proxyUrl !== undefined) {
    const valid: string[] = []
    const seen = new Set<string>()
    for (const raw of proxyUrl.split(',')) {
      const s = raw.trim()
      if (!s || seen.has(s) || !isValidProxySpec(s) || valid.length >= 10) continue
      seen.add(s)
      valid.push(s)
    }
    if (valid.length) out.proxyUrl = valid.join(',')
  }
  // 镜像域名组(dd-b): 钳长 2000(多条列表形态) + 逐条域名校验(host[:port] 形态, 不带
  // scheme/path, 单条 ≤500) + 去空去重(大小写不敏感, 统一小写)上限 10 条后回写,
  // 全部非法则整字段丢弃 —— 口径对齐 proxyUrl 惯例
  const mirrorDomains = safeStr(r.mirrorDomains, 2000)
  if (mirrorDomains !== undefined) {
    const valid: string[] = []
    const seen = new Set<string>()
    for (const raw of mirrorDomains.split(',')) {
      const s = raw.trim().toLowerCase()
      if (!s || seen.has(s) || !isValidMirrorHost(s) || valid.length >= 10) continue
      seen.add(s)
      valid.push(s)
    }
    if (valid.length) out.mirrorDomains = valid.join(',')
  }
  // 采集传输模式(hh-c): 枚举白名单校验 —— 非法值丢弃(undefined = 回退 native 链零回归);
  // 'native' 显式接受(语义等价缺省)。scraplingBridgeUrl: safeStr 钳长 + http(s) URL 形态
  // 校验 + 单行化(防 CR/LF 注入), 非法形态整字段丢弃
  if (
    r.fetchMode === 'native' || r.fetchMode === 'scrapling-static' ||
    r.fetchMode === 'scrapling-stealthy' || r.fetchMode === 'scrapling-playwright'
  ) out.fetchMode = r.fetchMode
  const scraplingBridgeUrlRaw = safeStr(r.scraplingBridgeUrl, 300)
  if (scraplingBridgeUrlRaw !== undefined) {
    const scraplingBridgeUrl = safeSingleLine(scraplingBridgeUrlRaw)
    if (scraplingBridgeUrl && /^https?:\/\/\S+$/i.test(scraplingBridgeUrl)) out.scraplingBridgeUrl = scraplingBridgeUrl
  }
  return out
}

/** 镜像条目形态校验(types.ts 消毒与 fetcher.ts 运行时组解析共用口径, 改动需同步):
 *  无 scheme/无 path/无空白的 host[:port] 形态(host 标签字母数字连字符, 允许纯数字 IP
 *  如 127.0.0.1 与 localhost), 单条 ≤500 字符; 不支持 IPv6 字面量(冒号与端口定界冲突, 列表形态固有) */
export function isValidMirrorHost(s: string): boolean {
  return s.length <= 500 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/.test(s)
}

// ============================================================
// regex 安全校验(gg-a): 规则侧正则有四个引擎直编入口 ——
//   ① FieldRule.expression(type='regex', parser.regexExtract/regexExtractAll)
//   ② FieldRule.replaceFrom(任意 type 的后处理, parser.applyTransform)
//   ③ FetchConfig.tokenPattern 的 'regex:' 形态(fetcher.extractToken)
//   ④ CleanConfig.adPatterns(cleaner.removeAdLines)
// 双面问题: (a)非法正则被引擎 try/catch 静默忽略 = 静默失效面(规则保存成功但永不生效);
// (b)灾难型嵌套量词((a+)+ 类)可挂住单线程事件循环(test 路由 90s 护栏只 race 不中断在途正则)。
// 本校验供 API 保存入口(POST/PUT /api/admin/rules)拒绝非法/危险正则(400 指明字段与原因),
// 是入口防线; 引擎侧 try/catch 静默忽略语义保留(运行时韧性兜底, 双层防线)。
// 零误伤要求: 规则库全部存量规则的正则字段必须全数通过(verify-gg-a-regex 实证)
// ============================================================

export interface RegexSafetyResult {
  ok: boolean
  reason?: string
}

/** 无界量词(+ 号、星号、{n,} 开区间)识别: 返回量词长度(含懒惰标记 ?), 非量词返回 0 */
function unboundedQuantifierLen(p: string, i: number): number {
  const c = p[i]
  if (c === '+' || c === '*') return p[i + 1] === '?' ? 2 : 1
  if (c === '{') {
    const m = /^\{(\d+),(\d*)\}/.exec(p.slice(i))
    if (m && m[2] === '') return m[0].length + (p[i + m[0].length] === '?' ? 1 : 0)
  }
  return 0
}

/** 跳过一个正则原子(转义序列/字符类/嵌套组/单字符), 返回原子结束下标(不含其量词) */
function skipRegexAtom(p: string, i: number, end: number): number {
  const c = p[i]
  if (c === '\\') return Math.min(end, i + 2)
  if (c === '[') {
    let j = i + 1
    if (p[j] === '^') j++
    if (p[j] === ']') j++ // 首位 ] 为字面量
    while (j < end && p[j] !== ']') {
      if (p[j] === '\\') j++
      j++
    }
    return Math.min(end, j + 1)
  }
  if (c === '(') {
    let depth = 1
    let j = i + 1
    while (j < end && depth > 0) {
      const cj = p[j]
      if (cj === '\\') { j += 2; continue }
      if (cj === '[') {
        let k = j + 1
        if (p[k] === '^') k++
        if (p[k] === ']') k++
        while (k < end && p[k] !== ']') {
          if (p[k] === '\\') k++
          k++
        }
        j = k + 1
        continue
      }
      if (cj === '(') depth++
      else if (cj === ')') depth--
      j++
    }
    return Math.min(end, j)
  }
  return Math.min(end, i + 1)
}

/**
 * 组内容(from..to)按顶层 | 分支检查: 任一分支的末原子带无界量词 → true。
 * 覆盖 (a+)+、(X*)×星、(a{2,})+、(?:\w+)+ 等显式嵌套, 以及 (a+|b)+ 型"分支歧义"形态
 * (末分支虽无嵌套, 但量词分支可变长 + 外层无界循环 = 同型灾难回溯)。
 * 保守口径: 有界外层({n,m})/末原子有界(\d+\.)+ 均不报警, 避免误伤正常模式
 */
function groupHasUnboundedTail(p: string, from: number, to: number): boolean {
  let i = from
  let branchUnbounded = false
  let anyBranchUnbounded = false
  while (i < to) {
    if (p[i] === '|') {
      anyBranchUnbounded = anyBranchUnbounded || branchUnbounded
      branchUnbounded = false
      i++
      continue
    }
    const atomEnd = skipRegexAtom(p, i, to)
    const q = unboundedQuantifierLen(p, atomEnd)
    branchUnbounded = q > 0
    i = atomEnd + q
  }
  return anyBranchUnbounded || branchUnbounded
}

/** 顶层 | 分支的字面量串提取(rr-c3): 分支内仅含普通字符与单字符转义(无量词/类/组/元字符)
 *  时返回解码后的字面量串; 含任何元字符(量词/类/组/锚/点/类缩写)返回 null(保守不参与判定) */
function literalBranchOf(p: string, from: number, to: number): string | null {
  let out = ''
  let i = from
  while (i < to) {
    const c = p[i]
    if (c === '\\') {
      if (i + 1 >= to) return null
      const n = p[i + 1]
      if ('dDwWsSbB'.includes(n)) return null // 类缩写非字面量
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n
      i += 2
      continue
    }
    if ('+*?[](){}|^$.'.includes(c)) return null
    out += c
    i++
  }
  return out
}

/** 分支前缀歧义(rr-c3): 组带无界量词时, 若存在两个字面量分支互为前缀(如 a 与 aa),
 *  匹配路径数随输入长度指数增长 —— (a|aa)+ 是 OWASP 经典灾难形态, 与 (a+)+ 同级;
 *  生产引擎运行时 node/V8 无 JSC 式回溯预算(probe-rr-c3-redos 实测: 41 字符输入 47s,
 *  53 字符 15s 跑不完), 原校验器仅认显式嵌套量词漏过此类。分支拆分复用 skipRegexAtom
 *  (嵌套组/类整体消耗, '|' 必为组内顶层), 字面量分支互为前缀即报警(保守口径) */
function branchesHavePrefixAmbiguity(p: string, from: number, to: number): boolean {
  const literals: (string | null)[] = []
  let i = from
  let start = from
  while (i < to) {
    const atomEnd = skipRegexAtom(p, i, to)
    i = atomEnd + unboundedQuantifierLen(p, atomEnd)
    if (i < to && p[i] === '|') {
      literals.push(literalBranchOf(p, start, i))
      i++
      start = i
    }
  }
  literals.push(literalBranchOf(p, start, to))
  const lits = literals.filter((s): s is string => s !== null && s.length > 0)
  for (let a = 0; a < lits.length; a++) {
    for (let b = 0; b < lits.length; b++) {
      if (a !== b && lits[b].startsWith(lits[a])) return true
    }
  }
  return false
}

/** 嵌套量词检测(保守启发式):
 *  ① 结构检查: 未转义组 (...) 后跟无界量词, 且组内任一分支以无界量词原子收尾;
 *  ② 分支歧义检查(rr-c3 bug#4): 组带无界量词且组内两个字面量分支互为前缀((a|aa)+ 型,
 *     OWASP 经典灾难形态, 与显式嵌套同级 —— 生产引擎运行时 node/V8 无 JSC 式回溯预算,
 *     probe-rr-c3-redos 实测 41 字符输入 47s、53 字符 15s 跑不完);
 *  ③ 形态检查: [+*])[+*{ 与 cleaner.removeAdLines 运行时跳过闸门同款
 *     (该闸门会静默跳过此形态的模式 —— API 层若放行会造成"校验通过但运行时静默失效") */
export function hasNestedQuantifier(pattern: string): boolean {
  const n = pattern.length
  let i = 0
  const groupStack: number[] = []
  while (i < n) {
    const c = pattern[i]
    if (c === '\\') { i += 2; continue }
    if (c === '[') {
      let j = i + 1
      if (pattern[j] === '^') j++
      if (pattern[j] === ']') j++
      while (j < n && pattern[j] !== ']') {
        if (pattern[j] === '\\') j++
        j++
      }
      i = j + 1
      continue
    }
    if (c === '(') { groupStack.push(i); i++; continue }
    if (c === ')') {
      const start = groupStack.pop()
      i++
      const q = unboundedQuantifierLen(pattern, i)
      if (q > 0 && start !== undefined) {
        if (groupHasUnboundedTail(pattern, start + 1, i - 1)) return true
        if (branchesHavePrefixAmbiguity(pattern, start + 1, i - 1)) return true
      }
      i += q
      continue
    }
    i++
  }
  // 形态检查(与 cleaner 运行时闸门同口径): 量词紧跟闭括号再跟量词/开花括号
  if (/[+*]\s*\)\s*[+*{]/.test(pattern)) return true
  return false
}

/**
 * 正则安全校验(gg-a): ①编译试错(非法 → 拒绝, 消灭"保存成功但静默失效"面)
 * ②嵌套量词启发式(灾难回溯 → 拒绝)。flags 传引擎实际生效的标志位
 * (expression=规则 flags 或缺省 gis/gi, replaceFrom=g, adPatterns=gi, tokenPattern 无标志),
 * 使编译试错与运行时行为严格一致(含非法标志位字符的拒绝)。
 * 空模式返回 ok(由各字段的必填校验另行把关)
 */
export function validateRegexSafety(pattern: string, flags?: string): RegexSafetyResult {
  if (typeof pattern !== 'string' || pattern === '') return { ok: true }
  const effFlags = typeof flags === 'string' ? flags : ''
  try {
    new RegExp(pattern, effFlags)
  } catch (e) {
    const msg = (e as Error)?.message?.slice(0, 120) || '编译失败'
    return { ok: false, reason: `正则非法(${msg})` }
  }
  if (hasNestedQuantifier(pattern)) {
    return { ok: false, reason: '疑似灾难型嵌套量词(形如 (a+)+ 或分支歧义 (a|aa)+), 会引发指数级回溯挂起采集线程' }
  }
  return { ok: true }
}

/** 正则命中面描述(rules API 400 信息用) */
export interface RegexIssue {
  field: string
  reason: string
}

/** FieldRule 正则面收集: expression(仅 regex 型) + replaceFrom(任意型, 引擎统一按正则跑) */
function collectFieldRuleIssues(prefix: string, rule: unknown, issues: RegexIssue[]): void {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return
  const r = rule as Record<string, unknown>
  if (r.type === 'regex' && typeof r.expression === 'string') {
    const res = validateRegexSafety(r.expression, typeof r.flags === 'string' ? r.flags : 'gis')
    if (!res.ok) issues.push({ field: `${prefix}.expression`, reason: res.reason || '不安全' })
  }
  if (typeof r.replaceFrom === 'string' && r.replaceFrom !== '') {
    const res = validateRegexSafety(r.replaceFrom, 'g')
    if (!res.ok) issues.push({ field: `${prefix}.replaceFrom`, reason: res.reason || '不安全' })
  }
}

function collectPageRuleIssues(prefix: string, page: unknown, issues: RegexIssue[]): void {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return
  const p = page as Record<string, unknown>
  collectFieldRuleIssues(`${prefix}.itemSelector`, p.itemSelector, issues)
  collectFieldRuleIssues(`${prefix}.tocLink`, p.tocLink, issues)
  if (p.fields && typeof p.fields === 'object' && !Array.isArray(p.fields)) {
    for (const [k, fr] of Object.entries(p.fields as Record<string, unknown>)) {
      collectFieldRuleIssues(`${prefix}.fields.${k}`, fr, issues)
    }
  }
  if (p.pagination && typeof p.pagination === 'object' && !Array.isArray(p.pagination)) {
    collectFieldRuleIssues(`${prefix}.pagination.nextLink`, (p.pagination as Record<string, unknown>).nextLink, issues)
  }
}

/**
 * 规则配置全量正则安全审查(gg-a): 覆盖四入口 —— 四段 PageRule 的 regex 型 expression 与
 * 全部 replaceFrom / fetch.tokenPattern 的 'regex:' 形态 / clean.adPatterns 逐条。
 * 入参为保存接口收到的 config 原始形态(对象或 JSON 字符串; 字符串解析失败返回空 ——
 * 运行时 parseRuleConfig 对不可解析配置本就回退默认, 无正则执行面)。
 * 返回全部问题(空数组=通过)
 */
export function collectRegexIssues(config: unknown): RegexIssue[] {
  const issues: RegexIssue[] = []
  let cfg: unknown = config
  if (typeof cfg === 'string') {
    try { cfg = JSON.parse(cfg) } catch { return issues }
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return issues
  const r = cfg as Record<string, unknown>
  collectPageRuleIssues('list', r.list, issues)
  collectPageRuleIssues('book', r.book, issues)
  collectPageRuleIssues('toc', r.toc, issues)
  collectPageRuleIssues('content', r.content, issues)
  if (r.fetch && typeof r.fetch === 'object' && !Array.isArray(r.fetch)) {
    const f = r.fetch as Record<string, unknown>
    const tp = f.tokenPattern
    if (typeof tp === 'string' && tp.startsWith('regex:')) {
      const res = validateRegexSafety(tp.slice(6))
      if (!res.ok) issues.push({ field: 'fetch.tokenPattern', reason: res.reason || '不安全' })
    }
  }
  if (r.clean && typeof r.clean === 'object' && !Array.isArray(r.clean)) {
    const c = r.clean as Record<string, unknown>
    if (Array.isArray(c.adPatterns)) {
      c.adPatterns.forEach((p, i) => {
        if (typeof p !== 'string' || !p) return
        const res = validateRegexSafety(p, 'gi')
        if (!res.ok) issues.push({ field: `clean.adPatterns[${i}]`, reason: res.reason || '不安全' })
      })
    }
  }
  return issues
}

/** 代理条目形态校验(types.ts 侧与 fetcher.ts 运行时池解析共用口径):
 *  scheme 白名单 + 无空白/逗号的 host[:port][:path] 形态, 单条 ≤500 字符 */
function isValidProxySpec(s: string): boolean {
  return s.length <= 500 && /^(https?|socks5h?|socks4a?):\/\/[^\s,]+$/.test(s)
}

/** CleanConfig 消毒: 选择器/广告正则/白名单标签三数组+布尔重建 */
export function sanitizeCleanConfig(v: unknown): CleanConfig | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const r = v as Record<string, unknown>
  const out: CleanConfig = {
    removeSelectors: safeStrArr(r.removeSelectors, 30, 300) ?? [...DEFAULT_CLEAN_CONFIG.removeSelectors],
    adPatterns: safeStrArr(r.adPatterns, 30, 1000) ?? [...DEFAULT_CLEAN_CONFIG.adPatterns],
    whitelist:
      safeStrArr(r.whitelist, 30, 20)?.map((t) => t.trim().toLowerCase()).filter(Boolean) ??
      [...DEFAULT_CLEAN_CONFIG.whitelist],
    normalize: safeBool(r.normalize) ?? true,
    plainText: safeBool(r.plainText) ?? false,
  }
  return out
}
