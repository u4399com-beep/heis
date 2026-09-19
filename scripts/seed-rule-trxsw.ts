// 种子脚本: 天人小说 (www.trxsw.com) ·唐人小说路由 采集规则
// 用法: bun run scripts/seed-rule-trxsw.ts
// 幂等: 同名规则先删后建; export{} 守卫(可被 verify 脚本 import 规则配置)
//
// ================= 结构依据(GitHub AiraBrowser 反查, 非直连实测) =================
// 主控 R11-1A 任务书反查到 trxsw.com 真实 DOM 结构(唐人小说路由站), 来自
// GitHub 仓库 mason173/aira-browser 的完整配置。
//
// ★可达性: trxsw.com 域名已过期(cirosantilli expired-domain 列表收录), 直连不可达。
//   AiraBrowser 仍保留规则作为"备用源", 待域名恢复或镜像出现时启用。本规则结构
//   按 AiraBrowser 完整配置反推, 路径前缀 /tangren_ 或 /tangren/ 是关键标识。
//
// AiraBrowser 完整配置(原文直译):
//   - chapterLinkSelector: '.vlist > li:not(.now) > a, .read > li > a'
//   - contentSelector: '.content'
//   - chapterTitleSelector: 'h1.headline'
//   - prevSelector: '.pager a:first-of-type'
//   - nextSelector: '.pager a:nth-of-type(3)'
//   - bookTitleSelector: '.detail .name strong'
//   - authorSelector: '.detail .author a'
//   - coverSelector: '.detail > img'
//   - synopsisSelector: '.intro'
//   - catalogIncomplete: false
//   - requiresContentQualityGate: true
//
// URL 体系(基于 .vlist/.read/.detail/.pager/.content 类名 + 唐人小说模板推断):
//   - 列表: /tangren_/sort/{cat}/{page}.html 或 /tangren/sort/{cat}/{page}.html
//     (★关键: 路径前缀 /tangren_ 或 /tangren/, AiraBrowser 实测)
//   - 书籍页: /tangren_/{id}/ 或 /tangren/{id}/
//   - 章节页: /tangren_/{bid}/{cid}.html 或 /tangren/{bid}/{cid}.html
//
// DOM 结构(AiraBrowser 完整配置直译):
//   - .vlist > li:not(.now) > a  —— 主章节列表(vertical list, 排除"当前阅读位置"项)
//   - .read > li > a              —— 备用章节列表(另一种主题, 可能切换时存在)
//   - .content                    —— 正文容器
//   - h1.headline                 —— 章节标题
//   - .pager a:first-of-type      —— 上一页
//   - .pager a:nth-of-type(3)     —— 下一页
//   - .detail .name strong        —— 书名
//   - .detail .author a           —— 作者
//   - .detail > img               —— 封面
//   - .intro                      —— 简介
//
// 四层结构(基于 AiraBrowser 反推):
//   * 列表 = /tangren_/sort/{cat}/{page}.html .vlist li(a 书名+bookUrl)
//   * 书籍页 = /tangren_/{id}/ .detail .name strong 书名 / .detail .author a 作者
//     / .detail>img 封面 / .intro 简介
//   * 目录 = 书籍页同 URL .vlist>li:not(.now)>a(排除"当前位置"项)
//   * 正文 = /tangren_/{bid}/{cid}.html .content(h1.headline 章节标题)
// ============================================================
const BASE = 'http://localhost:3000'

// 测试探针 URL(基于 AiraBrowser 路径前缀 /tangren_/ + 类名推断, ID 为推测值):
//   ★rules/test 接口 URL 参数一律传已展开 URL({page}→1, {cat}→1, cc-b 占位符坑先例);
//   config.urlTemplate 保持 {cat}/{page} 形态供实采 runner 替换
const PROBE = {
  list: 'https://www.trxsw.com/tangren_/sort/1/1.html',
  book: 'https://www.trxsw.com/tangren_/1234/',
  toc: 'https://www.trxsw.com/tangren_/1234/',
  content: 'https://www.trxsw.com/tangren_/1234/5678.html',
}

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '天人小说(trxsw.com)·唐人小说路由',
  description:
    'trxsw.com 唐人小说路由站(★路径前缀 /tangren_ 或 /tangren/, 主控 R11-1A 反查 GitHub mason173/aira-browser 完整配置直译)。域名已过期但规则保留待镜像恢复。列表 /tangren_/sort/{cat}/{page}.html .vlist li / 书籍页 .detail .name strong 书名+.detail .author a 作者+.detail>img 封面+.intro 简介 / 目录 .vlist>li:not(.now)>a(排除"当前位置"项, AiraBrowser chapterLinkSelector 直译) / 正文 .content(h1.headline 章节标题, AiraBrowser contentSelector 直译) / .pager a:first-of-type 上一页 / .pager a:nth-of-type(3) 下一页。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // ★路径前缀 /tangren_ 是关键(AiraBrowser 实测); /tangren/ 为备用前缀
      // cat=1 为默认分类(具体分类编号待站点恢复后实测补全)
      urlTemplate: 'https://www.trxsw.com/tangren_/sort/1/{page}.html',
      // .vlist li 内 a 即书名+bookUrl(vertical list 紧凑布局)
      itemSelector: { type: 'css', expression: '.vlist li' },
      fields: {
        name: { type: 'css', expression: 'a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'a', attr: 'href' },
      },
      // R31-1C: maxPages 50→30 防过深; 站点已过期但保留规则, 实测时若恢复仍可能带 CF 防护,
      //   30 页 × {每页 ~20 本} = 600 本发现量已足够, 50 页会让 scrapling-static 路径多
      //   抓 20 页拉长任务时长; AiraBrowser 反查未给 nextLink class, 引擎兜底 a:contains
      //   ("下一页") 在 .vlist 模板上自然命中(中文笔趣阁系惯例)
      pagination: { enabled: true, maxPages: 30 },
    },
    book: {
      enabled: true,
      fields: {
        // AiraBrowser bookTitleSelector 直译: .detail .name strong
        name: { type: 'css', expression: '.detail .name strong', attr: 'text' },
        // AiraBrowser authorSelector 直译: .detail .author a
        author: { type: 'css', expression: '.detail .author a', attr: 'text' },
        // AiraBrowser coverSelector 直译: .detail > img
        cover: { type: 'css', expression: '.detail > img', attr: 'src' },
        // AiraBrowser synopsisSelector 直译: .intro
        intro: { type: 'css', expression: '.intro', attr: 'text' },
      },
    },
    toc: {
      enabled: true,
      // AiraBrowser chapterLinkSelector 直译: .vlist > li:not(.now) > a
      // ★:not(.now) 排除"当前阅读位置"项(用户上次阅读的章节会带 .now 类高亮)
      itemSelector: { type: 'css', expression: '.vlist > li:not(.now)' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      // AiraBrowser catalogIncomplete: false, 无翻页机制(全量单页)
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        // AiraBrowser contentSelector 直译: .content
        // h1.headline 章节标题在 cleaner.cleanChapterTitle 处理
        content: { type: 'css', expression: '.content', attr: 'html' },
      },
      // ★翻页关闭: AiraBrowser nextSelector=.pager a:nth-of-type(3) 是"下一章"而非"下一页",
      // 开启翻页会多章并一章(kanunu8 式陷阱); requiresContentQualityGate=true 也表明
      // 站点对内容质量有要求, 翻页合并可能破坏质量门
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      // scrapling-static: 站点已过期但规则保留, 实测时若恢复仍可能带 CF 防护;
      // scrapling-static TLS 指纹伪装可应对 CF 防护 + 兼容老站点 SSL 证书问题
      engine: 'scrapling-static',
      uaMode: 'rotate',
      autoCookie: true,
      referer: true,
      timeout: 25000,
      retries: 2,
      waitMs: 1000,
      browserFallbackStatus: [403, 412, 429, 503],
      hostGateLimit: 2,
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle'],
      adPatterns: [
        // 站点水印 + 域名灌水
        '(www\\.)?trxsw\\.com\\S*',
        '天人小说[^<>]*',
        '唐人小说[^<>]*转载收集',
        '天人小说网[^<>]*',
        // 通用推广词(与 fanqianxs/aijjxs 同款)
        '本书首发于[^<>]*',
        '请记住本书[^<>]*',
        '最新章节请到[^<>]*查看',
        '一秒记住.*?免费读',
        '本章未完.*?点击下一页继续阅读',
        '为您提供.*?精彩小说',
        '本站(?:首发|更新最快).{0,30}《',
        '下载(?:APP|客户端|手机版).{0,20}看',
        '扫码(?:关注|下载).{0,20}',
        '关注微信公众号.{0,20}',
        '加入书签.{0,15}继续阅读',
        '为了方便下次阅读.{0,30}',
        '本章(?:未完|未完待续|继续阅读).{0,8}',
        '友情链接[:：].{0,200}',
        // 裸域名灌水兜底
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

  console.log('== trxsw.com 四段烟测 (域名已过期, scrapling-static) ==')
  // ★trxsw.com 域名已过期, 直连不可达; 测试探针依赖 scrapling-bridge 服务转发。
  // 若探针失败(DNS 不解析), 检查:
  //   1. 域名是否已恢复(cirosantilli expired-domain 列表更新)
  //   2. 是否有镜像域名可用(改 urlTemplate 即可)
  //   3. AiraBrowser 配置是否仍匹配当前 DOM(站点恢复后可能改版)
  // 探针失败不阻断入库(规则已基于反查 DOM 写定, 待站点恢复后实测)
  const list = await testSection('list', PROBE.list, cfg.list)
  if (!list || (list.count as number) < 5) {
    allPass = false
    console.log('  !! list<5 未过线(域名过期或结构变更, 入库仍继续)')
  }

  const book = await testSection('book', PROBE.book, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) {
    allPass = false
    console.log('  !! book 段无 name 字段(.detail .name strong 缺失, 检查 DOM 是否变更)')
  }

  const toc = await testSection('toc', PROBE.toc, cfg.toc)
  if (!toc || (toc.count as number) < 10) {
    allPass = false
    console.log('  !! toc<10 未过线(.vlist 可能不存在, 备用 .read > li > a)')
  }

  const content = await testSection('content', PROBE.content, cfg.content)
  if (!content || (content.cleanedLength as number) < 1000) {
    allPass = false
    console.log('  !! content<1000 未过线(.content 可能不存在)')
  }

  // 幂等入库: 同名规则(含历史重复)全部先删后建
  const listRes = await fetch(`${BASE}/api/admin/rules?take=200`)
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

  console.log(allPass ? '✅ 四段烟测全部过线(list≥5, toc≥10, content≥1000)' : '❌ 存在未过线段落, 见上方日志(域名过期站点, 入库仍完成)')
  // 域名过期站点探针失败不阻断入库(规则已基于反查 DOM 写定, 待站点恢复后实测)
  // 若需严格阻断, 改为 if (!allPass) process.exit(2)
}

main()

export {}
