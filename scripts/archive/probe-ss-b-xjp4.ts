/** ss-b: xjp 结构定案 — toc 容器/翻页锚/sort 翻页/书页封面 (3 请求) */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE = "https://www.xinjianpan.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: BASE + "/" }, signal: AbortSignal.timeout(20000) });
  console.log(`[get] ${res.status} ${url}`);
  return new TextDecoder("utf-8", { fatal: false }).decode(await res.arrayBuffer());
}

// ① list-1 容器与翻页区
const t1 = await get(`${BASE}/txt/oaa/list-1.html`);
await sleep(800);
const ci = t1.indexOf('class="chapters');
console.log("== chapters 容器开标签:", JSON.stringify(t1.slice(ci - 20, ci + 60)));
// chapters 容器结束位置(找 </div> 配平太贵, 直接看 select 区是否在 chapters 内: 检查 chapters 与 indexselect 的相对位置)
const selIdx = t1.indexOf('id="indexselect"');
const ulStart = t1.indexOf("<ul", ci);
const ulEnd = t1.indexOf("</ul>", ulStart);
console.log("== ul 区间:", ulStart, ulEnd, " select 位置:", selIdx, "(select 在 ul 后?", selIdx > ulEnd, ")");
// li 总数(ul 内) 与 ul 后第一个锚
const liCount = (t1.slice(ulStart, ulEnd).match(/<li /g) ?? []).length;
console.log("== ul 内 li 数:", liCount);
const afterUl = t1.slice(ulEnd, ulEnd + 900).replace(/\s+/g, " ");
console.log("== ul 后 900 字:", JSON.stringify(afterUl));

// ② list-2 翻页锚(中部页)
const t2 = await get(`${BASE}/txt/oaa/list-2.html`);
await sleep(800);
const u2s = t2.indexOf("<ul", t2.indexOf('class="chapters'));
const u2e = t2.indexOf("</ul>", u2s);
const after2 = t2.slice(u2e, u2e + 900).replace(/\s+/g, " ");
console.log("== list-2 ul 后:", JSON.stringify(after2));

// ③ sort 页翻页锚 + 书页封面
const t3 = await get(`${BASE}/sort/xuanhuan-2.html`);
await sleep(800);
const pager = [...t3.matchAll(/<a[^>]+href="([^"]*sort[^"]*)"[^>]*>([^<]{1,14})<\/a>/gi)].map((m) => `${m[2].trim()}→${m[1]}`);
console.log("== sort 翻页锚:", JSON.stringify(pager.slice(0, 10)));
const nextArea = /<div[^>]*class="[^"]*(page|pager)[^"]*"[^>]*>[\s\S]{0,600}?<\/div>/i.exec(t3)?.[0]?.replace(/\s+/g, " ");
console.log("== sort pager 区:", JSON.stringify(nextArea?.slice(0, 500)));
export {};
