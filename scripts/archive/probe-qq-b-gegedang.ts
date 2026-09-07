/** qq-b: gegedang 正文墙强度测试 — 多章多书采样 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const B = "https://www.gegedangbook.com";
const H = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(20000) });
  return { s: r.status, t: await r.text(), u: r.url };
}

function probe(label: string, t: string) {
  const c1 = t.indexOf('id="content"');
  const seg = t.slice(c1, c1 + 1500);
  const appWall = /由于版权问题|下载.*APP|APP内更新|正在手打中/.test(seg);
  const paras = [...t.matchAll(/<div class="content" id="content">([\s\S]*?)<\/div>/gi)][0]?.[1] || "";
  const textLen = paras.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
  console.log(`[${label}] appWall=${appWall} rawLen=${paras.length} textLen=${textLen} sample=${paras.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").slice(0, 60)}`);
}

for (const cid of ["156113", "156114", "227260", "200000"]) await get(`${B}/chapter/460712/${cid}.html`).then((r) => probe(`460712/${cid}`, r.t));

// 另一本书(首页新书): /txt/462142.html 找第一章链接
const b2 = await get(B + "/txt/462142.html");
const first = [...b2.t.matchAll(/href="(\/chapter\/\d+\/\d+\.html)"/g)][0]?.[1];
console.log("b2 first chapter:", first);
if (first) await get(B + first).then((r) => probe("b2-first", r.t));
// 大站的完本书试试(完本区)
const qb = await get(B + "/quanben/sort/");
const qfirst = [...qb.t.matchAll(/href="(\/txt\/\d+\.html)"/g)][0]?.[1];
console.log("quanben sample book:", qfirst);
