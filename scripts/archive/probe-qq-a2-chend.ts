/** qq-a2 探针4: 章内分页末页行为(_3/_4) */
const UA = "Mozilla/5.0 (Linux; Android 13) Chrome/131.0.0.0 Mobile";
async function grab(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  const nav = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]{1,6})<\/a>/gi)].filter((m) => /下一|上一|目录|下一章/.test(m[2]));
  const nr = html.match(/<div[^>]*id="nr"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  console.log(`[${url.split("/").pop()}] status=${res.status} nr长度=${nr?.replace(/<[^>]+>/g, "").replace(/\s+/g, "").length ?? 0} 导航:`, nav.map((m) => `[${m[2].trim()}]→${m[1]}`).join(" "));
  return html;
}
await grab("http://wap.80ge.info/225637/76636828_3.html");
await grab("http://wap.80ge.info/225637/76636828_4.html");
export {};
