/** qq-b2 站3: libahao2 XFF 伪造 + 桥 static/stealthy 对照(判断封锁层) */
const BLOCK = "https://www.libahao2.com/";

// 1) XFF 伪造族
const tries: Array<[string, Record<string, string>]> = [
  ["xff=8.8.8.8", { "X-Forwarded-For": "8.8.8.8" }],
  ["xff=1.2.3.4+XReal", { "X-Forwarded-For": "1.2.3.4", "X-Real-IP": "1.2.3.4" }],
  ["CF-Connecting-IP", { "CF-Connecting-IP": "8.8.8.8" }],
  ["client-ip", { "Client-IP": "8.8.8.8", "X-Client-IP": "8.8.8.8" }],
  ["zh-US+full headers", { "X-Forwarded-For": "104.28.5.6", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8", "Accept-Encoding": "gzip, deflate, br", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Upgrade-Insecure-Requests": "1" }],
];
for (const [tag, hdrs] of tries) {
  try {
    const r = await fetch(BLOCK, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Accept-Language": "zh-CN,zh;q=0.9", ...hdrs },
      redirect: "follow", signal: AbortSignal.timeout(15000),
    });
    const t = await r.text();
    console.log(`${tag}: ${r.status} ${(t.match(/<title[^>]*>([^<]{0,40})/i)?.[1] || "").trim()}`);
  } catch (e) { console.log(`${tag}: ERR ${String(e).slice(0, 80)}`); }
}

// 2) 桥 static / stealthy 对照(同 IP, 看封锁是否 TLS/JS 指纹层)
async function bridge(mode: string) {
  try {
    const r = await fetch("http://localhost:3012/fetch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: BLOCK, mode, timeout: 45000 }),
      signal: AbortSignal.timeout(60000),
    });
    const j: any = await r.json().catch(() => ({}));
    const html = j?.data?.html || j?.html || "";
    console.log(`bridge ${mode}: status=${r.status} ok=${j?.ok} finalUrl=${j?.data?.finalUrl || j?.finalUrl || "?"} bytes=${html.length} title=${(html.match(/<title[^>]*>([^<]{0,40})/i)?.[1] || "").trim()}`);
  } catch (e) { console.log(`bridge ${mode}: ERR ${String(e).slice(0, 120)}`); }
}
await bridge("static");
await bridge("stealthy");
export {};
