// dd-e: RuleEditor 字段保全性排查验证 — 模拟"后台编辑任一规则点保存"的完整数据往返,
// 断言 UI 未暴露的 FetchConfig 高级字段(tokenUrl/tokenPattern/tokenInjection/tokenHeaderName/
// hostGateLimit 等)在 编辑器加载→状态合并→保存→入库→再加载 全链路存活(零数据丢失)。
// 组装逻辑单源复用: 直接调用 RuleEditor 实际使用的 safeParseRuleConfig(admin/helpers,
// 内部即 src/lib/crawl/types parseRuleConfig)与 sanitizeFetchConfig, 不复制逻辑。
// 运行: bun scripts/verify-dd-e-editor.ts
export {}
import { safeParseRuleConfig } from '../src/components/admin/helpers'
import { sanitizeFetchConfig, type FetchConfig } from '../src/lib/crawl/types'

let passed = 0
let failed = 0
function assert(cond: boolean, name: string, detail = '') {
  if (cond) {
    passed++
    console.log(`  PASS: ${name}`)
  } else {
    failed++
    console.log(`  FAIL: ${name} ${detail}`)
  }
}

/** 模拟 RuleEditor.setFetch 的合并语义(逐字段 patch, spread 保留未触碰字段) */
function setFetch(config: ReturnType<typeof safeParseRuleConfig>, patch: Partial<FetchConfig>) {
  return { ...config, fetch: { ...config.fetch, ...patch } }
}

/** 含全部 FetchConfig 序列化字段的库存量级配置(以 bqg713 token 型规则为底本扩展) */
const RICH_FETCH: Partial<FetchConfig> = {
  engine: 'auto',
  uaMode: 'custom',
  customUa: 'Mozilla/5.0 (Linux; Android 13) Chrome/140',
  headers: { 'X-Test': '1', Accept: 'text/html' },
  cookies: 'k=v; k2=v2',
  autoCookie: true,
  referer: true,
  timeout: 30000,
  retries: 2,
  waitSelector: '#content',
  waitMs: 1500,
  clickSelector: '.catalog-all',
  browserFallbackStatus: [403, 412],
  hostGateLimit: 2,
  tokenUrl: 'http://127.0.0.1:3010/rewrite?url={url}',
  tokenPattern: 'token',
  tokenInjection: 'url',
  tokenHeaderName: 'X-Api-Token',
}

function main() {
  const richConfig = {
    list: { enabled: true, urlTemplate: 'https://x.com/{page}', fields: {} },
    book: { enabled: true, fields: {} },
    toc: { enabled: true, fields: {} },
    content: { enabled: true, fields: {} },
    fetch: RICH_FETCH,
    clean: { removeSelectors: ['.ad'], adPatterns: [], whitelist: ['p'], normalize: true, plainText: false },
  }
  const storedJson = JSON.stringify(richConfig) // 规则入库后的 config 字符串

  // ---- 用例1: 全量字段往返(加载→不改任何东西→保存→入库→再加载) ----
  console.log('[1] 打开编辑器不改任何配置直接保存')
  const loaded1 = safeParseRuleConfig(storedJson) // 编辑器打开
  const saved1 = JSON.stringify(loaded1) // save() → PUT body → 服务端 configToString 原样入库
  const reloaded1 = safeParseRuleConfig(saved1) // 再打开
  const f1 = reloaded1.fetch
  assert(f1.tokenUrl === 'http://127.0.0.1:3010/rewrite?url={url}', '往返存活: tokenUrl')
  assert(f1.tokenPattern === 'token', '往返存活: tokenPattern')
  assert(f1.tokenInjection === 'url', '往返存活: tokenInjection')
  assert(f1.tokenHeaderName === 'X-Api-Token', '往返存活: tokenHeaderName')
  assert(f1.hostGateLimit === 2, '往返存活: hostGateLimit')
  assert(f1.clickSelector === '.catalog-all', '往返存活: clickSelector')
  assert(f1.waitSelector === '#content', '往返存活: waitSelector')
  assert(!!f1.customUa?.includes('Android 13'), '往返存活: customUa')
  assert(f1.timeout === 30000 && f1.retries === 2, '往返存活: timeout/retries')
  assert(f1.browserFallbackStatus?.[0] === 403, '往返存活: browserFallbackStatus')
  assert(loaded1.list.urlTemplate === 'https://x.com/{page}', '往返存活: list.urlTemplate({page} 占位符)')
  assert(reloaded1.clean.removeSelectors[0] === '.ad', '往返存活: clean.removeSelectors')

  // ---- 用例2: 编辑器上改一个 UI 暴露字段(如 uaMode), 高级字段不受影响 ----
  console.log('[2] 编辑器修改 uaMode=rotate 后保存')
  const edited = setFetch(loaded1, { uaMode: 'rotate', timeout: 25000 })
  const saved2 = JSON.stringify(edited)
  const reloaded2 = safeParseRuleConfig(saved2).fetch
  assert(reloaded2.uaMode === 'rotate' && reloaded2.timeout === 25000, '显式覆盖字段生效: uaMode/timeout')
  assert(reloaded2.tokenUrl === 'http://127.0.0.1:3010/rewrite?url={url}', 'spread 合并不剥离: tokenUrl')
  assert(reloaded2.tokenPattern === 'token' && reloaded2.tokenInjection === 'url', 'spread 合并不剥离: tokenPattern/tokenInjection')
  assert(reloaded2.hostGateLimit === 2, 'spread 合并不剥离: hostGateLimit')

  // ---- 用例3: sanitizeFetchConfig 白名单完整性(接口全部序列化字段, 除运行时 pageFetch) ----
  console.log('[3] sanitizeFetchConfig 白名单完整性(接口字段全覆盖)')
  const out = sanitizeFetchConfig(RICH_FETCH)
  const expectedKeys = Object.keys(RICH_FETCH) as (keyof FetchConfig)[]
  const missing = expectedKeys.filter((k) => k !== 'pageFetch' && out[k] === undefined)
  assert(missing.length === 0, 'FetchConfig 全部序列化字段均在白名单', `missing: ${missing.join(',')}`)
  assert((out as Record<string, unknown>).pageFetch === undefined, '运行时 pageFetch 刻意不入白名单(不可序列化)')
  assert(out.engine === 'auto' && out.uaMode === 'custom', '枚举字段白名单透传')

  // ---- 用例4: 脏类型防御(字符串数字/非法枚举/垃圾键仍被拒, 与保全性不冲突) ----
  console.log('[4] 脏输入防御回归')
  const dirty = sanitizeFetchConfig({
    engine: 'graphql',
    timeout: 'abc',
    retries: 'x',
    tokenUrl: 123,
    tokenInjection: 'cookie',
    evilRuntime: '() => {}',
  })
  assert(dirty.engine === undefined, '非法 engine 丢弃')
  assert(dirty.timeout === undefined, '非数字 timeout 丢弃(字符串"abc")')
  assert(dirty.tokenUrl === undefined, '非字符串 tokenUrl 丢弃')
  assert(dirty.tokenInjection === undefined, '非法 tokenInjection 枚举丢弃')
  assert((dirty as Record<string, unknown>).evilRuntime === undefined, '未知键(垃圾键)丢弃')
  const strNum = sanitizeFetchConfig({ timeout: '30000', hostGateLimit: '5' })
  assert(strNum.timeout === 30000 && strNum.hostGateLimit === 5, '字符串数字仍按数字转换(既有口径)')

  // ---- 用例5: 损坏 JSON/脏段不白屏且回退默认(编辑器兜底路径回归) ----
  console.log('[5] safeParseRuleConfig 兜底回归')
  const broken = safeParseRuleConfig('{"list":"garbage","fetch":42}')
  assert(broken.fetch.engine === 'auto' && Array.isArray(broken.list.fields) === false, '脏段回退默认配置')
  assert(safeParseRuleConfig('not-json').fetch.engine === 'auto', '损坏 JSON 回退默认配置')

  console.log(`\nverify-dd-e-editor: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}
main()
