/** qq-a2 探针1: qiushu.info 章节页结构定位 (总请求 ≤3: 章1 → 章内页2或下一章 → 再下一章) */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function analyze(html: string, tag: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
  console.log(`\n===== [${tag}] =====`);
  console.log("title:", title);
  console.log("h1:", h1);
  // 所有 div 的 id/class + 文本长度 (找正文容器: 文本最长)
  const divs = [...html.matchAll(/<div([^>]*)>([\s\S]*?)<\/div>/gi)];
  const stats = new Map<string, number>();
  for (const [, attrs, inner] of divs) {
    const id = attrs.match(/id="([^"]+)"/i)?.[1];
    const cls = attrs.match(/class="([^"]+)"/i)?.[1];
    const key = id ? `div#${id}` : cls ? `div.${cls.split(/\s+/)[0]}` : "div(plain)";
    const textLen = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    stats.set(key, Math.max(stats.get(key) ?? 0, textLen));
  }
  console.log("div容器(按文本长度Top8):", [...stats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
  // 链接: 下一页/下一章/目录/上一章 + _N.html 形态
  const links = [...html.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/gi)];
  for (const [, attrs, text] of links) {
    const href = attrs.match(/href="([^"]*)"/i)?.[1] ?? "";
    const t = text.replace(/<[^>]+>/g, "").trim();
    if (/下一页|下一章|上一页|上一章|目录|返回/.test(t) || /_\d+\.html/.test(href)) {
      console.log(`  link: [${t}] -> ${href}`);
    }
  }
  return { title, h1 };
}

function extractText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

async function grab(url: string, tag: string) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" }, redirect: "follow" });
  const buf = await res.arrayBuffer();
  let html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const cs = html.match(/charset=["']?([\w-]+)/i)?.[1] ?? "?";
  if (/gb2312|gbk/i.test(cs)) {
    try { html = new TextDecoder("gb18030").decode(buf); } catch {}
  }
  console.log(`[${tag}] status=${res.status} bytes=${buf.byteLength} charset=${cs} finalUrl=${res.url} ms=${Date.now() - t0}`);
  analyze(html, tag);
  return html;
}

const CH1 = "http://www.qiushu.info/t/225637/76636828.html";
const h1 = await grab(CH1, "章1");
const t1 = extractText(h1);
console.log("\n[章1]纯文本长度:", t1.length);
console.log("[章1]开头240:", JSON.stringify(t1.slice(0, 240)));
console.log("[章1]结尾240:", JSON.stringify(t1.slice(-240)));
const ads = ["请记住本站", "首发", "最新章节", "手机阅读", "www\\.", "com[/\\\\]", "一秒记住", "天才一秒", "本章未完"];
console.log("[章1]广告词命中:", ads.filter((a) => new RegExp(a, "i").test(h1)));

// 从章1 HTML 里找下一章链接 (含 _N 章内分页形态)
const nextChapter = h1.match(/<a[^>]*href="([^"]*)"[^>]*>\s*下一章/) ?? h1.match(/<a[^>]*href="([^"]*\/t\/[^"]*\.html)"[^>]*>[^<]*下一/);
const nextPage = h1.match(/<a[^>]*href="([^"]*_\d+\.html)"/);
const abs = (u: string) => (u.startsWith("http") ? u : new URL(u, CH1).href);

if (nextPage?.[1]) {
  const u2 = abs(nextPage[1]);
  console.log("\n>>> 检测到章内分页, 抓第2页:", u2);
  const h2 = await grab(u2, "章1-页2");
  const t2 = extractText(h2);
  console.log("[章1页2]纯文本长度:", t2.length, "开头120:", JSON.stringify(t2.slice(0, 120)));
  if (nextChapter?.[1]) await grab(abs(nextChapter[1]), "章2(连续抓验证)");
  else console.log(">>> 章1页内无下一章链接");
} else if (nextChapter?.[1]) {
  const u2 = abs(nextChapter[1]);
  console.log("\n>>> 无章内分页, 下一章:", u2);
  const h2 = await grab(u2, "章2");
  const t2 = extractText(h2);
  console.log("[章2]纯文本长度:", t2.length, "开头120:", JSON.stringify(t2.slice(0, 120)));
  const nx2 = h2.match(/<a[^>]*href="([^"]*)"[^>]*>\s*下一章/);
  if (nx2?.[1]) await grab(abs(nx2[1]), "章3(连续抓验证)");
  else console.log(">>> 章2无下一章链接");
} else {
  console.log(">>> 章1页内未发现下一页/下一章链接, 需人工判读HTML");
}

export {};
