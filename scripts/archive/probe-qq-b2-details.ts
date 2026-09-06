/** qq-b2: 细节补探 — jhsssd 列表翻页/章标题元素/index页/ttkan 下一章链接/目录计数 */
const UA_M = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const UA_D = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
async function get(url: string, ua: string) {
  const r = await fetch(url, { headers: { "User-Agent": ua, "Accept-Language": "zh-CN,zh;q=0.9" }, signal: AbortSignal.timeout(20000) });
  return { s: r.status, t: await r.text(), u: r.url };
}

// A) jhsssd /list/3.html 尾部(有无翻页)
const cat = await get("https://m.jhsssd.com/list/3.html", UA_M);
const ct = cat.t.replace(/\s+/g, " ");
console.log("A list/3 tail:", ct.slice(-700));
console.log("A listpage?", /listpage/.test(cat.t), "bookItems:", (cat.t.match(/tjimg/g) || []).length);

// B) jhsssd 章节页标题元素
const ch = await get("https://m.jhsssd.com/114604/47132142.html", UA_M);
const h1 = ch.t.match(/<h1[^>]*>[\s\S]{0,150}?<\/h1>/i);
console.log("\nB chapter h1:", h1 ? h1[0].replace(/\s+/g, " ") : "none");
const tt = ch.t.match(/<title[^>]*>([\s\S]{0,120}?)<\/title>/i);
console.log("B chapter title-tag:", tt ? tt[1].replace(/\s+/g, " ") : "none");
const td = ch.t.match(/<td[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]{0,120}?<\/td>/i);
console.log("B title td:", td ? td[0].replace(/\s+/g, " ") : "none");

// C) jhsssd index_1 与 index_120 存在性 + 条数
const i1 = await get("https://m.jhsssd.com/114604/index_1.html", UA_M);
console.log("\nC index_1:", i1.s, i1.t.length, "li:", (i1.t.match(/<li><a href="\/114604\//g) || []).length, "first:", (i1.t.match(/<li><a href="(\/114604\/\d+\.html)">([^<]+)/) || [])[2]);
const i120 = await get("https://m.jhsssd.com/114604/index_120.html", UA_M);
console.log("C index_120:", i120.s, i120.t.length, "li:", (i120.t.match(/<li><a href="\/114604\//g) || []).length, "last:", [...i120.t.matchAll(/<li><a href="\/114604\/\d+\.html">([^<]+)/g)].slice(-1)[0]?.[1]);

// D) ttkan pagea 下一章/翻页线索 + content 尾
const tk = await get("https://cn.ttkan.co/novel/pagea/wanxiangzhiwang-tiancantudou_1.html", UA_D);
console.log("\nD 下一 occurrences:", [...tk.t.matchAll(/[^<>]{0,40}下一[^<>]{0,20}/g)].map((m) => m[0].replace(/\s+/g, " ")).slice(0, 6));
const endIdx = tk.t.indexOf('id="div_content_end"');
console.log("D div_content_end region:", tk.t.slice(Math.max(0, endIdx - 900), endIdx + 250).replace(/\s+/g, " ").slice(-700));
const ps = [...tk.t.matchAll(/<p[^>]*>([^<]{10,})<\/p>/g)].map((m) => m[1].trim());
console.log("D p total:", ps.length, "| p[-2..]:", ps.slice(-3).map((p) => p.slice(0, 50)).join(" / "));

// E) ttkan chapters 页 pagea 锚计数
const toc = await get("https://cn.ttkan.co/novel/chapters/wanxiangzhiwang-tiancantudou", UA_D);
const anchors = [...toc.t.matchAll(/<a[^>]+href="(\/novel\/pagea\/[^"]+)"[^>]*>([\s\S]{0,80}?)<\/a>/g)];
console.log("\nE pagea anchors:", anchors.length, "| first:", anchors[0]?.[2].replace(/<[^>]+>/g, "").trim(), "| last:", anchors[anchors.length - 1]?.[2].replace(/<[^>]+>/g, "").trim());
console.log("E dup urls?", new Set(anchors.map((a) => a[1])).size);
export {};
