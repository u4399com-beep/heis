// 种子脚本: 稻草人书屋 (www.iidcr.com) 直连采集规则
// 用法: bun run scripts/seed-rule-iidcr.ts
// 侦察结论(实测 curl+bun fetch+引擎 2026-08-31, 无 Legado 书源参考全侦察):
//  - 站点形态: Cloudflare CDN(DYNAMIC 不缓存)+源站 Apache(DedeCMS 系, robots 有 /plus//include),
//    UTF-8, 传统多页 HTML 站, 正文/目录全在 HTML 源码里(非 JS 壳) —— http 引擎直采;
//    旧域名 www.dcrbk.com 301→iidcr.com(sitemap 内即以 dcrbk 指路, 非独立镜像站)
//  - ★UA 门禁(本站唯一反爬点, yybsw 同款先例): 桌面 Chrome UA 主页 /index.html 200 但
//    一切深路径(/nav/* /book/*) 403(Apache 源站级, 303B "403 Forbidden", 无 Set-Cookie
//    无挑战页); 移动 UA / Baiduspider UA 深路径全 200 —— fetch 配置钉 uaMode=custom
//    +移动 Chrome UA(实测三层全通), 绝不可用 rotate(池内桌面 UA 会 403)
//  - URL 体系: 分类列表 /nav/{slug}.html(love/bl/qihuan/wuxia/kehuan/dushi/lishi/kongbu/light
//    共 9 类), 翻页 /nav/sub{slug}-{n}.html(★sublove-1.html 与 love.html 同内容同尺寸,
//    页 1 别名实测 200 → urlTemplate 可用统一形态); 书籍 /book/p{id}/; 章节
//    /book/p{id}/{cid}.html, 章节子页 {cid}_{n}.html(第1章 3 子页实测); 作者页
//    /author/{名}.html; 下载页 /txt/{bid}.html(纯下载页不采)
//  - ★目录形态: 全量目录内嵌书籍页 #all-chapter div.item, 无翻页锚; 实测最大样本
//    /book/p25202/ 异常魔兽见闻录 1205 章全量单页(>999 不截断, shudugu 999 截断陷阱
//    不存在于本站); "最新章节"区块同为 .item 但在 div.chapter 内, 不在 #all-chapter
//    作用域内(计数 195=末章号实锤无混入)
//  - ★正文翻页: 章节子页 {cid}_{n}.html, 顶部按钮组 <a><button>下一页</button></a> 驱动,
//    末页变"下一章"(实测 7231478_3 与 7222309_2) → parseContent 兜底 a:contains("下一页")
//    不含"下一章"自然收敛; 分页 ul.pagination 同链路备用
//  - 正文纯净(站自称无弹窗广告): #cont-body 纯 <p> 段落; 唯一固定尾注
//    "有能力者，请一定订阅和购买正版书籍支持作者…"每个子页尾都追加(合并后重复),
//    已入 adPatterns 清洗; 无域名灌水/无脚本残留
//  - 四层(实测全通):
//    * 列表 = /nav/sublove-{page}.html(言情类, 每页 10 本×5 页) div.b10 div.media
//      (h4 a 书名+bookUrl / media-info 简介 / media-left img 封面; ★主列表无作者字段,
//      作者由 book 段补齐, 不影响实采)
//    * 书籍页 = /book/p{id}/: h1.book-name a 书名 + a[href*="/author/"] 作者 +
//      div.dark:contains("状态") "状态：完结/连载"原文交 smartCompleteDetect +
//      div.dark:contains("最近更新") a 最新章 + div.book-detail 简介 + media-left img 封面
//    * 目录 = 内嵌书籍页 #all-chapter div.item > a(195/1164/1205 章三样本全量)
//    * 正文 = div#cont-body(p 段落), 子页 {cid}_{n}.html maxPages 10
const BASE = 'http://localhost:3000'

// 测试探针:
//  - list: 言情分类第 1 页(/nav/sublove-1.html 200 直达, 10 本 ≥10)
//    ★rules/test 接口占位符坑: 传已展开 URL 最稳(cc-b 结论), config.urlTemplate 仍用
//    {page} 形态供实采 runner 自行展开
//  - book: /book/p25225/ 老实人，但娇气[快穿](中原逐鹿, 完结, 195 章, 全字段)
//  - toc: 同书籍页(195 章 ≥50)
//  - content: 第一章 /book/p25225/7231478.html(3 子页分页合并, ≥2000 清洗字符)
//  - 兼容性附加探针(仅报告不设门槛): 大书 /book/p25202/(目录 1205 章单页不截断样本) +
//    列表第 2 页 sublove-2.html(翻页 URL 形态实证)
const PROBE = {
  list: 'https://www.iidcr.com/nav/sublove-1.html',
  book: 'https://www.iidcr.com/book/p25225/',
  toc: 'https://www.iidcr.com/book/p25225/',
  content: 'https://www.iidcr.com/book/p25225/7231478.html',
  tocBig: 'https://www.iidcr.com/book/p25202/',
  list2: 'https://www.iidcr.com/nav/sublove-2.html',
}

// ★UA 门禁站: 钉移动 Chrome UA(桌面 UA 深路径全 403 实测, rotate 池含桌面 UA 绝不可用)
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '稻草人书屋 (iidcr.com)',
  description:
    'iidcr.com 稻草人书屋 Cloudflare+Apache(DedeCMS 系) UTF-8 传统多页站, 静态直采非 JS 壳。★UA 门禁站(yybsw 同款): 桌面 UA 深路径全 403, 钉 uaMode=custom 移动 Chrome UA 后三层全通(引擎 http)。列表=/nav/sublove-{page}.html(言情类每页10本×5页, sublove-1=love.html 页1别名实测; 其他8类改 sub{slug} 即可: subbl/subqihuan/subwuxia/subkehuan/subdushi/sublishi/subkongbu/sublight) div.b10 div.media(书名/bookUrl/简介/封面, 主列表无作者由 book 段补齐) / 书籍页 /book/p{id}/ 内嵌 h1.book-name+a[href*=/author/]+div.dark 状态原文+最新章+div.book-detail 简介 / 目录全量内嵌书籍页 #all-chapter div.item 无翻页锚(实测 1205 章单页不截断) / 正文 div#cont-body, 章节子页 {cid}_{n}.html 由顶部"下一页"按钮翻页(末页变"下一章"自然收敛); 每子页尾固定订阅推广语已入 adPatterns。旧域名 dcrbk.com 301 归一非镜像。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 言情分类: /nav/sublove-1.html ~ sublove-5.html(每页 10 本);
      // ★sublove-1.html 与 /nav/love.html 同内容(页 1 别名, 实测双 200 同尺寸),
      // urlTemplate 用统一 sub{slug}-{page} 形态免 302/别名特判;
      // 其他分类同模板: 把 sublove 换成 subbl/subqihuan/subwuxia/subkehuan/subdushi/
      // sublishi/subkongbu/sublight 即可(subbl-2.html 已实测 200 佐证命名规律)
      urlTemplate: 'https://www.iidcr.com/nav/sublove-{page}.html',
      itemSelector: { type: 'css', expression: 'div.b10 div.media' },
      fields: {
        name: { type: 'css', expression: '.media-title h4 a', attr: 'text' },
        bookUrl: { type: 'css', expression: '.media-title h4 a', attr: 'href' },
        // ★主列表无作者字段(媒体卡仅书名/简介/封面), 作者由 book 段补齐不影响实采
        intro: { type: 'css', expression: '.media-info', attr: 'text' },
        // 封面相对地址 /uploads/cover/{bid}s.jpg, 引擎 absolutize 补全
        cover: { type: 'css', expression: '.media-left img', attr: 'src' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: 'h1.book-name a', attr: 'text' },
        // 作者链接 /author/{名}.html, 文本即作者名
        author: { type: 'css', expression: 'a[href*="/author/"]', attr: 'text' },
        // "状态：完结/连载" 原文提取, 剥"状态："前缀后交 smartCompleteDetect 归一化
        status: {
          type: 'css',
          expression: 'div.dark:contains("状态")',
          attr: 'text',
          replaceFrom: '^状态[:：]\\s*',
          replaceTo: '',
        },
        // "最近更新：第x章 xxx" 行内链接文本 = 最新章
        latestChapter: { type: 'css', expression: 'div.dark:contains("最近更新") a', attr: 'text' },
        // 简介在 div.book-detail(点击展开区块, 源码内即全文非 AJAX)
        intro: { type: 'css', expression: 'div.book-detail', attr: 'text' },
        cover: { type: 'css', expression: 'div.media-left img', attr: 'src' },
      },
    },
    toc: {
      enabled: true,
      // 全部章节内嵌书籍页 #all-chapter div.item, 无翻页锚;
      // ★"最新章节"区块同为 .item 但位于 div.chapter 内, 不在 #all-chapter 作用域
      // (实测 p25225 计数 195=末章号精确吻合, 无重复混入);
      // 大样本 p25202 1205 章全量单页(>999 不截断), pagination 关闭
      itemSelector: { type: 'css', expression: '#all-chapter div.item' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: 'div#cont-body', attr: 'html' },
      },
      // 章节内分页: {cid}.html → {cid}_2.html → ...顶部 <a><button>下一页</button></a> 驱动,
      // 末页按钮变"下一章"(实测 7231478_3/7222309_2) → parseContent 兜底
      // a:contains("下一页") 不含"下一章"自然收敛, 跨章连锁陷阱不存在
      pagination: { enabled: true, maxPages: 10 },
    },
    fetch: {
      engine: 'http',
      // ★UA 门禁站核心配置: 钉移动 UA。桌面 UA 主页 200 但深路径 403(源站 Apache 级);
      // 移动 UA 全路径 200 实测; rotate 池混有桌面 UA 会随机 403, 绝不可用
      uaMode: 'custom',
      customUa: MOBILE_UA,
      autoCookie: true,
      referer: true,
      timeout: 25000,
      retries: 2,
      waitMs: 800,
      hostGateLimit: 3,
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
      adPatterns: [
        // 每个内容子页尾固定追加的订阅推广语(合并多子页后重复多次)
        '有能力者，请一定订阅[^<]*',
        '(www\\.)?iidcr\\.com\\S*',
        '(www\\.)?dcrbk\\.com\\S*',
        '稻草人书屋[^<>]*',
        '请记住本站[^<>]*',
        '本站所有小说[^<>]*',
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      normalize: true,
      plainText: false,
    },
  },
}

// ---------- 四段测试 ----------
interface TestResp {
  ok: boolean
  message?: string
  data?: Record<string, unknown>
}

async function testSection(section: string, url: string, ruleSection: unknown, extra: Record<string, unknown> = {}): Promise<Record<string, any> | null> {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      section, url, rule: ruleSection,
      fetch: (rule.config as Record<string, unknown>).fetch,
      clean: (rule.config as Record<string, unknown>).clean,
      ...extra,
    }),
  })
  const json = (await res.json()) as TestResp
  const ms = Date.now() - t0
  if (!json.ok) {
    console.log(`  [${section}] ❌ ${json.message} (${ms}ms)`)
    return null
  }
  const d = json.data as Record<string, any>
  if (section === 'list') {
    console.log(`  [list] ✅ engine=${d.engine} count=${d.count} ${d.ms}ms`)
    for (const it of (d.sample || []).slice(0, 2)) console.log('    ', JSON.stringify(it).slice(0, 150))
  } else if (section === 'book') {
    console.log(`  [book] ✅ engine=${d.engine} ${d.ms}ms fields=${JSON.stringify(d.fields).slice(0, 260)}`)
  } else if (section === 'toc') {
    console.log(`  [toc] ✅ engine=${d.engine} count=${d.count} pages=${d.pages} ${d.ms}ms`)
    for (const it of (d.sample || []).slice(0, 2)) console.log('    ', JSON.stringify(it).slice(0, 130))
  } else {
    console.log(`  [content] ✅ engine=${d.engine} pages=${d.pages} raw=${d.rawLength} clean=${d.cleanedLength} ${d.ms}ms`)
    console.log('    text:', JSON.stringify((d.cleanedText || '').slice(0, 120)))
  }
  return d
}

async function main() {
  const cfg = rule.config as Record<string, any>
  let allPass = true

  console.log('== iidcr.com 稻草人书屋 四段测试 ==')
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 10) allPass = false

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields) {
    allPass = false
  } else {
    const f = book.fields as Record<string, string>
    // book 过线标准: 全字段 name+author+intro(_status/latest/cover 站点侧缺失即报告)
    if (!f.name || !f.author || !f.intro) allPass = false
  }

  const toc = await testSection('toc', PROBE.toc, cfg.toc)
  if (!toc || (toc.count as number) < 50) { allPass = false; console.log('  !! toc<50 未过线') }

  const content = await testSection('content', PROBE.content, cfg.content)
  if (!content || (content.cleanedLength as number) < 2000) { allPass = false; console.log('  !! content<2000 未过线') }

  console.log('== 布局兼容性附加探针(不设门槛, 仅报告: 大书 p25202 目录 1205 章单页 / 列表第 2 页) ==')
  await testSection('toc', PROBE.tocBig, cfg.toc)
  await testSection('list', PROBE.list2, cfg.list)

  // 幂等入库: 同名规则(含历史重复)全部先删后建
  // 注: GET /api/admin/rules 信封为 {ok, data: Rule[]} —— data 直接是数组
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`)
  const listJson = (await listRes.json()) as { ok: boolean; data?: { id: string; name: string }[] | { rules?: { id: string; name: string }[] } }
  const raw = Array.isArray(listJson.data) ? listJson.data : (listJson.data as { rules?: { id: string; name: string }[] })?.rules || []
  const duplicates = raw.filter((r) => r.name === rule.name)
  for (const d of duplicates) {
    const del = await fetch(`${BASE}/api/admin/rules/${d.id}`, { method: 'DELETE' })
    const delJson = (await del.json()) as { ok: boolean }
    console.log('旧规则已删除:', d.id, delJson.ok)
  }
  const res = await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  })
  const json = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)

  console.log(allPass ? '✅ 四段测试全部过线(list≥10, book 全字段, toc≥50, content≥2000)' : '❌ 存在未过线段落, 见上方日志')
  if (!allPass) process.exit(2)
}

main()

export {}
