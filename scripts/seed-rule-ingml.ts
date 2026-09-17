// 种子脚本: 瀚海书阁 (www.ingml.cc) 采集规则
// 用法: bun run scripts/seed-rule-ingml.ts
//
// 实测侦察(2026-09, 裸 curl 200, 无 CF 防护, Tailwind CDN + 暗色模式):
//  - 站点框架: Tailwind CSS (cdn.tailwindcss.com) + Font Awesome 6 + 暗色模式
//    (dark:bg-dark / dark:text-gray-200, blue-500 主色, sticky header)
//  - URL 结构:
//    * 列表 = 首页 `/` 卡片网格 `div.grid.grid-cols-1.md:grid-cols-3.gap-6` 内
//      `<a class="bg-light-secondary rounded-lg overflow-hidden shadow-sm flex flex-col
//      md:flex-row card-hover..." href="/novel/{id}.html">` 卡片; 卡片含
//      h3.text-lg.font-bold 书名 + img object-cover 封面 + p.text-gray-500.text-sm
//      作者(作者：xxx) + span.bg-red-100 分类 + span.bg-green-100 已完结/bgc-yellow 连载中 +
//      p.mt-3.line-clamp-2 简介。首页另有 `<table>` 更新列表(tr>td>a /novel/{id}.html +
//      /book/{bid}/{cid}.html 最新章节), 优先用卡片网格。
//    * 书籍页 = `/novel/{id}.html`: h1.text-2xl.font-bold 书名 + 小信息行
//      `<a href^="/home/search/index.html?keyword=">作者</a>` + `<a href^="/lists/">分类</a>`
//      + `<i>xx万字</i>` + span 已完结/连载中 + og:image 封面 + 简介块
//      `<h2 class="section-title">小说简介</h2>` 后的 `div.text-gray-700.leading-relaxed`。
//      ingml.cc 不使用 og:novel:* meta, 只用通用 og:title/description/image。
//    * 目录 = 书籍页 `#chapter-list > a.chapter-item`, 含 `<span>` 章节名 + href
//      `/book/{bid}/{hash}.html`; 全量内嵌, 无翻页。
//    * 正文 = `/book/{bid}/{hash}.html`: `#j_readMainWrap .read-content.j_readContent`
//      html, 段落用 `<p>...</p>` (注意源站部分 `</br>` 自闭合写法不规范但 cheerio 容错)。
//  - fetch 配置: engine=http (200 无 CF), uaMode=rotate, autoCookie, referer, 20s 超时, 2 重试
//  - clean: 标准 + ingml.cc 域名剥离 + "瀚海书阁" 品牌剥离
const BASE = process.env.BASE || 'http://localhost:3000'
const PASSWORD = process.env.ADMIN_PASSWORD || 'audit-fix-2025'

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '瀚海书阁 (www.ingml.cc)·Tailwind 现代响应式',
  description:
    '[实测裸 curl 200 无 CF] www.ingml.cc 瀚海书阁, Tailwind CSS + Font Awesome 6 + 暗色模式站, blue-500 主色。首页 = 卡片网格 div.grid.md:grid-cols-3 内 a.card-hover(h3.text-lg.font-bold 书名 + img object-cover 封面 + p.text-gray-500 作者:前缀 + span.bg-red-100 分类 + span.bg-green-100 已完结 + p.mt-3.line-clamp-2 简介, href=/novel/{id}.html); 首页另有 table 更新列表(tr>td>a /novel/{id}.html + td>a /book/{bid}/{cid}.html 最新章节)作辅助。书籍页 /novel/{id}.html: h1.text-2xl 书名 + a[href^=/home/search/index.html?keyword=] 作者 + a[href^=/lists/] 分类 + i xx万字 + span 已完结/连载中 + og:image 封面 + section-title 简介块下 div.text-gray-700。无 og:novel:* meta, 走 og:title/description/image 通用提取。目录 #chapter-list>a.chapter-item(全量内嵌无翻页, span 标题 + href /book/{bid}/{hash}.html)。正文 /book/{bid}/{hash}.html: #j_readMainWrap .read-content.j_readContent html(<p> 段落)。fetch engine=http+uaMode rotate+autoCookie+referer+20s+2retry; clean 标准+ingml.cc 域名剥离+瀚海书阁品牌剥离。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 首页卡片网格作为列表源(全站最新精选 12 本);
      // 备用列表入口: /lists/{catId}.html 分类页(同款 table + 卡片结构)
      urlTemplate: 'https://www.ingml.cc/',
      itemSelector: {
        type: 'css',
        expression: 'a.card-hover',
      },
      fields: {
        name: { type: 'css', expression: 'h3.text-lg.font-bold.truncate, h3', attr: 'text' },
        // scope=card 的 <a> 自身; cheerio 加载 outerHTML 后 <a> 即根节点, "a" 选择器命中自身
        bookUrl: { type: 'css', expression: 'a', attr: 'href' },
        author: {
          type: 'css',
          expression: 'p.text-gray-500.text-sm, p.text-gray-500',
          attr: 'text',
        },
        intro: {
          type: 'css',
          expression: 'p.mt-3.line-clamp-2, p.line-clamp-2',
          attr: 'text',
        },
        cover: { type: 'css', expression: 'img', attr: 'src' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        name: {
          type: 'css',
          expression: 'h1.text-2xl.font-bold, h1',
          attr: 'text',
        },
        // 作者链接 /home/search/index.html?keyword=xxx
        author: {
          type: 'css',
          expression: 'a[href^="/home/search/index.html?keyword="]',
          attr: 'text',
        },
        // 分类链接在小信息行 span>i.fa-folder + a, 避开 nav 下拉菜单的 /lists/ 链接
        category: {
          type: 'css',
          expression: 'i.fa-folder + a, i.fa-folder ~ a[href^="/lists/"]',
          attr: 'text',
        },
        // 已完结 / 连载中 span (与分类 span 同色族, 取绿色族 span)
        status: {
          type: 'css',
          expression:
            'span.px-2.py-1.bg-green-100, span.bg-green-100, span.bg-yellow-100, span[class*="bg-"][class*="-100"]',
          attr: 'text',
        },
        intro: {
          type: 'css',
          expression:
            'h2.section-title + div, div.text-gray-700.dark\\:text-gray-300.leading-relaxed, div.leading-relaxed',
          attr: 'html',
        },
        cover: {
          type: 'css',
          expression: 'meta[property="og:image"]',
          attr: 'content',
        },
      },
    },
    toc: {
      enabled: true,
      // 全部章节内嵌书籍页 #chapter-list, 全量单页无翻页
      itemSelector: { type: 'css', expression: '#chapter-list > a.chapter-item' },
      fields: {
        title: { type: 'css', expression: 'span', attr: 'text' },
        // scope=<a>; 用 "a" 选择器命中自身 href
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        // .read-content.j_readContent 双类命中, 备用 #j_readMainWrap 兜底
        content: {
          type: 'css',
          expression: '.read-content.j_readContent, #j_readMainWrap, .read-content',
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
      timeout: 20000,
      retries: 2,
      waitMs: 800,
      hostGateLimit: 2,
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
        'i.iconfont',
        '.text-head',
        '.text-info',
      ],
      adPatterns: [
        '(www\\.)?ingml\\.cc\\S*',
        '瀚海书阁[^<>]*',
        '本书作者[^<>]*提醒您[^<>]*',
        '最新章节请到[^<>]*查看',
        '请记住本站[^<>]*',
        '一秒记住[^<>]*',
        '本章未完.*?点击下一页继续阅读',
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
  console.log('== 瀚海书阁 (ingml.cc) 规则入库 ==')
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

  console.log('\n✅ 瀚海书阁规则已入库')
  console.log('注: 站点无 CF 防护(裸 curl 200), 选择器已实测命中。')
  console.log('    首页卡片网格 12 本 + 更新 table 双入口, 取卡片优先(字段更全)。')
  console.log('    目录全量内嵌无翻页, 正文 #j_readMainWrap 双类命中。')
}

main()

export {}
