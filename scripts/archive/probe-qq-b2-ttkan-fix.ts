/** qq-b2 站2修复: toc url 归一化(www 变体→相对) + 重测 toc + 任务重建 */
const API = "http://localhost:3000/api/admin";
const RULE_ID = "cmtmslaxi08ionsczpden4pop";
const BOOK = "https://cn.ttkan.co/novel/chapters/wanxiangzhiwang-tiancantudou";

// 读规则
const r0 = await fetch(`${API}/rules/${RULE_ID}`);
const j0: any = await r0.json();
const rule = j0.data;
if (!rule) { console.log("rule read fail", r0.status, JSON.stringify(j0).slice(0, 200)); process.exit(1); }
const config = typeof j0.data.config === "string" ? JSON.parse(j0.data.config) : j0.data.config;
// toc url 字段: 剥 www.ttkan.co 起源 → 两变体统一相对路径 → absolutize 后同 URL 引擎去重
config.toc.fields.url = {
  type: "css", expression: "a", attr: "href",
  replaceFrom: "^https?://(?:www|tw|cn)\\.ttkan\\.co", replaceTo: "",
};

// 重测 toc
const fetchCfg = config.fetch;
const tr = await fetch(`${API}/rules/test`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ section: "toc", url: BOOK, rule: config.toc, fetch: fetchCfg, clean: config.clean, limit: 5 }),
  signal: AbortSignal.timeout(95000),
});
const tj: any = await tr.json();
console.log(`[toc retest] ${tr.status} count=${tj?.data?.count}`, JSON.stringify((tj?.data?.sample || []).slice(0, 2)));

if ((tj?.data?.count || 0) !== 1838) { console.log("TOC COUNT != 1838, abort"); process.exit(1); }

// PATCH 规则
const pr = await fetch(`${API}/rules/${RULE_ID}`, {
  method: "PUT", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: rule.name, description: rule.description + "; toc url replaceFrom 归一化 www/tw 变体(页面双列表: SSR相对+noscript绝对)防双倍采集", config, enabled: true }),
});
const pj: any = await pr.json();
console.log("rule patch:", pr.status, pj.data?.id || JSON.stringify(pj).slice(0, 150));

// 重建任务
const r2 = await fetch(`${API}/tasks`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "天天看小说·万相之王 单书实测",
    ruleId: RULE_ID, mode: "single", bookUrl: BOOK,
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
export {};
