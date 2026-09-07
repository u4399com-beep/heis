/** qq-b2 站2: ttkan 书链接形态 + __NUXT__ 数据 + 翻页探测 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(25000) });
  const t = await r.text();
  return { s: r.status, t, u: r.url };
}

const cls = await get("https://cn.ttkan.co/novel/class/xuanhuan");
const t = cls.t;
// 1) 全部 /novel/xxx 链接(具体值)
const links = [...new Set([...t.matchAll(/href="(\/novel\/[^"{]+)"/g)].map((m) => m[1]))];
console.log("all /novel/* links:\n" + links.join("\n"));
// 2) __NUXT__ 摘要
const nuxt = t.match(/window\.__NUXT__\s*=\s*([\s\S]{0,400})/);
console.log("\n__NUXT__ head:", nuxt ? nuxt[1].replace(/\s+/g, " ").slice(0, 350) : "none");
// 3) 书籍卡片区域(找中文书名)
const zh = t.indexOf("小说");
const cardRegion = t.match(/<li[^>]*>[\s\S]{0,120}?\/novel_pages[\s\S]{0,300}?<\/li>/);
console.log("\nli sample:", cardRegion ? cardRegion[0].replace(/\s+/g, " ").slice(0, 400) : "no li sample");
const idx = t.search(/class="[^"]*(novel|book)[^"]*item/i);
console.log("\nitem-class region:", idx > -1 ? t.slice(idx - 200, idx + 600).replace(/\s+/g, " ") : "no item class");
// 4) 翻页链接
const pageLinks = [...new Set([...t.matchAll(/href="([^"]*(?:page|_(\d+))[^"]*)"/gi)].map((m) => m[1]))];
console.log("\npage links:", pageLinks.slice(0, 10).join(" | ") || "none");
console.log("\ntail region:", t.slice(-1200).replace(/\s+/g, " "));
export {};
