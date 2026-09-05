// 离线复现 php_decrypt_js(c) 算法 (源自 get20260103.js 反混淆)
const c = (await Bun.file("tmp/xjp-varc.txt").text()).trim();
const s = Buffer.from(c, "base64").toString("binary");
const n = parseInt(s.substring(8, 11), 10);
console.log("n =", n, "(100..999?)", n >= 100 && n <= 999);
const payload = s.substring(11 + n, s.length - n).replace(/-/g, "+").replace(/_/g, "/");
const decoded = Buffer.from(payload, "base64").toString("utf-8");
console.log("decoded len:", decoded.length);
console.log("head 300:", JSON.stringify(decoded.slice(0, 300)));
console.log("tail 120:", JSON.stringify(decoded.slice(-120)));
export {};
