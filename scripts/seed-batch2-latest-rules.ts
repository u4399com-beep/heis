// 批量种子脚本: batch 2 站点首页"最近更新"规则
// 用法: bun run scripts/seed-batch2-latest-rules.ts
//
// 侦察结论(实测 curl 2026-09-12):
//  ✅ ixdzs8.com  — 首页 .panel:last 含 <h2><a href="/new/">最近更新</a></h2>, ul.u-line li
//     15 项每项含 name/bookUrl/author/category/latestChapter/updateTime(无封面)
//  ✅ biquge.tw   — 首页 div.list-index-3 .item (6 项), dt a 书名+链, dd.author/.intro/.more,
//     .cover img[data-src] 封面, .cover span " / 全本|连载" 状态, dd.more span 字数+日期
//  ✅ bqg713.cc   — JSON API /api/index?sort=all 含 uplist[] (30 项), 字段 id/title/author/
//     sortname/lastchapter/lastchapterid/uptime; bookUrl 用 const 模板 /api/book?id={id}
//  ✅ shudugu.org — 首页 div.container > div.item (11 项), 同分类页结构(h1/h3 a 书名+链,
//     p span 状态+类别, p a "作者：xxx", ul li 最新三章, img 封面)
//  ✅ piaotia.com — 首页 .block:contains("最近更新") ul.ulmul (唯一 ul.ulmul), li.fl.lm
//     书目项 + li.fr.tr 作者+日期(分立两 li); 提 name/bookUrl/latestChapter/latestChapterUrl/
//     category(regex 提取 [类别])
//  ⚠ hnxianxin.cn — /qd/ SPA 壳无 SSR, /qd/ranking.php?action=ranking 返 JSON Books[]20项
//     含全字段(name/author/category/wordsCount/description), 但 LastUpdateTime=0 非"最近更新"
//     排序而是首页 ranking; 现有 search.php 规则已覆盖书籍详情, 此处跳过(非清晰 latest 段)
//  ⚠ jpxs123.com — 现有规则 urlTemplate=https://jpxs123.com/ + selector div.bk 已覆盖
//     首页"最新小說"段(每页 10+ 项含 title/bookUrl/author/intro/cover), 跳过
//  ⚠ dafengdagengren / daweixs — 现有规则 urlTemplate=/xuanhuanxiaoshuo/ 已覆盖"最近更新
//     小说列表"(分类页 30 本/页; 主列表区 ul.txt-list-row5 li), 首页本身 403 双 Set-Cookie
//     挑战需浏览器引擎故不直接抓首页; 跳过(现有规则已等价覆盖)
//  ⚠ 23qb.net     — 首页仅有 1 个 .module 含 16 .module-item 无明确"最近更新"标题; 现有规则
//     /book/lastupdate_*.html 才是真"最近更新"列表页; 跳过
//  ❌ pilishuwu/guichuideng/dongliuxiaoshuo/libahao2/hetushu — Cloudflare 5xx 挑战
//     (裸 curl 403 + /cdn-cgi/challenge-platform 挑战页), 需 Obscura 浏览器引擎; 跳过
//  ❌ shucong.com — nginx 403 直拒(非 CF), 需浏览器引擎; 跳过

import { db } from '../src/lib/db'

const BASE = 'http://localhost:3000'
const PASSWORD = process.env.ADMIN_PASSWORD || 'audit-fix-2025'

// ---------------- 5 个规则定义 ----------------
interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown // 入库前 JSON.stringify (schema.config 字段为 String 类型)
}

// Prisma Rule 模型 config 字段为 String, 入库前需序列化
function toRecord(rule: RuleSeed): { name: string; description: string; enabled: boolean; config: string } {
  return { name: rule.name, description: rule.description, enabled: rule.enabled, config: JSON.stringify(rule.config) }
}

const rules: RuleSeed[] = [
  // 1. ixdzs8 首页最近更新
  {
    name: '爱下电子书(ixdzs8.com)·首页最近更新',
    description:
      'ixdzs8.com 首页"最近更新"段采集(共 9 个 .panel 区块中最后一块, 标题 <h2><a href="/new/">最近更新</a></h2>; 仅本页唯一 ul.u-line li). 每项含 .l-name h3.bname a 书名+链, .l-author .bauthor a 作者, .l-sort a 类别, .l-nchapter a 最新章+链, .l-ntime 更新时间. 列表段单页(无分页); 书籍/目录/正文走现有 ixdzs8 主规则(li.burl 列表 + og:meta + article.page-content)。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://ixdzs8.com/',
        itemSelector: { type: 'css', expression: 'ul.u-line li' },
        fields: {
          name: { type: 'css', expression: '.l-name h3.bname a', attr: 'text' },
          bookUrl: { type: 'css', expression: '.l-name h3.bname a', attr: 'href' },
          author: { type: 'css', expression: '.l-author .bauthor a', attr: 'text' },
          category: { type: 'css', expression: '.l-sort a', attr: 'text' },
          latestChapter: { type: 'css', expression: '.l-nchapter a', attr: 'text' },
          latestChapterUrl: { type: 'css', expression: '.l-nchapter a', attr: 'href' },
          updateTime: { type: 'css', expression: '.l-ntime', attr: 'text' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      book: { enabled: false, fields: {} },
      toc: { enabled: false, itemSelector: { type: 'css', expression: '' }, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      content: { enabled: false, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      fetch: { engine: 'auto', uaMode: 'desktop', autoCookie: true, referer: true, timeout: 20000, retries: 2, waitMs: 800 },
      clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: false },
      enabled: true,
    },
  },
  // 2. biquge.tw 首页最近更新
  {
    name: '笔趣阁(www.biquge.tw)·首页最近更新',
    description:
      'biquge.tw 首页"最近更新"段采集(共 6 个区块, div.list-index-3 含 h2"最近更新", 6 项 .item). 每项 dt a 书名+链, dd.author 作者, dd.intro 简介(空内容"..."), .cover img[data-src] 封面懒加载, .cover span " / 全本|连载" 状态原文(交 smartCompleteDetect), dd.more span 字数+日期. 现有"直连SSR采集"规则用 /sort/{page}.html 列表页; 本规则专采首页 6 本最新更新快照。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://www.biquge.tw/',
        itemSelector: { type: 'css', expression: '.list-index-3 .item' },
        fields: {
          name: { type: 'css', expression: 'dt a', attr: 'text' },
          bookUrl: { type: 'css', expression: 'dt a', attr: 'href' },
          author: { type: 'css', expression: 'dd.author', attr: 'text' },
          intro: { type: 'css', expression: 'dd.intro', attr: 'text' },
          cover: { type: 'css', expression: '.cover img', attr: 'data-src' },
          status: { type: 'css', expression: '.cover span', attr: 'text' },
          wordCount: { type: 'css', expression: 'dd.more span:first-child', attr: 'text' },
          updateTime: { type: 'css', expression: 'dd.more span:last-child', attr: 'text' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      book: { enabled: false, fields: {} },
      toc: { enabled: false, itemSelector: { type: 'css', expression: '' }, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      content: { enabled: false, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      fetch: { engine: 'auto', uaMode: 'desktop', autoCookie: true, referer: true, timeout: 20000, retries: 2, waitMs: 800 },
      clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: false },
      enabled: true,
    },
  },
  // 3. bqg713 首页最近更新(JSON uplist)
  {
    name: '笔趣阁bqg713(www.bqg713.cc)·首页最近更新',
    description:
      'bqg713.cc JSON API /api/index?sort=all 顶层 uplist 数组(30 项), 字段 id/title/author/sortname/lastchapter/lastchapterid/uptime; bookUrl 用 const 模板 /api/book?id={id} 复用主规则同款书籍 API URL. 与现有主规则(hotlist,sort1~6)互不重叠(主规则不含 uplist); 本规则专采"最近更新"榜单 30 本快照。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://www.bqg713.cc/api/index?sort=all',
        itemSelector: { type: 'json', expression: 'uplist' },
        fields: {
          id: { type: 'json', expression: 'id' },
          name: { type: 'json', expression: 'title' },
          author: { type: 'json', expression: 'author' },
          category: { type: 'json', expression: 'sortname' },
          latestChapter: { type: 'json', expression: 'lastchapter' },
          latestChapterId: { type: 'json', expression: 'lastchapterid' },
          updateTime: { type: 'json', expression: 'uptime' },
          bookUrl: { type: 'const', expression: 'https://www.bqg713.cc/api/book?id={id}' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      book: { enabled: false, fields: {} },
      toc: { enabled: false, itemSelector: { type: 'css', expression: '' }, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      content: { enabled: false, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      fetch: { engine: 'auto', uaMode: 'rotate', autoCookie: true, referer: true, timeout: 20000, retries: 2, waitMs: 500, browserFallbackStatus: [403, 429, 503] },
      clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: false },
      enabled: true,
    },
  },
  // 4. shudugu 首页最近更新
  {
    name: '速读谷(shudugu.org)·首页最近更新',
    description:
      'shudugu.org 首页 div.container > div.item(11 本, 含 1 个置顶 h1"捞尸人" + 10 常规 h3), 同分类页 .itemtxt 结构(h3/h1 a 书名+链, p a "作者：xxx" 剥前缀, p span 状态+类别, ul li 最新三章, img 绝对地址封面). 现有主规则用 /xuanhuan/{page}.html 分类页 30 本/页, 本规则专采首页 11 本"最新更新"快照(置顶"捞尸人"为强推位)。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://www.shudugu.org/',
        itemSelector: { type: 'css', expression: 'div.item' },
        fields: {
          name: { type: 'css', expression: '.itemtxt h3 a, .itemtxt h1 a', attr: 'text' },
          bookUrl: { type: 'css', expression: '.itemtxt h3 a, .itemtxt h1 a', attr: 'href' },
          author: {
            type: 'css',
            expression: '.itemtxt p a',
            attr: 'text',
            replaceFrom: '^作者[:：]\\s*',
            replaceTo: '',
          },
          status: { type: 'css', expression: '.itemtxt p span', attr: 'text' },
          cover: { type: 'css', expression: 'img', attr: 'src' },
          latestChapter: { type: 'css', expression: '.itemtxt ul li a', attr: 'text' },
          latestChapterUrl: { type: 'css', expression: '.itemtxt ul li a', attr: 'href' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      book: { enabled: false, fields: {} },
      toc: { enabled: false, itemSelector: { type: 'css', expression: '' }, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      content: { enabled: false, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      fetch: { engine: 'auto', uaMode: 'rotate', autoCookie: true, referer: true, timeout: 25000, retries: 2, waitMs: 800 },
      clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: false },
      enabled: true,
    },
  },
  // 5. piaotia 首页最近更新
  {
    name: '飘天文学(www.piaotia.com)·首页最近更新',
    description:
      'piaotia.com 首页"最近更新"段(全页唯一 ul.ulmul, .blocktitle 标题"最近更新"), li.fl.lm 项内 3 个 a 顺序: 1.a.poptext 书名+bookinfo 链, 2.a 目录链接, 3.a 最新章+正文链; 类别用 regex 提取 li 文本起始 [xxx] 括号内字符(cheerio 序列化含 <li> 标签故 ^ 锚失效, 用无锚 \\[([^\\]]+)\\] 取首个方括号即类别). 现有主规则用 /booksort1/0/{page}.html 表格分类页; 本规则专采首页最近更新 30 本快照(无作者字段——作者+日期在紧邻 li.fr.tr 同级 li, parser 不支持跨 li 取值故略)。',
    enabled: true,
    config: {
      list: {
        enabled: true,
        urlTemplate: 'https://www.piaotia.com/',
        itemSelector: { type: 'css', expression: 'ul.ulmul li.fl.lm' },
        fields: {
          name: { type: 'css', expression: 'a.poptext', attr: 'text' },
          bookUrl: { type: 'css', expression: 'a.poptext', attr: 'href' },
          latestChapter: { type: 'css', expression: 'a:last-child', attr: 'text' },
          latestChapterUrl: { type: 'css', expression: 'a:last-child', attr: 'href' },
          category: { type: 'regex', expression: '\\[([^\\]]+)\\]', attr: '1', flags: 'gs' },
        },
        pagination: { enabled: false, maxPages: 1 },
      },
      book: { enabled: false, fields: {} },
      toc: { enabled: false, itemSelector: { type: 'css', expression: '' }, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      content: { enabled: false, fields: {}, pagination: { enabled: false, maxPages: 1 } },
      fetch: { engine: 'auto', uaMode: 'desktop', autoCookie: true, referer: true, timeout: 20000, retries: 2, waitMs: 800 },
      clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: false },
      enabled: true,
    },
  },
]

// ---------------- 测试辅助 ----------------
interface TestResp {
  ok: boolean
  message?: string
  data?: Record<string, unknown>
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`login failed: ${res.status}`)
  const setCookie = res.headers.get('set-cookie') || ''
  const m = setCookie.match(/heis_admin=([^;]+)/)
  if (!m) throw new Error('no heis_admin cookie')
  return `heis_admin=${m[1]}`
}

async function testList(cookie: string, rule: RuleSeed): Promise<{ count: number; sample: unknown[]; ms: number } | null> {
  const listCfg = (rule.config as Record<string, any>).list
  const fetchCfg = (rule.config as Record<string, any>).fetch
  const cleanCfg = (rule.config as Record<string, any>).clean
  const res = await fetch(`${BASE}/api/admin/rules/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      section: 'list',
      url: listCfg.urlTemplate,
      rule: listCfg,
      fetch: fetchCfg,
      clean: cleanCfg,
    }),
  })
  const json = (await res.json()) as TestResp
  if (!json.ok) {
    console.log(`  ❌ ${rule.name}: ${json.message}`)
    return null
  }
  const d = json.data as Record<string, any>
  return { count: d.count as number, sample: (d.sample as unknown[]) || [], ms: d.ms as number }
}

// ---------------- main ----------------
async function main() {
  console.log('== batch 2 首页最近更新规则批量入库 ==\n')

  // 1. 登录
  const cookie = await login()
  console.log('登录成功\n')

  // 2. 入库 + 测试每个规则
  let createdCount = 0
  let testedOkCount = 0
  const results: { name: string; count: number; ok: boolean }[] = []

  for (const rule of rules) {
    console.log(`--- ${rule.name} ---`)
    // 幂等入库: 同名先删后建
    const existing = await db.rule.findFirst({ where: { name: rule.name } })
    const rec = toRecord(rule)
    if (existing) {
      await db.rule.update({ where: { id: existing.id }, data: rec })
      console.log(`  update: id=${existing.id}`)
    } else {
      const created = await db.rule.create({ data: rec })
      console.log(`  create: id=${created.id}`)
    }
    createdCount++

    // 测试
    const t = await testList(cookie, rule)
    if (t) {
      console.log(`  ✅ list count=${t.count} ${t.ms}ms`)
      testedOkCount++
      results.push({ name: rule.name, count: t.count, ok: true })
      // 显示首条样本
      const first = t.sample[0] as Record<string, unknown> | undefined
      if (first) console.log('    sample:', JSON.stringify(first).slice(0, 200))
    } else {
      results.push({ name: rule.name, count: 0, ok: false })
    }
    console.log()
  }

  // 3. 汇总
  console.log('== Stage Summary ==')
  console.log(`  rules created/updated: ${createdCount}`)
  console.log(`  rules tested OK:      ${testedOkCount}`)
  console.log(`  rules failed test:    ${createdCount - testedOkCount}`)
  console.log()
  console.log('  per-rule results:')
  for (const r of results) {
    console.log(`    ${r.ok ? '✅' : '❌'} ${r.name}: ${r.count} items`)
  }

  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
