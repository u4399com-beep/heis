/** qq-a2: 80ge 单书任务创建+启动+轮询 (book=修仙从绑定名师课程开始, 28章×3子页) */
const API = "http://localhost:3000/api/admin";
const RULE_ID = process.argv[2] ?? "cmtmssm570f97nscz8ubgaabn";

const r2 = await fetch(`${API}/tasks`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "八零电子书·修仙从绑定名师课程开始 单书实测",
    ruleId: RULE_ID,
    mode: "single",
    bookUrl: "http://www.80ge.info/txtxz/225637.html",
    recrawlMode: "incremental", storageMode: "db",
    threadMin: 2, threadMax: 2, intervalMin: 300, intervalMax: 600,
    smartCategory: false, smartComplete: false, autoSuggest: false,
  }),
});
const j2 = await r2.json();
console.log("task create:", r2.status, j2.data?.id || JSON.stringify(j2).slice(0, 200));
const taskId = j2.data?.id;
if (!taskId) process.exit(1);

const r3 = await fetch(`${API}/tasks/${taskId}/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) });
console.log("task start:", r3.status, (await r3.text()).slice(0, 120));

// 轮询: 最多 8 分钟
const t0 = Date.now();
let last = "";
while (Date.now() - t0 < 8 * 60_000) {
  await new Promise((r) => setTimeout(r, 6000));
  const s = await (await fetch(`${API}/tasks/${taskId}`)).json();
  const d = s.data ?? {};
  const line = `t+${Math.round((Date.now() - t0) / 1000)}s status=${d.status} phase=${d.phase ?? "?"} contentDone=${d.contentDone ?? d.progress?.contentDone ?? "?"}/${d.contentTotal ?? d.progress?.contentTotal ?? "?"}`;
  if (line !== last) { console.log(line); last = line; }
  if (["done", "completed", "failed", "stopped", "error"].includes(String(d.status))) { console.log("终态:", JSON.stringify(d).slice(0, 400)); break; }
}
export {};
