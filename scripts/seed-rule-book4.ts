// ============================================================
// 种子脚本: AU文学 (book4.cc) — JS-base64壳站, browser引擎采集规则
// 用法: bun run scripts/seed-rule-book4.ts
// ============================================================
// 侦察结论(实测 2026-08, 直连 https://book4.cc/):
//  - 站点形态: "聚合书库"站群(AU文学/星星小说/笔趣阁02 等多源聚合), nginx 直连 200 无
//    IP封锁/无 Set-Cookie/无挑战。★全站统一 base64 渲染壳: 任何 HTML 页(列表/书籍/章节/
//    首页)响应体均为 `<script>window['user_ip']=''; html_b="PCFET0NU...(base64)...";
//    decodedHtml=decodeURIComponent(escape(atob(html_b))); document.writeln(decodedHtml)</script>`
//    —— 真实 DOM 经 base64 内嵌由 JS 解码后 document.write 渲染(壳内无 <title>, 长度
//    89KB, looksBlocked/isJsChallenge 均不命中 → engine='auto' 的 HTTP 首选路径会把壳当
//    正常页返回且选择器全空, 故必须 engine='browser' 强制浏览器渲染)。
//  - ★Cookie 两步法不可行: 响应无任何 Set-Cookie(壳化无条件, 与会话无关); d.js 仅为
//    UI/统计脚本(推广后缀替换/umami 统计), 无解壳逻辑 → 纯 HTTP 路径对 HTML 页全灭,
//    browser 渲染后 DOM 正常(壳 script 节点残留在 DOM 源码中, removeSelectors script 清除)。
//  - ★反爬小花样: 页面部分容器 class 带 6 位随机 hex 前缀(6ac07c/ecb1fb/f9b426, 逐页轮换),
//    语义类名(book-info/book-detail-info/entry-content/intro/tag-box)稳定 → 选择器全部
//    只认语义类名。书籍页 URL 分类段可变(/AU文学/同人/411853/ 301 → /AU文学/仙侠/411853/,
//    按书归一), 目录正文链接均为书籍页相对路径。
//  - 分类页分页: /AU文学/{分类}/{page}(无尾斜杠! 仙侠 1..N, 带尾斜杠 /2/ 会 503 "book
//    error"); 页1=/{分类}/1 与 /{分类}/ 同内容。列表项结构: li > div.book-img(封面) +
//    div.book-info(h3 a 书名《》 / p.author 作者·点击量·最新·章节数 / p 简介), 每页 20 本。
//  - 书籍页 /AU文学/{分类}/{id}/: div.book-detail-info(h2《书名》/p 作者：/p 章节数量/p
//    点击/p 更新/p 最新：<a>末章</a>) + div.tag-box a 分类 + div.intro p 简介。
//    ★站点无"状态/完结"字段(状态行被站点注释掉) → 不采 status, 交 smartCompleteDetect
//    由简介/最新章标题推断(完本感言/终章 等命中词表); 内嵌 book={...} JSON 的 "isok"
//    字段语义不明(未完结书也是 1)不采用。
//  - 封面 /img_io_read/{源}/{id}/cover.jpg.css —— .css 后缀伪装但 content-type: text/css、
//    实体为 WebP(RIFF); 去掉 .css 后缀即得 image/jpg 正常响应 → cover 字段 replaceFrom
//    '\\.css$' 剥壳。
//  - ★目录为 AJAX 注入: 书籍页静态 HTML 的 #chapter_list 只有"章节加载中"占位, 章节数据
//    由内嵌 load_js('/show_jsload_book_info/'+book_yun_path) 加载 JS(内容为
//    dstr=base64(urlencode(JSON)) 形态, 纯 HTTP 可达但引擎无 base64 解码能力无法解析)
//    → 依赖 browser 渲染 + obscura settle 稳定化采样等 AJAX 注入完成(实测 996 章全量
//    单页, 无翻页; 渲染后 li#chapter_id_N > a[相对路径](N字) —— (N字) 后缀用 title 字段
//    replaceFrom '\\(\\d+字\\)' 剥除)。
//  - 正文: 章节页 .entry-content 服务端已在壳内渲染完整内容(browser 解壳后直接提取),
//    无章节内分页(nav-single 上一章/下一章在容器外; "下一页"锚 0 处)。
//    ★源数据瑕疵(清洗无法修复): 源站章节正文中部混入其他小说的段落(反采集污染或源站
//    数据错乱), 属源站数据质量问题如实留档; 容器内尾部有推广行(请各位大哥大姐帮忙推广…)
//    与"正在阅读《…》/当前章节: …"链接行 → clean.adPatterns 剥除。
//  - 引擎耗时(实测): 列表 5.6s / 书籍 3.0s / 目录(含AJAX等待) 3.8s / 正文 3.5s ——
//    browser 渲染天然慢, 规则 timeout=60s / hostGateLimit=2 克制并发。
// ============================================================
const BASE = 'http://localhost:3000'

// 测试探针(仙侠分类, 从赘婿开始建立长生家族 id=411853):
//  - list: /AU文学/仙侠/1 每页 20 本(≥10)
//  - book: /AU文学/仙侠/411853/ 全字段
//  - toc: 同书籍页(AJAX 注入 996 章 ≥50)
//  - content: 第一章(3095字, 清洗后 ≥2000)
const PROBE = {
  list: 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/1',
  book: 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/411853/',
  toc: 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/411853/',
  content:
    'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/411853/YXV3eHcvNDExODUzL2FIUjBjSE02THk5M2QzY3VZWFYzZUhjdVkyOXRMMkYxY21WaFpDODFNamcwTUY4ek1UVXhOREExTnk1b2RHMXMuanNvbg==.html',
}

// 桌面 Chrome UA(book4.cc 对桌面 UA 无门禁; 壳化与 UA 无关)
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: 'AU文学 (book4.cc)',
  description:
    'book4.cc 聚合书库(AU文学站群, 页面品牌 AU文学/聚合书库), 全站统一 base64 渲染壳 —— 真实 DOM 内嵌 html_b 变量由 JS atob+document.write 输出, 响应无 Set-Cookie(壳化无条件, Cookie 两步法不可行), 且壳页 looksBlocked 不命中 → 必须 engine=browser 强制渲染, 禁用 auto(http 首选会拿壳返回空解析)。页面容器 class 带 6 位随机 hex 前缀逐页轮换, 选择器只认语义类名。列表=/AU文学/{分类}/{page}(无尾斜杠, {page} 从 1 起)的 li:has(div.book-info) 每页 20 本(书名/作者/简介/封面) / 书籍页 /AU文学/{分类}/{id}/ h2 书名+作者regex+div.intro 简介+封面(剥 .css 伪装后缀)+最新章regex, 站点无状态字段(isok 语义不明未采用)交 smartCompleteDetect / 目录=书籍页 AJAX 注入 #chapter_list li(996 章全量单页, (N字) 后缀由 replaceFrom 剥除, 依赖 obscura settle 等注入) / 正文=.entry-content 无章节内分页, 尾部推广行与"正在阅读/当前章节"行由 adPatterns 剥除。已知源数据瑕疵: 源站章节中部混入其他小说段落(反采集污染, 清洗不可修复)。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 分类分页列表: /AU文学/{分类}/{page} 从 1 起, 每页 20 本(热门排行榜)。
      // 其他分类变体(改路径段即可): 玄幻/都市/科幻/历史/游戏/奇幻/轻/现代/穿越/古代/军事/二次/热血/未分类
      // 注意: page>1 必须无尾斜杠(/仙侠/2/ 带斜杠会 503 "book error"), {page}=1 与 /仙侠/ 同内容
      urlTemplate: 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/{page}',
      itemSelector: { type: 'css', expression: 'li:has(div.book-info)' },
      fields: {
        // 书名带《》书名号 → replaceFrom 剥除
        name: { type: 'css', expression: 'h3 a', attr: 'text', replaceFrom: '[《》]', replaceTo: '' },
        bookUrl: { type: 'css', expression: 'h3 a', attr: 'href' },
        // 列表项作者在 p.author 首行(其后还有点击量/最新/章节数同 class p), 用 regex 精准取值
        author: { type: 'regex', expression: '作者[:：]\\s*([^<\\s<]{1,40})', attr: '1', flags: 'gis' },
        intro: { type: 'css', expression: 'p:contains("简介")', attr: 'text', replaceFrom: '^简介[:：]\\s*', replaceTo: '' },
        // 封面真实地址带 .css 伪装后缀(content-type text/css 实体 WebP), 剥后缀得 image/jpg
        cover: { type: 'css', expression: 'div.book-img img', attr: 'src', replaceFrom: '\\.css$', replaceTo: '' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: '.book-detail-info h2', attr: 'text', replaceFrom: '[《》]', replaceTo: '' },
        author: { type: 'regex', expression: '作者[:：]\\s*([^<\\s<]{1,40})', attr: '1', flags: 'gis' },
        intro: { type: 'css', expression: 'div.intro p', attr: 'text', replaceFrom: '^简介[:：]\\s*', replaceTo: '' },
        cover: { type: 'css', expression: 'div.book-img img', attr: 'src', replaceFrom: '\\.css$', replaceTo: '' },
        latestChapter: { type: 'regex', expression: '最新：<a[^>]*>([^<]{1,120})</a>', attr: '1', flags: 'gis' },
        category: { type: 'css', expression: '.tag-box a', attr: 'text' },
        // 站点无状态字段("状态：已完结"行被站点注释掉; 内嵌 JSON 的 isok 未完结书也为 1,
        // 语义不明不采) —— status 交 smartCompleteDetect 从简介/最新章标题推断
      },
    },
    toc: {
      enabled: true,
      // 目录由 AJAX 注入书籍页 #chapter_list(browser 渲染 + obscura settle 稳定化采样等待);
      // 实测 996 章全量单页无翻页。最新5章面板在 #chapter_list_new(不同 id), 天然隔离。
      // 章节链为书籍页相对路径(如 YXV3...==.html), parser absolutize 挂到书籍页 URL 下
      itemSelector: { type: 'css', expression: '#chapter_list li' },
      fields: {
        // JS 注入的标题带 "(3095字)" 字数后缀 → replaceFrom 剥除
        title: { type: 'css', expression: 'a', attr: 'text', replaceFrom: '\\(\\d+字\\)', replaceTo: '' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      // 无翻页标记, 防御性开启(零请求)
      pagination: { enabled: true, maxPages: 20 },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: '.entry-content', attr: 'html' },
      },
      // 章节内容整页一次渲染完(无 _2/_3 子页; nav-single 上一章/下一章在容器外),
      // 翻页关闭防"下一章"被误当"下一页"
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      // ★强制 browser: 站点为 base64 渲染壳且壳页不被 looksBlocked 判拦,
      // engine=auto 的 HTTP 首选路径会拿壳返回(200)且选择器全空 —— 实测证据见文件头
      engine: 'browser',
      uaMode: 'custom',
      customUa: DESKTOP_UA,
      timeout: 60000,
      retries: 1,
      waitMs: 1500,
      browserFallbackStatus: [403, 412, 429, 503],
      hostGateLimit: 2,
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
      adPatterns: [
        // .entry-content 内嵌 HTML 注释节点(站点注释掉的推广行)整段剥除 —— cheerio 白名单
        // 剥壳不处理注释节点, 注释会原样残留进清洗后正文(实测 "服务商故障…" 注释漏到正文头部)
        '<!--[\\s\\S]{0,300}?-->',
        '(www\\.)?book4\\.cc\\S*',
        // .entry-content 尾部推广行与"正在阅读/当前章节"回链行(a 标签已被白名单剥壳, 按纯文本匹配)
        '请各位大哥大姐帮忙推广[^<]{0,200}',
        '正在阅读《[^<]{0,80}》?',
        '当前章节[:：][^<]{0,120}',
        // 章节尾部 JS 注入的下一章回链(a 标签剥壳后成纯文本, 实测第一章尾部残留)
        '下一章节[:：][^<]{0,120}',
        '本站长期运营[^<]{0,120}',
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
    console.log(`  [book] ✅ engine=${d.engine} ${d.ms}ms fields=${JSON.stringify(d.fields).slice(0, 300)}`)
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

  console.log('== book4.cc (AU文学) 四段测试 — browser 引擎, 每段含渲染耗时 ==')
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 10) allPass = false

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) allPass = false

  const toc = await testSection('toc', PROBE.toc, cfg.toc)
  if (!toc || (toc.count as number) < 50) { allPass = false; console.log('  !! toc<50 未过线') }

  const content = await testSection('content', PROBE.content, cfg.content)
  if (!content || (content.cleanedLength as number) < 2000) { allPass = false; console.log('  !! content<2000 未过线') }

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

  console.log(allPass ? '✅ 四段测试全部过线(list≥10, toc≥50, content≥2000)' : '❌ 存在未过线段落, 见上方日志')
  if (!allPass) process.exit(2)
}

main()

export {}
