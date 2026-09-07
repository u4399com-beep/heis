/** qq-b2: 3 站(jhssd/ttkan/libahao2) 首轮侦察 — 状态/编码/反爬指纹/URL 形态 */
const SITES = [
  ["1 m.jhssd.com", "https://m.jhssd.com/"],
  ["1b m.jhsssd.com(对照)", "https://m.jhsssd.com/"],
  ["2 cn.ttkan.co", "https://cn.ttkan.co/"],
  ["3 www.libahao2.com", "https://www.libahao2.com/"],
] as const;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function sig(html: string) {
  return {
    cfChallenge: /cdn-cgi\/challenge-platform|cf-browser-verification|__cf_chl|Just a moment/i.test(html),
    jsChallenge: /eval\(function\(p,a,c,k,e|window\["\w+"\]\s*=\s*function|_0x[0-9a-f]{4,}/i.test(html),
    appWall: /下载APP|APP内|客户端.*阅读/i.test(html.slice(0, 30000)),
    gbk: /charset=["']?(gb2312|gbk)["']?/i.test(html),
    utf8: /charset=["']?utf-?8["']?/i.test(html),
    title: (html.match(/<title[^>]*>([^<]{0,80})/i)?.[1] || "").trim(),
    bytes: html.length,
  };
}

function shapes(t: string) {
  const ls = [...new Set([...t.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))].filter((l) => !/\.(css|js|ico|png|jpg|svg|gif)/.test(l));
  const m = new Map<string, number>();
  for (const l of ls) {
    const s = l.replace(/https?:\/\/[^/]+/, "").replace(/\d+/g, "N").replace(/\?.*/, "?Q").slice(0, 50);
    m.set(s, (m.get(s) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
}

for (const [name, url] of SITES) {
  const out: string[] = [`== ${name} ${url}`];
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    const buf = await r.arrayBuffer();
    let html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    out.push(`status=${r.status} final=${r.url} bytes=${buf.byteLength}`);
    const s = sig(html);
    out.push(`sig=${JSON.stringify(s)}`);
    if (s.gbk && !s.utf8) {
      html = new TextDecoder("gbk", { fatal: false }).decode(buf);
      out.push(`(gbk re-decoded)`);
    }
    out.push(shapes(html).map(([k, c]) => `${k} x${c}`).join("\n"));
    out.push(`head400=${html.slice(0, 400).replace(/\s+/g, " ")}`);
  } catch (e) {
    out.push(`ERR ${String(e).slice(0, 200)}`);
  }
  console.log(out.join("\n") + "\n");
}
export {};
