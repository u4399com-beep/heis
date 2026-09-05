/** qq-b2 站1: jhsssd 书页/目录/正文 全链路 */
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const H = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  return { s: r.status, t, u: r.url };
}

// 书页
const book = await get("https://m.jhsssd.com/114604/");
console.log("=== BOOK", book.s, book.t.length, book.u);
const bt = book.t.replace(/\s+/g, " ");
console.log(bt.slice(700, 4200));
// 目录链接形态
const tocLinks = [...new Set([...book.t.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))].filter((l) => /list|all|chapter|catalog|1_\d|\/\d+\/\d+/.test(l));
console.log("\ntoc-ish links:", [...new Set(tocLinks.map((l) => l.replace(/\d+/g, "N")))].slice(0, 15).join(" | "));
console.log("toc sample:", tocLinks.slice(0, 6).join(" | "));
export {};
