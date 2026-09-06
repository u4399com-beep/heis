/** qq-b: xinjianpan get.js 沙箱运行 — 抓出 morecontent 填充的网络端点 */
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const r = await fetch("https://www.xinjianpan.com/public/js/get20260103.js?v=20260103", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
let code = await r.text();

const netCalls: string[] = [];
// ---- 最小 DOM/网络桩 ----
const fakeEl: any = () => ({
  innerHTML: "", style: {}, setAttribute() {}, getAttribute: () => null,
  appendChild() {}, addEventListener() {}, classList: { add() {}, remove() {} },
});
const stubWindow: any = {
  navigator: { userAgent: UA, platform: "iPhone", language: "zh-CN" },
  location: { href: "https://www.xinjianpan.com/txt/oaa/vl7.html", protocol: "https:", hostname: "www.xinjianpan.com", pathname: "/txt/oaa/vl7.html", search: "", reload() { netCalls.push("RELOAD"); } },
  document: {
    getElementById: () => fakeEl(), getElementsByTagName: () => [fakeEl()], querySelector: () => fakeEl(), querySelectorAll: () => [],
    createElement: () => fakeEl(), body: fakeEl(), documentElement: fakeEl(), cookie: "", write() {}, addEventListener() {},
  },
  localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} },
  setTimeout: (fn: any) => { netCalls.push("SETTIMEOUT"); try { fn(); } catch {} return 1; },
  setInterval: () => 1, clearTimeout() {}, clearInterval() {},
  fetch: (u: any) => { netCalls.push("FETCH " + u); return Promise.resolve({ text: () => Promise.resolve(""), ok: true }); },
  XMLHttpRequest: class {
    open(m: string, u: string) { netCalls.push(`XHR ${m} ${u}`); }
    send() {} setRequestHeader() {} addEventListener() {}
  },
  screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844,
  addEventListener() {}, Math, Date, JSON, String, Number, parseInt, isNaN, RegExp, Array, Object, Promise,
};
stubWindow.window = stubWindow; stubWindow.globalThis = stubWindow; stubWindow.self = stubWindow; stubWindow.top = stubWindow;
// isMobile() 是脚本内定义的全局; 运行
try {
  const fn = new Function("window", "document", "navigator", "location", "XMLHttpRequest", "localStorage", "sessionStorage", "screen", code + "\n;try{ if (typeof getChapter==='function') getChapter(); }catch(e){}");
  fn(stubWindow, stubWindow.document, stubWindow.navigator, stubWindow.location, stubWindow.XMLHttpRequest, stubWindow.localStorage, stubWindow.sessionStorage, stubWindow.screen);
} catch (e) { console.log("exec err:", String(e).slice(0, 200)); }
await new Promise((res) => setTimeout(res, 300));
console.log("netCalls:", netCalls.slice(0, 30).join(" | ") || "none");
export {};
