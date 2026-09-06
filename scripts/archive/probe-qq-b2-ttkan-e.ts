/** qq-b2 站2: ttkan pagea 正文容器定位(是否 SSR 全文) */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" };
const r = await fetch("https://cn.ttkan.co/novel/pagea/wanxiangzhiwang-tiancantudou_1.html", { headers: H, signal: AbortSignal.timeout(25000) });
const t = await r.text();
console.log("status", r.status, "bytes", t.length);
// id/class 含 content/chapter 的容器
const containers = [...t.matchAll(/<(?:div|article|section)[^>]+(?:id|class)="[^"]*(?:content|chapter|text|read)[^"]*"[^>]*>/gi)].map((m) => m[0].replace(/\s+/g, " ").slice(0, 120));
console.log("containers:\n" + [...new Set(containers)].join("\n"));
// 每个 container 后 800 字符
const c1 = t.search(/<div[^>]+id="content[^>]*>/i);
const c2 = t.search(/<div[^>]+class="[^"]*content[^"]*"[^>]*>/i);
const at = c1 > -1 ? c1 : c2;
if (at > -1) {
  console.log("\n--- content container region ---");
  console.log(t.slice(at, at + 1200).replace(/\s+/g, " "));
  const end = t.indexOf("</div>", at + 50);
  console.log("\n--- content end region ---");
  console.log(t.slice(Math.max(at, end - 500), end + 700).replace(/\s+/g, " "));
} else console.log("no content container found");
// 中文段落统计(仅 <p> 内)
const paras = [...t.matchAll(/<p[^>]*>([^<]{40,})<\/p>/g)].map((m) => m[1]);
console.log("\n<p> count:", paras.length);
console.log("p[0..2]:", paras.slice(0, 3).map((p) => p.slice(0, 60)).join(" / "));
// 上下章链接
const navs = [...t.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{1,12}(?:章|下一|上一)[^<]{0,8})<\/a>/g)].map((m) => `${m[2]}->${m[1]}`);
console.log("\nnav links:", [...new Set(navs)].slice(0, 10).join(" | "));
export {};
