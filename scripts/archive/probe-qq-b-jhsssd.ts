/** qq-b: jhsssd 正文翻页形态+广告检测 */
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const B = "https://m.jhsssd.com";
const H = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(20000) });
  return { s: r.status, t: await r.text(), u: r.url };
}

const ch = await get(B + "/172/652.html");
const c = ch.t.replace(/\s+/g, " ");
// 下一页按钮区
const nx = c.indexOf("下一页");
console.log("--- 下一页 region ---");
console.log(nx > 0 ? c.slice(Math.max(0, nx - 700), nx + 300) : "NO 下一页 button");
// 尾部广告探测
console.log("\n--- after nr1 tail ---");
const n1 = c.indexOf('id="nr1"');
const n1end = c.indexOf("</div>", c.indexOf("</div>", n1 + 20) + 6);
console.log(c.slice(n1end, n1end + 900));

// 第2页
const ch2 = await get(B + "/172/652_2.html");
console.log("\nPAGE2", ch2.s, ch2.t.length, "title:", (ch2.t.match(/nr_title[^>]*>([^<]+)/) || [])[1]);
