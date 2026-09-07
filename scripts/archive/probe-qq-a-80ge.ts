/** qq-a: 80ge.info 全站结构探测 — 列表/书页/目录页/章节页 + qiushu.info 限速测试 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function get(url: string, timeoutMs = 20000): Promise<{ status: number; html: string; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const buf = await res.arrayBuffer();
  const ms = Date.now() - t0;
  return { status: res.status, html: new TextDecoder("utf-8").decode(buf), ms };
}

function pick(html: string, tag: string, n = 3): string[] {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < n) out.push(m[0]);
  return out;
}

// ============ 1. 列表页: 最近更新/编辑推荐/分类 ============
console.log("========== LIST PAGES ==========");
for (const u of ["http://www.80ge.info/top/lastupdate/1.html", "http://www.80ge.info/top/toptime/1.html", "http://www.80ge.info/sort3/1.html"]) {
  const r = await get(u);
  console.log(`\n--- ${u} → ${r.status} (${r.ms}ms, ${r.html.length} chars)`);
  // 找列表容器常见结构
  const sample = r.html.slice(0, 400);
  console.log("HEAD:", sample.replace(/\s+/g, " ").slice(0, 300));
  // ul/li 或 table tr
  const lis = pick(r.html, "li", 5);
  console.log(`li count sample: ${lis.length}; first:`, lis[0]?.replace(/\s+/g, " ").slice(0, 200));
  const trs = pick(r.html, "tr", 4);
  console.log(`tr count sample: ${trs.length}; first:`, trs[0]?.replace(/\s+/g, " ").slice(0, 200));
  // 翻页区
  const pagIdx = r.html.indexOf("pagego");
  if (pagIdx > 0) console.log("pagego snippet:", r.html.slice(pagIdx - 100, pagIdx + 200).replace(/\s+/g, " "));
  const pageNav = r.html.match(/lastupdate[^"']*(\d+)\.html/g);
  console.log("page links sample:", pageNav?.slice(0, 5));
}

// ============ 2. 书页: /txtxz/{id}.html ============
console.log("\n========== BOOK PAGE ==========");
const BOOK = "http://www.80ge.info/txtxz/225637.html";
const br = await get(BOOK);
console.log(`--- ${BOOK} → ${br.status} (${br.ms}ms, ${br.html.length} chars)`);
// h1
console.log("H1:", pick(br.html, "h1", 2).map(s => s.replace(/\s+/g, " ")));
// 信息区块: 找 author 链接
const authorIdx = br.html.indexOf("/author/");
console.log("author region:", authorIdx > 0 ? br.html.slice(Math.max(0, authorIdx - 300), authorIdx + 150).replace(/\s+/g, " ") : "N/A");
// 简介
const introIdx = br.html.search(/简介|内容简介|书籍简介/);
console.log("intro region:", introIdx > 0 ? br.html.slice(introIdx - 200, introIdx + 400).replace(/\s+/g, " ") : "N/A");
// 下载链接
const dl = br.html.match(/txt\.80ge\.info[^"'<>\s]*/g);
console.log("txt dl links:", dl?.slice(0, 3));
// 目录页链接
const tocLink = br.html.match(/txtml_\d+\.html/g);
console.log("toc links:", tocLink?.slice(0, 3));
// 封面 img
const imgs = br.html.match(/<img[^>]+>/gi);
console.log("imgs:", imgs?.slice(0, 6).map(s => s.replace(/\s+/g, " ")));
// 分类/状态
const sortIdx = br.html.indexOf("/sort");
console.log("sort region:", sortIdx > 0 ? br.html.slice(Math.max(0, sortIdx - 200), sortIdx + 120).replace(/\s+/g, " ") : "N/A");

// ============ 3. 目录页: /txtml_{id}.html ============
console.log("\n========== TOC PAGE ==========");
const TOC = "http://www.80ge.info/txtml_225637.html";
const tr2 = await get(TOC);
console.log(`--- ${TOC} → ${tr2.status} (${tr2.ms}ms, ${tr2.html.length} chars)`);
const links = [...tr2.html.matchAll(/<a[^>]+href="([^"]*)"[^>]*>([^<]{1,60})<\/a>/gi)].map(m => [m[1], m[2].trim()]);
const qsLinks = links.filter(l => l[0].includes("qiushu"));
console.log(`total links=${links.length}, qiushu links=${qsLinks.length}`);
console.log("first 3 qiushu:", qsLinks.slice(0, 3));
console.log("last 2 qiushu:", qsLinks.slice(-2));
// 章节容器上下文
const q0 = tr2.html.indexOf("qiushu");
console.log("toc container ctx:", q0 > 0 ? tr2.html.slice(Math.max(0, q0 - 350), q0 + 200).replace(/\s+/g, " ") : "N/A");
// 目录页翻页?
const tocPag = tr2.html.match(/txtml_\d+_\d+\.html/g);
console.log("toc pagination:", tocPag?.slice(0, 5));

// ============ 4. qiushu.info 章节页 ============
console.log("\n========== QIUSHU CHAPTER PAGE ==========");
if (qsLinks.length > 0) {
  const cu = qsLinks[0][0].startsWith("http") ? qsLinks[0][0] : `http://www.qiushu.info${qsLinks[0][0]}`;
  const cr = await get(cu);
  console.log(`--- ${cu} → ${cr.status} (${cr.ms}ms, ${cr.html.length} chars)`);
  // 找正文容器: 常见 id/class
  for (const pat of [/id="content"/i, /class="content"/i, /id="txt"/i, /id="BookText"/i, /class="showtxt"/i, /<article/i]) {
    const i = cr.html.search(pat);
    if (i >= 0) {
      console.log(`content ctx (${pat}):`, cr.html.slice(i - 120, i + 250).replace(/\s+/g, " "));
      break;
    }
  }
  // 标题
  console.log("TITLE:", pick(cr.html, "h1", 2).map(s => s.replace(/\s+/g, " ")), pick(cr.html, "title", 1).map(s => s.replace(/\s+/g, " ")));
  // 章内分页: 下一页链接
  const nextPage = cr.html.match(/href="([^"]*_\d+\.html)"/g);
  console.log("_N.html links:", nextPage?.slice(0, 5));
  const nextTxt = cr.html.match(/<a[^>]+>(下一页|下一頁|下页)[^<]*<\/a>/i);
  console.log("nextPage anchor:", nextTxt?.[0]?.replace(/\s+/g, " "));
  // 正文长度粗测: 最大 div
  const divs = [...cr.html.matchAll(/<div[^>]*id="([^"]+)"[^>]*>/gi)].map(m => m[1]);
  console.log("div ids:", divs);
}

export {};
