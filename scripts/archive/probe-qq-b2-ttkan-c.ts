/** qq-b2 站2: ttkan chapters(目录)页 + 正文页结构 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(25000) });
  const t = await r.text();
  return { s: r.status, t, u: r.url };
}

// 目录页
const toc = await get("https://cn.ttkan.co/novel/chapters/wanxiangzhiwang-tiancantudou");
console.log("=== TOC", toc.s, toc.t.length, toc.u);
const tt = toc.t.replace(/\s+/g, " ");
// 书名/章节链接形态
const chapLinks = [...new Set([...toc.t.matchAll(/href="(\/novel\/[^"]+)"/g)].map((m) => m[1]))].filter((l) => !/chapters|class|rank|user|sitemap|imgs/.test(l));
console.log("chapter-link shapes:", [...new Set(chapLinks.map((l) => l.replace(/[a-z0-9_-]{4,}/gi, "W")))].join(" , "));
console.log("chapter sample:", chapLinks.slice(0, 5).join(" | "), "... total:", chapLinks.length);
// 结构区
const i1 = toc.t.search(/chapter|item/);
console.log("\ntoc region:", tt.slice(2000, 5200));
export {};
