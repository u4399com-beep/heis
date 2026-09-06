/** ss-b: xinjianpan toc 锚形态 + 章节页正文层 + 内容 JS 拉取 — ~4 请求 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://www.xinjianpan.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, ref = BASE + "/"): Promise<{ status: number; text: string; bytes: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9", Referer: ref },
      redirect: "follow", signal: AbortSignal.timeout(25000),
    });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    console.log(`[get] ${res.status} ${Date.now() - t0}ms len=${buf.byteLength}B ${url}`);
    return { status: res.status, text, bytes: buf.byteLength };
  } catch (e) {
    console.log(`[get] ERR ${Date.now() - t0}ms ${url} ${String(e).slice(0, 140)}`);
    return { status: 0, text: "", bytes: 0 };
  }
}

// ① toc 原始锚形态
const toc = await get(`${BASE}/txt/oaa/list-1.html`);
await sleep(800);
const anchor = /<a[^>]+onclick="location\.href='[^']+'"[^>]*>/i.exec(toc.text)?.[0] ?? "";
console.log("  toc 锚原文:", JSON.stringify(anchor));
// 目录容器
const container = /<(ul|dl|div)[^>]*(list|chapter|book)[^>]*>/i.exec(toc.text)?.[0] ?? "";
console.log("  toc 容器:", JSON.stringify(container));
// 章节区在哪: 找 vl7.html 附近 500 字
const idx = toc.text.indexOf("/txt/oaa/vl7.html");
console.log("  章节区上下文:", JSON.stringify(toc.text.slice(Math.max(0, idx - 300), idx + 120).replace(/\s+/g, " ")));
// 翻页区: 找 list-2 上下文
const idx2 = toc.text.indexOf("list-2");
console.log("  翻页上下文:", JSON.stringify(toc.text.slice(Math.max(0, idx2 - 350), idx2 + 150).replace(/\s+/g, " ")));

// ② 章节页
const ch = await get(`${BASE}/txt/oaa/vl7.html`, toc.url || `${BASE}/txt/oaa/list-1.html`);
await sleep(900);
if (ch.text) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(ch.text)?.[1]?.trim();
  console.log("  ch h1:", JSON.stringify(h1));
  const mc = /<div[^>]*morecontent[^>]*>/i.exec(ch.text)?.[0];
  console.log("  #morecontent 开标签:", JSON.stringify(mc));
  const ps = [...ch.text.matchAll(/<p>/gi)].length;
  console.log("  SSR <p> 数:", ps, " 全文字节数:", ch.bytes);
  // 正文容器: 查找主要内容 div
  const mainDiv = /<div[^>]*class="[^"]*(content|showtxt|read)[^"]*"[^>]*>/gi.exec(ch.text)?.[0];
  console.log("  正文容器开标签:", JSON.stringify(mainDiv));
  const moreIdx = ch.text.search(/morecontent/i);
  if (moreIdx > 0) console.log("  morecontent 上下文:", JSON.stringify(ch.text.slice(moreIdx - 200, moreIdx + 300).replace(/\s+/g, " ")));
  // JS 引用
  const scripts = [...ch.text.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/gi)].map((m) => m[1]);
  console.log("  script src 列表:", JSON.stringify(scripts));
  // 章节内翻页/下一章形态
  const nexts = [...ch.text.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]{0,10}(?:下一[页章]|上一步)[^<]{0,10})<\/a>/gi)].map((m) => `${m[2]}→${m[1]}`);
  console.log("  翻页锚:", JSON.stringify(nexts.slice(0, 6)));
  const onclickNext = [...ch.text.matchAll(/onclick="location\.href='([^']+)'"[^>]*>([^<]{0,14})</gi)].map((m) => `${m[2].trim()}→${m[1]}`);
  console.log("  onclick 翻页:", JSON.stringify(onclickNext.slice(0, 6)));
}

// ③ 内容 JS(改名探测)
const jsName = /(?:src=|")([^"\/]*get\d+\.js)/i.exec(ch.text)?.[1] ?? "get20260103.js";
const jsPath = /src="([^"]*get\d+\.js[^"]*)"/i.exec(ch.text)?.[1] ?? `/public/js/${jsName}`;
const jsUrl = jsPath.startsWith("http") ? jsPath : BASE + jsPath;
console.log("  内容JS URL:", jsUrl);
const js = await get(jsUrl, `${BASE}/txt/oaa/vl7.html`);
if (js.text) {
  console.log("  JS 长度:", js.text.length, " 前 600 字:", js.text.slice(0, 600).replace(/\s+/g, " "));
}
export {};
