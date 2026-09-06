/** qq-b2 站2: ttkan class 页列表项 markup + chapters 页简介/封面 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html", "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(25000) });
  return { s: r.status, t: await r.text() };
}

const cls = await get("https://cn.ttkan.co/novel/class/xuanhuan");
const t = cls.t;
const p1 = t.indexOf("/novel/chapters/qingshan");
console.log("=== class item region (around 1st book link):");
console.log(t.slice(Math.max(0, p1 - 1500), p1 + 500).replace(/\s+/g, " "));
// 列表容器
const uls = [...t.matchAll(/<(ul|div)[^>]+class="([^"]*(?:list|item|novel|book)[^"]*)"[^>]*>/gi)].map((m) => `${m[1]}.${m[2]}`);
console.log("\nlist-ish containers:", [...new Set(uls)].slice(0, 12).join(" | "));

const toc = await get("https://cn.ttkan.co/novel/chapters/wanxiangzhiwang-tiancantudou");
const tt = toc.t;
console.log("\n=== chapters 页 og:image?", tt.includes("og:image"), "| cover img tags:", (tt.match(/<amp-img[^>]*>/g) || []).length);
const ampImgs = [...tt.matchAll(/<amp-img[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1]).filter((s) => !/bookmark|icon|logo|avatar/i.test(s));
console.log("content imgs:", [...new Set(ampImgs)].slice(0, 5).join(" | "));
// 简介可见元素(找"简介"文本区域)
const ii = tt.indexOf("简介");
console.log("\nintro region:", tt.slice(Math.max(0, ii - 600), ii + 800).replace(/\s+/g, " "));
export {};
