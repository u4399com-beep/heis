/** mm 轮采样: 分类/详情/正文/CSS 全留存 tmp/mm/ */
const BRIDGE = "http://127.0.0.1:3012/fetch";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
async function grab(url: string, mode = "stealthy", timeoutMs = 90000) {
  const r = await fetch(BRIDGE, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, mode, timeoutMs, headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9" } }) });
  const j = await r.json();
  return { status: j.status as number, html: (j.html as string) || "", err: j.error as string | undefined };
}
const targets: Array<[string, string]> = [
  ["https://www.pilishuwu.com/1/list/1.html", "pili-cat1.html"],
  ["https://www.pilishuwu.com/5/2951/info.html", "pili-book-info.html"],
  ["https://www.pilishuwu.com/5/2951/read/845008.html", "pili-read.html"],
];
for (const [u, f] of targets) {
  const g = await grab(u);
  await Bun.write(`tmp/mm/${f}`, g.html);
  console.log(f, g.status, g.html.length, g.err || "");
}
// CSS(配色源) — static 试一发, 失败再 stealthy
const cssFiles = ["wmcms.global.css", "wmcms.index.css", "wmcms.main-header-content.css", "wmcms.main-header-nav.css", "wmcms.main-header-bg.css"];
for (const c of cssFiles) {
  let g = await grab(`https://www.pilishuwu.com/templates/wmcms-web/static/css/${c}`, "static", 30000);
  if (g.status !== 200 || g.html.length < 200) g = await grab(`https://www.pilishuwu.com/templates/wmcms-web/static/css/${c}`, "stealthy", 60000);
  await Bun.write(`tmp/mm/css-${c}`, g.html);
  console.log("css-" + c, g.status, g.html.length);
}

// mm-theme: 补 export{} 模块化 —— 无 import 的全局脚本在 tsc 全局作用域与他文件同名碰撞
// (TS1375/TS2451/TS2393), 且根 tsconfig 无 @types/bun(cc-d2 裁定), Bun 全局需最小类型面
export {}
declare const Bun: { write(path: string, data: string | Blob): Promise<number> }
