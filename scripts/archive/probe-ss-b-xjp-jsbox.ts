/** ss-b: get20260103.js 沙箱 v2 — with+Proxy 全局访问日志, 揭示其读取的页面全局与触发的请求 */
import { readFileSync } from "node:fs";

const LOG: string[] = [];
const log = (m: string) => { LOG.push(m); console.log("[js]", m); };

const TIMERS: { fn: () => void; ms: number }[] = [];
function mySetTimeout(fn: () => void, ms: number) { TIMERS.push({ fn, ms }); return TIMERS.length; }
function mySetInterval(fn: () => void, ms: number) { log(`setInterval ${ms}ms`); TIMERS.push({ fn, ms }); return TIMERS.length; }
const myClear = () => {};

const mobileUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const elStub = () => {
  const o: any = {
    style: {}, src: "", appendChild() {}, remove() {}, setAttribute() {},
    getAttribute: () => null, parentNode: { removeChild() {} },
    contentWindow: null, addEventListener() {}, value: null, innerText: "",
    length: 0, 0: null,
  };
  Object.defineProperty(o, "innerHTML", {
    get() { return o.__html ?? ""; },
    set(v: string) {
      o.__html = v;
      if (v && v.length > 40) console.log(`[dom] innerHTML← ${v.length} chars: ${JSON.stringify(v.slice(0, 300))}`);
    },
  });
  return o;
};

const moreEl = elStub();
const chapterEl = elStub();
chapterEl.getAttribute = (k: string) => (k === "id" ? "chaptercontent" : null);

const documentStub: any = {
  cookie: "",
  referrer: "https://www.xinjianpan.com/txt/oaa/vl7.html",
  URL: "https://www.xinjianpan.com/txt/oaa/vl7.html",
  domain: "www.xinjianpan.com",
  title: "第一章 外门弟子_修罗武神",
  documentElement: elStub(), head: elStub(), body: elStub(),
  scripts: [elStub(), elStub(), elStub()],
  getElementsByTagName: (t: string) => { log(`doc.getElementsByTagName(${t})`); return [elStub(), elStub()]; },
  getElementById: (id: string) => { log(`getElementById(${id})`); return id === "morecontent" ? moreEl : id === "chaptercontent" ? chapterEl : null; },
  querySelector: (s: string) => { log(`querySelector(${s})`); return null; },
  querySelectorAll: (s: string) => { log(`querySelectorAll(${s})`); return []; },
  createElement: (t: string) => { log(`createElement(${t})`); return elStub(); },
  addEventListener: (ev: string) => log(`document.on ${ev}`),
  write: (s: string) => log(`document.write(${String(s).slice(0, 150)})`),
  writeln: (s: string) => log(`document.writeln(${String(s).slice(0, 150)})`),
};

const locationStub: any = {
  href: "https://www.xinjianpan.com/txt/oaa/vl7.html",
  hostname: "www.xinjianpan.com", host: "www.xinjianpan.com", protocol: "https:",
  origin: "https://www.xinjianpan.com", pathname: "/txt/oaa/vl7.html", search: "", hash: "",
  reload: () => log("location.reload()"),
  replace: (u: string) => log(`location.replace(${u})`),
  assign: (u: string) => log(`location.assign(${u})`),
};

class MyXHR {
  method = "GET"; url = ""; headers: Record<string, string> = {}; onreadystatechange: any = null; readyState = 4; status = 200; responseText = ""; response = "";
  open(m: string, u: string) { this.method = m; this.url = u; log(`xhr.open ${m} ${u}`); }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; log(`xhr.hdr ${k}: ${v}`); }
  send(body?: string) { log(`xhr.send(${body ?? ""}) url=${this.url}`); if (this.onreadystatechange) { this.readyState = 4; this.status = 200; this.responseText = "{}"; this.onreadystatechange(); } }
  addEventListener(_e: string, cb: any) { this.onreadystatechange = cb; }
  getResponseHeader() { return null; } getAllResponseHeaders() { return ""; }
}

const win: any = {
  location: locationStub, document: documentStub,
  navigator: { userAgent: mobileUA, language: "zh-CN", platform: "iPhone", cookieEnabled: true, vendor: "Apple Computer, Inc.", appVersion: "5.0 (iPhone)", maxTouchPoints: 5, userAgentData: undefined },
  screen: { width: 390, height: 844 },
  history: { pushState() {}, replaceState() {} },
  setTimeout: mySetTimeout, setInterval: mySetInterval, clearTimeout: myClear, clearInterval: myClear,
  addEventListener: (ev: string) => log(`window.on ${ev}`),
  attachEvent: () => {},
  XMLHttpRequest: MyXHR,
  fetch: (u: any, init?: any) => { log(`fetch ${init?.method ?? "GET"} ${String(u)} hdr=${JSON.stringify(init?.headers ?? {})}`); return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) }); },
  atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
  btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  console: { log: (m: any) => log(`console.log ${String(m).slice(0, 300)}`), warn() {}, error() {} },
  ontouchstart: null, matchMedia: () => ({ matches: true, addListener() {}, addEventListener() {} }),
  String, Number, Boolean, Array, Object, Math, Date, RegExp, Error, JSON, parseInt, parseFloat, isNaN, encodeURIComponent, decodeURIComponent, Promise, Symbol, Map, Set, Uint8Array, TextDecoder,
};
win.window = win; win.self = win; win.top = win; win.parent = win; win.frames = win;

// 全局代理: 记录一切属性读取(去噪: undefined/符号/数字/内建跳过)
const seenGets = new Set<string>();
const g = new Proxy(win, {
  get(target, prop, recv) {
    if (typeof prop !== "string" || prop === "undefined" || /^\d+$/.test(prop)) return undefined;
    if (seenGets.has(prop)) {
      return Reflect.get(target, prop, target);
    }
    seenGets.add(prop);
    log(`${prop in target ? "global get" : "GLOBAL GET(未定义)"}: ${prop}`);
    return Reflect.get(target, prop, target);
  },
  set(target, prop, value) {
    log(`global SET: ${String(prop)}`);
    return Reflect.set(target, prop, value);
  },
  has() { return true; },
});

const src = readFileSync("tmp/xjp-get20260103.js", "utf-8");
const varc = await Bun.file("tmp/xjp-varc.txt").text();
// with(__g) 包裹: 未声明全局都落代理
const runner = new Function("__g", "c", "articleid", "chapterid", "uri", "articlename", "chaptername", "next_page", `with(__g) {\n${src}\n}`);
try {
  runner(g, varc, 31989, 4623, "/txt/oaa/vl7.html", "修罗武神", "第一章 外门弟子", "/txt/oaa/el7.html");
} catch (e) {
  console.log("EXEC ERR:", String(e).slice(0, 500));
}
console.log("== 同步完毕, timers:", TIMERS.length);
for (let round = 0; round < 25; round++) {
  if (!TIMERS.length) break;
  const batch = TIMERS.splice(0, TIMERS.length);
  console.log(`== timer 轮 ${round + 1}: ${batch.length} 个`);
  seenGets.clear(); // 每轮重置去噪以便观察回调内部访问
  for (const t of batch) { try { t.fn(); } catch (e) { console.log("  timer ERR:", String(e).slice(0, 200)); } }
}
console.log("== 日志", LOG.length, "条");
export {};
