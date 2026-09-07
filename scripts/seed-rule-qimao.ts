// ============================================================
// 种子脚本: 七猫官方API (wtzw.com) 采集规则 (Task qq-d)
// 用法: bun run scripts/seed-rule-qimao.ts
// 幂等: 同名规则先删后建; export{} + import.meta.main 守卫(可被 verify 脚本 import 规则配置)
//
// ================= 结构依据(Legado 书源反译, 真网实测) =================
// 参考 scripts/archive/reference-shuyuan-7698-qimao.json — yckceo 7698.json
// 「⭐七猫[官方]v3.1✨」(bookSourceUrl=https://api-bc.wtzw.com#七猫官方API)。
// 官方双域 API: api-bc.wtzw.com(search/detail/leader-board) + api-ks.wtzw.com(toc/content)。
//
// ★ 翻译判定: 全端点强制逐请求 MD5 双签名(实测无 sign: search=44010102 参数错误/
//   detail=401/toc+content=44010120 验签失败) + 正文 AES-128-CBC 解密
//   (data.content=Base64(IV16B+密文), key='242ccb8230d709e1', IV=密文前16B) —
//   超出项目声明式规则引擎(css/xpath/regex/json/const)表达力 → 按 bqg713 外置
//   转换代理先例(cc-d2)由 mini-services/qimao-proxy(端口3013)承载签名+解密,
//   规则六段全部指向代理(纯 JSON, 引擎 json/const 型)。
//
// Legado→项目 对照(逐字段):
//   searchUrl(@js 签名构造 /search/v1/words) → 代理 /search?wd=&page= 通道 + list 段
//     改用发现页 /rank(leader-board 单页50本, 上游 page 参数被忽略 → 分页禁用);
//     项目 list.urlTemplate 无关键词占位符, 搜索型发现属引擎能力边界(留档)
//   ruleSearch.bookList $.data.books → list.itemSelector json 'books'(代理归一化)
//   ruleSearch.name/author/coverUrl/intro original_title/original_author/image_link/intro
//     → list.fields name/author/cover/intro(排行榜项无 author/intro, 由详情段补全, ll-c2 兜底)
//   ruleSearch.kind $.score&&$.ptags&&$.sub_title → list.fields category(归一化 ptags/榜单标签)
//   ruleSearch.bookUrl @js('/api/v4/book/detail?'+签名) → list.fields.bookUrl const '/detail?bid={id}'
//   ruleBookInfo.init data.book → book 段 json 前缀 'book.'
//   ruleBookInfo.name title@put:{bid:id} → book.fields.name + {q.bid} 查询参数形态(tocLink 引用)
//   ruleBookInfo.tocUrl @js(chapter-list+签名) → toc.tocLink const '/toc?bid={q.bid}'
//   ruleBookInfo.author/coverUrl/intro/lastChapter → book.fields author/cover/intro/latestChapter
//   ruleBookInfo.intro <useweb>卡片HTML(阅读APP展示层) → 放弃(项目 intro 存纯文本)
//   ruleBookInfo/ruleSearch wordCount words_num → 放弃(项目 Book 模型无书籍级字数)
//   ruleToc.chapterList $.data.chapter_lists → toc.itemSelector json 'chapters'
//   ruleToc.chapterName $.title → toc.fields.title json 'title'
//   ruleToc.chapterUrl data:;base64(cid/cmd5) 参数暂存 → toc.fields.url const
//     '/content?bid={q.bid}&cid={cid}'(两阶段 const; content_md5 未参与 content API, 放弃)
//   ruleToc.updateTime $.words 字 → 放弃(项目目录项不存字数)
//   ruleContent.content @js(签名+AES 解密) → content.fields.content json 'content'(代理解密纯文本)
//   ## 排除规则: 本书源原文无 ## → clean.adPatterns 留空(解密纯文本无广告形态)
// ============================================================
export {}
export const RULE_NAME = '七猫官方API (wtzw.com)·Legado7698·签名代理'

export const ruleConfig = {
  list: {
    enabled: true,
    // 发现页=大热榜男频(leader-board 上游忽略 page → 单页50本, 分页禁用)
    // 换榜: rec_list/must_read_list/craft_list/end_list/new_list/up_list… tab_type 1=男频 2=女频
    urlTemplate: 'http://127.0.0.1:3013/rank?rank_type=hot_list&tab_type=1',
    itemSelector: { type: 'json', expression: 'books' },
    fields: {
      name: { type: 'json', expression: 'name' },
      author: { type: 'json', expression: 'author' },
      intro: { type: 'json', expression: 'intro' },
      category: { type: 'json', expression: 'category' },
      cover: { type: 'json', expression: 'cover' },
      status: { type: 'json', expression: 'status' },
      // 供 const bookUrl 模板引用(两阶段提取)
      id: { type: 'json', expression: 'id' },
      bookUrl: { type: 'const', expression: '/detail?bid={id}' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: 'json', expression: 'book.name' },
      author: { type: 'json', expression: 'book.author' },
      category: { type: 'json', expression: 'book.category' },
      keywords: { type: 'json', expression: 'book.keywords' },
      intro: { type: 'json', expression: 'book.intro' },
      cover: { type: 'json', expression: 'book.cover' },
      status: { type: 'json', expression: 'book.status' },
      latestChapter: { type: 'json', expression: 'book.latestChapter' },
    },
  },
  toc: {
    enabled: true,
    // 书源 tocUrl(js 构造 api-ks chapter-list+签名) → 代理 /toc?bid={q.bid}
    tocLink: { type: 'const', expression: '/toc?bid={q.bid}' },
    itemSelector: { type: 'json', expression: 'chapters' },
    fields: {
      title: { type: 'json', expression: 'title' },
      // 章节id(万古神帝形态 16526676570001) 供 const url 模板引用
      cid: { type: 'json', expression: 'cid' },
      url: { type: 'const', expression: '/content?bid={q.bid}&cid={cid}' },
    },
    // 目录API单次全量返回, 无翻页
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: {
      // 代理已完成 签名+AES-128-CBC 解密 → 纯文本 \n 分段(与番茄聚合 API 同范式)
      content: { type: 'json', expression: 'content' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  fetch: {
    engine: 'http',
    // 本地签名代理回环直连; UA 无关紧要, 取书源客户端同款 okhttp 形态
    uaMode: 'custom',
    customUa: 'okhttp/3.12.0',
    headers: { Accept: 'application/json' },
    autoCookie: false,
    referer: false,
    timeout: 30000,
    retries: 1,
    waitMs: 200,
    // 上游限速未知, 同站(=代理)在飞钳 2 保守起步
    hostGateLimit: 2,
  },
  clean: {
    removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
    // 书源原文无 ## 排除规则; 正文=解密纯文本无广告形态(出版书 EPUB 由代理如实报错)
    adPatterns: [],
    whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u'],
    // 纯文本 \n 分段: plainText 剥标签保段落, 存库即干净文本(番茄/bqg713 同范式)
    normalize: true,
    plainText: true,
  },
}

const BASE = 'http://localhost:3000'

async function main() {
  // 幂等: 同名规则先删后建
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`)
  const listJson = (await listRes.json()) as { ok: boolean; data?: unknown }
  const rules = (Array.isArray(listJson.data) ? listJson.data : []) as { id: string; name: string }[]
  const existing = rules.find((r) => r.name === RULE_NAME)
  if (existing) {
    const del = await fetch(`${BASE}/api/admin/rules/${existing.id}`, { method: 'DELETE' })
    const delJson = (await del.json()) as { ok: boolean }
    console.log('旧规则已删除:', existing.id, delJson.ok)
  }
  const res = await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: RULE_NAME,
      description:
        '七猫官方API(api-bc/api-ks.wtzw.com)四层JSON采集: rank发现页/detail/toc/content。' +
        '结构依据 Legado 书源 yckceo 7698.json「⭐七猫[官方]v3.1✨」反译并真网实测。' +
        '⚠ 依赖本机签名代理 mini-services/qimao-proxy(端口3013, MD5双签名+正文AES-128-CBC解密, key=242ccb8230d709e1): ' +
        '上游全端点强制逐请求验签, 声明式规则无法表达 → 六段指向代理(引擎 json/const 型)。' +
        'list=leader-board大热榜男频50本(上游忽略page分页禁用, /search 通道留代理); 出版书(source非空)正文为EPUB如实报错。' +
        '代理启动: cd mini-services/qimao-proxy && bun run start; /health 自检 selfTestOk/apiReachable。',
      enabled: true,
      config: ruleConfig,
    }),
  })
  const json = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)
}

if (import.meta.main) main()
