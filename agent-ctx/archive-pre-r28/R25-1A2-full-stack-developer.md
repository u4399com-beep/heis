---
Task ID: R25-1A2
Agent: full-stack-developer (fetcher 深度审查+反反爬)
Task: fetcher.ts 逐段审查 + bug 修复 + 反反爬增强
Started: 2026-09-18
Status: ✅ Completed (lint 0/0, tsc 0, dev server 200)
---

# 1. 任务范围与约束

**只改** `src/lib/crawl/fetcher.ts`(原 4531 行 → 4694 行, +163 行)。
**不动**: obscura.ts/runner.ts/cleaner.ts/parser.ts/types.ts 等(其他后续做); src/components/public/* (前端); page.tsx/PublicSite.tsx (主控已改)。

# 2. 第一步: 读交接文档

读 worklog.md 末尾 150 行(R24-3A 主控 SSRF 根因修复 + R24-3B 9 套 HomeClone 接 initialCategories + R25-1B 其他页型 SSR 接线) 确认:
- R22-1A 已修 PUT /admin/sites/[id]/route.ts footer 4 字段 + 删除 27 个孤儿 layouts 文件
- R24-3A/B 已完成主控 SSR (page.tsx 按 view 类型 server fetch + 10 套 HomeClone 接 initialCategories)
- R25-1B 已完成 7 个 View + PublicSite + page.tsx SSR 接线 + 40 个 clone-themes 页型

读 agent-ctx 历史记录:
- `2-fetcher.md` (Part A SSRF 守卫 + Part B 9 bug 修复 + Part C 反反爬增强; UA_POOL 20→34)
- `anti-anti-crawl-research.md` (5 级降级链文档: native→curl→fetch-relay→scrapling-static→scrapling-stealthy→Obscura→uc-bridge→moli-bridge, 共 8 级)
- `feat-cloak-anticrawler.md` (10 子任务 A-J, 含 cookie PSL/persist/fingerprint rotation/concurrency/path jitter/OOM/ReDoS/Referer chain)
- `code-audit-r22.md` (R22-1A 深度审计, 含 fetcher.ts inflightMap/tokenInflight TOCTOU + AbortController clearTimeout × 3 历史修复复核)

# 3. 第二步: 聚焦审查(fetcher.ts 4531 行 → 逐段读完)

## 3.1 TOCTOU 竞态(R22-1A 修复点复核)

**inflightMap** (line 3906-3926):
```ts
const entry: { p: Promise<FetchResult>; at: number } = { p: undefined as any, at: Date.now() }
entry.p = (async () => {
  try { ... } finally {
    const cur = inflightMap.get(dedupKey)
    if (cur === entry) inflightMap.delete(dedupKey)  // ✓ 引用对比 entry
  }
})()
inflightMap.set(dedupKey, entry)
return entry.p
```
**审计结论**: entry 引用对比完整保留 ✓

**tokenInflight** (line 3587-3611):
```ts
const entry: { p: Promise<string> } = { p: undefined as any }
entry.p = (async () => {
  try { ... } finally {
    const cur = inflightMap.get(cacheKey)
    if (cur === entry.p) inflightMap.delete(cacheKey)  // ✓ 引用对比 entry.p
  }
})()
inflightMap.set(cacheKey, entry.p)
return entry.p
```
**审计结论**: entry.p 引用对比完整保留 ✓

## 3.2 资源泄漏: AbortController clearTimeout × 3

**fetchHttp** (line 2613-2822): `const timer = setTimeout(() => controller.abort(), timeoutMs)` + `try { ... } finally { clearTimeout(timer) }` ✓
**fetchBinary** (line 4387-4466): `const timer = setTimeout(() => controller.abort(), timeoutMs)` + `try { ... } finally { clearTimeout(timer) }` ✓
**checkProxyHealth** (line 2265-2302): `const timer = setTimeout(() => controller.abort(), timeoutMs)` + `try { ... } finally { clearTimeout(timer) }` ✓

附加: **fetchViaCurl killTimer** (line 2909-2937): `setTimeout(() => child.kill('SIGKILL'), timeoutMs + 5000)` + 在 `child.on('error')` / `child.on('close')` 中 `clearTimeout(killTimer)` ✓ (非 AbortController, 但同款 try/finally clearTimeout 模式)

**审计结论**: 3 个 AbortController 路径全部 try/finally clearTimeout 完整保留 ✓

## 3.3 5 级降级链审查(实际是 8 级, per anti-anti-crawl-research.md)

| # | 级别 | 实现位置 | 状态 |
|---|------|----------|------|
| 1 | native fetch | fetchHttp (line 2608+) | ✓ |
| 2 | curl 子进程 | fetchViaCurl (line 2869+) | ✓ |
| 3 | fetch-relay:3011 | relayHop via transport='relay' (line 3088+) | ✓ |
| 4 | scrapling-static:3012 | fetchViaScraplingBridge slMode='static' (line 3325+) | ✓ |
| 5 | scrapling-stealthy:3012 | fetchViaScraplingBridge slMode='stealthy' | ✓ |
| 6 | Obscura (playwright --stealth) | obscuraFetch via renderWithBrowser (line 1630+) | ✓ |
| 7 | **uc-bridge:3016** | **未实现!** | ❌ P1 bug |
| 8 | moli-bridge:3017 | fetchViaMoli (line 4489+) | ✓ |

**P1 缺口**: SSRF 端口白名单 (loopbackBypassAllowed line 2015) 已含 3016 (R25-1A 添加), 但 `fetchViaUcBridge` 函数未实现, `renderWithBrowser` 失败后直接落裸 Playwright (无隐身, 指纹裸露) —— 与 8 级链断档。

## 3.4 反反爬能力审查

| 维度 | 现状 | 评估 |
|------|------|------|
| UA 池 | 34 entries (Chrome 137-142 / Edge 137-142 / Firefox 125-130 / Safari 17.4-18.0 / Android / iOS) | ✓ ≥20 真实浏览器 UA |
| Referer 伪造 | chain Referer (refererChain+refererUrl) + origin 回退; **P1 bug**: origin 回退覆盖 cfg.headers.Referer | ❌ P1 bug 待修 |
| Cookie 管理 | CookieJar (跨子域合并 + 安全校验 + 持久化 + 30min TTL + prune) | ✓ 完整 |
| 请求延迟 | applyThinkTime (全抖动 [0, ms)) + applyGlobalRateLimit (滑窗 60s) + pathJitter + jitterMs + adaptiveMinGapMs (EWMA) + cookie retry 抖动 200~500ms + 429/5xx 退避 1.5s×2^n 全抖动 | ✓ 多层防节奏检测 |
| 重试策略 | 指数退避 + 全抖动 (cookie retry / 429/5xx backoff / DNS retry / proxy 失败指数退避 30s→60s→120s→240s→300s 上限) | ✓ 完整 |
| TLS 指纹 | curl 子进程 (OpenSSL) + scrapling-bridge (curl_cffi impersonate) + Obscura (chromium) | ✓ 3 种 TLS 栈覆盖 |
| headers 完整性 | fingerprintHeadersFor: sec-ch-ua / sec-ch-ua-mobile / sec-ch-ua-platform / sec-ch-ua-platform-version / sec-ch-ua-arch / sec-ch-ua-bitness / sec-ch-ua-model / sec-ch-ua-wow64 + Sec-Fetch-Dest/Mode/Site/User + Upgrade-Insecure-Requests + Accept-Language (per UA 平台) + HEADER_ORDER (chrome/firefox/safari 真实顺序) | ✓ 完整 (与真实浏览器自洽) |
| **资源泄漏** | 9 处 `new Promise((r) => setTimeout(r, X))` 模式未 unref (cookie retry/429 退避/scrapling 重试/DNS 重试等) | ❌ P2 待修 |

# 4. 第三步: 修复 + 增强

## 4.1 P1 修复 ①: uc-bridge 5 级降级链补齐 (line 4600-4694, +95 行)

新增 `fetchViaUcBridge()` 函数 + `checkUcBridge()` 可用性探测:

```ts
const UC_BRIDGE_URL = process.env.UC_BRIDGE_URL || 'http://127.0.0.1:3016'
const UC_BRIDGE_PROBE_RETRY_MS = 60_000

async function checkUcBridge(): Promise<boolean> { /* /health 探测, 60s 缓存, 与 checkRelay 同口径 */ }

async function fetchViaUcBridge(url: string, cfg: FetchConfig): Promise<{ html: string; status: number; cookies: string[] } | null> {
  if (!(await checkUcBridge())) return null  // 短超时快返, 防 ECONNREFUSED 每请求叠加
  const timeoutMs = cfg.timeout && cfg.timeout > 0 ? cfg.timeout : 20000
  try {
    const body: Record<string, unknown> = {
      url,
      timeout: Math.min(timeoutMs, 30_000),  // uc-bridge MAX_TIMEOUT_MS=30s 硬帽
    }
    // 透传 cookieJar 现有 cookies (cf_clearance 等) 给 UC 浏览器, 复用挑战凭证
    const existingCookies = cookieJar.get(originHost(url))
    if (existingCookies) body.cookies = existingCookies  // 字符串 'k1=v1; k2=v2' 形态
    const res = await fetch(`${UC_BRIDGE_URL}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // 客户端护栏冗余 15s, 下限 45s (UC 冷启 + Turnstile 求解常需 10~25s)
      signal: AbortSignal.timeout(Math.max(timeoutMs + 15_000, 45_000)),
    })
    if (!res.ok) { console.warn(...); return null }
    const data = await res.json() as { ok, html?, status?, cookies?, finalUrl?, error? }
    if (!data.ok || !data.html) { console.warn(...); return null }
    return { html: data.html, status: data.status || 200, cookies: Array.isArray(data.cookies) ? data.cookies : [] }
  } catch (e) { console.warn(...); return null }
}
```

**协议对齐** (mini-services/uc-bridge/server.py):
- POST /fetch body: `{ url, cookies?(string 'k1=v1; k2=v2'), timeout?, xvfb?(query) }`
- 返回: `{ ok:true, status, html, cookies[](Set-Cookie 风格), finalUrl, xvfbUsed }` 或 `{ ok:false, error }`
- 输入 cookies 是字符串形态 (与 cookieJar.get 同口径), 输出 cookies 是数组形态 (与 cookieJar.store 同口径)

**接入 renderWithBrowser** (line 1630-1677):

```ts
async function renderWithBrowser(url, cfg, ua) {
  const proxy = pickProxyFor(url, cfg)
  if (proxy) return renderWithBrowserRaw(url, cfg, ua, proxy)  // 代理路径不参与本降级链
  try {
    if (await checkObscuraAvailable()) {
      const res = await obscuraFetch(url, {...})
      if (res.cookies.length) cookieJar.store(originHost(url), res.cookies)
      return res.html
    }
  } catch (e) {
    // R25-1A2: Obscura 失败后先试 uc-bridge 再降级裸 Playwright
    console.warn('[fetcher] Obscura 渲染失败, 降级 uc-bridge / 裸 Playwright:', ...)
  }
  // R25-1A2 修复 P1: 5 级降级链断档补齐
  const ucResult = await fetchViaUcBridge(url, cfg)
  if (ucResult) {
    if (ucResult.cookies.length) cookieJar.store(originHost(url), ucResult.cookies)
    return ucResult.html
  }
  return renderWithBrowserRaw(url, cfg, ua, '')  // 最后兜底
}
```

**完整 8 级降级链**: native → curl → fetch-relay → scrapling-static → scrapling-stealthy → Obscura → uc-bridge → moli-bridge
- moli-bridge 已在 fetchPageOnce 顶部按 cfg.fetchMode==='moli' 分流, 不参与本降级链
- scrapling-* 在 fetchPageOnce 顶部按 fetchMode 分流, 不参与本降级链
- 失败语义: uc-bridge 返回 null (桥不可达/桥内失败) → 降级裸 Playwright; 目标侧 4xx/5xx 在 ok:true 信封内如实透传, 不双发
- cookies 回写: uc-bridge 返回 cf_clearance 等挑战凭证 → 写回 CookieJar → 后续 HTTP 直连复用, 与 Obscura 路径 cookies 回写同口径

## 4.2 P1 修复 ②: cfg.headers.Referer 覆盖 bug (line 1814-1850)

**Bug**: `buildHeaders` 注释声明 "规则显式配置的头永远最优先" (line 1783), 但 origin 回退 `else if (cfg.referer !== false && origin) headers.Referer = origin` 会无条件覆盖 `cfg.headers.Referer` (用户显式配置的伪造 Referer, 如搜索引擎 Referer `https://www.google.com/` 用于"按目标站伪造"反反爬场景)。

**修复**:
1. **cfgReferer 检测** (大小写不敏感): 在 buildHeaders 顶部遍历 cfg.headers, 找出 Referer 头(任意大小写):
   ```ts
   let cfgReferer: string | undefined
   if (cfg.headers) {
     for (const k of Object.keys(cfg.headers)) {
       if (k.toLowerCase() === 'referer') {
         const v = (cfg.headers as Record<string, string>)[k]
         if (typeof v === 'string') { cfgReferer = v; break }
       }
     }
   }
   ```

2. **fingerprintHeadersFor Sec-Fetch-Site 计算修正**: 原 `chainReferer || origin` → `chainReferer || cfgReferer || origin`, 让 Sec-Fetch-Site 按用户配的 fake search Referer 计算 cross-site (而非 same-origin):
   ```ts
   const fpReferer = chainReferer || cfgReferer || origin
   Object.assign(headers, fingerprintHeadersFor(ua, fpReferer, url, { jitter: cfg.fingerprintJitter === true }))
   ```

3. **Referer 头回退条件加 `!cfgReferer`**: 仅当 cfg.headers 未显式提供 Referer 时才回退 origin:
   ```ts
   if (chainReferer) headers.Referer = chainReferer
   else if (cfg.referer !== false && origin && !cfgReferer) headers.Referer = origin
   ```

**零回归**: 默认无 cfg.headers.Referer 时 cfgReferer=undefined, 行为等同改前 (origin 回退); 用户显式配 cfg.headers.Referer 后, fingerprintHeadersFor 内 secFetchSite 已据该 Referer 计算同源/跨站语义自洽。

**应用场景**: "Referer 按目标站伪造" 反反爬 —— 用户在规则里配 `cfg.headers.Referer = 'https://www.google.com/search?q=<目标站关键词>'`, 引擎发送 Referer: google.com → Sec-Fetch-Site: cross-site (匹配"用户从搜索引擎点击进入"的真实浏览器行为, 而非"Referer=目标 origin"的爬虫指纹破绽)。

## 4.3 P2 增强 ①: 统一 unref sleep helper (line 1152-1167, +18 行)

**Bug**: 引擎内 9 处 `new Promise((r) => setTimeout(r, X))` 模式(cookie retry / 429 退避 / scrapling 重试 / DNS 重试 / 4xx 退避等)修前未 unref —— 一次性脚本/测试用例结束时事件循环因 retry/backoff 定时器挂起额外 X ms 才退; 长跑 dev server 无影响但与 applyThinkTime/cookiePersistTimer/hostgate.timer 同口径统一 unref, 防 CLI 卡死。

**修法**: 引入 `sleepUnref(ms)` helper, 替换 9 处内联 setTimeout:
```ts
function sleepUnref(ms: number): Promise<void> {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return Promise.resolve()
  return new Promise((r) => {
    const t = setTimeout(r, ms)
    ;(t as unknown as { unref?: () => void }).unref?.()
  })
}
```

**替换位置** (9 处):
- line 3373: scrapling 桥响应形态非法重试 800ms
- line 3383: scrapling 桥内失败重试 800ms
- line 3393: scrapling 桥不可达重试 800ms
- line 3435: fetchHttpWithCurlSingle DNS 瞬时失败重试 2000ms
- line 4307: auto 引擎 200 但挑战壳 cookie retry 抖动 200~500ms
- line 4349: fallbackStatus 命中 cookie retry 抖动 200~500ms
- line 4360: 403 陈旧会话清罐 retry 抖动 200~500ms
- line 4384: 429/5xx 指数退避 delay (1.5s×2^n 全抖动, 可达 8s 长退避尤其需要 unref)
- line 4394: 其余 4xx attempt 比例退避 jitteredDelay (400×attempt × ±25% 抖动)

**额外**: applyThinkTime 内部也改用 sleepUnref (统一, 原 R25-1A 已 unref 的内联模式合并到 helper)。

## 4.4 反反爬增强完整对齐表

| 任务要求 | 现状(修后) | 实现 |
|---|---|---|
| UA 轮换池扩充(≥20 真实浏览器 UA) | 34 entries | 既有(2-fetcher Part C 已扩, R25-1A2 不再扩, 已超 20) |
| Referer 按目标站伪造 | **修复 cfg.headers.Referer 覆盖 bug + secFetchSite 按 cfgReferer 计算** | 4.2 |
| 请求随机延迟(避免频控) | applyThinkTime 全抖动 + applyGlobalRateLimit 滑窗 + pathJitter + jitterMs + adaptiveMinGapMs (EWMA) + cookie retry 抖动 + 429/5xx 全抖动退避 | 既有, 4.3 增强 unref |
| headers 完整性(Accept-Language/Accept-Encoding/Sec-Ch-Ua 等) | fingerprintHeadersFor: 9 个 sec-ch-ua-* + 4 个 Sec-Fetch-* + Upgrade-Insecure-Requests + Accept-Language (per UA 平台) + HEADER_ORDER (chrome/firefox/safari 真实顺序) | 既有(2-fetcher Part C2 已完整, R25-1A2 不再扩) |
| 重试退避策略(指数退避) | 429/5xx backoffRetries: base=1500ms × 2^(n-1), cap=8000ms, 全抖动 [0, min(cap, base×2^n)) | 既有 + 4.3 unref 增强 |
| 5 级降级链(实际 8 级) | native → curl → fetch-relay → scrapling-static → scrapling-stealthy → Obscura → **uc-bridge (NEW)** → moli-bridge | 4.1 |

# 5. 第四步: 验证

```
$ cd /home/z/my-project && bun run lint
$ eslint .
exit=0  ✓ (0 errors / 0 warnings)

$ cd /home/z/my-project && bunx tsc --noEmit 2>&1 | grep -v examples | grep -v skills | tail -5
(no output = 0 errors)
exit=0  ✓

$ tail -10 /home/z/my-project/dev.log
✓ Ready in 1384ms
GET /?view=home&site=cmtpnmn1h0004p2wsqmk6xb5j 200 in 18.9s (compile: 18.2s, proxy.ts: 131ms, render: 520ms)
```

# 6. 修改文件清单

| 文件 | 改动 | 行数变化 |
|------|------|---------|
| `src/lib/crawl/fetcher.ts` | P1 修复① uc-bridge 补齐 + P1 修复② Referer 覆盖 bug + P2 增强① sleepUnref 9 处替换 | 4531 → 4694 (+163) |

# 7. 不修改的文件(尊重约束)

- `src/lib/crawl/{obscura,runner,parser,cleaner,types,storage,hostgate,smart,sorter,calibrate,downloader,rule-templates,auto-tdk}.ts` 全部未动
- `src/components/public/*` 全部未动(前端)
- `src/app/api/*` 全部未动
- `mini-services/*` 全部未动(仅审查 uc-bridge/server.py 确认协议对齐)
- `prisma/schema.prisma` 未动
- `package.json` 未动(0 新依赖)

# 8. 历史 R22~R24 修改保留状态

| 任务 | 修改 | R25-1A2 状态 |
|------|------|-------------|
| R22-1A | fetcher.ts inflightMap + tokenInflight TOCTOU (entry 引用对比) | ✓ 保留, 双处验证(3.1) |
| R22-1A | fetcher.ts AbortController clearTimeout × 3 try/finally | ✓ 保留, 三处验证(3.2) |
| 2-fetcher | Part A SSRF 守卫 (assertSafeTarget/loopbackBypassAllowed) | ✓ 保留 |
| 2-fetcher | Part B 9 bug 修复 (1/2/3/9/11/12/22/23/27) | ✓ 保留 |
| 2-fetcher | Part C 反反爬增强 (UA_POOL 34 + sec-ch-ua-* + looksBlocked + isJsChallenge + DNS retry) | ✓ 保留 |
| feat-cloak-anticrawler | A cookie PSL / B cookie persist / C fingerprint rotation / D deviceId / E SIGTERM / F concurrency / G pathJitter / H OOM / I ReDoS / J Referer chain | ✓ 全部保留 |
| agent-FF-crawl-phase8 | fingerprintJitter / responseCache / detectHttp3AltSvc / Sec-Fetch-User 链路语义 / weighted-rr ties 洗牌 | ✓ 保留 |
| agent-EE-crawl-phase7 | rateLimitAware / cookie persist 去抖 / proxy weighted-rr + successRate | ✓ 保留 |
| agent-K-crawl-phase2 | thinkTimeMs / globalRateLimitPerMin / proxyHealthCheck / fingerprintRotationInterval / adaptiveRateLimit / perHostConcurrency / headerOrderProfile / CaptchaType 冷却 / Cookie 同意横幅 / 会话人格 (UA+viewport+timezone+language) / per-host keep-alive 池 / 代理级联熔断 / 代理加权轮换 | ✓ 全部保留 |
| agent-Z-crawl-phase6 | per-host undici Agent / h2Pool / HostDispatcher 空闲淘汰 | ✓ 保留 |
| R25-1A | applyThinkTime + applyGlobalRateLimit unref / checkCurl 5s probe unref / KNOWN_MINI_SERVICE_PORTS 补 3016 / buildHeaders Accept-Language per UA | ✓ 保留(R25-1A2 在此基础上补 3016 实际函数实现) |

# 9. 反反爬覆盖度自评

| 维度 | 覆盖度 | 备注 |
|------|--------|------|
| UA 轮换 | ★★★★★ | 34 真实浏览器 UA, 桌面/移动/Edge/Firefox/Safari 全覆盖, per-host 钉扎防会话内跳变, fingerprintRotationInterval 防 host 内持久身份 |
| Referer 伪造 | ★★★★☆ | chain Referer (runner 注入) + cfg.headers.Referer (规则配) + origin 回退; P1 修复后 cfg.headers.Referer 不再被覆盖, secFetchSite 按 cfgReferer 计算自洽 |
| Cookie 管理 | ★★★★★ | CookieJar 跨子域合并 + 父域安全校验 + ATTR_NAMES 过滤 + src 字段精确清扫副罐 + 30min TTL + prune 5min 节流 + persist/restore 跨重启 + scheduleCookiePersist 去抖 |
| 请求延迟 | ★★★★★ | thinkTime 全抖动 + globalRateLimitPerMin 滑窗 + pathJitter + jitterMs(批次间) + adaptiveMinGapMs(EWMA 驱动) + cookie retry 抖动 + 429/5xx 全抖动退避 + 4xx 比例退避 ±25% 抖动 |
| 重试策略 | ★★★★★ | cookie retry / 429-5xx backoffRetries / DNS retry / proxy 指数退避 30s→300s 全抖动 / 级联熔断 10s 窗口 ≥3 失败暂停 |
| TLS 指纹 | ★★★★☆ | curl (OpenSSL) + scrapling-bridge (curl_cffi impersonate chrome TLS) + Obscura/uc-bridge (chromium BoringSSL) 三栈覆盖; native undici (BoringSSL) 与 Chrome 接近但有定制 Extensions 差异, 由 scrapling 桥承担真实 JA3 伪装 |
| headers 完整性 | ★★★★★ | sec-ch-ua 全 9 项 + Sec-Fetch-* 4 项 + Upgrade-Insecure-Requests + Accept-Language per UA + HEADER_ORDER (chrome/firefox/safari 真实顺序) + fingerprintJitter (Not:A-Brand 版本随机) |
| 浏览器引擎多样性 | ★★★★★ | 8 级降级链补齐后: native + curl + fetch-relay + scrapling-static/stealthy/playwright + Obscura (stealth 单例池) + uc-bridge (undetected-chromedriver) + moli-bridge (Rust AI 浏览器) + 裸 Playwright 兜底 |
| 行为指纹 | ★★★★☆ | sessionPersonality (UA+viewport+timezone+language 一致性) + fingerprintRotationInterval (防持久身份) + thinkTime + pathJitter + adaptiveMinGapMs (响应延迟驱动) + cookie retry 抖动 |
| 验证码识别 | ★★★★☆ | looksLikeCaptcha (recaptcha/hcaptcha/turnstile/geetest 双标记+短壳单命中) + captchaCooldown (host 冷却 10min 默认, 钳 60s~3600s) + captchaCooldown 计数器 |
| 反检测代理 | ★★★★★ | proxyPool 池(10 上限) + 轮换策略(random/round-robin/least-used + weighted-rr + successRate + geo 同地域优先) + 指数退避冷却 + 级联熔断 + 主动健康检查 + cookieJar 跨子域 + cf_clearance 挑战凭证复用 |

# 10. 已知限制(如实记录, 不虚报)

1. **native undici TLS 指纹不可定制**: undici fetch 的 connect 选项无法定制 ClientHello (JA3), 真正定制需替换 dispatcher 用 tls.createSecureContext (非标准 API, 跨 Node 版本不稳)。缓解: scrapling-* 桥(curl_cffi)承担真实 JA3 伪装; native 链仅作为兜底。详见 fetcher.ts line 257-275 注释。
2. **HTTP/2 SETTINGS 帧指纹**: Node undici allowH2=true 时 h2 SETTINGS 帧与 Chrome 不完全一致, JA3-strict WAF 场景应保持 h1-keep-alive。cfg.h2Pool 缺省 false(零回归), 仅在确认 WAF 不严 h2 站点启用。
3. **HTTP/3 (QUIC) 不支持**: undici/Bun 原生 fetch 不支持 QUIC, detectHttp3AltSvc 仅观测用, 引擎仍走 HTTP/1.1/2。真正走 h3 需桥服务(curl --http3 / scrapling-bridge)。
4. **Accept-Encoding 不显式设置**: undici/Bun 自动加 `gzip, deflate, br` (无 zstd), 真实 Chrome 124+ 发 `gzip, deflate, br, zstd`。手动加 zstd 风险: undici/Node v22.14- 不支持自动解码 zstd 响应, 会导致乱码。故保守不显式加(零回归 > 指纹精确匹配)。
5. **DNS rebinding TOCTOU**: SSRF 守卫只校验 DNS 解析的 IP, 实际 fetch(url) 仍以 hostname 发起连接, 攻击者控制 DNS 即可在守卫通过后重绑内网 IP。缓解: 60s DNS 缓存窗口 + Caddy 出口代理。详见 fetcher.ts line 1830-1835 注释。
6. **uc-bridge 不支持代理**: uc-bridge server.py /fetch 不接受 proxy 参数(UC 浏览器自身无代理支持); 配置了 proxyUrl 的请求跳过 Obscura/uc-bridge 直接走 renderWithBrowserRaw per-context proxy。详见 renderWithBrowser line 1636 注释。
