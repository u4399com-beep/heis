// ============================================================
// 种子脚本: 模拟源站·校准演示 (127.0.0.1:3040) (Task ab-a)
// 用法: bun run scripts/seed-rule-ratelimit-demo.ts
// 幂等: 同名规则先删后建; import.meta.main 守卫
//
// ================= 结构依据(scripts/ratelimit-site.ts 源码逐行) =================
// 模拟源站返回【HTML】四段页面(与真实小说站同构, 非JSON → 引擎 css 型选择器):
//  1) GET /list/{page} → <ul id="list"><li class="book-item">
//       <a href="/book/{id}">书名</a><span>作者</span></li>×8 (每页恒 8 本)
//  2) GET /book/{id} → <div id="maininfo"><h1>书名</h1>
//       <p>作者：xx</p><p>分类：xx</p>
//       <meta name="keywords" content="书名,分类,作者">
//       <div id="intro">简介</div>
//       <a id="toclink" href="/toc/{id}">查看完整目录</a></div>
//  3) GET /toc/{id} → <dl id="toc"><dd><a href="/chapter/{id}/{n}">第n章 xx</a></dd>×60
//  4) GET /chapter/{id}/{n} → <div id="content"><h2>章名</h2><p>…</p>×4</div>
// 规则本身与校准探测相互独立(校准探"源站耐受度"而非"规则解析力"), 但本规则
// enabled=true 参与 calibrate-all 全量校准; 同时可供真实采集任务端到端验证
// (校准参数落库 + 任务级覆盖 → 观察限流冷却与采集统计)。
// ============================================================
export {}
export const RULE_NAME = '模拟源站·校准演示 (127.0.0.1:3040)'

export const SITE_BASE = 'http://127.0.0.1:3040'

export const ruleConfig = {
  list: {
    enabled: true,
    urlTemplate: `${SITE_BASE}/list/{page}`,
    itemSelector: { type: 'css', expression: 'ul#list li.book-item' },
    fields: {
      name: { type: 'css', expression: 'a', attr: 'text' },
      author: { type: 'css', expression: 'span', attr: 'text' },
      // 相对路径 /book/{id} → parseList 按列表页 URL absolutize 补全 host
      bookUrl: { type: 'css', expression: 'a', attr: 'href' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: 'css', expression: '#maininfo h1', attr: 'text' },
      author: {
        type: 'css',
        expression: '#maininfo p:nth-of-type(1)',
        attr: 'text',
        replaceFrom: '^作者：',
        replaceTo: '',
      },
      category: {
        type: 'css',
        expression: '#maininfo p:nth-of-type(2)',
        attr: 'text',
        replaceFrom: '^分类：',
        replaceTo: '',
      },
      keywords: { type: 'css', expression: 'meta[name="keywords"]', attr: 'content' },
      intro: { type: 'css', expression: '#intro', attr: 'text' },
    },
  },
  toc: {
    enabled: true,
    // 书籍页 "查看完整目录" 链接 → /toc/{id}(absolutize 按书籍页 URL)
    tocLink: { type: 'css', expression: 'a#toclink', attr: 'href' },
    itemSelector: { type: 'css', expression: 'dl#toc dd' },
    fields: {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    },
    // 目录单页全量 60 章, 无翻页
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: {
      content: { type: 'css', expression: 'div#content', attr: 'html' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  fetch: {
    engine: 'http',
    // 校准探测与生产引擎 uaMode=rotate 同款浏览器指纹轮换(strict 档 UA 指纹检测也过得去)
    uaMode: 'rotate',
    autoCookie: true,
    referer: true,
    timeout: 20000,
    retries: 2,
    waitMs: 500,
    // 初始值; 全量校准后由 recommended.hostGateLimit 覆盖落库
    hostGateLimit: 3,
  },
  clean: {
    removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
    // 模拟源站正文无广告形态
    adPatterns: [],
    whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h2'],
    normalize: true,
    plainText: true,
  },
}

const BASE = 'http://localhost:3000'

// ---------- 四段测试(播种前验证规则可被引擎解析) ----------
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
      fetch: (ruleConfig as Record<string, unknown>).fetch,
      clean: (ruleConfig as Record<string, unknown>).clean,
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
  const cfg = ruleConfig as Record<string, any>
  let allPass = true

  console.log('== 模拟源站(127.0.0.1:3040) 四段测试 ==')
  const list = await testSection('list', `${SITE_BASE}/list/1`, cfg.list)
  if (!list || (list.count as number) < 8) allPass = false

  const book = await testSection('book', `${SITE_BASE}/book/1`, cfg.book)
  if (!book || !book.fields || !(book.fields as Record<string, string>).name) allPass = false

  const toc = await testSection('toc', `${SITE_BASE}/toc/1`, cfg.toc)
  if (!toc || (toc.count as number) < 60) { allPass = false; console.log('  !! toc<60 未过线') }

  const content = await testSection('content', `${SITE_BASE}/chapter/1/1`, cfg.content)
  if (!content || (content.cleanedLength as number) < 100) { allPass = false; console.log('  !! content<100 未过线') }

  // 幂等入库: 同名规则先删后建
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`)
  const listJson = (await listRes.json()) as { ok: boolean; data?: { id: string; name: string }[] }
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
        '极限校准演示规则(zz-a 校准系统实战, ab-a): 四段指向本机模拟源站 scripts/ratelimit-site.ts(127.0.0.1:3040, ' +
        'standard 档 60req/60s 窗+2s 突发窗 6+429×5→临时封60s)。HTML 四段 css 型选择器: ' +
        'list=/list/{page}(8本) / book=#maininfo / toc=#toc dd(60章) / content=#content。' +
        '用途: calibrate-all 全量校准 + 校准参数落库后真实采集任务端到端验证。⚠ 源站仅本地 3040 常驻, 生产环境无此站。',
      enabled: true,
      config: ruleConfig,
    }),
  })
  const json = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)
  if (!allPass) process.exit(2)
  console.log('✅ 四段测试全部过线(list=8, toc=60, content≥100)')
}

if (import.meta.main) main()
