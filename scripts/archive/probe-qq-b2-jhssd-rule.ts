/** qq-b2 站1: m.jhsssd.com(精华书阁移动版) 四段测试 → 入库 → 单书任务 */
const API = "http://localhost:3000/api/admin";

const fetchCfg = {
  engine: "http",
  uaMode: "mobile",
  referer: true,
  refererChain: true,
  autoCookie: false,
  timeout: 20000,
  retries: 1,
  hostGateLimit: 3,
};

const clean = {
  removeSelectors: ["script", "style", "iframe", "ins", "noscript"],
  adPatterns: [
    "阅读提示：[^<>]*",
    "本章未完[^<>]*",
    "请记住本站[^<>]*",
    "最新章节首发更新地址[^<>]*",
    "精华书阁[^<>]{0,40}阅读",
    "天才一秒记住[^<>]*",
  ],
};

const config = {
  list: {
    enabled: true,
    urlTemplate: "https://m.jhsssd.com/list/3.html",
    itemSelector: { type: "css", expression: "ul.xbk" },
    fields: {
      name: { type: "css", expression: "li.tjxs span.xsm a", attr: "text" },
      bookUrl: { type: "css", expression: "li.tjimg a", attr: "href" },
      author: { type: "regex", expression: "</a>\\(([^)]{1,30})\\)", attr: "1" },
      intro: { type: "css", expression: "li.tjxs span.xsm + span", attr: "text", replaceFrom: "^简介：", replaceTo: "" },
      cover: { type: "css", expression: "li.tjimg img", attr: "src" },
      status: { type: "css", expression: "li.tjxs span.tjrs i", attr: "text" },
      category: { type: "const", expression: "都市" },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: "css", expression: 'meta[property="og:novel:book_name"]', attr: "content" },
      author: { type: "css", expression: 'meta[property="og:novel:author"]', attr: "content" },
      intro: { type: "css", expression: 'meta[property="og:description"]', attr: "content" },
      cover: { type: "css", expression: 'meta[property="og:image"]', attr: "content" },
      status: { type: "css", expression: 'meta[property="og:novel:status"]', attr: "content" },
      category: { type: "css", expression: 'meta[property="og:novel:category"]', attr: "content" },
    },
  },
  toc: {
    enabled: true,
    itemSelector: { type: "css", expression: "ul.chapter li" },
    fields: {
      title: { type: "css", expression: "a", attr: "text" },
      url: { type: "css", expression: "a", attr: "href" },
    },
    pagination: { enabled: true, nextLink: { type: "css", expression: "div.listpage span.right a", attr: "href" }, maxPages: 140 },
  },
  content: {
    enabled: true,
    fields: {
      title: { type: "css", expression: "div#nr_title", attr: "text", replaceFrom: "\\(\\d+/\\d+\\)", replaceTo: "" },
      content: { type: "css", expression: "div#nr1", attr: "html" },
    },
    pagination: { enabled: true, nextLink: { type: "css", expression: 'a#pb_next:contains("下一页")', attr: "href" }, maxPages: 12 },
  },
  fetch: fetchCfg,
  clean,
};

async function test(section: string, url: string, ruleOverride?: any) {
  const r = await fetch(`${API}/rules/test`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section, url, rule: ruleOverride ?? config[section], fetch: fetchCfg, clean, limit: 5 }),
    signal: AbortSignal.timeout(95000),
  });
  const j: any = await r.json().catch(() => ({}));
  return { s: r.status, j };
}

// ---- 1) list ----
{
  const { s, j } = await test("list", "https://m.jhsssd.com/list/3.html");
  const items = j?.data?.sample || [];
  console.log(`[list] ${s} count=${j?.data?.count}`, JSON.stringify(items[0] || j).slice(0, 400));
}
// ---- 2) book ----
{
  const { s, j } = await test("book", "https://m.jhsssd.com/114604/");
  console.log(`[book] ${s}`, JSON.stringify(j?.data?.fields || j).slice(0, 500));
}
// ---- 3) toc (maxPages=5 快测链路) ----
let tocCount = 0;
{
  const tocFast = JSON.parse(JSON.stringify(config.toc));
  tocFast.pagination.maxPages = 5;
  const { s, j } = await test("toc", "https://m.jhsssd.com/114604/", tocFast);
  tocCount = j?.data?.count || 0;
  const sample = j?.data?.sample || [];
  console.log(`[toc] ${s} count(5页)=${tocCount} pages=${j?.data?.pages}`, JSON.stringify(sample.slice(0, 3)));
}
// ---- 4) content (带翻页) ----
{
  const { s, j } = await test("content", "https://m.jhsssd.com/114604/47132142.html");
  console.log(`[content] ${s} raw=${j?.data?.rawLength} cleaned=${j?.data?.cleanedLength} pages=${j?.data?.pages}`);
  console.log("  text:", (j?.data?.cleanedText || "").replace(/\s+/g, " ").slice(0, 260));
  console.log("  tail:", (j?.data?.cleanedText || "").replace(/\s+/g, " ").slice(-160));
}

// ---- 门禁: 全绿才入库 ----
const gate = { list: 0, book: 0, toc: 0, content: 0 };
{
  const { j } = await test("list", "https://m.jhsssd.com/list/3.html");
  gate.list = j?.data?.count || 0;
  const { j: bj } = await test("book", "https://m.jhsssd.com/114604/");
  gate.book = bj?.data?.fields?.name ? 1 : 0;
  const { j: cj } = await test("content", "https://m.jhsssd.com/114604/47132142.html");
  gate.content = (cj?.data?.cleanedLength || 0) > 300 ? 1 : 0;
  gate.toc = tocCount >= 90 ? 1 : 0;
}
console.log("gate:", JSON.stringify(gate));
if (Object.values(gate).every((v) => v > 0)) {
  const r1 = await fetch(`${API}/rules`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "精华书阁移动版 (m.jhsssd.com)·直连干净站",
      description: "qq-b2轮: jhssd.com 301→m.jhsssd.com, 零反爬UTF-8直连; 列表=list/{1-9}.html 单页; 书页含og:meta全字段+目录20章/页 index_{page} 翻页140页上限; 正文 div#nr1 带页内翻页 _N.html(a#pb_next) 引擎翻页合并; html5接口清单: list分类/书og:meta/toc ul.chapter/content nr1",
      config, enabled: true,
    }),
  });
  const j1: any = await r1.json();
  const ruleId = j1.data?.id;
  console.log("rule create:", r1.status, ruleId || JSON.stringify(j1).slice(0, 200));
  if (ruleId) {
    const r2 = await fetch(`${API}/tasks`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "精华书阁·野花满山村 单书实测",
        ruleId, mode: "single", bookUrl: "https://m.jhsssd.com/114604/",
        recrawlMode: "incremental", storageMode: "db",
        threadMin: 2, threadMax: 2, intervalMin: 300, intervalMax: 600,
        smartCategory: false, smartComplete: false, autoSuggest: false,
      }),
    });
    const j2: any = await r2.json();
    console.log("task create:", r2.status, j2.data?.id || JSON.stringify(j2).slice(0, 200));
    const taskId = j2.data?.id;
    if (taskId) {
      const r3 = await fetch(`${API}/tasks/${taskId}/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
      console.log("task start:", r3.status, (await r3.text()).slice(0, 120));
    }
  }
} else {
  console.log("GATE FAIL — 不入库");
}
export {};
