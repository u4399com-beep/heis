/** qq-b2 站1: jhsssd 分类列表页/书页/目录/正文 全链路结构 */
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const H = { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" };
async function get(url: string) {
  const r = await fetch(url, { headers: H, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  return { s: r.status, t, u: r.url };
}

// 1) 分类列表(都市 3) 第1页
const cat = await get("https://m.jhsssd.com/list/3.html");
console.log("=== CAT /list/3.html", cat.s, cat.t.length);
console.log(cat.t.replace(/\s+/g, " ").slice(900, 3400));

// 2) 从中抓一个书链接
const bookHref = cat.t.match(/href="(\/\d+\/\d+\/?[^"]*)"/)?.[1] || cat.t.match(/href="(\/[^"]*book[^"]*)"/)?.[1];
console.log("\nbookHref guess:", bookHref);
export {};
