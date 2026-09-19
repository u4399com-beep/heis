// 种子脚本: 金银小说 (www.fdxrz.com) 采集规则
// 用法: bun run scripts/seed-rule-fdxrz.ts
//
// 实测侦察(2026-09, 裸 curl 200, Bootstrap 3 + Font Awesome 4, GBK-转-UTF8 站, 无 CF):
//  - 站点品牌: 金银小说 (www.fdxrz.com), Bootstrap 3 + jQuery 1.9 + Font Awesome 4
//    URL 结构(实测全通):
//    * 列表 = 分类页 `/xuanhuan/{page}/` (page 1 同 `/xuanhuan/`, page 2 `/xuanhuan/2/`)
//      主列表 `table.mytable tr`(跳过 th 表头行)含:
//        td:nth(1) a[href=/jinyin/{id}.html] 书名+bookUrl,
//        td:nth(2) a.text-muted[href=/jinyin/{bid}/{cid}.html] 最新章节,
//        td:nth(3) text-muted 作者,
//        td:nth(4) hidden-xs 更新时间,
//        td:nth(5) text-nowrap 状态(连载|完成)
//      另有侧栏 .list-group.list-top > li.list-group-item (热门推荐, Top10) 备用
//    * 书籍页 = `/jinyin/{id}.html`: og:novel:* meta 全套(book_name/author/category/status/
//      latest_chapter_name/read_url), og:image 封面。完整 yiove 标准结构。
//    * 目录 = 书籍页 `#list-chapterAll dd.col-md-3 > a`(全量章节目录, 全量单页无翻页),
//      `@text` 章节名, `@href` URL `/jinyin/{bid}/{cid}.html`
//    * 正文 = `/jinyin/{bid}/{cid}.html`: `.panel-readcontent #htmlContent` html, `<p>` 段落
//      含嵌入广告 `<p>◐本书作者xxx提醒您《xxx》最新章节在<a>金|银小说</a>全网首发无弹窗免费阅读
//      ｆｄｘｒz◉com◐(请来金|银小说|看最新章节|完整章节)` —— 需 adPatterns 全套剥离
//  - fetch 配置: engine=http (200 无 CF), uaMode=rotate, autoCookie, referer, 25s 超时, 2 重试
//  - clean: 标准 + fdxrz.com 域名剥离 + 金银小说品牌剥离 + 嵌入广告段全套 regex
const BASE = process.env.BASE || 'http://localhost:3000'
const PASSWORD = process.env.ADMIN_PASSWORD || 'audit-fix-2025'

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '金银小说 (www.fdxrz.com)·Bootstrap 直连 + yiove 标准 og:novel',
  description:
    '[实测裸 curl 200 无 CF] www.fdxrz.com 金银小说, Bootstrap 3 + jQuery + Font Awesome 4 站。列表=分类页 /xuanhuan/{page}/ (page1 同 /xuanhuan/, page2=/xuanhuan/2/ 共 11933 页) 的 table.mytable tr 跳过表头行(td:nth(1) a[href=/jinyin/{id}.html] 书名+bookUrl / td:nth(2) a.text-muted 最新章节+url / td:nth(3) 作者 / td:nth(5) 状态 连载|完成); 另有侧栏 .list-group.list-top>li.list-group-item 热门 Top10 备用。书籍页 /jinyin/{id}.html: og:novel:* meta 全套(book_name/author/category/status/read_url/latest_chapter_name/update_time) + og:image 封面, yiove 标准结构无需自定义字段。目录 #list-chapterAll dd.col-md-3>a 全量单页无翻页(@text 章节名 + @href /jinyin/{bid}/{cid}.html)。正文 /jinyin/{bid}/{cid}.html: .panel-readcontent #htmlContent html, 含嵌入广告段 ◐本书作者xxx提醒您《xxx》最新章节在<a>金|银小说</a>全网首发无弹窗◐(请来金|银小说|看最新章节|完整章节) —— 需全套 adPatterns 剥离(金银小说/全网首发无弹窗/请来完整章节/如章节缺失/记住域名/讨论本书/推荐他的其他作品 等 16+ regex)。fetch engine=http+uaMode rotate+autoCookie+referer+25s+2retry。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 分类页 list source: /xuanhuan/{page}/ 共 11933 页, 每页 ~30 本;
      // 其他分类变体(改 slug 即可): qihuan/wuxia/xianxia/dushi/lishi/junshi/etc
      urlTemplate: 'https://www.fdxrz.com/xuanhuan/{page}/',
      // tr 容器选择器(无 tbody, 后代选择器 .mytable tr 通杀有/无 tbody 两种形态);
      // 表头行(tr>th)无 td, regex 字段全部空 → 自动跳过(引擎 url 字段空过滤)
      itemSelector: { type: 'css', expression: 'table.mytable tr' },
      fields: {
        // ★name/bookUrl/author/latestChapter/status 全部用 regex 字段(引擎缺口绕道):
        // itemSelector 命中 tr 时, 引擎对每个容器项独立 cheerio 重解析, parse5 碎片解析会
        // 丢弃表格上下文元素(td 剥壳文本逃逸), CSS 字段全部落空 — 正则字段作用于容器项
        // 原始 html 字符串不经重解析, 表格布局通吃 (wanben.ts 同款模式)
        name: {
          type: 'regex',
          expression: '<a href="[^"]*/jinyin/\\d+\\.html"[^>]*>([^<]+)</a>',
          attr: '1',
          flags: 'i',
        },
        bookUrl: {
          type: 'regex',
          expression: '<a href="([^"]*/jinyin/\\d+\\.html)"',
          attr: '1',
          flags: 'i',
        },
        author: {
          type: 'regex',
          // 第三 td 无 <a>, class="text-muted" 纯文本 td (区别于第二 td 的 <a class="text-muted">)
          expression: '<td class="text-muted">\\s*([^<]+?)\\s*</td>',
          attr: '1',
          flags: 'i',
        },
        latestChapter: {
          type: 'regex',
          expression:
            '<a class="text-muted" href="[^"]*/jinyin/\\d+/\\d+\\.html"[^>]*>([^<]+)</a>',
          attr: '1',
          flags: 'i',
        },
        status: {
          type: 'regex',
          expression: '<td class="text-nowrap">\\s*([^<]+?)\\s*</td>',
          attr: '1',
          flags: 'i',
        },
      },
      // R31-1C: maxPages 50→30 防过深; 站点 /xuanhuan/{page}/ 共 11933 页但每页 30 本,
      //   30 页 = 900 本发现量已足够覆盖大部分书源(且 fdxrz.com 直连无 WAF, 30 页
      //   响应快); 50 页会让列表阶段抓 25 分钟(每页 ~30s 含 rotate UA + autoCookie);
      //   站点无显式翻页按钮 class(Bootstrap 表格分页用 ul.pagination li a), 引擎
      //   兜底 a:contains("下一页") 命中("下一页"文本即源站 ul.pagination 末项链接)
      pagination: { enabled: true, maxPages: 30 },
    },
    book: {
      enabled: true,
      fields: {
        name: {
          type: 'css',
          expression: "meta[property='og:novel:book_name']",
          attr: 'content',
        },
        author: {
          type: 'css',
          expression: "meta[property='og:novel:author']",
          attr: 'content',
        },
        category: {
          type: 'css',
          expression: "meta[property='og:novel:category']",
          attr: 'content',
        },
        status: {
          type: 'css',
          expression: "meta[property='og:novel:status']",
          attr: 'content',
        },
        latestChapter: {
          type: 'css',
          expression: "meta[property='og:novel:latest_chapter_name']",
          attr: 'content',
        },
        intro: {
          type: 'css',
          expression: "meta[property='og:description'], meta[name='description']",
          attr: 'content',
        },
        cover: { type: 'css', expression: "meta[property='og:image']", attr: 'content' },
      },
    },
    toc: {
      enabled: true,
      // 全部章节内嵌书籍页 #list-chapterAll(实测全量单页无翻页);
      // yiove 原规则 `#list-chapterAll dd a` 含最新章节 dl 与全部章节 dl 重复,
      // 收紧为 `#list-chapterAll dd.col-md-3 > a` 只取全部章节目录
      itemSelector: {
        type: 'css',
        expression: '#list-chapterAll dd.col-md-3 > a, #list-chapterAll dd a',
      },
      fields: {
        // scope=<a>; cheerio 加载 outerHTML 后 <a> 即根节点, "a" 选择器命中自身
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        // .panel-readcontent #htmlContent 双 ID/类命中; 备用 .panel-body.contents 兜底
        content: {
          type: 'css',
          expression: '#htmlContent, .panel-readcontent .panel-body, .panel-readcontent',
          attr: 'html',
        },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      engine: 'http',
      uaMode: 'rotate',
      autoCookie: true,
      referer: true,
      timeout: 25000,
      retries: 2,
      waitMs: 800,
      hostGateLimit: 3,
    },
    clean: {
      removeSelectors: [
        'script',
        'style',
        'iframe',
        'ins',
        'noscript',
        '.adsbygoogle',
        '.ad',
        '#ad',
        '.ads',
        '.page-header',
        '.booktag',
        '.readTitle',
        '.errorlink',
      ],
      // yiove 原规则 JS ad 过滤逻辑全部转 regex (16+ 模式)
      // 顺序敏感: 整段优先(◐本书作者...完整章节）), 再细分短语兜底
      adPatterns: [
        // ★整段综合(优先匹配): 嵌入广告段从 ◐本书作者 到 完整章节） 一次吞掉,
        //   避免分短语剥后残留 ◐本书作者xxx在 等残片(yiove 原逻辑是按行剥, 单行完整吞掉)
        '◐本书作者[^<]*?完整章节）',
        '◐本书作者[^<]*?完整章节\\)',
        // 域名/品牌剥离
        '(www\\.)?fdxrz\\.com\\S*',
        '金\\|?银小说[^<>]*',
        '金银小说[^<>]*',
        '金银[^<>]*?修复[^<>]*',
        // 嵌入广告段细分(原 yiove filter 数组逐条转 regex, 兜底处理变体)
        '提醒您[^<]*?最新章节',
        '记住[^<]*?域名',
        '牢记[^<]*?域名',
        '金银小说[^<]*?首发',
        '金银小说[^<]*?无弹窗',
        '金银小说[^<]*?完整章节',
        '全网首发无弹窗[^<>]*',
        '网址：[^<]*?/book/[^<>]*',
        '如章节缺失[^<>]*',
        '#阅#读#模#式[^<>]*',
        '你看#到的[^<>]*',
        '推荐他的其他作品[^<>]*',
        '记住域名[^<>]*',
        '讨论本书[^<>]*',
        '请来[^<]*?完整章节',
        '（请来[^<]*?完整章节）',
        // 残片兜底(◐本书作者xxx在 等综合剥后剩余的小尾巴)
        '◐本书作者[^<>]*',
        '◐[^<>]*完整章节[^<>]*',
        // 通用兜底
        '本章未完.*?点击下一页继续阅读',
        '最新章节请到[^<>]*查看',
        '一秒记住[^<>]*',
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      normalize: true,
      plainText: false,
    },
  },
}

async function main() {
  // 1. 登录获取 cookie
  console.log('== 金银小说 (fdxrz.com) 规则入库 ==')
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  if (!loginRes.ok) {
    console.error('登录失败:', loginRes.status)
    process.exit(1)
  }
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const cookieMatch = setCookie.match(/heis_admin=([^;]+)/)
  const cookie = cookieMatch ? `heis_admin=${cookieMatch[1]}` : ''
  if (!cookie) {
    console.error('无法获取 auth cookie')
    process.exit(1)
  }
  console.log('登录成功')

  // 2. 幂等: 删同名旧规则(含历史重复名)
  const listRes = await fetch(`${BASE}/api/admin/rules?take=200`, { headers: { cookie } })
  const listJson = (await listRes.json()) as {
    ok: boolean
    data?: { id: string; name: string }[]
  }
  const raw = Array.isArray(listJson.data) ? listJson.data : []
  const dups = raw.filter((r) => r.name === rule.name)
  for (const d of dups) {
    await fetch(`${BASE}/api/admin/rules/${d.id}`, { method: 'DELETE', headers: { cookie } })
    console.log('  旧规则已删除:', d.id)
  }

  // 3. 创建规则
  const res = await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(rule),
  })
  const json = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)

  console.log('\n✅ 金银小说规则已入库')
  console.log('注: 站点无 CF 防护(裸 curl 200), 选择器已实测命中。')
  console.log('    分类页 /xuanhuan/{page}/ 共 11933 页, 每页 ~30 本。')
  console.log('    书籍页 og:novel:* meta 全套, yiove 标准结构。')
  console.log('    正文嵌入广告段全套 adPatterns (16+ regex) 剥离, 请用测试面板验证。')
}

main()

export {}
