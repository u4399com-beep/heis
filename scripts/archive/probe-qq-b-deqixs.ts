/** qq-b: deqixs 兜底实验 — v1 端点/参数裁剪 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const B = "https://www.deqixs.cc";
const A = "126", C = "81417";

async function tk(aid: string, cid: string) {
  const r = await fetch(`${B}/scripts/chapter.js.php?aid=${aid}&cid=${cid}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
  const t = await r.text();
  return { token: t.match(/chapterToken = '([^']+)'/)?.[1] || "", ts: t.match(/timestamp = (\d+)/)?.[1] || "", nonce: t.match(/nonce = '([^']+)'/)?.[1] || "" };
}
async function hit(url: string, label: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Referer: `${B}/books/${A}/${C}.html`, ...headers }, signal: AbortSignal.timeout(15000) });
  const buf = await r.arrayBuffer();
  const txt = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  let s = `status=${r.status} bytes=${buf.byteLength} head=${txt.slice(0, 100).replace(/\s+/g, " ")}`;
  try { const j = JSON.parse(txt); s += ` | jstatus=${j.status} len=${j.data?.content?.length ?? 0}`; } catch {}
  console.log(`[${label}] ${s}`);
}
const f = await tk(A, C);
// v1 端点(注释里那个)
await hit(`${B}/modules/article/ajax_chapter.php?aid=${A}&cid=${C}&token=${f.token}&timestamp=${f.ts}&nonce=${f.nonce}`, "v1-full3");
await hit(`${B}/modules/article/ajax_chapter.php?aid=${A}&cid=${C}`, "v1-noparams");
// v2 换序/缺 nonce
await hit(`${B}/modules/article/ajax2.php?aid=${A}&cid=${C}&token=${f.token}&timestamp=${f.ts}`, "v2-no-nonce");
// timestamp 是否强校验: 老时间戳+当前 token
await hit(`${B}/modules/article/ajax2.php?aid=${A}&cid=${C}&token=${f.token}&timestamp=1000000000000&nonce=${f.nonce}`, "v2-old-ts");
