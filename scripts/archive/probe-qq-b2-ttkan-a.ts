/** qq-b2 站2: cn.ttkan.co Nuxt-SSR 分类页/书页 结构深探 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(25000) });
  const t = await r.text();
  return { s: r.status, t, u: r.url };
}

const cls = await get("https://cn.ttkan.co/novel/class/xuanhuan");
console.log("=== CLASS", cls.s, cls.t.length, cls.u);
const t = cls.t.replace(/\s+/g, " ");
// 找书链接形态
const hrefs = [...new Set([...cls.t.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))].filter((l) => /novel|book|\/\d/.test(l) && !/\.(css|js|ico|png)/.test(l));
const shapes = new Map<string, number>();
for (const l of hrefs) {
  const s = l.replace(/https?:\/\/[^/]+/, "").replace(/[a-z0-9_-]{8,}/gi, "W").replace(/\?.*/, "?Q").slice(0, 60);
  shapes.set(s, (shapes.get(s) || 0) + 1);
}
console.log([...shapes.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} x${c}`).join("\n"));
console.log("sampleHrefs:", hrefs.slice(0, 8).join(" | "));
// 列表项区域样例
const idx = t.indexOf("novel");
console.log("\nmid-region:", t.slice(3000, 6500));
export {};
