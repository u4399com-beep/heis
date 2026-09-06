/** qq-b2 站3: libahao2 403 地区拦截页解剖 + 多形态重试 */
const UAs = {
  winChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  baiduspider: "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
};

async function probe(tag: string, url: string, ua: string, extra: Record<string, string> = {}) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": ua, "Accept-Language": "zh-CN,zh;q=0.9", ...extra }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    const title = (t.match(/<title[^>]*>([^<]{0,80})/i)?.[1] || "").trim();
    console.log(`${tag}: ${r.status} bytes=${t.length} title=${title}`);
    return t;
  } catch (e) {
    console.log(`${tag}: ERR ${String(e).slice(0, 120)}`);
    return "";
  }
}

// 拦截页全文(找 JS 绕过线索)
const block = await probe("winChrome /", "https://www.libahao2.com/", UAs.winChrome);
if (block) {
  console.log("--- body text ---");
  console.log(block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1200));
  console.log("--- scripts ---");
  console.log([...block.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).join(" | ") || "(inline only)");
  const inline = [...block.matchAll(/<script[^>]*>([\s\S]{0,600}?)<\/script>/g)].map((m) => m[1].replace(/\s+/g, " ").slice(0, 400)).filter(Boolean);
  console.log("--- inline js ---\n" + inline.join("\n--\n"));
}

await probe("iphone /", "https://www.libahao2.com/", UAs.iphone);
await probe("baiduspider /", "https://www.libahao2.com/", UAs.baiduspider);
await probe("http://", "http://www.libahao2.com/", UAs.winChrome);
await probe("www.libahao.com", "https://www.libahao.com/", UAs.winChrome);
await probe("libahao2.com apex", "https://libahao2.com/", UAs.winChrome);
await probe("/robots.txt", "https://www.libahao2.com/robots.txt", UAs.winChrome);
export {};
