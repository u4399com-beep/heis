/** qq-b2 站2: cn.ttkan.co(天天看小说) 四段测试 → 入库 → 单书任务 */
const API = "http://localhost:3000/api/admin";

const fetchCfg = {
  engine: "http",
  uaMode: "desktop",
  referer: true,
  refererChain: true,
  autoCookie: false,
  timeout: 20000,
  retries: 1,
  hostGateLimit: 3,
};

const clean = {
  removeSelectors: ["script", "style", "iframe", "ins", "noscript"],
  adPatterns: ["章节报错[^<>]*", "添加书签[^<>]*"],
};

const config = {
  list: {
    enabled: true,
    urlTemplate: "https://cn.ttkan.co/novel/class/xuanhuan",
    itemSelector: { type: "css", expression: "div.novel_cell" },
    fields: {
      name: { type: "css", expression: "h3", attr: "text" },
      bookUrl: { type: "css", expression: "a", attr: "href" },
      author: { type: "css", expression: "ul li:nth-child(2)", attr: "text", replaceFrom: "^作者：", replaceTo: "" },
      intro: { type: "css", expression: "ul li:nth-child(3)", attr: "text", replaceFrom: "^简介：", replaceTo: "" },
      cover: { type: "css", expression: "amp-img", attr: "src", replaceFrom: "\\?.*$", replaceTo: "" },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: "css", expression: 'meta[name="og:novel:book_name"]', attr: "content" },
      author: { type: "css", expression: 'meta[name="og:novel:author"]', attr: "content" },
      intro: { type: "css", expression: "div.description p", attr: "text" },
      cover: { type: "css", expression: "amp-img[src*='ttkan.co/cover']", attr: "src", replaceFrom: "\\?.*$", replaceTo: "" },
      status: { type: "css", expression: 'meta[name="og:novel:status"]', attr: "content" },
      category: { type: "css", expression: 'meta[name="og:novel:category"]', attr: "content" },
    },
  },
  toc: {
    enabled: true,
    itemSelector: { type: "css", expression: "a[href*='/novel/pagea/']" },
    fields: {
      title: { type: "css", expression: "a", attr: "text" },
      url: { type: "css", expression: "a", attr: "href" },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: {
      title: { type: "css", expression: "h1", attr: "text" },
      // 首段 <p> 为章题重复(与 h1 同文), 正则锚定跳过: div.content 起点越过书签<a>与题段 <p>, 捕获至 div_content_end
      content: { type: "regex", expression: 'class="content">[\\s\\S]{0,500}?<p>[^<]{0,120}</p>([\\s\\S]*?)<div id="div_content_end"', attr: "1" },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  fetch: fetchCfg,
  clean,
};

async function test(section: string, url: string) {
  const r = await fetch(`${API}/rules/test`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section, url, rule: config[section], fetch: fetchCfg, clean, limit: 5 }),
    signal: AbortSignal.timeout(95000),
  });
  const j: any = await r.json().catch(() => ({}));
  return { s: r.status, j };
}

const BOOK = "https://cn.ttkan.co/novel/chapters/wanxiangzhiwang-tiancantudou";
const CH = "https://cn.ttkan.co/novel/pagea/wanxiangzhiwang-tiancantudou_1.html";

{
  const { s, j } = await test("list", "https://cn.ttkan.co/novel/class/xuanhuan");
  console.log(`[list] ${s} count=${j?.data?.count}`, JSON.stringify(j?.data?.sample?.[0] || j).slice(0, 420));
}
{
  const { s, j } = await test("book", BOOK);
  console.log(`[book] ${s}`, JSON.stringify(j?.data?.fields || j).slice(0, 500));
}
let tocCount = 0;
{
  const { s, j } = await test("toc", BOOK);
  tocCount = j?.data?.count || 0;
  console.log(`[toc] ${s} count=${tocCount}`, JSON.stringify((j?.data?.sample || []).slice(0, 3)));
}
{
  const { s, j } = await test("content", CH);
  console.log(`[content] ${s} raw=${j?.data?.rawLength} cleaned=${j?.data?.cleanedLength} pages=${j?.data?.pages}`);
  console.log("  head:", (j?.data?.cleanedText || "").replace(/\s+/g, " ").slice(0, 220));
  console.log("  tail:", (j?.data?.cleanedText || "").replace(/\s+/g, " ").slice(-150));
}
{
  // 抽查后段章节(末章附近) 验证正则鲁棒性
  const { s, j } = await test("content", "https://cn.ttkan.co/novel/pagea/wanxiangzhiwang-tiancantudou_1838.html");
  console.log(`[content-1838] ${s} raw=${j?.data?.rawLength} cleaned=${j?.data?.cleanedLength}`);
  console.log("  head:", (j?.data?.cleanedText || "").replace(/\s+/g, " ").slice(0, 200));
}

const gate = {
  list: 0, book: 0, toc: 0, content: 0, content2: 0,
};
{
  const { j } = await test("list", "https://cn.ttkan.co/novel/class/xuanhuan");
  gate.list = j?.data?.count || 0;
  const { j: bj } = await test("book", BOOK);
  gate.book = bj?.data?.fields?.name ? 1 : 0;
  gate.toc = tocCount >= 500 ? 1 : 0;
  const { j: cj } = await test("content", CH);
  gate.content = (cj?.data?.cleanedLength || 0) > 300 ? 1 : 0;
  const { j: cj2 } = await test("content", "https://cn.ttkan.co/novel/pagea/wanxiangzhiwang-tiancantudou_1838.html");
  gate.content2 = (cj2?.data?.cleanedLength || 0) > 300 ? 1 : 0;
}
console.log("gate:", JSON.stringify(gate));
if (Object.values(gate).every((v) => v > 0)) {
  const r1 = await fetch(`${API}/rules`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "天天看小说 (cn.ttkan.co)·Nuxt-SSR直连站",
      description: "qq-b2轮: Nuxt/AMP 站但全 SSR, 零反爬直连; 列表 /novel/class/{cat}(18本/页, 字母分组 _abcd.._xyz 替代数字翻页故 pagination 关) + 书页即目录页 /novel/chapters/{slug}(og:novel:* meta + div.description 简介 + 全量章节 a[href*=pagea] 单页1838章) + 正文 /novel/pagea/{slug}_{n}.html(div.content 首段p为章题重复, regex 越过至 div_content_end) ; 前任疑SPA动态渲染实为 SSR 无需浏览器",
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
        name: "天天看小说·万相之王 单书实测",
        ruleId, mode: "single", bookUrl: BOOK,
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
