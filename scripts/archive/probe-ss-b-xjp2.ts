/** ss-b: xinjianpan 链路深探 (sort→book→toc→chapter→正文JS) — 礼貌串行 ~7 请求 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://www.xinjianpan.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9", Referer: BASE + "/" },
      redirect: "follow", signal: AbortSignal.timeout(20000),
    });
    const buf = await res.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    console.log(`[get] ${res.status} ${Date.now() - t0}ms len=${buf.byteLength}B ${url}`);
    return text;
  } catch (e) {
    console.log(`[get] ERR ${Date.now() - t0}ms ${url} ${String(e).slice(0, 140)}`);
    return "";
  }
}

// ① 列表页
const sortHtml = await get(`${BASE}/sort/xuanhuan-1.html`);
await sleep(800);
const bookLinks = [...sortHtml.matchAll(/href="(\/txt\/[^"]+\/)"/gi)].map((m) => m[1]);
const uniqBooks = [...new Set(bookLinks)];
console.log("  sort 书链样本:", JSON.stringify(uniqBooks.slice(0, 5)), "total uniq:", uniqBooks.length);
const firstBook = uniqBooks[0] ?? "/txt/oei4/";
// 列表项结构样本
const item = /<dl[^>]*list-item[\s\S]{0,2000}?<\/dl>/i.exec(sortHtml)?.[0] ?? "";
console.log("  sort item sample:", item.slice(0, 900).replace(/\s+/g, " "));

// ② 书页(即目录页?)
const bookHtml = await get(BASE + firstBook);
await sleep(800);
if (bookHtml) {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(bookHtml)?.[1]?.trim();
  console.log("  book h1:", h1);
  const metas = [...bookHtml.matchAll(/<meta[^>]*(?:property|name)="(og:novel:[^"]+)"[^>]*content="([^"]*)"/gi)].map((m) => `${m[1]}=${m[2]}`);
  console.log("  og metas:", JSON.stringify(metas));
  const listPages = [...new Set([...bookHtml.matchAll(/href="([^"]*list-\d+\.html)"/gi)].map((m) => m[1]))];
  console.log("  toc 分页链:", JSON.stringify(listPages.slice(0, 4)));
  const chLinks = [...bookHtml.matchAll(/<a[^>]+href="([^"]*)"[^>]*onclick[^>]*>/gi)].slice(0, 3).map((m) => m[0].slice(0, 200));
  console.log("  onclick 锚样本:", JSON.stringify(chLinks));
  // 章节锚的另一种形态: href=javascript + onclick
  const jsAnchors = [...bookHtml.matchAll(/<a\s+href="javascript:;?"[^>]*>/gi)].slice(0, 3).map((m) => m[0].slice(0, 220));
  console.log("  javascript; 锚样本:", JSON.stringify(jsAnchors));
}

// ③ 目录页 list-1.html
const tocPage = /href="([^"]*list-1\.html)"/i.exec(bookHtml)?.[1] ?? firstBook.replace(/\/$/, "") + "/list-1.html";
const tocUrl = tocPage.startsWith("http") ? tocPage : BASE + tocPage;
const tocHtml = await get(tocUrl);
await sleep(800);
if (tocHtml) {
  // 抽取目录区第一段
  const zone = /<ul[^>]*>[\s\S]{0,3000}?<\/ul>/i.exec(tocHtml)?.[0] ?? "";
  console.log("  toc ul 样本:", zone.slice(0, 800).replace(/\s+/g, " "));
  const chs = [...tocHtml.matchAll(/<a\s+href="javascript:;?"[^>]*onclick="location\.href='([^']+)'"[^>]*(?:title="([^"]*)")?[^>]*>/gi)].slice(0, 5)
    .map((m) => ({ u: m[1], t: m[2] }));
  console.log("  toc onclick 章节链:", JSON.stringify(chs));
  const chCount = [...tocHtml.matchAll(/onclick="location\.href='/gi)].length;
  console.log("  toc onclick 总数:", chCount);
  const pager = [...tocHtml.matchAll(/<a[^>]+href="([^"]*list-\d+\.html)"[^>]*>([^<]{0,12})<\/a>/gi)].slice(0, 6).map((m) => `${m[2]}→${m[1]}`);
  console.log("  toc 翻页锚:", JSON.stringify(pager));
}
export {};
