/** ss-b: xjp 翻页锚定案 — list-2/list-3 底部 pager + sort 页 pager (3 请求) */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://www.xinjianpan.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: BASE + "/" }, signal: AbortSignal.timeout(20000) });
  console.log(`[get] ${res.status} ${url}`);
  return new TextDecoder("utf-8", { fatal: false }).decode(await res.arrayBuffer());
}
function dumpPager(t: string, tag: string) {
  // 全部 listpage div
  const zones = [...t.matchAll(/<div class="listpage">[\s\S]{0,2600}?<\/div>\s*(?=<)/g)].map((m) => m[0]);
  console.log(`== ${tag} listpage 区块数:`, zones.length);
  zones.forEach((z, i) => {
    const anchors = [...z.matchAll(/<a[^>]+(?:href|onclick)="([^"]+)"[^>]*>([^<]{1,12})<\/a>/g)].map((m) => `${m[2].trim()}[${m[1]}]`);
    console.log(`  区块${i + 1}: ${JSON.stringify(anchors)}`);
  });
}

const t2 = await get(`${BASE}/txt/oaa/list-2.html`);
dumpPager(t2, "list-2");
await sleep(800);
const t3 = await get(`${BASE}/txt/oaa/list-3.html`);
dumpPager(t3, "list-3");
await sleep(800);
const t4 = await get(`${BASE}/sort/xuanhuan-2.html`);
dumpPager(t4, "sort-2");
// sort 页翻页是否还有其它形态
const nexts4 = [...t4.matchAll(/<a[^>]+(?:href|onclick)="([^"]+)"[^>]*>([^<]{0,10}(?:下一页|下页|尾页)[^<]{0,10})<\/a>/gi)].map((m) => `${m[2].trim()}[${m[1]}]`);
console.log("== sort-2 下一页类锚:", JSON.stringify(nexts4));
export {};
