/** mm 轮: 霹雳书屋规则入库 + 单书任务端到端实测 */
const API = "http://localhost:3000/api/admin";

const config = {
  list: {
    enabled: true,
    urlTemplate: "https://www.pilishuwu.com/1/list/{page}.html",
    itemSelector: { type: "css", expression: "li.ret-search-item" },
    fields: {
      name: { type: "css", expression: "h3.ret-works-title a", attr: "text" },
      bookUrl: { type: "css", expression: "h3.ret-works-title a", attr: "href" },
      author: { type: "css", expression: "p.ret-works-author", attr: "text", replaceFrom: "^作者[：:]", replaceTo: "" },
      category: { type: "css", expression: "p.ret-works-tags a", attr: "text", replaceFrom: "^分类[：:]", replaceTo: "" },
      intro: { type: "css", expression: "p.ret-works-decs", attr: "text" },
      cover: { type: "css", expression: "a.mod-cover-list-thumb img", attr: "src" },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: "css", expression: "h2.works-intro-title strong", attr: "text" },
      author: { type: "regex", expression: "（作者：([^）]{1,30})）" },
      intro: { type: "css", expression: "p.works-intro-short", attr: "text" },
      cover: { type: "css", expression: "div.works-cover img", attr: "src" },
      status: { type: "css", expression: "label.works-intro-status", attr: "text" },
      category: { type: "css", expression: "a.works-intro-tags-item", attr: "text" },
    },
  },
  toc: {
    enabled: true,
    tocLink: { type: "css", expression: "a[href*='/menu/']", attr: "href" },
    itemSelector: { type: "css", expression: "span.works-chapter-item" },
    fields: {
      title: { type: "css", expression: "a", attr: "text" },
      url: { type: "css", expression: "a", attr: "href" },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: {
      title: { type: "css", expression: "h3.j_chapterName span.content-wrap", attr: "text" },
      content: { type: "css", expression: "div.read-content", attr: "html" },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  fetch: {
    engine: "http",
    fetchMode: "scrapling-stealthy",
    uaMode: "custom",
    customUa: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    autoCookie: false,
    referer: true,
    timeout: 90000,
    retries: 1,
    waitMs: 300,
    hostGateLimit: 2,
  },
  clean: {
    removeSelectors: ["script", "style", "iframe", "ins", "noscript"],
    adPatterns: ["请记住本站[^<>]*", "本站所收录[^<>]*", "最快更新[^<>]*"],
  },
};

const r1 = await fetch(`${API}/rules`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "霹雳书屋 (pilishuwu.com)·CF挑战站·stealthy",
    description: "mm轮新增: Cloudflare Managed Challenge 站, fetchMode=scrapling-stealthy(patchright自动求解); 四段=分类列表/详情/完整目录menu/正文read; HTML需stealthy, 静态资产可直连",
    config, enabled: true,
  }),
});
const j1 = await r1.json();
console.log("rule create:", r1.status, j1.data?.id || JSON.stringify(j1).slice(0, 200));
const ruleId = j1.data?.id;

const r2 = await fetch(`${API}/tasks`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "霹雳书屋·全球高考 单书实测",
    ruleId,
    mode: "single",
    bookUrl: "https://www.pilishuwu.com/5/2951/info.html",
    recrawlMode: "incremental", storageMode: "db",
    threadMin: 2, threadMax: 2, intervalMin: 200, intervalMax: 500,
    smartCategory: false, smartComplete: false, autoSuggest: false,
  }),
});
const j2 = await r2.json();
console.log("task create:", r2.status, j2.data?.id || JSON.stringify(j2).slice(0, 200));
const taskId = j2.data?.id;
if (taskId) {
  const r3 = await fetch(`${API}/tasks/${taskId}/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
  console.log("task start:", r3.status, (await r3.text()).slice(0, 100));
}

// mm-theme: 补 export{} 模块化 —— 无 import 的全局脚本顶层 await 报 TS1375, 模块化后互不相干(运行无感)
export {}
