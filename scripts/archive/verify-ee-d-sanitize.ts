// ============================================================
// Task ee-d 验证脚本④ — sanitizeFetchConfig 控制字符白名单完整性
// 场景: 管理员在规则 fetch 配置(headers 值/键/customUa/cookies)中粘入 CR/LF/NUL
//       —— sanitize 只钳长不清洗控制字符, 脏值直达引擎:
//       (1) bun fetch 层 Headers 构造对值含 \r\n 直接抛 TypeError(HTTP 链弯折)
//       (2) Playwright newContext({ extraHTTPHeaders }) 同抛 → auto 引擎浏览器升级链全灭
//       (3) headers 键含冒号 → WHATWG Headers 拒绝无效 header name → 同(1)
//       (curl 出口虽已逐键值清洗, 但 bun fetch 出口与浏览器链是脏值第一落点)
// 断言: sanitizeFetchConfig 修后对 customUa/headers 键值/cookies 剥除 \r\n\0(键含冒号),
//       与 curl 层头注入清洗同口径 —— 修前原样透传(FAIL), 修后干净(PASS)
// 运行: bun scripts/verify-ee-d-sanitize.ts
// ============================================================
export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}

const { sanitizeFetchConfig } = await import('../src/lib/crawl/types')

const dirty = {
  engine: 'http',
  uaMode: 'custom',
  customUa: 'Mozilla/5.0 (Windows NT 10.0)\r\nX-Slip: 1 test',
  headers: {
    'X-Good': 'clean-value',
    'X-Bad': 'v1\r\nX-Injected: 2',
    'X:Colon': 'v3',
    'X\0Nul': 'v4',
  },
  cookies: 'k1=v1\nk2=v2',
  timeout: 8000,
  retries: 0,
}
const out = sanitizeFetchConfig(dirty) as Record<string, any>

console.log('\n== sanitizeFetchConfig 控制字符剥离 ==')
ok('字段幸存(白名单透传不丢)', !!out && out.engine === 'http' && !!out.headers, JSON.stringify(Object.keys(out || {})))
ok('customUa 剥除 CR/LF', !/[\r\n\0]/.test(out.customUa || ''), JSON.stringify(out.customUa))
ok('customUa 语义保留(空格化不空串)', (out.customUa || '').includes('X-Slip'), JSON.stringify(out.customUa))
ok('headers 值剥除 CR/LF/NUL(所有键)', Object.values(out.headers || {}).every((v) => !/[\r\n\0]/.test(String(v))), JSON.stringify(out.headers))
ok('headers 键剥除 CR/LF/NUL/冒号(所有键)', Object.keys(out.headers || {}).every((k) => !/[\r\n\0:]/.test(k)), JSON.stringify(Object.keys(out.headers || {})))
ok('合法头保留', (out.headers || {})['XGood'] === 'clean-value' || Object.values(out.headers || {}).includes('clean-value'), JSON.stringify(out.headers))
ok('cookies 剥除 CR/LF', !/[\r\n\0]/.test(out.cookies || ''), JSON.stringify(out.cookies))
ok('cookies 语义保留', (out.cookies || '').includes('k1=v1'), JSON.stringify(out.cookies))

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)
