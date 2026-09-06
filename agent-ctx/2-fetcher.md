---
Task ID: 2-fetcher
Agent: fetcher.ts SSRF + bugs + enhancement
Task: SSRF blocklist + 9 bug fixes + crawler/anti-anti-crawler enhancement in fetcher.ts

Work Log:
- Read `/home/z/my-project/worklog.md` (Tasks 3-a/4-a/1-a/1-c) for context on the 9 fetcher bugs from Task 4-a deep hunt + auth/middleware state from 1-a.
- Read the ENTIRE `src/lib/crawl/fetcher.ts` (1652 lines) before any changes — mapped every function boundary, every call site of `looksBlocked`/`isJsChallenge`/`fetchHttp`, the CookieJar methods, and the redirect loop in `fetchHttp`. Mapped the rule-test API caller in `src/app/api/admin/rules/test/route.ts` to confirm the SSRF guard could live inside `fetchPage` (route needs no change).

Part A — SSRF Blocklist (audit C2):
- Added `assertSafeTarget(url, opts?: { allowLoopback?: boolean })` returning `{ ok: true } | { ok: false, reason }`. Logic: reject non-http(s) schemes → strip brackets from IPv6 hostnames → block localhost/*.localhost unless `allowLoopback` → for IP literals check ranges directly (169.254.169.254 + 169.254.169.253 cloud metadata; 169.254.0.0/16 link-local; 100.64.0.0/10 CGNAT; 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 private; 0.0.0.0/8 non-routable; 127.0.0.0/8 + ::1 loopback only if allowLoopback; fe80::/10 + fc00::/7 IPv6 link-local/ULA; IPv4-mapped IPv6 (`::ffff:a.b.c.d`) extracted + recursively checked) → for hostnames `dns.promises.lookup(hostname, {all:true, family:0})`, check EACH resolved IP against ranges (DNS-poisoning defense).
- DNS cache: `Map<hostname, {ips, at}>`, 60s TTL, FIFO eviction at 2000-entry cap, persisted on `globalThis.__novelSsrfDnsCache_v1` for HMR safety.
- Exported `isSafeTarget(url, opts): Promise<boolean>` boolean wrapper.
- Helper `loopbackBypassAllowed(url, cfg)`: returns true only when URL host:port matches `cfg.tokenUrl` (with `{url}` substituted), `RELAY_URL` (127.0.0.1:3011), or `SCRAPLING_BRIDGE_URL` (127.0.0.1:3012). Prevents arbitrary loopback SSRF while keeping token-prefetch + relay/bridge internal calls working.
- Guard applied in: `fetchPage` (top + per-mirror-host, allowLoopback from `loopbackBypassAllowed`); `fetchBinary` (allowLoopback:false, returns null on block); `relayHop` (allowLoopback:false, throws); `fetchViaScraplingBridge` (allowLoopback:false, returns null); `prefetchToken` (allowLoopback:true for `tokenUrl`, still rejects metadata/private).
- No changes needed to `src/app/api/admin/rules/test/route.ts` — guard lives inside `fetchPage`/`fetchBinary` so the route is automatically protected.

Part B — 9 Bug Fixes:
- Bug 1 (`fetchBinary` OOM): replaced `Buffer.from(await res.arrayBuffer())` with `res.body.getReader()` streaming loop + running byte counter, aborts (`reader.cancel()`) when `total > MAX_BINARY_BYTES` (25MB). Falls back to `arrayBuffer()` only when `res.body` is null (relay/recomposed response shape).
- Bug 2 (`decodeBuffer` gb2312): added `if (charset === 'gb2312' || charset === 'gbk') charset = 'gb18030'` after toLowerCase — GB18030 is a strict superset, fixes 4-byte GB18030 chars previously decoded as U+FFFD.
- Bug 3 (retry-backoff boundary): introduced dedicated `backoffRetries` counter (decoupled from `cookieRetries`); `maxBackoffRetries = Math.min(2, cfg.retries ?? 0)`; sleep delay uses `Math.pow(2, backoffRetries - 1)`; backoff retry doesn't consume cookieRetry slot.
- Bug 9 (CookieJar empty-domain leak): in `fresh()`, after `jar.delete(k)`, the `get()`/`count()` now check `if (jar.size === 0) this.jars.delete(domain)`. Added `prune()` method (5min throttled via `lastPruneAt`) that sweeps all domains — lazy-invoked from `get`/`count` empty-jar paths.
- Bug 11 (token `{url}` first-occurrence only): `real.replace('{url}', enc)` → `real.split('{url}').join(enc)` (global replace; handles templates with multiple `{url}` placeholders).
- Bug 12 (token duplicate param): before appending `?token=...`, check `new URL(reqUrl).searchParams.has('token')`; if exists, use `searchParams.set('token', enc)` then `toString()` (replaces existing value); otherwise original append-with-fragment-aware logic. URL-parse failure falls back to original string-append behavior.
- Bug 22 (curl retryAfter overwrite): `retryAfter = r.retryAfter` → `if (r.retryAfter) retryAfter = r.retryAfter` (preserves intermediate 3xx round's Retry-After against final round's empty value).
- Bug 23 (`fetchBinary` redirect cookie leak): `redirect: 'follow'` → `redirect: 'manual'` + hop loop (max 5 hops); each hop calls `buildHeaders(hopUrl, ...)` which re-evaluates Cookie from the jar by origin (cross-domain redirects naturally don't carry the prior domain's Cookie). Cross-scheme: only `http→https` upgrade allowed.
- Bug 27 (`CookieJar.store` malformed Set-Cookie): added ATTR_NAMES set (`path`, `domain`, `expires`, `max-age`, `secure`, `httponly`, `samesite`); skip entries where first `;`-segment has no `=`, OR cookie name (lowercased) is a known attribute keyword. Prevents "Path=/; Secure" being stored as cookie `Path` with value `/` then sent back as `Cookie: Path=/; Secure` (which gets servers to return 400).

Part C — Crawler & Anti-anti-crawler Enhancement:
- C1 (UA_POOL expansion): added 14 new entries (Chrome 141/142 Win + Edge 141/142, Firefox 128 macOS/129/130 Win, Safari 17.6/18.0 macOS, Pixel 9 Chrome 141, Samsung S24 SM-S926B Chrome 141, SM-S921B Chrome 142, iPhone Safari 17.6/18.0 iOS). Pool now ~34 entries. All mobile UAs match `isMobileUa` regex.
- C2 (`fingerprintHeadersFor` enhancement): added `sec-ch-ua-platform-version` (Win 10.0.0, macOS 14.0.0, Android 14.0.0 derived from UA, iOS 17.0.0 derived), `sec-ch-ua-arch` (x86 for desktop, arm for Android/iOS), `sec-ch-ua-bitness: "64"`, `sec-ch-ua-model` (empty for desktop, device model from Android UA for mobile, empty for iOS Safari as it doesn't send Client Hints), `sec-ch-ua-wow64: "?0"`. Added `acceptLanguageFor(ua)` deriving zh-CN / en-US / ja Accept-Language from UA locale segment.
- C3 (`looksBlocked` enhancement): added `opts?: { status?: number; serverHeader?: string }` optional 2nd param — when status is 403/429/503 AND server header matches `cloudflare|akamai|incapsula|sucuri`, return true (WAF signature). Added short-page check: `html.length < 500` AND visible text (after stripping `<script>`/`<style>`/tags) `< 50` chars → suspicious. Added new STRONG_BLOCK_MARKERS: `cf-chl-bypass`, `please verify you are a human`, `enable javascript and cookies`. Updated scrapling/error-path callers to pass status info.
- C4 (DNS-error retry): in `fetchHttpWithCurlSingle`, after `fetchHttp` throws, check `e.code === 'ENOTFOUND' || 'EAI_AGAIN'` (or message regex `getaddrinfo (ENOTFOUND|EAI_AGAIN)`); if matched AND `!e?.status && !e?.isFetchTimeout`, sleep 2s and retry `fetchHttp` once before falling to curl. ECONNREFUSED NOT retried (port closed = non-transient).
- C5 (`isJsChallenge` broadening): added `cf-chl-bypass` regex match for short HTML (< 1200 chars). `challenge-platform` already in STRONG_BLOCK_MARKERS (handled by `looksBlocked`). `__cf_bm` cookie presence is a scrutiny signal not a hard block — left out of `isJsChallenge` to avoid false positives on legitimate CF-protected sites.

Verification:
- `cd /home/z/my-project && bun run lint` → clean (no errors, no warnings).
- `bunx tsc --noEmit | grep crawl/fetcher` → no errors (only pre-existing errors in `examples/` and `skills/`).
- SSRF live tests via `/api/admin/rules/test` (authed cookie):
  * `http://169.254.169.254/` → 502 `SSRF blocked: 云元数据地址 169.254.169.254` ✓
  * `http://127.0.0.1:9999/` (no bypass) → 502 `SSRF blocked: IPv4 回环 127.0.0.0/8` ✓
  * `http://10.0.0.1/` → 502 `SSRF blocked: 私网 10.0.0.0/8` ✓
  * `http://192.168.1.1/` → 502 `SSRF blocked: 私网 192.168.0.0/16` ✓
  * `http://100.64.0.1/` → 502 `SSRF blocked: CGNAT 100.64.0.0/10` ✓
  * `http://169.254.1.1/` → 502 `SSRF blocked: 链路本地 169.254.0.0/16` ✓
  * `http://[::1]:9999/` → 502 `SSRF blocked: IPv6 回环 ::1` ✓
  * `http://0.0.0.0/` → 502 `SSRF blocked: 不可路由 0.0.0.0/8` ✓
  * `http://localhost:9999/` → 502 `SSRF blocked: localhost 域名` ✓
  * `http://127.0.0.1:3010/rewrite?url=test` (with `cfg.tokenUrl` matching) → bypassed SSRF (got past guard, fell to network error since service not running) ✓
  * `http://127.0.0.1:3011/` (matches RELAY_URL) → bypassed SSRF ✓
  * `https://example.com/` (legit external) → 200 OK, 559 bytes HTML fetched ✓
- Unit tests via `bun run /tmp/test-fetcher.ts`:
  * `assertSafeTarget('http://169.254.169.254/')` → blocked ✓
  * `assertSafeTarget('https://example.com/')` → ok ✓
  * `assertSafeTarget('http://127.0.0.1:3010/', { allowLoopback: true })` → ok ✓
  * `isSafeTarget('http://10.0.0.1/')` → false ✓
  * `fetchBinary('http://169.254.169.254/favicon.ico')` → null (SSRF) ✓
  * `fetchBinary('https://www.google.com/favicon.ico')` → got 5430 bytes image/x-icon ✓
- Bug-specific tests via `bun run /tmp/test-bugs.ts`:
  * Bug 27: malformed `Secure` / `Path=/login` / `Expires=...` filtered; only `sess=abc123; token=xyz` stored ✓
  * Bug 9: `count()` returns correctly, prune mechanism in place ✓
  * Bug 11: `http://127.0.0.1/rewrite?url={url}&ref={url}` → both placeholders replaced ✓
  * Bug 12: `?token=old&foo=bar` + `set('token', 'NEW')` → `?token=NEW&foo=bar` (no duplicate) ✓

Stage Summary:
- Files modified: ONLY `src/lib/crawl/fetcher.ts` (per constraint). `src/app/api/admin/rules/test/route.ts` was inspected but not modified — SSRF guard lives inside `fetchPage`/`fetchBinary`, so the route is automatically protected.
- Line count: 1652 → 2111 lines (+459, mostly SSRF helpers + new sec-ch-ua Client Hints + fetchBinary streaming).
- All 9 Task 4-a bugs (1, 2, 3, 9, 11, 12, 22, 23, 27) fixed in place — verified by code inspection + targeted unit tests.
- Part A SSRF guard wired into all 5 entry points (`fetchPage`, `fetchBinary`, `relayHop`, `fetchViaScraplingBridge`, `prefetchToken`) with appropriate `allowLoopback` policy per caller.
- Part C enhancements: UA_POOL 20→34 entries; `fingerprintHeadersFor` now emits 5 additional sec-ch-ua Client Hints + locale-aware Accept-Language; `looksBlocked` gains optional status+WAF-server check + short-page visible-text check + 3 new markers; `isJsChallenge` matches `cf-chl-bypass`; `fetchHttpWithCurlSingle` retries once on transient DNS errors.
- Backward compatibility: all public function signatures preserved (`fetchPage`/`fetchBinary`/`relayHop`/`fetchViaScraplingBridge`/`prefetchToken` accept same params; `looksBlocked` added optional 2nd param so existing single-arg callers continue to work).
- `bun run lint` clean. `bunx tsc --noEmit` clean for fetcher.ts (only pre-existing errors in examples/skills folders).
