/** ss-b2: xjp 活体复核 (7 请求, 串行, 间隔 900ms+) — 结构确认 + 新鲜 var c 双样本 */
const UA_M = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_D = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://www.xinjianpan.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(path: string, ua: string, tag: string): Promise<string> {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + path, {
      headers: { "User-Agent": ua, Accept: "text/html,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9", Referer: BASE + "/" },
      redirect: "follow", signal: AbortSignal.timeout(25000),
    });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    console.log(`[${tag}] ${res.status} ${Date.now() - t0}ms len=${buf.byteLength}B`);
    return text;
  } catch (e) { console.log(`[${tag}] ERR ${String(e).slice(0, 140)}`); return ""; }
}
const home = await get("/", UA_D, "home");
console.log("  title:", /<title>([^<]*)<\/title>/i.exec(home)?.[1]);
await sleep(900);
const sort = await get("/sort/xuanhuan-1.html", UA_D, "sort-1");
await Bun.write("tmp/ssb2-xjp-sort.html", sort);
await sleep(900);
const book = await get("/txt/oaa/", UA_D, "book");
await Bun.write("tmp/ssb2-xjp-book.html", book);
await sleep(900);
const toc1 = await get("/txt/oaa/list-1.html", UA_D, "toc-1");
await Bun.write("tmp/ssb2-xjp-toc1.html", toc1);
await sleep(900);
const toc2 = await get("/txt/oaa/list-2.html", UA_D, "toc-2");
await Bun.write("tmp/ssb2-xjp-toc2.html", toc2);
await sleep(900);
const ch1 = await get("/txt/oaa/vl7.html", UA_M, "chapter-mobile-1");
await Bun.write("tmp/ssb2-xjp-ch1.html", ch1);
await sleep(1200);
const ch2 = await get("/txt/oaa/vl7.html", UA_M, "chapter-mobile-2");
await Bun.write("tmp/ssb2-xjp-ch2.html", ch2);
// var c 双样本对比(是否每请求随机化)
const c1 = /var c="([^"]+)"/.exec(ch1)?.[1] ?? "";
const c2 = /var c="([^"]+)"/.exec(ch2)?.[1] ?? "";
console.log("var c1 len:", c1.length, "c2 len:", c2.length, "identical:", c1 === c2);
export {};
