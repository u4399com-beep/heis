/** qq-b: 同源 CMS 三站(jhsssd/xinjianpan/gegedang) 链接形态盘点 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function links(name: string, url: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    const ls = [...new Set([...t.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))].filter((l) => !/\.(css|js|ico|png|jpg|svg|gif)/.test(l));
    // 归纳形态
    const shapes = new Map<string, number>();
    for (const l of ls) {
      const shape = l.replace(/https?:\/\/[^/]+/, "").replace(/\d+/g, "N").replace(/\?.*/, "?Q").slice(0, 60);
      shapes.set(shape, (shapes.get(shape) || 0) + 1);
    }
    console.log(`\n== ${name} ${r.status} bytes=${t.length}`);
    console.log([...shapes.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => `${s} x${c}`).join("\n"));
    // 样例书链接与正文链接文本
    const bookSample = ls.filter((l) => /\/(book|xiaoshuo|\d+_?N?)\//.test(l)).slice(0, 6);
    console.log("sample:", bookSample.join(" | "));
  } catch (e) { console.log(`\n== ${name} ERR ${String(e).slice(0, 120)}`); }
}

await links("jhsssd(m)", "https://m.jhsssd.com/");
await links("xinjianpan", "https://www.xinjianpan.com/");
await links("gegedang", "https://www.gegedangbook.com/");
