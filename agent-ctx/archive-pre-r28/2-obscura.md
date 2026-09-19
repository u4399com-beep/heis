# Task 2-obscura — obscura.ts bug fixes + stealth enhancement

## Context loaded
- Read prior worklog entries (Tasks 3-a/4-a/1-a/1-c/2-fetcher/2-runner) for context.
- Confirmed Task 4-a's 2 obscura bugs: Bug 4 (recreateSlot orphaned context on newPage failure) and Bug 18 (cookie host-filter uses original URL not page.url()).
- Read the ENTIRE `src/lib/crawl/obscura.ts` (1097 lines) before changes — mapped every function boundary (randomFingerprint / parseUaIdentity / buildIdentityInitScript / STEALTH_INIT_SCRIPTS / looksLikeChallenge / newStealthContext / createSlot / recreateSlot / withObscuraPage / renderStealth / shutdownObscura), every call site, the cookie host-filter logic, and the challenge-wait loop.

## Bugs fixed

### Bug 4 — recreateSlot orphaned BrowserContext on newPage failure
- File: `src/lib/crawl/obscura.ts` lines ~785-810 (after fix).
- Symptom: `recreateSlot` did `await slot.ctx.close()` (old ctx closed), then `newStealthContext()` + `ctx.newPage()` + `applyUaCdpOverride()` all bare. If newPage/CDP failed, the new ctx was neither attached to the slot nor closed → every failure leaked an empty BrowserContext (process-level browser resource; cumulative leaks would exhaust file descriptors / memory). Plus slot.ctx/page/cdp still pointed to the old (closed) ctx.
- Fix: wrapped `newPage()` + `applyUaCdpOverride()` in try/catch; on failure `await ctx.close().catch(()=>{})` to reclaim the new ctx, then rethrow. Slot fields stay pointing to the old (already-closed) ctx so `withObscuraPage`'s `free.page.isClosed()` triggers recreateSlot on next acquire (and recreateSlot's first line `slot.ctx.close().catch(()=>{})` is idempotent on an already-closed ctx).

### Bug 18 — Cookie host-filter uses original URL not page.url()
- File: `src/lib/crawl/obscura.ts` lines ~1080-1100 (after fix).
- Symptom: original code computed `host = new URL(url).hostname` (using REQUEST url, not FINAL url after redirects) then filtered `ctx.cookies()` by `domainMatch(cookie.domain)` against that host. On cross-subdomain redirects (e.g. `www.example.com` → `example.com`) or challenge-handoff redirects, host mismatch caused critical cookies (cf_clearance / sessionId) to be silently dropped before being returned to the fetcher — the HTTP engine then re-fetched without those credentials and still got blocked.
- Fix: chose the simpler approach the task description proposed — return ALL cookies from `ctx.cookies()` and let the fetcher's `CookieJar.store(originHost(url), res.cookies)` bucket by the request URL host. The obscura slot is already origin-pinned (same-domain reuse / cross-domain destroy+rebuild), so third-party cookies are rare and short-lived; even if a third-party cookie leaks into the target host's jar, it's mostly harmless (target host ignores unknown cookies). Critical cf_clearance / sessionId cookies now zero-loss, HTTP engine direct-fetch can pass the shield on retry.

## Enhancements

### E1 — Expanded stealth init scripts
Added 2 new scripts to `STEALTH_INIT_SCRIPTS` (now 9→11 entries, scripts 11 & 12):
- Script 11: `navigator.connection` stub (effectiveType=4g, rtt=50, downlink=10, saveData=false, type=wifi) + `navigator.getBattery()` stub returning a BatteryManager-like object (charging=true, level=1, chargingTime=0, dischargingTime=Infinity). Both are real-Chrome objects that headless omits → creepjs-class detectors flag missing.
- Script 12: `window.screenX/screenY/screenLeft/screenTop` randomized to 0-100 (real browsers have non-zero window position from user dragging; headless default 0,0 is a fingerprint surface).
- Verified: `navigator.deviceMemory` already =8 (script 5); `navigator.hardwareConcurrency` already randomized from `[4,6,8,8,10,12,16]` (8 most common); `Notification.permission` already synced with `permissions.query` (script 8); WebGL `UNMASKED_VENDOR_WEBGL`/`UNMASKED_RENDERER_WEBGL` already overridden per-UA via `buildIdentityInitScript` using `GPU_BY_OS` (static script 6 is now a fallback only — `buildIdentityInitScript` runs after and patches the same `proto.getParameter`).
- Probed: all 11 scripts compile as plain JS via `new Function()` (no TS annotations leaked into the string literals).

### E2 — Improved CF challenge auto-wait
- Added helper `isChallengeUIVisible(page)`: returns true if URL contains `/cdn-cgi/challenge` OR any of `#challenge-running`, `#challenge-form`, `.cf-turnstile`, `iframe[src*="challenges.cloudflare.com"]` is in the DOM. Conservative: on locator failure (page destroyed mid-reload) returns true to let upper-layer polling continue.
- Added helper `tryClickTurnstile(page)`: iterates `page.frames()` (up to 8, gg cross-frame semantics); for CF iframes (URL matches `challenges.cloudflare.com` or `cdn-cgi/challenge-platform`) uses selector `input[type=checkbox]` (typically the only checkbox in the Turnstile widget iframe); for main frame uses `.cf-turnstile input[type=checkbox]` (avoids mis-clicking site-local checkboxes). Silent on miss.
- Reworked the challenge-wait loop:
  - Replaced fixed 1000ms poll with randomized 1000-3000ms human-like delay (less rhythm-detectable).
  - Attempts `tryClickTurnstile` each iteration (interactive-mode CF challenges need user click to proceed).
  - Checks `isChallengeUIVisible` for structural disappearance (UI gone but HTML keywords still matching is a transition state — early-exit loop on `uiGone && !looksLikeChallenge`).
  - On `uiGone`, waits `domcontentloaded` (5s timeout) before re-reading content.
- Relaxed throws:
  - Removed first throw (line 1057-1059 original): `Obscura 挑战等待超时` — now returns current page state on timeout; fetcher's `looksBlocked` catches blocked content and falls back. Crucially, cookies (cf_clearance) obtained during the wait are still written to the CookieJar — the original throw lost them, making even the fallback `renderWithBrowserRaw` unable to pass the shield.
  - Removed second throw (line 1106-1108 original): `Obscura 渲染结果仍为挑战页` (post-settle double-insurance) — same rationale; leaves the commented-out check in place for documentation.
- Default `challengeWaitMs` kept at 40000ms (not reduced to task's suggested 8000ms): the existing comment justifies 40s for CF managed challenges (10-25s typical, slow tail 35s+); 8000ms would be a regression for slow-resolving challenges. The task's "default 3000ms" assumption was based on stale code (actual was already 40000ms).
- Dev-log inspected: 502 errors in `dev.log` are from mini-services on ports 3010/3011 (not running), unrelated to obscura.

### E3 — Viewport entropy (locale / timezone / deviceScaleFactor)
- Added `LOCALE_POOL` (weighted): `zh-CN/Asia/Shanghai` 70%, `zh-TW/Asia/Taipei` 12%, `en-US/America/New_York` 12%, `en-GB/Europe/London` 6%.
- Added `pickDesktopDsf()`: 1 (60%), 1.25 (10%), 1.5 (15%), 2 (15%).
- Added `pickMobileDsf()`: 1 (10%), 1.5 (15%), 2 (60%), 3 (10%).
- `randomFingerprint` now picks weighted locale/timezone pair + weighted deviceScaleFactor (mobile and desktop separate pools). Probed: all 4 locales appear in 200 samples.
- Added `acceptLanguageFor(locale)` helper: derives `Accept-Language` header per locale (e.g. `zh-TW,zh;q=0.9,en;q=0.6` for zh-TW). Wired into `newStealthContext` (was hardcoded to `zh-CN,zh;q=0.9,en;q=0.6`).
- Added per-context dynamic init script in `newStealthContext` that overrides `navigator.language`/`navigator.languages` to match `fp.locale`. Static script 4 hardcodes `zh-CN` which conflicted with the new locale pool — the dynamic script (registered after STEALTH_INIT_SCRIPTS, before `buildIdentityInitScript`) aligns `navigator.language` / `navigator.languages` / `Accept-Language` header / `newContext(locale)` four-way. Probed: all 4 locale scripts compile as plain JS.
- `hasTouch` and `isMobile` already correct in `newStealthContext` (both = `fp.mobile`, derived from UA family). No change needed.

### E4 — Fingerprint consistency verification
- Verified `parseUaIdentity` for all branches:
  - Mobile UAs → `mobile:true`, `chPlatform:'Android'/'iOS'`, `navPlatform:'Linux armv8l'/'iPhone'/'MacIntel'` (iPadOS 13+ reports MacIntel), `maxTouchPoints:5`, brands=`[Chromium, Google Chrome, Not:A-Brand]`.
  - Desktop Chrome UAs → `mobile:false`, `chPlatform:'Windows'/'macOS'/'Linux'`, `navPlatform:'Win32'/'MacIntel'/'Linux x86_64'`, `maxTouchPoints:0`, brands=`[Chromium, Google Chrome, Not:A-Brand]`.
  - Edge UAs → brands additionally include `Microsoft Edge` (after Chromium/Google Chrome, before Not:A-Brand).
- Found one inconsistency in coverage (not logic): `DESKTOP_UAS` had no Edge UA entries, so the Edge brand logic in `parseUaIdentity` (lines 200-203) was never exercised in production. Added 2 Edge UAs to `DESKTOP_UAS`:
  - Windows Edge 139: `...Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0`
  - macOS Edge 139: `...Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0`
- Probed: Edge UA hits in 500 random samples = 135 (~27%, matches expected 2 Edge UAs × 78% desktop rate).

### E5 — Slot heartbeat / activity check
- Added `lastUsedAt: number` field to `PoolSlot` interface; set in `createSlot`, `recreateSlot`, and `withObscuraPage`'s finally block.
- Added constants: `SLOT_IDLE_RECLAIM_MS = 10 * 60 * 1000` (10 min), `SLOT_RECLAIM_INTERVAL_MS = 60_000` (60s scan).
- Added `S.reclaimTimer?: ReturnType<typeof setInterval> | null` to `ObscuraGlobal` (HMR-safe via globalThis).
- Added `scheduleReclaim()` (idempotent — early-returns if `S.reclaimTimer` already set): every 60s scans all non-busy slots; for each slot where `Date.now() - slot.lastUsedAt >= SLOT_IDLE_RECLAIM_MS` AND `!slot.page.isClosed()`, calls `void slot.ctx.close().catch(()=>{})` (ctx.close auto-cascades to its pages). The slot object itself stays in `S.slots` — next `withObscuraPage` acquire sees `free.page.isClosed()=true` and triggers `recreateSlot` to rebuild the ctx with a fresh fingerprint.
- Wired `scheduleReclaim()` into `ensureBrowser()` (after `registerExitHooks()`) — runs once per browser instance lifetime.
- `shutdownObscura()` now also clears `S.reclaimTimer`.
- The reclaim timer is `unref`'d (won't keep CLI/one-shot scripts alive).
- Complements `IDLE_CLOSE_MS` (5min all-idle full browser shutdown): when one slot is busy with a long task and another is idle >10min, the reclaim timer closes the idle slot's ctx while the busy slot keeps the browser alive.

## Files modified
- ONLY `src/lib/crawl/obscura.ts` (per constraint). No other file touched.

## Test results
- `bun run lint` → clean (no errors).
- `bunx tsc --noEmit 2>&1 | grep "crawl/obscura"` → no errors (only 4 pre-existing errors in examples/+skills/ folders, zero in obscura.ts).
- Probe `/tmp/probe-obscura.ts`: all 11 STEALTH_INIT_SCRIPTS compile as plain JS; `buildIdentityInitScript` for 4 UA variants (Windows Chrome, Android Chrome, Windows Edge, macOS Chrome) compiles + brands/maxTouchPoints/GPU all consistent with UA family; `randomFingerprint` produces all 4 locales in 200 samples; Edge UAs appear in 27% of 500 random samples.
- Probe `/tmp/probe-locale.ts`: all 4 locale variants of the per-context dynamic init script compile as plain JS.
- Dev server log shows obscura.ts compiles fine; 502 errors in log are from mini-services on ports 3010/3011 (not running, unrelated).

## Line count
- `src/lib/crawl/obscura.ts`: 1097 → 1339 lines (+242). Growth from new stealth scripts (E1), CF challenge helpers (E2), locale/dsf pools + acceptLanguageFor + dynamic locale init (E3), Edge UA additions (E4), reclaim timer infrastructure (E5), and detailed comments explaining each fix.

## Backward compatibility
- All exported function signatures preserved: `randomFingerprint`, `isMobileUaLocal`, `parseUaIdentity`, `buildUaMetadata`, `buildIdentityInitScript`, `applyUaCdpOverride`, `STEALTH_INIT_SCRIPTS`, `GPU_BY_OS`, `isJsRedirectShell`, `looksLikeChallenge`, `clickSelectorAnywhere`, `withObscuraPage`, `checkObscuraAvailable`, `renderStealth`, `obscuraFetch`, `shutdownObscura`.
- Interfaces `ObscuraFetchOptions`, `ObscuraFetchResult`, `ObscuraFingerprint` unchanged.
- `PoolSlot.lastUsedAt` added as required field — only internal to this module, no external impact (callers use `withObscuraPage`/`obscuraFetch` which abstract the slot away).
- The two removed `throw` paths in `renderStealth` are observable to callers — but the new behavior (return challenge page state instead of throwing) is strictly more permissive and the fetcher's `looksBlocked` already catches blocked content from obscura's return value (verified in `fetcher.ts` lines 1908/1820).
