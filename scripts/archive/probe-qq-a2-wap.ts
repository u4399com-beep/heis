/** qq-a2 探针2(场景切换): qiushu.info 沙箱不可达 → wap.80ge.info 承载正文, 验证章节页+目录分页 */
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

function analyze(html: string, tag: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  console.log(`\n===== [${tag}] title: ${title}`);
  const divs = [...html.matchAll(/<(?:div|p)([^>]*)>([\s\S]*?)<\/(?:div|p)>/gi)];
  const stats = new Map<string, number>();
  for (const [, attrs, inner] of divs) {
    const id = attrs.match(/id="([^"]+)"/i)?.[1];
    const cls = attrs.match(/class="([^"]+)"/i)?.[1];
    const key = `${attrs.toString().startsWith(" p") ? "p" : "div"}${id ? `#${id}` : cls ? `.${cls.split(/\s+/)[0]}` : ""}`;
    const textLen = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
    stats.set(key, Math.max(stats.get(key) ?? 0, textLen));
  }
  console.log("容器(文本长度Top6):", [...stats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6));
  const links = [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const [, href, text] of links) {
    const t = text.replace(/<[^>]+>/g, "").trim();
    if (/下一|上一|目录|书页|首页/.test(t)) console.log(`  link: [${t}] -> ${href}`);
  }
}

async function grab(url: string, tag: string) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  console.log(`[${tag}] status=${res.status} bytes=${html.length} ms=${Date.now() - t0}`);
  analyze(html, tag);
  return html;
}

function textOf(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ").replace(/\n{2,}/g, "\n").trim();
}

// 1) 章节页(与 qiushu 同 ID 第1章 76636828)
const ch = await grab("http://wap.80ge.info/225637/76636828.html", "wap章1");
const t = textOf(ch);
console.log("[章1]纯文本长度:", t.length, "\n开头200:", JSON.stringify(t.slice(0, 200)), "\n结尾160:", JSON.stringify(t.slice(-160)));
console.log("[章1]广告词命中:", ["请记住本站", "一秒记住", "天才一秒", "首发", "手机阅读", "80ge", "wap\\."].filter((a) => new RegExp(a, "i").test(ch)));

// 2) 目录分页第1页(确认章节数/选择器)
const toc = await grab("http://wap.80ge.info/225637/page-1.html", "wap目录页1");
const items = [...toc.matchAll(/<a[^>]*href="\/225637\/(\d+)\.html"[^>]*>([^<]*)<\/a>/gi)];
console.log("[目录页1]章节数:", items.length, "首章:", items[0]?.[2], "末章:", items.at(-1)?.[2]);
const pages = toc.match(/共(\d+)页|page-(\d+)\.html/g);
console.log("[目录页1]分页线索:", JSON.stringify(pages?.slice(0, 8)));

// 3) 连续抓第2章(限速验证)
const ch2 = await grab("http://wap.80ge.info/225637/76636829.html", "wap章2(连续抓)");
const t2 = textOf(ch2);
console.log("[章2]纯文本长度:", t2.length, "开头100:", JSON.stringify(t2.slice(0, 100)));

export {};
