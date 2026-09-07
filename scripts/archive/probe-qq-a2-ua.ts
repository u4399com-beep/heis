/** qq-a2 探针5: 单一UA兼容性(wap是否挑UA) + wap目录页结构 + lastupdate列表页结构 */
const D = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const M = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
async function g(url: string, ua: string, note: string) {
  const res = await fetch(url, { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(15000), redirect: "follow" });
  const html = await res.text();
  const nr = html.match(/<div[^>]*id="nr"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
  console.log(`[${note}] ${res.status} len=${html.length} final=${res.url.replace("http://wap.80ge.info", "")} h1=${JSON.stringify(h1?.slice(0, 30))} #nr=${nr ? nr.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length : 0}`);
  return html;
}
// 1) wap 章节页用桌面 UA — 是否挑UA
await g("http://wap.80ge.info/225637/76636828.html", D, "wap章节×桌面UA");
// 2) www 书页用移动 UA — 是否挑UA
await g("http://www.80ge.info/txtxz/225637.html", M, "www书页×移动UA");
// 3) wap 目录页1(保存分析 itemSelector)
const toc = await g("http://wap.80ge.info/225637/page-1.html", M, "wap目录页1");
await Bun.write("scripts/qq-a2-wap-toc.html", toc);
const listarea = toc.match(/<div[^>]*(?:class="book_last"|id="listpage")[^>]*>[\s\S]{0,600}/)?.[0];
console.log("目录容器片段:", JSON.stringify(listarea?.slice(0, 500) ?? toc.slice(1500, 2200)));
// 4) lastupdate 列表页结构
const lst = await g("http://www.80ge.info/top/lastupdate/1.html", D, "lastupdate列表页");
await Bun.write("scripts/qq-a2-www-list.html", lst);
console.log("列表容器:", JSON.stringify([...lst.matchAll(/<(div|table|ul|li|tr)[^>]*(?:id|class)="[^"]*"/gi)].map((m) => m[0]).slice(0, 14)));
export {};
