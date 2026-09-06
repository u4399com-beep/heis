/** mm 轮侦察: pilishuwu.com 四段采样(stealthy 过 CF) → tmp/mm/ 留证 */
const BRIDGE = "http://127.0.0.1:3012/fetch";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function grab(url: string, mode = "stealthy", timeoutMs = 90000): Promise<{ status: number; html: string }> {
  const r = await fetch(BRIDGE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, mode, timeoutMs, headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" } }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`bridge error: ${j.error}`);
  return { status: j.status, html: j.html as string };
}

const home = await grab("https://www.pilishuwu.com/index.html");
await Bun.write("tmp/mm/pili-home.html", home.html);
console.log("home:", home.status, home.html.length);

// 分类导航链接
const navLinks = [...home.html.matchAll(/href="(\/[^"]*)"[^>]*>([^<]{2,12})</g)]
  .filter(m => /list|sort|cat|class|fenlei/i.test(m[1]))
  .slice(0, 20);
console.log("nav candidates:", JSON.stringify(navLinks.map(m => [m[1], m[2].trim()])));

// 书籍详情链接
const bookLinks = [...new Set([...home.html.matchAll(/href="(\/book\/[^"]+|\/\d+\/[^"]+|\/xiaoshuo\/[^"]+)"/g)].map(m => m[1]))].slice(0, 10);
console.log("book link candidates:", JSON.stringify(bookLinks));

// 所有 href 形态分布
const allHrefs = [...home.html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
const shape = new Map<string, number>();
for (const h of allHrefs) {
  const s = h.replace(/\d+/g, "N");
  shape.set(s, (shape.get(s) || 0) + 1);
}
console.log("href shapes:", JSON.stringify([...shape.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)));

// mm-theme: 补 export{} 模块化 —— 无 import 的全局脚本在 tsc 全局作用域与他文件同名碰撞
// (TS1375/TS2451/TS2393), 且根 tsconfig 无 @types/bun(cc-d2 裁定), Bun 全局需最小类型面
export {}
declare const Bun: { write(path: string, data: string | Blob): Promise<number> }
