/** ss-b: pp 残站 3 站首轮侦察 (xinjianpan / libahao2 / gegedangbook)
 *  礼貌约束: 并发 1, 间隔 800~1200ms, 常规 Chrome UA; 首轮共 ~12 请求
 *  目标:
 *   ① xinjianpan: 首页模板/类名尾缀现状 → 摸列表页形态
 *   ② libahao2: 403 GeoIP 复测(native 桌面 UA)
 *   ③ gegedang: 列表/书页/章节页复测(APP 导流墙现状)
 */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function probe(tag: string, url: string, init?: RequestInit) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      ...init,
    });
    const buf = await res.arrayBuffer();
    // 编码嗅探: GBK 站 charset
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const cs = /charset\s*=\s*["']?([\w-]+)/i.exec(text.slice(0, 1200))?.[1] ?? "";
    if (cs && !/utf-?8/i.test(cs)) {
      try { text = new TextDecoder(cs).decode(buf); } catch { /* keep utf8 */ }
    }
    console.log(`[${tag}] ${res.status} ${Date.now() - t0}ms len=${buf.byteLength}B enc=${cs || "utf-8?"} final=${res.url}`);
    return text;
  } catch (e) {
    console.log(`[${tag}] ERR ${Date.now() - t0}ms ${String(e).slice(0, 180)}`);
    return "";
  }
}

// ---------- ① xinjianpan ----------
{
  const home = await probe("xjp-home", "https://www.xinjianpan.com/");
  await sleep(900);
  if (home) {
    // 模板特征: biquge2023 类名尾缀 / 列表链接形态
    const sorts = [...home.matchAll(/href="([^"]*sort[^"]*)"/gi)].slice(0, 6).map((m) => m[1]);
    console.log("  xjp sort links:", JSON.stringify(sorts));
    const cls = [...home.matchAll(/class="([a-z0-9-]*-[0-9a-f]{6,8})"/gi)].slice(0, 5).map((m) => m[1]);
    console.log("  xjp suffixed class sample:", JSON.stringify(cls));
    const t = /<title>([^<]*)<\/title>/i.exec(home)?.[1];
    console.log("  xjp title:", t);
    // 首页上的书籍/章节链接样本
    const books = [...home.matchAll(/href="(\/txt\/[^"]+)"/gi)].slice(0, 4).map((m) => m[1]);
    console.log("  xjp /txt/ links:", JSON.stringify(books));
    const chs = [...home.matchAll(/href="(\/chapter\/[^"]+)"/gi)].slice(0, 4).map((m) => m[1]);
    console.log("  xjp /chapter/ links:", JSON.stringify(chs));
  }
}

// ---------- ② libahao2 ----------
{
  await probe("lbh2-home", "https://www.libahao2.com/");
  await sleep(1000);
}

// ---------- ③ gegedang ----------
{
  const home = await probe("ggd-home", "https://www.gegedangbook.com/");
  await sleep(900);
  if (home) {
    const sorts = [...home.matchAll(/href="([^"]*\/sort\/[^"]*)"/gi)].slice(0, 4).map((m) => m[1]);
    console.log("  ggd sort links:", JSON.stringify(sorts));
    const t = /<title>([^<]*)<\/title>/i.exec(home)?.[1];
    console.log("  ggd title:", t);
    const books = [...home.matchAll(/href="(\/txt\/\d+\.html)"/gi)].slice(0, 3).map((m) => m[1]);
    console.log("  ggd /txt/ links:", JSON.stringify(books));
  }
}
export {};
