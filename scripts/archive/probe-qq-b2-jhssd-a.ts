/** qq-b2 站1: m.jhsssd.com 列表/书页/目录/正文 结构深探 */
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const H = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  return { s: r.status, t, u: r.url };
}

// 1) 列表页
const list = await get("https://m.jhsssd.com/list.html");
console.log("=== LIST", list.s, list.t.length, list.u);
console.log(list.t.replace(/\s+/g, " ").slice(0, 2600));

// 2) 排行页(多书链接源)
const rank = await get("https://m.jhsssd.com/Ranking.html");
console.log("\n=== RANK", rank.s, rank.t.length);
console.log(rank.t.replace(/\s+/g, " ").slice(0, 1500));
export {};
