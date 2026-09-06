/** qq-b: xinjianpan 章节页脚本清单+morecontent 填充源 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const B = "https://www.xinjianpan.com";
const r = await fetch(B + "/txt/oaa/vl7.html", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
const t = await r.text();
const scripts = [...t.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
scripts.forEach((m, i) => {
  const attrs = m[1].trim();
  const body = m[2].trim();
  if (attrs.includes("src")) {
    console.log(`ext#${i}: ${attrs.match(/src="([^"]+)"/)?.[1]}`);
  } else {
    const keys = (body.match(/(morecontent|ajax|fetch|XMLHttp|chaptercontent|innerHTML)/g) || []).join(",");
    console.log(`inl#${i} len=${body.length} keys=[${keys}]`);
    if (/morecontent|chaptercontent/.test(body)) console.log(body.slice(0, 1500));
  }
});
