/** qq-a2 验证: DB 书籍字段 + 章节数 + 抽 3 章正文质量 */
const API = "http://localhost:3000/api/admin";
const TASK = "cmtmstor90ffbnscz2n0fpu5p";

// 1) 任务终态
const task = (await (await fetch(`${API}/tasks/${TASK}`)).json()).data;
console.log(`任务: status=${task.status} 书籍=${task.booksDone ?? "?"} 章节=${task.contentDone ?? "?"}`);

// 2) 书籍记录(按任务或书名检索)
const bj = await (await fetch(`${API}/books?page=1&pageSize=50&search=${encodeURIComponent("修仙从绑定")}`)).json();
const books = bj.data?.books ?? bj.data?.items ?? [];
const b = books.find((x: any) => x.name?.includes("修仙从绑定名师课程开始"));
if (!b) { console.log("书籍未找到! books返回:", JSON.stringify(bj).slice(0, 300)); process.exit(1); }
console.log(`书籍: id=${b.id} name=${b.name} author=${b.author} status=${b.status} category=${b.category ?? "-"} cover=${b.cover ?? b.coverUrl ?? "-"}`);
console.log(`intro(${(b.intro ?? "").length}字): ${(b.intro ?? "").slice(0, 80)}...`);
console.log("来源URL:", b.bookUrl ?? b.sourceUrl ?? "-");

// 3) 章节目录
const toc = (await (await fetch(`${API}/books/${b.id}/toc`)).json()).data;
const items = toc?.chapters ?? toc?.items ?? [];
console.log(`目录: ${items.length} 章 首=${JSON.stringify(items[0]?.title)} 末=${JSON.stringify(items[items.length-1]?.title)}`);

// 4) 抽 3 章正文(首/中/末)质量检查
const last = items[items.length - 1];
const pick = [items[0], items[Math.floor(items.length / 2)], last].filter(Boolean);
const junk = [/本章未完/, /请记住本站/, /80ge\.info/, /qiushu/, /wap\./i, /上一[页章]/, /下一[页章]/, /回目录/, /手机阅读/, /一秒记住/, /[\u0000-\u0008]/, /window\.location/];
let bad = 0;
for (const it of pick) {
  const cid = it.chapterId ?? it.id;
  const c = (await (await fetch(`${API}/chapters/${cid}`)).json()).data;
  const txt = (c?.content ?? "").replace(/<[^>]+>/g, "");
  const hits = junk.filter((re) => re.test(c?.content ?? ""));
  const ok = txt.length > 500 && hits.length === 0;
  if (!ok) bad++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${it.title} id=${cid} 正文${txt.length}字 命中=[${hits.map((h) => h.source).join(",")}] 开头: ${JSON.stringify(txt.replace(/\s+/g, " ").slice(0, 60))}`);
}
console.log(bad === 0 ? "VERIFY-3-GREEN" : `VERIFY-FAILED=${bad}`);
export {};
