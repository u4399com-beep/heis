/** qq-d: 拉取 yckceo Legado 书源 7698.json — bun 直连优先, 失败转 scrapling-bridge static */
const SRC_URL = "https://www.yckceo.com/yuedu/shuyuan/json/id/7698.json";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function directFetch(): Promise<{ ok: boolean; status: number; body: string; via: string }> {
  try {
    const res = await fetch(SRC_URL, {
      headers: { "user-agent": UA, accept: "application/json,text/plain,*/*", referer: "https://www.yckceo.com/" },
      redirect: "follow",
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body, via: "bun-direct" };
  } catch (e) {
    return { ok: false, status: -1, body: String(e), via: "bun-direct" };
  }
}

async function bridgeFetch(): Promise<{ ok: boolean; status: number; body: string; via: string }> {
  try {
    const res = await fetch("http://127.0.0.1:3012/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: SRC_URL, mode: "static" }),
    });
    const j = (await res.json()) as { status?: number; body?: string; error?: string };
    return { ok: !!j.body && (j.status ?? 500) < 400, status: j.status ?? -1, body: j.body ?? j.error ?? "", via: "scrapling-bridge-static" };
  } catch (e) {
    return { ok: false, status: -1, body: String(e), via: "scrapling-bridge-static" };
  }
}

let r = await directFetch();
console.log(`[direct] status=${r.status} ok=${r.ok} len=${r.body.length}`);
if (!r.ok || r.body.length < 50) {
  console.log("[direct] failed/empty -> bridge fallback");
  r = await bridgeFetch();
  console.log(`[bridge] status=${r.status} ok=${r.ok} len=${r.body.length}`);
}

if (r.ok) {
  try {
    const j = JSON.parse(r.body);
    console.log("=== VALID JSON ===", Array.isArray(j) ? `ARRAY(${j.length})` : "OBJECT");
    const arr = Array.isArray(j) ? j : [j];
    for (const src of arr) {
      console.log("──────────────────────────────");
      console.log("bookSourceName:", src.bookSourceName);
      console.log("bookSourceUrl:", src.bookSourceUrl);
      console.log("bookSourceGroup:", src.bookSourceGroup);
      console.log("bookSourceType:", src.bookSourceType, "enabled:", src.enabled);
      console.log("bookSourceComment:", (src.bookSourceComment || "").slice(0, 600));
      console.log("loginUrl:", src.loginUrl);
      console.log("header:", src.header);
      console.log("charset:", src.charset);
      console.log("concurrentRate:", src.concurrentRate);
      console.log("--- exploreUrl:", (src.exploreUrl || "").slice(0, 500));
      console.log("--- searchUrl:", (src.searchUrl || "").slice(0, 800));
      console.log("--- ruleSearch:", JSON.stringify(src.ruleSearch, null, 1));
      console.log("--- ruleBookInfo:", JSON.stringify(src.ruleBookInfo, null, 1));
      console.log("--- ruleToc:", JSON.stringify(src.ruleToc, null, 1));
      console.log("--- ruleContent:", JSON.stringify(src.ruleContent, null, 1));
      console.log("--- lastUpdateTime:", src.lastUpdateTime, "weight:", src.weight);
      console.log("--- jsLib len:", (src.jsLib || "").length);
      console.log("--- jsLib:", (src.jsLib || "").slice(0, 1200));
      console.log("--- loginUi:", src.loginUi ? JSON.stringify(src.loginUi).slice(0, 300) : undefined);
      console.log("--- other keys:", Object.keys(src).join(","));
    }
  } catch (e) {
    console.log("NOT JSON:", String(e));
    console.log("body head 800:", r.body.slice(0, 800));
  }
} else {
  console.log("BOTH FAILED. body head:", r.body.slice(0, 500));
}

export {};
