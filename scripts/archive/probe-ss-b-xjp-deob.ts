/** ss-b: get20260103.js 全量静态反混淆 — 解码全部 (0xNNN,'key') 调用点并替换为明文字符串 */
const src = await Bun.file("tmp/xjp-get20260103.js").text();

// 独立解码器
const a1 = src.indexOf("function _0x6dfb");
let depth = 0, i = src.indexOf("{", a1), e1 = -1;
for (let j = i; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}") { depth--; if (!depth) { e1 = j; break; } } }
const arrayFn = src.slice(a1, e1 + 1);
const rotator = src.slice(src.indexOf("(function"), a1);
const a3 = src.indexOf("function _0x3ed9");
let d3 = 0, k3 = src.indexOf("{", a3), e4 = -1;
for (let k = k3; k < src.length; k++) { if (src[k] === "{") d3++; else if (src[k] === "}") { d3--; if (!d3) { e4 = k; break; } } }
const decoder = src.slice(a3, e4 + 1);
const dec = new Function('var _0xodN="jsjiami.com.v7";\n' + arrayFn + "\n" + rotator + "\n" + decoder + "\nreturn _0x3ed9;")();

const unhex = (s: string) => s.replace(/\\x([0-9a-f]{2})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
const unesc = (s: string) => s.replace(/\\u([0-9a-f]{4})/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

// 全部 (0xHEX,'KEY') 形态调用点(任意别名) — 输出映射表
const callRe = /\((0x[0-9a-fA-F]+),'((?:[^'\\]|\\.)*)'\)/g;
const seen = new Set<string>();
const map = new Map<string, string>();
let m: RegExpExecArray | null;
while ((m = callRe.exec(src))) {
  const k = m[1] + "|" + m[2];
  if (seen.has(k)) continue;
  seen.add(k);
  const idx = parseInt(m[1], 16);
  const key = unhex(m[2]);
  let v = "";
  try { v = dec(idx, key); } catch (e) { v = "ERR"; }
  map.set(k, v);
}
console.log("== 唯一 (idx,key) 调用形态:", map.size, "种");
for (const [k, v] of map) console.log(`  ${k} => ${JSON.stringify(v)}`);

// 生成可读版: 先替换调用点为明文字符串字面量, 再还原十六进制/unicode 转义
let readable = src.replace(callRe, (full, idxS, keyS) => {
  const v = map.get(idxS + "|" + keyS);
  if (v === undefined) return full;
  return JSON.stringify(v);
});
readable = unesc(unhex(readable));
// 缩进美化(简单): 分号/大括号后换行
readable = readable.replace(/;/g, ";\n").replace(/\{/g, "{\n").replace(/\}/g, "}\n");
await Bun.write("tmp/xjp-get-deobfuscated.js", readable);
console.log("== 可读版已写 tmp/xjp-get-deobfuscated.js,", readable.length, "chars");
process.exit(0);
export {};
