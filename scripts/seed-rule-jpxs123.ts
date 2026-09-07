// 种子脚本: 精品小说 jpxs123.com (GB2312 繁体站采集规则)
// 用法: bun run scripts/seed-rule-jpxs123.ts
//
// ================= 站点侦察结论(2026-08-30 主控实测) =================
// - GB2312 编码, 页面内容为繁体中文(标题/作者/正文全繁), fetcher 自动解码;
//   入库后 t2s 强信号门自动转简(既有能力, 无需规则处理)
// - 直连无防护(curl 任意 UA 200), engine: http 即可
// - 四层结构:
//   list: 首页 div.bk(书籍卡: a[href=/分类拼音/ID.html] + div.pic>img + div.infos>h3/.booknews/p)
//   book: /{分类}/{书ID}.html — div.book_info(.pic>img 封面 / .infos>h1 书名含"(全本)"状态后缀 /
//         a[href*="/author/"] 作者), 简介无独立容器 → 用 meta[name=description](与正文简介一致)
//   toc:  目录内嵌书籍页(tocLink 缺省 → runner 用书籍页本身解析), 章节链
//         /{分类}/{书ID}/{N}.html 文本"第N节"(注意是"节"不是"章"), regex 天然排除
//         /txt/13-{ID}-0.html(txt下载)与 /author/ 等非纯数字路径
//   content: /{分类}/{书ID}/{N}.html — div.read_chapterDetail <p>段落, 无翻页
// - status: book 段 h1 原文含"(全本)"后缀 → smartCompleteDetect 词表命中 completed;
//   连载书无后缀 → 走简介/末章启发式(既有行为)
// - GET /api/admin/rules 信封 data 直为数组(幂等取法兼容两种形态)
export {}
const BASE = 'http://localhost:3000'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

const rule = {
  name: '精品小说(jpxs123.com)·繁体站直连采集',
  enabled: true,
  config: JSON.stringify({
    list: {
      enabled: true,
      // 首页书籍卡; 无 {page} 占位符 → 单页模式
      urlTemplate: 'https://jpxs123.com/',
      itemSelector: { type: 'css', expression: 'div.bk' },
      fields: {
        title: { type: 'css', expression: 'h3', attr: 'text' },
        bookUrl: { type: 'css', expression: 'a', attr: 'href' },
        author: {
          type: 'css', expression: '.booknews', attr: 'text',
          replaceFrom: '作者[:：]\\s*|\\s*\\d{4}-\\d{2}-\\d{2}\\s*$', replaceTo: '',
        },
        intro: {
          type: 'css', expression: 'div.infos > p', attr: 'text',
          replaceFrom: '^(简介|簡介)[:：]\\s*', replaceTo: '',
        },
        cover: { type: 'css', expression: 'img', attr: 'src' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        // parseBook 消费字段名是 name(非 title); h1 形如 "全能大畫家(全本)" —
        // name 剥状态括号后缀, status 保留原文交 smartCompleteDetect
        name: { type: 'css', expression: 'h1', attr: 'text', replaceFrom: '\\s*[(（](全本|完本|連載中|\\d{1,5}-\\d{1,5})[)）]\\s*$', replaceTo: '' },
        status: { type: 'css', expression: 'h1', attr: 'text' },
        author: { type: 'css', expression: 'a[href*="/author/"]', attr: 'text' },
        cover: { type: 'css', expression: '.book_info img', attr: 'src' },
        intro: { type: 'css', expression: 'meta[name="description"]', attr: 'content' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    toc: {
      enabled: true,
      // 目录内嵌书籍页: 不配 tocLink → runner 以书籍页 HTML 解析;
      // 章节链 <a href="/dsxs/12502/1.html"> 第1节</a> — 末段纯数字.html + "第N节"文本;
      // txt下载(/txt/13-{ID}-0.html 含横杠)与 author 链接天然不匹配
      itemSelector: { type: 'regex', expression: '<a href="[^"]*/\\d{1,6}\\.html">\\s*第\\d+节\\s*</a>', attr: '0', flags: 'gi' },
      fields: {
        title: { type: 'regex', expression: '<a href="[^"]*">\\s*(第\\d+节)\\s*</a>', attr: '1', flags: 'gi' },
        url: { type: 'regex', expression: 'href="([^"]*/\\d{1,6}\\.html)"', attr: '1', flags: 'gi' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        content: { type: 'css', expression: 'div.read_chapterDetail', attr: 'html' },
        title: { type: 'css', expression: '.read_chapterName h1', attr: 'text' },
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
      waitMs: 500,
      browserFallbackStatus: [403, 429, 503],
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
      adPatterns: [
        'jpxs123\\.com\\S*',
        '(请|請)记住本书.*?(首发|首發)',
        '最新章节请到.*?查看',
        '本站最新网址.*?$',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3'],
      normalize: true,
    },
  }),
}

async function main() {
  // 幂等: 同名规则先删后建(信封 data 直为数组, 兼容 data.rules 旧形态)
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`, { headers: { 'User-Agent': UA } })
  const listJson = (await listRes.json()) as { ok: boolean; data?: unknown }
  const arr = Array.isArray(listJson.data)
    ? (listJson.data as { id: string; name: string }[])
    : ((listJson.data as { rules?: { id: string; name: string }[] })?.rules || [])
  const old = arr.find((r) => r.name === rule.name)
  if (old) {
    const del = await fetch(`${BASE}/api/admin/rules/${old.id}`, { method: 'DELETE' })
    console.log('清理同名旧规则:', old.id, del.ok ? 'OK' : 'FAIL')
  }
  const res = await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  })
  const j = (await res.json()) as { ok: boolean; data?: { id: string }; message?: string }
  if (!j.ok) { console.error('入库失败:', j.message); process.exit(1) }
  console.log('入库结果: OK id=' + j.data?.id)
}

main()
