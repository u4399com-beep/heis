// 种子脚本: 霹雳书屋 (www.pilishuwu.com) 采集规则
// 用法: bun run scripts/seed-rule-pilishuwu.ts
//
// 侦察结论:
//   - 站点 Cloudflare 防护: 裸 curl 返回 403 + /cdn-cgi/challenge-platform 挑战页
//   - 需 Obscura 隐身浏览器引擎(engine=auto, browserFallbackStatus 含 403)自动求解 CF 挑战
//   - URL 结构(基于霹雳书屋系通用模板 + pili 主题仿站):
//     * 列表 = /book/index.html 或 /sort/{cat}/{page}.html (分类列表)
//     * 书籍页 = /book/{id}.html
//     * 目录页 = /book/{id}/ (同书籍页, 章节列表内嵌)
//     * 正文 = /book/{bid}/{cid}.html
//   - 推断选择器(需后台测试面板 + 可视化调试器实测微调):
//     * 列表项: .book-item 或 .li (dt>a 书名, .author, .intro, img 封面)
//     * 书籍页: h1 书名 + og:novel:* meta + .intro 简介 + .cover img
//     * 目录: .list dd>a 或 #list li>a
//     * 正文: #content 或 .content 或 #chaptercontent
//   - fetch 配置: engine=auto (HTTP→CF挑战→自动升级浏览器), uaMode=rotate, autoCookie=true
//     browserFallbackStatus=[403,412,429,503] (CF 挑战触发降级)
const BASE = process.env.BASE || 'http://localhost:3000'
const PASSWORD = process.env.ADMIN_PASSWORD || 'audit-fix-2025'

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '霹雳书屋(www.pilishuwu.com)·CF防护隐身采集',
  description:
    '[实测CF] www.pilishuwu.com Cloudflare 防护站(裸 curl 403 + /cdn-cgi/challenge-platform 挑战页)。需 Obscura 隐身浏览器引擎自动求解 CF 挑战(engine=auto + browserFallbackStatus 含 403)。推断结构(需后台测试面板实测微调): 列表=/sort/{cat}/{page}.html 或 /book/index.html(.book-item 或 .li, dt>a 书名/书链, .author 作者, .intro 简介, img 封面) / 书籍页=/book/{id}.html(h1 书名 + og:novel:* meta 全套 + .intro p 简介 + .cover img 封面) / 目录=同书籍页 .list dd>a 或 #list li>a 全量 / 正文=/book/{bid}/{cid}.html div#content 或 .content(纯 <p> 段落)。fetch engine=auto+uaMode rotate+autoCookie+referer, browserFallbackStatus [403,412,429,503] 触发 CF 挑战自动降级浏览器。clean 标准小说站广告模式 + pilishuwu.com 域名剥离。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      urlTemplate: 'https://www.pilishuwu.com/sort/{cat}/{page}.html',
      itemSelector: { type: 'css', expression: '.book-item, .li, .item' },
      fields: {
        name: { type: 'css', expression: 'dt a, h3 a, .title a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'dt a, h3 a, .title a', attr: 'href' },
        author: { type: 'css', expression: '.author, dd.author, .info span', attr: 'text' },
        intro: { type: 'css', expression: '.intro, dd.intro, .desc', attr: 'text' },
        cover: { type: 'css', expression: 'img', attr: 'src' },
        status: { type: 'css', expression: '.status, span.status', attr: 'text' },
      },
      pagination: { enabled: true, maxPages: 20 },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: 'h1', attr: 'text' },
        author: { type: 'css', expression: "meta[property='og:novel:author']", attr: 'content' },
        category: { type: 'css', expression: "meta[property='og:novel:category']", attr: 'content' },
        status: { type: 'css', expression: "meta[property='og:novel:status']", attr: 'content' },
        latestChapter: { type: 'css', expression: "meta[property='og:novel:latest_chapter_name']", attr: 'content' },
        intro: { type: 'css', expression: '.intro p, #intro, .description', attr: 'html' },
        cover: { type: 'css', expression: '.cover img, #fmimg img, .book-cover img', attr: 'src' },
      },
    },
    toc: {
      enabled: true,
      itemSelector: { type: 'css', expression: '.list dd, #list li, .chapter-list li' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: '#content, .content, #chaptercontent', attr: 'html' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      engine: 'auto',
      uaMode: 'rotate',
      autoCookie: true,
      referer: true,
      timeout: 25000,
      retries: 2,
      waitMs: 1000,
      browserFallbackStatus: [403, 412, 429, 503],
      hostGateLimit: 2,
      proxyRotationStrategy: 'round-robin',
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle', '.ad', '#ad', '.ads'],
      adPatterns: [
        '(www\\.)?pilishuwu\\.com\\S*',
        '霹雳书屋[^<>]*',
        '本章未完.*?点击下一页继续阅读',
        '请记住本书.*?域名',
        '最新章节请到.*?查看',
        '一秒记住.*?免费读',
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
  console.log('== 霹雳书屋规则入库 ==')
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

  // 2. 幂等: 删同名旧规则
  const listRes = await fetch(`${BASE}/api/admin/rules?take=200`, { headers: { cookie } })
  const listJson = (await listRes.json()) as { ok: boolean; data?: { id: string; name: string }[] }
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

  console.log('\n✅ 霹雳书屋规则已入库')
  console.log('注: 站点有 CF 防护, 选择器为推断。请在后台 采集规则 → 编辑 → 测试面板 实测微调。')
  console.log('    engine=auto + browserFallbackStatus[403] 会自动降级到 Obscura 隐身浏览器求解 CF 挑战。')
}

main()
