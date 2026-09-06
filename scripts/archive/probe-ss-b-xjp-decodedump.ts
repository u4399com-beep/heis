/** ss-b: xjp get20260103.js 解码器调用点插桩 — 转储全部 RC4/base64 解码字符串 */
const src0 = await Bun.file("tmp/xjp-get20260103.js").text();
let src = src0.replace(/const _0x421d3b=_0x3ed9;/, "const _0x421d3b=__D(_0x3ed9,'alias');");
// 别名调用点包 __D
src = src.replace(/_0x421d3b\(/g, "__D(_0x421d3b)(");
// 直接调用点(排除定义形态)
src = src.replace(/(?<!function )_0x3ed9\(/g, "__D(_0x3ed9)(");
// 修正: 定义行 function _0x3ed9( 已被负向断言保护; 自赋值 _0x3ed9=function 不匹配 ( 后是 = )

const LOGS: string[] = [];
function __D(f: (i: number, k: string) => string) {
  return function (this: any, i: number, k: string) {
    const r = (f as any).call(this, i, k);
    LOGS.push(`${i}/${k} => ${r}`);
    return r;
  };
}
// 沙箱最小环境(仅需顶层 IIFE 数组轮转 + 常量定义执行到调用点)
(globalThis as any).__D = __D;
try {
  new Function("__D", src)(__D);
} catch (e) {
  console.log("(执行中断(可接受, 顶层已插桩):", String(e).slice(0, 200) + ")");
}
console.log("== 解码字符串", LOGS.length, "条:");
for (const l of LOGS) console.log("  ", l.slice(0, 300));
process.exit(0);
export {};
