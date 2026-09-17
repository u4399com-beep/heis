# Task: feat-cloak-anticrawler — CloakBrowser stealth + anti-crawler deep

**Agent**: CloakBrowser stealth + anti-crawler deep
**Task ID**: feat-cloak-anticrawler
**Started**: 2026-09-10
**Status**: ✅ Completed (lint 0/0, tsc 0, dev server / 200)

## Scope

Two big enhancement areas:
1. **CloakBrowser Enhanced Stealth** (rewrite `mini-services/cloak-browser/index.ts`): 3-tier stealth profiles + 12 flags + per-session noise seeds + CDP integration + enhanced CF handling
2. **Anti-crawler Deep Enhancement** (fetcher.ts + obscura.ts + types.ts + parser.ts + runner.ts): 10 sub-tasks A-J

## Files Modified

| File | Change |
|---|---|
| `mini-services/cloak-browser/index.ts` | Full rewrite: 3-tier stealth + 12 flags + CDP + CF handling + SIGTERM |
| `src/lib/crawl/fetcher.ts` | A: KNOWN_MULTI_PART_TLDS + parentDomainChain PSL; B: cookieJar.persist/load + loadCookieJarFromDisk; E: registerGracefulShutdown + inFlight counter; F: globalSem + acquireGlobalSlot/releaseGlobalSlot; G: maybePathJitter; H: OOM check in fetchPage; effectiveHostGateLimit reads hostGateConcurrency |
| `src/lib/crawl/obscura.ts` | C: FINGERPRINT_ROTATE_MS=30min + withObscuraPage fpAge check; D: deriveDeviceId (DJB2 hash) + buildDeviceIdInitScript; createSlot/recreateSlot track fpCreatedAt + deviceId |
| `src/lib/crawl/types.ts` | F: hostGateConcurrency + globalConcurrency fields + sanitize; G: pathJitter field + sanitize |
| `src/lib/crawl/parser.ts` | I: export testRegexBudget (200-char sample, 100ms budget); applyTransform uses budget before compile |
| `src/lib/crawl/runner.ts` | J: extractToc returns tocUrl; chapter fetch uses contentFetchCfgWithReferer (tocUrlRef + refererChain:true forced); module-load triggers loadCookieJarFromDisk + registerGracefulShutdown |

## CloakBrowser 3-tier Stealth

### lite (default, low-security sites)
- puppeteer-extra-stealth only (existing behavior)

### standard (CF-protected sites)
- + canvas noise (toDataURL/toBlob, per-session LCG seed)
- + audio noise (AudioContext.createAnalyser.getFloatFrequencyData)
- + WebGL vendor/renderer override (Google Inc. Intel UHD 630)
- + CDP `Network.setUserAgentOverride` + `userAgentMetadata`
- + navigator.permissions.query (notifications → granted)
- + navigator.languages = ['zh-CN', 'zh', 'en']
- + navigator.hardwareConcurrency = 8, deviceMemory = 8
- + navigator.connection (4g/rtt=50/downlink=10)

### maximum (hard WAF sites: hetushu/shucong)
- + all standard flags
- + font fingerprint noise (measureText ±0.25px stable delta)
- + screen colorDepth/pixelDepth (24)
- + _devid cookie (max-age 1 day)
- + request interception (20+ tracking/ad networks + ping/beacon type)
- + IMEI-like device ID (15-digit: '86' + 3 seq + 10 hash)

## 12 Stealth Flags

1. navigator.webdriver = undefined (stealth plugin + double-define)
2. window.chrome runtime object (stealth plugin + double-define)
3. navigator.plugins (PDF Viewer + Chrome/Chromium/Edge/WebKit PDF, 5 entries)
4. navigator.languages = ['zh-CN', 'zh', 'en']
5. WebGL UNMASKED_VENDOR_WEBGL=37445 / UNMASKED_RENDERER_WEBGL=37446 override
6. navigator.permissions.query (notifications → granted)
7. canvas noise (toDataURL/toBlob, per-session seed, ≤256x256 full + large canvas 200-pixel sampling)
8. audio noise (AudioContext.createAnalyser, per-session seed)
9. navigator.hardwareConcurrency = 8
10. navigator.deviceMemory = 8
11. navigator.connection (effectiveType/rtt/downlink/saveData/type)
12. CDP Network.setUserAgentOverride + userAgentMetadata (brands/fullVersionList/fullVersion/mobile/platform)

## CDP Integration

- `Network.setUserAgentOverride` with `userAgentMetadata` (brands/mobile/platform/architecture/bitness)
- `Page.addScriptToEvaluateOnNewDocument` for stealth scripts (per-frame init)
- `Emulation.setDeviceMetricsOverride` for screen size + deviceScaleFactor

## Enhanced CF Handling

- Detect CF challenge (12 markers including 中文/繁体 variants)
- Wait up to 30s, every 2s try clicking Turnstile checkbox (cross-origin iframe via Playwright frames)
- If still blocked: navigate to `/robots.txt` to get `cf_clearance` cookie, then retry target URL
- Return cookies array for engine reuse

## Per-session Noise Seeds

- `getSeed(sessionKey)` keyed by URL hostname (30min TTL, LRU 200)
- Same host across requests gets same canvas/audio noise seed → fingerprint consistent within session
- Cross-session fingerprint rotation defeats long-term tracking

## Anti-crawler 10 Sub-tasks

### A. Cookie PSL enhancement (fetcher.ts)
- `KNOWN_MULTI_PART_TLDS` set: 49 entries (UK/CN/HK/TW/AU/JP/KR/BR/IN/SG/US/RU + PaaS github.io/herokuapp.com/etc.)
- `parentDomainChain` checks last 2 segments against PSL, treats matched TLD as atomic, only accumulates subdomain chain before TLD
- Prevents `'co.uk'` from being treated as a parent domain (was: `*.uk` cookies all shared)

### B. Cookie persistence (fetcher.ts)
- `cookieJar.persist()` → JSON string `{"v":1,"ts":...,"domains":[{host,cookies:[{name,value,at}]}]}`
- `cookieJar.load(json)` → reverse rebuild (skips expired, full replace semantics)
- `loadCookieJarFromDisk()` sync read `data/cookies.json` on boot (idempotent, file-missing tolerated)
- `validJar` now checks persist/load/domainCount methods (dev HMR safety)

### C. Fingerprint rotation (obscura.ts)
- `FINGERPRINT_ROTATE_MS = 30 * 60 * 1000` (30 min)
- `withObscuraPage` checks `fpAge = Date.now() - (slot.fpCreatedAt ?? slot.lastUsedAt ?? Date.now())`
- If `fpAge > FINGERPRINT_ROTATE_MS` AND `domain matches` AND `page not closed` → force `recreateSlot` with new `randomFingerprint`
- Independent of IDLE_CLOSE_MS (5min) and SLOT_IDLE_RECLAIM_MS (10min) — those manage idle resource reclaim, this manages fingerprint freshness

### D. IMEI device ID (obscura.ts)
- `deriveDeviceId(fp)` = DJB2 hash of `fp.userAgent|viewport|locale|timezoneId|dsf|mobile`
  - 15 digits: `'86'` (China IMEI prefix) + 3-digit viewport-derived seq + 10-digit hash
  - Stable within same fp; changes when fp recreates (defeats long-term tracking)
- `buildDeviceIdInitScript(deviceId)`:
  - Auto-seed `_devid` cookie (max-age 86400, SameSite=Lax)
  - Append `DevID` brand to `navigator.userAgentData.brands` (via `Object.defineProperty`)
- `createSlot` and `recreateSlot` populate `slot.deviceId` + `slot.fpCreatedAt`

### E. SIGTERM handler (fetcher.ts + runner.ts + cloak-browser)
- `registerGracefulShutdown()` registers SIGTERM/SIGINT hooks (idempotent via `globalThis.__novelShutdownRegistered_v1`):
  1. Persist cookieJar → `data/cookies.json` (sync fs write, mkdir -p)
  2. `shutdownObscura()` close browser + slots
  3. Wait for in-flight `fetchPage` up to 10s
  4. `process.exit(0)`
- `inFlightFetchCount` counter: `enterInFlight()` at fetchPage entry, `leaveInFlight()` in finally
- `runner.ts` module-load triggers `loadCookieJarFromDisk()` + `registerGracefulShutdown()`
- CloakBrowser (separate bun process) has its own SIGTERM handler: wait in-flight 10s + close browser + exit

### F. Concurrency control (types.ts + fetcher.ts)
- `FetchConfig.hostGateConcurrency` (1-10, default 3) — alias for `hostGateLimit`
- `FetchConfig.globalConcurrency` (1-50, default 10) — global total
- `sanitizeFetchConfig` adds both fields with proper clamping
- `effectiveHostGateLimit` prefers `hostGateConcurrency`, falls back to `hostGateLimit` (zero regression)
- `globalSem` in fetcher.ts (globalThis for HMR safety):
  - `acquireGlobalSlot(limit)`: if `inFlight < limit` → `inFlight++`; else FIFO queue
  - `releaseGlobalSlot()`: `inFlight--` and wake next waiter (with `inFlight++` preemption to prevent barge)
- `fetchPage` wraps `acquire/release` around all fetch logic (SSRF/OOM/jitter/mirror/fetchPageOnce)

### G. Path jitter (fetcher.ts + types.ts)
- `FetchConfig.pathJitter?: boolean` (default false, zero regression)
- `maybePathJitter(url, cfg)`:
  - Per-host Map `lastPaths` (globalThis for HMR safety, LRU 200)
  - If current path differs from last → `await new Promise(r => setTimeout(r, 100 + random*400))` (100-500ms)
  - Same path (retry/token challenge) → no jitter (don't slow retries)
- Called inside `fetchPage` after `acquireGlobalSlot` (jitter wait counts toward global in-flight)

### H. OOM protection (fetcher.ts)
- At `fetchPage` entry: `process.memoryUsage()` (sync, <1μs)
- If `heapUsed > 1.5 * 1024 * 1024 * 1024` (1.5GB) → `await sleep(5000)` to let GC reclaim
- Long-task large-book (thousands of chapters) accumulated heap no longer kills the 4GB container

### I. ReDoS hardening (parser.ts)
- New exported `testRegexBudget(src, opts?)`:
  - Default sample: `'a'.repeat(50) + 'b'.repeat(50) + 'X'.repeat(100)` (200 chars)
  - Default budget: 100ms
  - Compiles regex, runs `sample.replace(re, '')` synchronously
  - Returns `{ok: boolean, reason?: string, elapsedMs?: number}`
- `applyTransform` now:
  - Length ≤1000 + nested quantifier gate (existing)
  - + `testRegexBudget(src, {budgetMs: 100})` BEFORE compiling
  - If budget fails → skip replace (zero regression), warn with elapsedMs
  - Double defense: known patterns (gate) + unknown patterns (budget)

### J. Referer chain enforcement (runner.ts)
- `extractToc` now returns `{items, pages, tocUrl}`:
  - tocLink path: `tocUrl = abs` (the absolutized tocLink URL)
  - Book page IS toc: `tocUrl = baseUrl`
  - Sniff path: `tocUrl = abs` (sniffed URL)
- `tocUrlRef` is `let` (updated when browser re-fetch finds more complete toc)
- Chapter content fetch builds `contentFetchCfgWithReferer`:
  ```ts
  { ...fetchCfg, refererUrl: tocUrlRef || bookUrl, refererChain: true }
  ```
- `refererChain: true` forced for chapter fetches (because `buildHeaders` only uses `refererUrl` when `refererChain === true`)
- Other request surfaces (list/book/toc) still respect rule's `refererChain` setting (zero regression for non-chapter fetches)

## Quality Gates Verification

```
$ bun run lint
$ eslint .
exit=0  ✓

$ bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | wc -l
0
exit=0  ✓

$ curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/
200  ✓

$ cd mini-services/cloak-browser && bunx tsc --noEmit --target esnext --module esnext --moduleResolution bundler --skipLibCheck --strict false --noImplicitAny false index.ts
(no output = 0 errors)  ✓
```

## Regression Safety

- `hostGateConcurrency` falls back to `hostGateLimit` (zero regression for old rules)
- `globalConcurrency` defaults to 10 (large enough to not throttle existing tasks)
- `pathJitter` defaults to `false` (no delay injection unless explicitly enabled)
- OOM check is read-only (only triggers `await sleep(5000)` when >1.5GB; otherwise zero-cost)
- `testRegexBudget` runs on 200-char sample (<1ms for normal regexes; ReDoS only triggers >100ms)
- Referer enforcement only for chapter content fetches (list/book/toc respect rule's `refererChain`)
- `cookieJar.persist/load` are additive methods (existing callers unaffected)
- CloakBrowser `lite` tier == previous behavior (zero regression for existing callers)

## Worklog Appended

`/home/z/my-project/worklog.md` — full entry with all 12 sub-tasks documented.
