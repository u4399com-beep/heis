// 种子脚本: WuxiaWorld Lite (lite.wuxiaworld.com) 英文英译站采集规则
// 用法: bun run scripts/seed-rule-wuxiaworld.ts
// 侦察结论(2024 实测):
//  - lite 子站为纯 SSR 静态页(主站 www 为 JS 重定向壳, 无需浏览器)
//  - 列表页 /novels: td.novel-cell(name/bookUrl/cover/tag状态·分类/syn简介), after 游标分页不兼容 {page} 模板 → 单页采集
//  - 书籍页 /novel/{slug}: main h1 书名 / p.muted.small 元信息(状态·作者·译者·章数) / div.chapter-body 简介 / div.cover img 封面
//  - 目录内嵌书籍页 <ul class="toc">: ?toc=N 标准页码分页(a.btn.next), 二页及以上自动跟随
//  - 正文页 /novel/{slug}/{chapter}: div.chapter-viewport 内 <p data-uid> 段落(嵌套 span/em)
//  - VIP(premium advance) 锁定章节无 viewport 容器 → 提取空按失败标记, 不污染数据(付费内容本就不采)
//  - CF 探测脚本(challenge-platform/jsd)存在但静态请求放行, 引擎 JSD 豁免逻辑覆盖
const BASE = 'http://localhost:3000'

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: 'WuxiaWorld Lite(lite.wuxiaworld.com)·英文英译站采集',
  description:
    'lite.wuxiaworld.com 英译网文站(SSR 纯静态, 免浏览器)。列表 td.novel-cell / 书籍页 h1+meta 行+chapter-body 简介 / 目录 ul.toc(?toc=N 分页自动跟随) / 正文 div.chapter-viewport。VIP 锁定章节无容器自动失败不污染。中文分类词表对英文分类无效→未分类兜底, 完结判断按 Ongoing/Completed 原文存状态字段。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // 游标分页(?after=id)不兼容 {page} 模板 → 固定单页 24 本; 需要更多书时换筛选变体:
      //   ?sort=popular|new|chapters|name|rating  ×  ?status=ongoing|completed|hiatus  ×  ?q=关键词
      urlTemplate: 'https://lite.wuxiaworld.com/novels?sort=chapters',
      itemSelector: { type: 'css', expression: 'td.novel-cell' },
      fields: {
        name: { type: 'css', expression: 'p.title a', attr: 'text' },
        bookUrl: { type: 'css', expression: 'p.title a', attr: 'href' },
        cover: { type: 'css', expression: 'a.cover img', attr: 'src' },
        status: { type: 'css', expression: 'p.tag', attr: 'text', replaceFrom: '\\s*·[\\s\\S]*$', replaceTo: '' },
        category: { type: 'css', expression: 'p.tag', attr: 'text', replaceFrom: '^[\\s\\S]*?·\\s*', replaceTo: '' },
        intro: { type: 'css', expression: 'p.syn', attr: 'text' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'css', expression: 'main h1', attr: 'text' },
        author: {
          type: 'css', expression: 'p.muted.small', attr: 'text',
          // "Ongoing · Author: Pitiful Xixi (可怜的夕夕) · Translator: Sanguine · 110 chapters" → 作者名
          replaceFrom: '^[\\s\\S]*?Author:\\s*([^·]+?)(?:\\s*·[\\s\\S]*)?$', replaceTo: '$1',
        },
        status: {
          type: 'css', expression: 'p.muted.small', attr: 'text',
          // → Ongoing / Completed / Hiatus
          replaceFrom: '^\\s*(Ongoing|Completed|Hiatus)\\b[\\s\\S]*$', replaceTo: '$1',
        },
        intro: { type: 'css', expression: 'div.chapter-body', attr: 'html' },
        cover: { type: 'css', expression: 'div.cover img', attr: 'src' },
        latestChapter: {
          type: 'css', expression: 'p.muted.small', attr: 'text',
          // 元信息行无章节名, 用 "N chapters" 构造进度说明(可选字段, 空则目录补)
          replaceFrom: '^[\\s\\S]*?(\\d+)\\s+chapters[\\s\\S]*$', replaceTo: '全书共 $1 章',
        },
      },
    },
    toc: {
      enabled: true,
      itemSelector: { type: 'css', expression: 'ul.toc li' },
      fields: {
        title: { type: 'css', expression: 'a', attr: 'text' },
        url: { type: 'css', expression: 'a', attr: 'href' },
      },
      // ?toc=N 标准页码分页(每页约100章); 超长书(2000+章)按 100 章上限放宽
      pagination: { enabled: true, maxPages: 100, joinWith: '', nextLink: { type: 'css', expression: 'a.btn.next', attr: 'href' } },
    },
    content: {
      enabled: true,
      fields: { content: { type: 'css', expression: 'div.chapter-viewport', attr: 'html' } },
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      engine: 'http',
      uaMode: 'rotate',
      autoCookie: true,
      referer: true,
      timeout: 25000,
      retries: 2,
      waitMs: 2000,
      browserFallbackStatus: [403, 429, 503],
    },
    clean: {
      removeSelectors: [
        'script', 'style', 'iframe', 'ins', 'noscript', '.adsbygoogle',
        // VIP 锁定提示/阅读器导航/章节搜索框(防御性; 免费章正文区内本不含这些)
        'div.notice', 'div.chapter-nav', 'div.reader-controls', 'div.search-form', 'form',
      ],
      adPatterns: [
        // 站点自我推广链接与常见英译站尾部噪音
        '(www\\.)?wuxiaworld\\.com\\S*',
        'Please\\s+(rate|follow|bookmark)[^.]*',
        'Translator[:\\s].{0,40}Editor[:\\s].{0,40}',
        'Join\\s+our?\\s+(discord|community)[^.]*',
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3'],
      normalize: true,
      plainText: false,
    },
  },
}

async function main() {
  // 幂等: 同名规则先删后建
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`)
  const listJson = await listRes.json() as { ok: boolean; data?: { rules?: { id: string; name: string }[] } }
  const existing = (Array.isArray(listJson.data) ? listJson.data : listJson.data?.rules || []).find((r) => r.name === rule.name)
  if (existing) {
    const del = await fetch(`${BASE}/api/admin/rules/${existing.id}`, { method: 'DELETE' })
    const delJson = await del.json() as { ok: boolean }
    console.log('旧规则已删除:', existing.id, delJson.ok)
  }
  const res = await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  })
  const json = await res.json() as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)
}

main()

export {}
