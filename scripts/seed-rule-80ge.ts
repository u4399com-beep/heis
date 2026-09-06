/** qq-a2: 80ge.info 规则入库 + 四段测试(带断言门槛)
 *  背景摘要: qiushu.info 对沙箱出口 TCP 拉黑 → 正文改走 wap.80ge.info(同 bookId/chapterId 体系)
 *  设计要点:
 *   - book/list 段=www.80ge.info(桌面 XHTML); toc/content 段=wap.80ge.info(手机 XHTML)
 *   - tocLink 把书籍页上 http://www.80ge.info/txtml_{id}.html 链接改写为 http://wap.80ge.info/$1/page-1.html
 *   - wap 章节页章内分页: 第1页→_2→_3(末页), 末页导航变"下一章"且无"下一页"锚
 *     → content 翻页不配 nextLink, parseContent 兜底 a:contains("下一页") 不含"下一章" 自然收敛(cc-b shudugu 同款)
 *   - 单一桌面 UA 全站通用(实测 wap 章节页用桌面 UA 200 且 #nr1 完整)
 */
const API = "http://localhost:3000/api/admin";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const config = {
  list: {
    enabled: true,
    urlTemplate: "http://www.80ge.info/top/lastupdate/{page}.html",
    itemSelector: { type: "css", expression: "div#list_art_2013" },
    fields: {
      name: { type: "css", expression: "div.book_bg a", attr: "text", replaceFrom: "\\s*TXT下载\\s*$", replaceTo: "" },
      bookUrl: { type: "css", expression: "div.book_bg a", attr: "href" },
      author: { type: "css", expression: "div.book_cont a[href*='/author/']", attr: "text" },
      intro: { type: "css", expression: "div.book_jj", attr: "text" },
      cover: { type: "css", expression: "div.book_pic img", attr: "src" },
      status: { type: "css", expression: "div.book_rg span.strong", attr: "text" },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: "css", expression: "#soft_info_para h1", attr: "text", replaceFrom: "TXT全集下载$", replaceTo: "" },
      author: { type: "css", expression: "div.soft_info_r a[href*='/author/']", attr: "text" },
      cover: { type: "css", expression: "img.info_img", attr: "src" },
      status: { type: "css", expression: "li:contains(\"写作进度\") strong", attr: "text" },
      intro: {
        type: "css", expression: "#mainSoftIntro p", attr: "text",
        replaceFrom: "^.*?分享推荐给你的朋友！\\s*|更多.*$", replaceTo: "",
      },
    },
  },
  toc: {
    enabled: true,
    tocLink: {
      type: "css", expression: "a[href*='txtml_']", attr: "href",
      replaceFrom: "^http://www\\.80ge\\.info/txtml_(\\d+)\\.html$",
      replaceTo: "http://wap.80ge.info/$1/page-1.html",
    },
    itemSelector: { type: "css", expression: "div.book_last dd" },
    fields: {
      title: { type: "css", expression: "a", attr: "text", replaceFrom: "^\\d+、", replaceTo: "" },
      url: { type: "css", expression: "a", attr: "href" },
    },
    // wap 目录"下一页"是无 href 的死锚(<a class="before">下一页</a>) → 兜底取 href=undefined → 单页自然收敛;
    // 大书翻页走 select[name=pageselect] 下拉(引擎不可表达), 当前目录规则按单页形态登记
    pagination: { enabled: true, maxPages: 5 },
  },
  content: {
    enabled: true,
    fields: {
      title: { type: "css", expression: "h1", attr: "text" },
      content: { type: "css", expression: "div#nr1", attr: "html" },
    },
    // 章内分页: 非末页 nav 有"下一页"(_N.html), 末页只有"下一章" → 兜底自然收敛, 无跨章串页风险
    pagination: { enabled: true, maxPages: 10 },
  },
  fetch: {
    engine: "http",
    uaMode: "custom",
    customUa: UA,
    autoCookie: false,
    referer: true,
    timeout: 30000,
    retries: 1,
    waitMs: 200,
    hostGateLimit: 3,
  },
  clean: {
    removeSelectors: ["script", "style", "iframe", "ins", "noscript"],
    adPatterns: ["（?本章未完[^）<>]{0,40}）?", "请记住本站[^<>]*", "本站所收录[^<>]*", "一秒记住[^<>]*"],
  },
};

const RULE_NAME = "八零电子书 (80ge.info)·wap正文·直连";
const BOOK_URL = "http://www.80ge.info/txtxz/225637.html";
const TOC_URL = "http://wap.80ge.info/225637/page-1.html";
const CH1_URL = "http://wap.80ge.info/225637/76636828.html";

// ---- 幂等: 同名先删后建 ----
const listRes = await fetch(`${API}/rules?page=1&pageSize=100`);
const listJson = await listRes.json();
const rules = listJson.data?.items ?? listJson.data ?? [];
for (const r of rules) {
  if (r.name === RULE_NAME) {
    await fetch(`${API}/rules/${r.id}`, { method: "DELETE" });
    console.log("删除同名旧规则:", r.id);
  }
}

const r1 = await fetch(`${API}/rules`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: RULE_NAME,
    description:
      "80ge.info 八零电子书(TXT下载老站, XHTML utf-8, 零反爬直连)。qq-a2 轮: 姊妹站 qiushu.info(www 目录页章节链接指向它)对本沙箱出口 IP TCP 拉黑(2026-09 实测), 应急转场 wap.80ge.info 手机版(同 bookId/chapterId 体系, 第1章同为 76636828)。架构: list/book=www 桌面页, toc/content=wap 页; tocLink 把书籍页 txtml_{id} 链接改写为 wap/{id}/page-1.html(每页40章, 多页书走 select 下拉引擎不可表达=已知边界)。章节页 div#nr1 章内分页(_2/_3), 末页导航变'下一章'无'下一页'锚 → content 翻页无 nextLink 兜底自然收敛。单一桌面 UA 全站通用。探测样本: 修仙从绑定名师课程开始 /txtxz/225637.html(28章, 全3页/章, ~4400字/章)。",
    config, enabled: true,
  }),
});
const j1 = await r1.json();
const ruleId = j1.data?.id;
console.log("rule create:", r1.status, ruleId || JSON.stringify(j1).slice(0, 200));
if (!ruleId) process.exit(1);

// ---- 四段测试(带断言门槛) ----
let failed = 0;
async function test(section: string, url: string, seg: any, assert: (d: any) => string | null) {
  const res = await fetch(`${API}/rules/test`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section, url, rule: seg, fetch: config.fetch, clean: config.clean }),
  });
  const j = await res.json();
  const d = j.data;
  if (!j.ok || !d) { console.log(`[${section}] FAIL http=${res.status}`, JSON.stringify(j).slice(0, 220)); failed++; return; }
  const err = assert(d);
  console.log(`[${section}] ${err ? "FAIL " : "ok "} ms=${d.ms} engine=${d.engine}`, err ?? summary(section, d));
  if (err) { failed++; console.log("  data:", JSON.stringify(d).slice(0, 500)); }
}
function summary(section: string, d: any) {
  if (section === "list") return `count=${d.count} 首本=${JSON.stringify(d.sample?.[0]?.name)} 作者=${d.sample?.[0]?.author}`;
  if (section === "book") return JSON.stringify({ name: d.fields?.name, author: d.fields?.author, status: d.fields?.status, cover: !!d.fields?.cover, introLen: d.fields?.intro?.length ?? 0 });
  if (section === "toc") return `chapters=${d.count} pages=${d.pages} 首=${JSON.stringify(d.sample?.[0])}`;
  return `raw=${d.rawLength} clean=${d.cleanedLength} 页数=${d.pages}`;
}

await test("list", "http://www.80ge.info/top/lastupdate/1.html", config.list, (d) =>
  (d.count < 10 ? `列表本数 ${d.count} < 10` : !d.sample?.[0]?.name ? "首本无名" : null));
await test("book", BOOK_URL, config.book, (d) => {
  const f = d.fields ?? {};
  if (!f.name || f.name.includes("TXT")) return `name 异常: ${f.name}`;
  if (!f.author) return "author 空";
  if ((f.intro?.length ?? 0) < 50) return `intro 过短: ${f.intro?.length}`;
  if (!f.cover?.includes("img.80ge.info")) return `cover 异常: ${f.cover}`;
  return null;
});
await test("toc", TOC_URL, config.toc, (d) =>
  (d.count < 20 || d.count > 40 ? `章数 ${d.count} 出界(预期28±)` : !d.sample?.[0]?.url?.includes("wap.80ge.info") ? "章节URL域名异常" : null));
await test("content", CH1_URL, config.content, (d) => {
  if ((d.rawLength ?? 0) < 2500) return `raw ${d.rawLength} < 2500(3页合并预期~5000)`;
  if ((d.pages ?? 1) < 3) return `章内页数 ${d.pages} < 3`;
  if ((d.cleanedLength ?? 0) < 2000) return `clean ${d.cleanedLength} < 2000`;
  return null;
});

console.log(failed === 0 ? "ALL-4-GREEN" : `FAILED=${failed}`);
export {};
