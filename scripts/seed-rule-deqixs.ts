// ============================================================
// 种子脚本: 得奇小说网 (deqixs.cc) 采集规则 (Task rr-a)
// 用法: bun run scripts/seed-rule-deqixs.ts
// 幂等: 同名规则先删后建; export{} + import.meta.main 守卫(可被 verify 脚本 import 规则配置)
//
// ================= 结构依据(rr-a 真网实测, 前置情报=worklog qq-b 条目) =================
// 站点: 杰奇系 GBK 老站, 列表/书页/目录三段直连零反爬, 正文层双墙:
//   ①章节页 div#chapter-content SSR 为空(20KB 内联渲染脚本 24行/页懒加载, 桥无 scroll/evaluate 不可救)
//   ②真实内容 = /scripts/chapter.js.php?aid&cid&referrer → 三参数(chapterToken/timestamp/nonce)
//     → /modules/article/ajax2.php 同参 → GBK JSON {status:1, data.content: 全文HTML}
// ★ajax2 三重校验(rr-a 实测, qq-b 时代"裸三参数即成"已失效):
//   1) 缺 X-Requested-With/Referer 头 → "仅支持网页端访问"
//   2) Referer 头 ≠ 签发时 referrer 参数值 → "Token验证失败"(token 与 referrer 值绑定, 每章独立)
//   3) 旧 timestamp → "请求已过期"
//   → 每章动态三参数, 引擎 token 预取钩子(单 token 槽位+仅 {url} 占位)不可表达 →
//   外置转换代理 mini-services/deqixs-proxy(端口 3014, qimao-proxy 同形态)承载全链路:
//   章节 URL → 三参数签发 → ajax2 → GBK 解码 → HTML→纯文本 → UTF-8 JSON
//   启动: cd mini-services/deqixs-proxy && bun run start; /health 自检 selfTestOk
//
// 六段设计:
//   list   = 直连 /sort/1/{page}.html(玄幻分类, div.bookbox×30/页, div.pages a.next 翻页)
//   book   = 直连书页 /books/{id}/(h1.booktitle + p.booktag + og:novel:* meta + img.thumbnail)
//   toc    = 书籍页即目录页(不配 tocLink, runner 回退书籍页解析; 单个 dl.book.chapterlist
//            内两段: h2最新章节 13条(12章倒序+dd.visible-xs"查看全部章节"死锚) + h2全部章节目录
//            正序全量) — itemSelector 用 dd:not(.visible-xs) 排死锚; 文档序乱序由引擎
//            reorderToc 自愈(URL 去重保首现 + 章号提取排序, 无号章排尾)
//   content= 指向代理 /content?u={章节URL}; toc url 字段 replaceFrom '^' 前置代理前缀
//            (HTML 目录模式无 sibling 变量上下文, 不能用 const {href} 模板; '^' 前置对
//            绝对/相对章节链均成立), 代理侧只接受 deqixs /books/{aid}/{cid}.html 形态(防开放代理)
//   fetch  = engine http(纯本地代理+直连, 无浏览器面), hostGate 2 保守
//   clean  = 站点自带 FILTER_RULES(章节页内联脚本取证) + 通用域名尾巴; plainText 归一
// ============================================================
export {}
export const RULE_NAME = '得奇小说网 (deqixs.cc)·直连+签名代理正文'
export const PROXY_BASE = 'http://127.0.0.1:3014'

export const ruleConfig = {
  list: {
    enabled: true,
    // 分类页: /sort/{cat}/{page}.html(cat: 1玄幻 2都市 3仙侠 4历史 5科幻 6诸天无限 7女生 …)
    // 此处取玄幻(1)约32页; 换分类改 URL 即可
    urlTemplate: 'https://www.deqixs.cc/sort/1/{page}.html',
    itemSelector: { type: 'css', expression: 'div.bookbox' },
    fields: {
      name: { type: 'css', expression: 'h4.bookname a' },
      author: { type: 'css', expression: 'div.author', replaceFrom: '^作者：', replaceTo: '' },
      intro: { type: 'css', expression: 'div.update', replaceFrom: '^\\s*简介：', replaceTo: '' },
      latestChapter: { type: 'css', expression: 'div.cat a' },
      // 列表页无封面 img(封面对象源在书页 img.thumbnail), 由 book 段补全
      bookUrl: { type: 'css', expression: 'h4.bookname a', attr: 'href' },
    },
    pagination: {
      enabled: true,
      nextLink: { type: 'css', expression: 'div.pages a.next', attr: 'href' },
      maxPages: 5,
    },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: 'css', expression: 'h1.booktitle' },
      author: { type: 'css', expression: 'p.booktag a.red' },
      // og:novel:status = 连载/完结 → 项目口径归一(连载→连载中)
      status: { type: 'css', expression: 'meta[property="og:novel:status"]', attr: 'content', replaceFrom: '^连载$', replaceTo: '连载中' },
      category: { type: 'css', expression: 'meta[property="og:novel:category"]', attr: 'content' },
      latestChapter: { type: 'css', expression: 'meta[property="og:novel:latest_chapter_name"]', attr: 'content' },
      cover: { type: 'css', expression: 'img.thumbnail', attr: 'src' },
      // p.bookintro 内嵌移动端封面 img(stripTags 剥掉) + 纯文本简介
      intro: { type: 'css', expression: 'p.bookintro', stripTags: true },
    },
  },
  toc: {
    enabled: true,
    // 目录就在书页(不配 tocLink → runner 书籍页即目录页回退, runner.ts extractToc 步骤2)
    itemSelector: { type: 'css', expression: 'dl.chapterlist dd:not(.visible-xs)' },
    fields: {
      title: { type: 'css', expression: 'a' },
      // '^' 前置代理前缀: 绝对链(https://www.deqixs.cc/books/a/c.html)与相对链(/books/..)通吃;
      // 代理侧 parseChapterUrl 只接受 deqixs /books/{aid}/{cid}.html 形态(防开放代理滥用)
      url: { type: 'css', expression: 'a', attr: 'href', replaceFrom: '^', replaceTo: 'http://127.0.0.1:3014/content?u=' },
    },
    // 书页单页全量目录, 无翻页
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: {
      // 代理已完成 三参数签发+GBK 解码+HTML→纯文本(\n 分段) → 纯文本 JSON(番茄/七猫代理同范式)
      content: { type: 'json', expression: 'content' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  fetch: {
    engine: 'http',
    // list/book/toc 直连 deqixs(桌面 UA 即可, 站点不挑 UA), content 打本地代理(UA 无关)
    uaMode: 'custom',
    customUa: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    headers: { Accept: 'application/json,text/html;q=0.9,*/*;q=0.8' },
    autoCookie: false,
    referer: false,
    timeout: 30000,
    retries: 1,
    waitMs: 200,
    // content 段每章=代理串行 2 次上游请求(chapter.js.php+ajax2), 同站(=代理)在飞钳 2 保守起步
    hostGateLimit: 2,
  },
  clean: {
    removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
    // 站点章节页内联脚本 CONFIG.FILTER_RULES 原文取证(其客户端同款过滤) + 通用尾巴
    adPatterns: [
      '更新不易.*?章节！',
      '速\\s*\\.?\\s*读\\s*\\.?\\s*谷',
      'shudugu\\.org',
      '看最新完整章節，就上速讀谷',
      '本章节未完.*?请订阅',
      '请记住本书.*?域名',
      '最新章节请到.*?查看',
      '一秒记住.*?免费读',
    ],
    whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u'],
    // 代理已输出纯文本 \n 分段: plainText 剥标签保段落, 存库即干净文本
    normalize: true,
    plainText: true,
  },
}

// 127.0.0.1 显式 IPv4: 本环境 next dev 仅监听 IPv4(bun fetch localhost 会先试 ::1 → ConnectionRefused)
const BASE = 'http://127.0.0.1:3000'

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
        '得奇小说网(deqixs.cc)杰奇系 GBK 站: list/book/toc 三段直连 + content 段走外置签名代理。' +
        '正文层双墙: 章节页 SSR 空(懒加载渲染) + 真实内容走 chapter.js.php 三参数(token/timestamp/nonce)→ajax2.php GBK JSON; ' +
        'ajax2 三重校验(XRW/Referer 头, token 与签发 referrer 绑定, timestamp 限时) → 每章动态三参数超出声明式引擎表达力(rr-a 真网实测)。 ' +
        '⚠ 依赖本机转换代理 mini-services/deqixs-proxy(端口 3014, 三参数签发+GBK 解码+HTML→纯文本): ' +
        'toc url 字段以 replaceFrom ^ 前置 http://127.0.0.1:3014/content?u= 指向代理, 代理只接受 deqixs /books/{aid}/{cid}.html 章节形态。 ' +
        'toc 在书页单 dl.chapterlist 两段(最新12倒序+全量正序), dd.visible-xs"查看全部章节"死锚以 :not() 排除, ' +
        '文档序乱序由引擎 reorderToc 去重+章号排序自愈。 ' +
        '代理启动: cd mini-services/deqixs-proxy && bun run start; /health 自检 selfTestOk/upstreamReachable。',
      enabled: true,
      config: ruleConfig,
    }),
  })
  const json = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)
}

if (import.meta.main) main()
