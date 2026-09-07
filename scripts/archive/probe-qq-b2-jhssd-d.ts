/** qq-b2 站1: jhsssd 书页尾部(目录是否全量/翻页) + 正文页结构 */
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const H = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  return { s: r.status, t, u: r.url };
}

// 1) 书页尾部: 目录翻页线索
const book = await get("https://m.jhsssd.com/114604/");
const bt = book.t.replace(/\s+/g, " ");
console.log("=== BOOK TAIL (from 目录标题 on):");
const idx = bt.indexOf("章节目录");
console.log(bt.slice(idx, idx + 1500));
console.log("\n--- raw tail ---");
console.log(bt.slice(-1800));
// 目录 li 计数
const liCount = (book.t.match(/<li><a href="\/114604\/\d+\.html">/g) || []).length;
console.log("\nli count in book page:", liCount, "page bytes:", book.t.length);

// 2) 正文页
const ch = await get("https://m.jhsssd.com/114604/47132142.html");
const ct = ch.t.replace(/\s+/g, " ");
console.log("\n=== CHAPTER", ch.s, ch.t.length, ch.u);
console.log("title-ish:", (ch.t.match(/nr_title[^>]*>([^<]+)/) || ch.t.match(/<h1[^>]*>([^<]+)/) || ["", "?"])[1]);
const nr1 = ch.t.indexOf('id="nr1"');
console.log("\n--- chapter head region ---");
console.log(ct.slice(nr1 - 400 > 0 ? nr1 - 400 : 0, nr1 + 900));
console.log("\n--- chapter tail region (翻页线索) ---");
console.log(ct.slice(-2200));
export {};
