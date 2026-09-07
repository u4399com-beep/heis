/** qq-b: 6 站首轮首页侦察 — 状态/编码/反爬指纹/URL 形态粗探 */
const SITES = [
  ["1 m.jhssd.com", "https://m.jhssd.com/"],
  ["2 cn.ttkan.co", "https://cn.ttkan.co/"],
  ["3 www.deqixs.cc", "https://www.deqixs.cc/"],
  ["4 www.libahao2.com", "https://www.libahao2.com/"],
  ["5 www.xinjianpan.com", "https://www.xinjianpan.com/"],
  ["6 www.gegedangbook.com", "https://www.gegedangbook.com/"],
] as const;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sig(html: string) {
  return {
    cfChallenge: /cdn-cgi\/challenge-platform|cf-browser-verification|__cf_chl|Just a moment/i.test(html),
    jsChallenge: /eval\(function\(p,a,c,k,e|window\["\w+"\]\s*=\s*function|_0x[0-9a-f]{4,}/i.test(html),
    gbk: /charset=["']?(gb2312|gbk)["']?/i.test(html),
    utf8: /charset=["']?utf-?8["']?/i.test(html),
    title: (html.match(/<title[^>]*>([^<]{0,80})/i)?.[1] || "").trim(),
    serverHints: /xiaoshuo|novel|chapter|book/i.test(html.slice(0, 20000)) ? "novel-ish" : "?",
    bytes: html.length,
  };
}

for (const [name, url] of SITES) {
  const out: string[] = [`== ${name} ${url}`];
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const buf = await r.arrayBuffer();
    let html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const finalUrl = r.url;
    out.push(`status=${r.status} final=${finalUrl} bytes=${buf.byteLength}`);
    const s = sig(html);
    out.push(`sig=${JSON.stringify(s)}`);
    if (s.gbk && !s.utf8) {
      const gbk = new TextDecoder("gbk", { fatal: false }).decode(buf);
      out.push(`gbkTitle=${(gbk.match(/<title[^>]*>([^<]{0,80})/i)?.[1] || "").trim()}`);
    }
    out.push(`head1k=${html.slice(0, 600).replace(/\s+/g, " ")}`);
    if (/Just a moment|__cf_chl/i.test(html) && r.status >= 400) out.push("VERDICT=CF-challenge -> stealthy needed");
  } catch (e) {
    out.push(`ERR ${String(e).slice(0, 200)}`);
  }
  console.log(out.join("\n") + "\n");
}
export {};
