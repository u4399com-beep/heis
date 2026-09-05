/** qq-b2 站2: ttkan 目录列表 li 结构 + 正文页 pagea 结构 + 书信息来源 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(25000) });
  const t = await r.text();
  return { s: r.status, t, u: r.url };
}

const toc = await get("https://cn.ttkan.co/novel/chapters/wanxiangzhiwang-tiancantudou");
const t = toc.t;
// h1 / 标题区
console.log("title:", (t.match(/<title[^>]*>([^<]{0,120})/i)?.[1] || "").trim());
const h1 = t.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i);
console.log("h1:", h1 ? h1[0].replace(/\s+/g, " ") : "none");
// 第一个 pagea 链接周围(列表项结构)
const p = t.indexOf("/novel/pagea/");
console.log("\nfirst pagea anchor context:\n" + t.slice(p - 700, p + 400).replace(/\s+/g, " "));
// 书信息(简介/封面)
console.log("\nintro-ish:", (t.match(/(简介|介绍)[^<]{0,120}/) || ["none"])[0]);
const og = [...t.matchAll(/<meta[^>]*(?:og:|name="description")[^>]*>/gi)].map((m) => m[0]).slice(0, 4);
console.log("meta:", og.join("\n"));

// 正文页
const ch = await get("https://cn.ttkan.co/novel/pagea/wanxiangzhiwang-tiancantudou_1.html");
console.log("\n=== PAGEA", ch.s, ch.t.length, ch.u);
const ct = ch.t.replace(/\s+/g, " ");
console.log("title:", (ch.t.match(/<title[^>]*>([^<]{0,120})/i)?.[1] || "").trim());
const h1c = ch.t.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i);
console.log("h1:", h1c ? h1c[0].replace(/\s+/g, " ") : "none");
// 正文容器: 找大段中文
const zhBlock = [...ct.matchAll(/>([^<>]{300,}?)</g)].map((m) => m[1]);
console.log("\nzhBlocks:", zhBlock.length, zhBlock[0]?.slice(0, 200));
// 正文所在容器 id/class
const zi = ct.search(/>[^<>]{300,}</);
if (zi > -1) {
  const before = ct.slice(Math.max(0, zi - 500), zi);
  console.log("\nbefore-zhBlock:", before.slice(-400));
}
// 翻页/上下章
console.log("\nnext-ish:", [...new Set([...ch.t.matchAll(/href="(\/novel\/pagea[^"]+)"/g)].map((m) => m[1]))].slice(0, 8).join(" | "));
console.log("\ntail:", ct.slice(-800));
export {};
