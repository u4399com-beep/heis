// 种子脚本: 久久小说网 (www.aijjxs.com) 直连采集规则
// 用法: bun run scripts/seed-rule-aijjxs.ts
// 侦察结论(实测 curl 2026-09-01, 串行+1s 间隔):
//  - 站点形态: openresty + PHP/7.4.33(帝国CMS 系), HTTP/2, UTF-8(Content-Type 头
//    charset=UTF-8 + <meta charset="utf-8"> 双证); 首页/列表/书籍/目录/正文全 200 直连,
//    无 WAF 挑战(无 Set-Cookie/无 CF/无 GoEdge)/无 UA 门禁(curl 默认 UA 同样 200)/
//    无 Referer 依赖 —— 纯直连站, 引擎 http + 常规 rotate UA 池即可
//  - URL 体系: 书籍 /txt/{bid}.html; 分类 /txt/{slug}/(第1页)与 /txt/{slug}/index_{N}.html
//    (N≥2, ★index_1.html 实测 200 且与 /txt/{slug}/ 字节级同页 = 第1页别名, {page} 模板
//    可统一从 1 起); 分类 slug 15 个: xuanhuan/dushi/chuanyue/chongshengxiaoshuo/lsjs/
//    young/qinggan/wuxia/tongrenxiaoshuo/wuxianliu/dmtr/tiexue/juben/kongbu/gdmz
//    (玄幻约 144 页×10 本/页); 全站排序页 /txt/listinfo-p_{page}-c_{cat}-... 同模板,
//    但 c_0(全部分类)是另一套紧凑布局无 div.listbg, 规则只钉分类形态
//  - ★目录形态: 书籍页只有"在线阅读全文"一个 /read/ 链接(a.download-btn href=/read/{bid}/),
//    目录页 /read/{bid}/ 内嵌 ul.chapter-list 全量单页(实测 847/921/1368 章三本无翻页锚,
//    大书 104KB 也不截断); ★首个 li 是"内容简介"非章节 → itemSelector 用
//    li:not(:first-child) 排除; 章节 URL = /read/{catid}/{bid}/{n}.html(绝对路径, absolutize 补全)
//  - ★★正文翻页陷阱: 章节页"下一页"锚 = 下一章(/2.html 的下一页 → /3.html = 第二章),
//    页码计数"N/总章数"是全书页码 —— kanunu8 式"下一页=下一章"陷阱存在, content 段
//    pagination 必须关闭(每章单页, parseContent 兜底只在 pagination.enabled 时生效, 关闭即安全)
//  - 正文极净: #view_content_txt 内纯 <p> 段落(74~140 段/章), 多章实测 0 广告 0 站名残留;
//    首 <p> 重复章节标题属源站排版原样保留; 章节字数 2000~4000
//  - 数据怪癖留档: 部分上传书章号重启(如 57185 页数 921 但章号只到 42, 中途从第1章重开,
//    标题均唯一)属上传者 TXT 分卷结构, 非采集缺陷; 书籍页无"最新章节"字段(book 段不采
//    latestChapter, 该站为 TXT 下载站无此概念, book4 状态缺失同型先例)
//  - 四层(实测全通):
//    * 列表 = /txt/xuanhuan/index_{page}.html div.listbg(10 本/页: .title a 书名+bookUrl /
//      a[href*=/zuozhe/] 作者 / regex "写作进度" 状态 / a.img img 封面(协议相对地址
//      //image.jjjjxsw.com absolutize 补全) / div[style*=padding] first() 简介)
//    * 书籍页 = /txt/{bid}.html: article.panel h3 书名(剥《》/ .kv a 作者 /
//      .kv p:contains("书籍分类") 分类 / span.sfwj 状态原文交 smartCompleteDetect /
//      div.desc first() 简介 / .pic img 封面
//    * 目录 = 书籍页 a[href^="/read/"] tocLink → /read/{bid}/ ul.chapter-list
//      li:not(:first-child) 全量单页
//    * 正文 = /read/{catid}/{bid}/{n}.html #view_content_txt, 翻页关闭(陷阱见上)
const BASE = 'http://localhost:3000'

// 测试探针: ★rules/test 接口 URL 参数一律传已展开 URL({page}→1, cc-b 占位符坑先例);
// config.urlTemplate 保持 {page} 形态供实采 runner 替换
const PROBE = {
  list: 'https://www.aijjxs.com/txt/xuanhuan/index_1.html',
  book: 'https://www.aijjxs.com/txt/57196.html',
  toc: 'https://www.aijjxs.com/txt/57196.html',
  content: 'https://www.aijjxs.com/read/11/57196/3.html',
  bookBig: 'https://www.aijjxs.com/txt/24475.html',
  tocBig: 'https://www.aijjxs.com/txt/24475.html',
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '久久小说网 (aijjxs.com)',
  description:
    'aijjxs.com 帝国CMS系 TXT下载+在线阅读混合站, openresty/PHP, UTF-8 直连无挑战(无WAF/无UA门禁/无编码陷阱)。列表=/txt/{slug}/index_{page}.html(第1页与 /txt/{slug}/ 同页实测, index_1 为别名) div.listbg 10本/页(书名/bookUrl/作者/regex状态/封面(协议相对地址自动补全)/简介) / 书籍页 /txt/{bid}.html article.panel h3 剥《》+.kv 作者/分类+span.sfwj 状态原文+div.desc 简介+.pic img 封面 / 目录: 书籍页 a[href^=/read/] tocLink → /read/{bid}/ 内嵌 ul.chapter-list 全量单页(1368章大书实测不截断, 首个li=内容简介用 :not(:first-child) 排除) / 正文 #view_content_txt 纯p段落, 每章单页(★"下一页"锚=下一章, 翻页必须关闭防跨章连锁); 章节字数约2000~4000, 正文极净。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 分类列表: /txt/xuanhuan/index_1.html ~ index_144.html(每页 10 本, index_1 = 第1页别名);
      // 其他分类同模板变体(改路径即可): dushi/chuanyue/chongshengxiaoshuo/lsjs/young/qinggan/
      // wuxia/tongrenxiaoshuo/wuxianliu/dmtr/tiexue/juben/kongbu/gdmz
      urlTemplate: 'https://www.aijjxs.com/txt/xuanhuan/index_{page}.html',
      itemSelector: { type: 'css', expression: 'div.listbg' },
      fields: {
        name: { type: 'css', expression: '.title a', attr: 'text' },
        bookUrl: { type: 'css', expression: '.title a', attr: 'href' },
        author: { type: 'css', expression: 'a[href*="/zuozhe/"]', attr: 'text' },
        // "写作进度：</small>已完结" 是 span.mainGreen 内裸文本节点, CSS 选择器取不到,
        // 用 regex 型取捕获组1(规则安全门: 捕获组在末尾无后继量词, 非嵌套量词形态)
        status: { type: 'regex', expression: '写作进度：</small>\\s*([^\\s<]+)' },
        // 简介在前、作者信息块在后, 两个同 style div, first() 语义天然取简介
        intro: { type: 'css', expression: 'div[style*="padding"]', attr: 'text' },
        // 封面为协议相对地址 //image.jjjjxsw.com/..., 引擎 absolutize 补全为 https:
        cover: { type: 'css', expression: 'a.img img', attr: 'src' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        // 第一个 article.panel h3 = 书名《xxx》(后续 panel h3 是"内容简介"等板块标题),
        // first() 语义 + replaceFrom 剥书名号
        name: { type: 'css', expression: 'article.panel h3', attr: 'text', replaceFrom: '^《|》$', replaceTo: '' },
        author: { type: 'css', expression: '.kv a[href*="/zuozhe/"]', attr: 'text' },
        category: {
          type: 'css',
          expression: '.kv p:contains("书籍分类")',
          attr: 'text',
          replaceFrom: '^书籍分类：\\s*',
          replaceTo: '',
        },
        // "已完结"等原文, 交 smartCompleteDetect 归一化
        status: { type: 'css', expression: 'span.sfwj', attr: 'text' },
        // 书籍页多个 div.desc(简介块在前, "猜您喜欢"推荐卡在后), first() 取简介
        intro: { type: 'css', expression: 'div.desc', attr: 'text' },
        cover: { type: 'css', expression: '.pic img', attr: 'src' },
        // 该站为 TXT 下载站, 书籍页无"最新章节"字段, 不采 latestChapter(book4 状态缺失同型先例)
      },
    },
    toc: {
      enabled: true,
      // 书籍页仅一个 /read/ 链接("在线阅读全文"), 即目录页 /read/{bid}/
      tocLink: { type: 'css', expression: 'a[href^="/read/"]', attr: 'href' },
      // 全量目录内嵌 /read/{bid}/ 单页(实测 847/921/1368 章无翻页锚); 首个 li 是
      // "内容简介"非真章节, :not(:first-child) 排除(cheerio css-select 实证支持)
      itemSelector: { type: 'css', expression: 'ul.chapter-list li:not(:first-child)' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      // 站点无目录翻页机制, 关闭(防未来误跟"下一章"锚)
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: '#view_content_txt', attr: 'html' },
      },
      // ★每章单页, 翻页必须关闭: 章节页"下一页"锚=下一章(kanunu8 式陷阱),
      // pagination.enabled=false 时 parseContent 不走兜底"下一页"锚, 天然安全
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      engine: 'http',
      // 直连站: 无挑战/无 UA 门禁, 常规 rotate UA 池 + autoCookie 防御性保留
      uaMode: 'rotate',
      autoCookie: true,
      referer: true,
      timeout: 25000,
      retries: 2,
      waitMs: 800,
      browserFallbackStatus: [403, 412, 429, 503],
      hostGateLimit: 3,
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
      adPatterns: [
        '(www\\.)?aijjxs\\.com\\S*',
        '(www\\.)?jjjjxsw\\.com\\S*',
        '久久小说网[^<>]*',
        '请记住本站[^<>]*',
        '本站内容来源于网络[^。<>]*',
        '本站所收录作品[^<>]*',
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      normalize: true,
      plainText: false,
    },
  },
}

// ---------- 四段测试(入库前烟测, 正式 2 遍验证见 verify-hh-a-foursection.ts) ----------
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

  console.log('== aijjxs.com 四段烟测 ==')
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 10) allPass = false

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) allPass = false

  const toc = await testSection('toc', PROBE.toc, cfg.toc)
  if (!toc || (toc.count as number) < 50) { allPass = false; console.log('  !! toc<50 未过线') }

  const content = await testSection('content', PROBE.content, cfg.content)
  if (!content || (content.cleanedLength as number) < 2000) { allPass = false; console.log('  !! content<2000 未过线') }

  console.log('== 布局兼容性附加探针(不设门槛, 仅报告: 大书24475目录1368章样本) ==')
  await testSection('book', PROBE.bookBig, cfg.book)
  await testSection('toc', PROBE.tocBig, cfg.toc)

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

  console.log(allPass ? '✅ 四段烟测全部过线(list≥10, toc≥50, content≥2000)' : '❌ 存在未过线段落, 见上方日志')
  if (!allPass) process.exit(2)
}

main()

export {}
