/** qq-a2 探针3: www 书页字段定位 + wap 章内分页末页行为(下一页是否跨章) */
import { writeFileSync } from "node:fs";
const UA_WWW = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const UA_WAP = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

async function grab(url: string, ua: string, save?: string) {
  const res = await fetch(url, { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  if (save) writeFileSync(save, html);
  console.log(`[${url}] status=${res.status} chars=${html.length}`);
  return html;
}

// 1) www 书页(字段定位: 书名/作者/简介/封面/目录链接形态)
const book = await grab("http://www.80ge.info/txtxz/225637.html", UA_WWW, "scripts/qq-a2-www-book.html");
for (const re of [/<h1[^>]*>([\s\S]*?)<\/h1>/i, /<title>([^<]*)<\/title>/i]) {
  const m = book.match(re);
  if (m) console.log("  ", re.source.slice(0, 12), "=>", JSON.stringify(m[1].replace(/<[^>]+>/g, "").trim().slice(0, 80)));
}
console.log("书页含 wap 链接:", book.match(/href="[^"]*wap[^"]*"/g)?.slice(0, 3) ?? "无");
console.log("书页含 txtml 链接:", book.match(/href="[^"]*txtml[^"]*"/g)?.slice(0, 3) ?? "无");
const cover = book.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
console.log("首个img:", cover?.[1]);
// meta info 区结构
const infoArea = book.match(/<div[^>]*id="(?:info|intro|bookinfo|detail)[^"]*"[^>]*>[\s\S]{0,1200}/i)?.[0];
console.log("info区片段:", JSON.stringify(infoArea?.slice(0, 900) ?? "未命中, 需Read全文"));

// 2) wap 第1章第2页(末页行为: 下一页指向哪)
const c1p2 = await grab("http://wap.80ge.info/225637/76636828_2.html", UA_WAP, "scripts/qq-a2-wap-ch1p2.html");
const nav = [...c1p2.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]{1,6})<\/a>/gi)].filter((m) => /下一|上一|目录/.test(m[2]));
console.log("章1页2导航:", nav.map((m) => `[${m[2].trim()}]→${m[1]}`).join(" "));
const nr = c1p2.match(/<div[^>]*id="nr"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
console.log("章1页2 #nr 文本长度:", nr?.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length ?? 0);

// 3) wap 第2章第2页(确认章末形态一致性)
const c2p2 = await grab("http://wap.80ge.info/225637/76636829_2.html", UA_WAP);
const nav2 = [...c2p2.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]{1,6})<\/a>/gi)].filter((m) => /下一|上一|目录/.test(m[2]));
console.log("章2页2导航:", nav2.map((m) => `[${m[2].trim()}]→${m[1]}`).join(" "));

// 4) 章节页标题元素(h1/h2/.title)
const c1 = await grab("http://wap.80ge.info/225637/76636828.html", UA_WAP);
console.log("章1 h1:", c1.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim());
console.log("章1 h2:", c1.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g, "").trim());
console.log("章1 .title/#title:", c1.match(/<(?:div|span|h\d)[^>]*(?:id|class)="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|h\d)>/i)?.[1]?.replace(/<[^>]+>/g, "").trim());

export {};
