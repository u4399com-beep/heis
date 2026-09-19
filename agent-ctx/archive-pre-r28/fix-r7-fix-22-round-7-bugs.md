# Task fix-r7 — Fix 22 round-7 audit bugs

## Agent context
- Task ID: `fix-r7`
- Parent: `audit-r7` (worklog line 2674+)
- Constraint scope: `src/lib/crawl/*`, `src/app/api/**`, `src/lib/{auth,api,links,logger}.ts`, `src/proxy.ts`, `src/components/**`
- Verification: `bun run lint` 0/0, `bunx tsc --noEmit` 0 errors (excluding examples/skills), dev server `/` 200 OK

## Summary of fixes (16 of 22; 6 low/cosmetic skipped per spec)

### R7-1 Critical — PSL blocklist in parentDomainChain (fetcher.ts:249-298)
- Added `KNOWN_MULTI_PART_TLDS` Set (co.uk / com.cn / com.hk / com.tw / co.jp / co.kr / com.au / co.nz / com.br / co.in / com.sg / github.io / appspot.com)
- `parentDomainChain` now stops at the registrable domain when the trailing 2 segments form a known multi-part TLD
- e.g. `www.example.co.uk` → `['www.example.co.uk', 'example.co.uk']` (no 'co.uk' leak → CookieJar can no longer be polluted with cross-domain cookies via public suffix)
- Verified by trace for: simple TLD (.com), multi-part TLD (.co.uk), 5-level chain, host-only (single segment)

### R7-2 High — tokenInflight thundering herd on retry (fetcher.ts:2098-2135)
- On in-flight promise rejection: immediately `inflightMap.delete(cacheKey)`, sleep 200ms, then re-read inflightMap
- If a sibling caller already started a retry promise, await that shared retry (no N× independent retries)
- If no sibling retry in flight yet, fall through to create one (single retry, not nested)

### R7-3 High — contentProxyUrl only for chapter URLs (fetcher.ts:2373-2451, types.ts:160-167)
- Added `FetchConfig.contentProxyUrlMatch` regex field
- When set, only matching URLs go through contentProxy; non-matching (list/book/toc) skip proxy entirely
- When unset, behavior is unchanged (all URLs use proxy — backward compatible)
- Removed `console.warn` on ok:false / proxy failure (was causing log spam for non-chapter URLs)
- Sanitize in types.ts:500-clamped, single-line, regex-validated (illegal regex → field discarded, runtime falls back to "all URLs" path)

### R7-4 High — SitesSection theme selector (SitesSection.tsx:107, 475-476)
- Changed `size=200` → `size=500` in `/api/admin/themes` fetch
- Added helper text below the dropdown: "显示前 500 套, 更多请用 URL ?theme= 预览"

### R7-5 High — admin/sites POST uses getThemeById (sites/route.ts:4-16)
- Replaced `THEMES.some(t => t.id === id)` with `getThemeById(id)` 
- POST now accepts both preset IDs and combo theme IDs (50400+), no longer silently downgrades combo → 'aurora'
- PUT route (sites/[id]/route.ts) already used getThemeById (verified, no change needed)

### R7-6 Medium — Cross-source dedup race (runner.ts:925-987, 1170-1208)
- When `existing.sourceRuleId !== taskCfg.ruleId` AND not full-recrawl mode: defer `db.book.update` until after cross-source dedup decision
- If dedup decides SKIP: don't write book metadata (preserves old source's sourceRuleId/sourceUrl)
- If dedup decides MERGE: write metadata via `pendingCrossSourceUpdate` deferred slot
- Full-recrawl mode unchanged (admin explicit override)

### R7-7 Medium — applyTransform chunk slicing (parser.ts:30-66)
- Increased CHUNK size from 200 → 2000 (fewer boundaries, less boundary-loss risk)
- Added 50-char OVERLAP between chunks to catch multi-char regex matches spanning boundaries
- First chunk fully written; subsequent chunks skip the OVERLAP region on output

### R7-8 Medium — sanitizeReaderHtml regex bypass (shared.tsx:117-149)
- (a) `\s+on` → `[\s/]+on` (handles `<img/onerror=...>` slash separator)
- (b) `"\s*javascript:` etc. — handles leading whitespace in quoted href values
- (c) Decode HTML entities upfront via textarea DOM trick (defeats `java&#x0A;script:` entity-encoded payloads)
- (d) `\s*` after quote handles tabs/whitespace before javascript: scheme

### R7-9 Medium — assertSafeIp IPv4-compatible IPv6 (fetcher.ts:898-910)
- Added check for IPv4-compatible IPv6 (`::a.b.c.d`, RFC 4291 deprecated but accepted by some stacks)
- Detection: first 12 bytes all zero AND v6[10]/v6[11] not (0xFF, 0xFF) (i.e., not v4-mapped)
- Extract embedded IPv4 from last 4 bytes, recurse via `assertSafeIp` to apply private/loopback rules
- e.g. `::10.0.0.1` now correctly rejected as private (was previously allowed — SSRF bypass)

### R7-10 Medium — proxyState Map GC (fetcher.ts:1045-1075)
- Added `proxyStateCleanup(activeProxyUrls: Set<string>)` helper
- Called from `parseProxyPool` after building the current pool — deletes any proxyState entry not in the active pool
- Prevents memory leak + prevents "改回旧配置时复活过期冷却" stale cooldown revival

### R7-11 Medium — contentProxyUrl {url} validation (types.ts:564-568)
- In `sanitizeFetchConfig`: if `contentProxyUrl` set but missing `{url}` placeholder, log warning
- Not a hard rejection (admin might intentionally use a fixed proxy URL)
- Warn fires once per sanitize call (admin sees the misconfiguration)

### R7-12 Medium — cleaner plainText third regex (cleaner.ts:170-183)
- Changed greedy `[\s\S]*$` → non-greedy `[\s\S]*?` with lookahead `(?=<(?:script|style|...)\b|$)`
- If a closing tag exists, non-greedy stops at the nearest one (preserves legitimate content after)
- If no closing tag (truncated HTML), lookahead `$` falls back to end-of-string (R5-16 intent preserved)
- Fixes content loss when first regex fails to match malformed attributes (e.g., `<script attr=">">`)

### R7-13 Medium — cap-50000 keeps LATEST not EARLIEST (runner.ts:1672-1691)
- Changed `Array.from(set).slice(0, 50_000)` → `.slice(-50_000)` for `discoveredBookUrls`, `completedBookUrls`, `ongoingBookUrls`
- For `bookLastChapters` Map: convert to entries array, take last 50_000 entries (most recently added)
- On restart: latest books (most likely ongoing/unprocessed) are remembered; old completed books may be re-crawled but existUrlMap dedup prevents duplicate chapter records

### R7-14 Medium — in-memory Sets cap 100000 (runner.ts:57-58, 544-573)
- Added `_capWarned?: boolean` to TaskRuntime (one-shot warning flag)
- In list-page dedup loop: when `rt.discoveredBookUrls.size >= 100_000`, stop adding new keys
- Still push raw URL to `urls` array (so the current batch continues processing)
- Log warning once per task (not per URL)
- Cap is well above the 50000 persistence cap, so saveProgress semantics are unaffected

### R7-17 Low — readBodyCapped stream cancel + parent abort (fetcher.ts:1283-1328)
- After `reader.cancel()`, also call `controller.abort()` (the parent AbortController via closure)
- Forces underlying TCP connection to close immediately, preventing temporary connection leak under sustained overflow
- Applied to all three overflow paths: content-length pre-check, arrayBuffer fallback, streaming read

### R7-19 Low — URL normalization for discoveredBookUrls dedup (sorter.ts:387 + runner.ts:15, 551-573)
- Exported `normalizeUrlKey` from sorter.ts (was private)
- Imported into runner.ts; used as dedup key in list-page discovery loop
- Normalizes: query param sort order, default port stripping (https:443 / http:80), trailing slash removal
- `urls` array still holds raw URLs for actual fetch (normalized key only used for Set membership check)
- Same dedup semantics already used by sorter for chapter dedup (consistency)

## Skipped per spec ("Fix the impactful ones, skip cosmetic/dead-code")

- R7-15: dead code getThemeList/getThemesPage perf trap (no request-path callers)
- R7-16: t2sHtml tag split regex edge case (rare malformed tags)
- R7-18: loginAttempts sliding window (adequate for threat model)
- R7-20: backup route db.book.findMany({}) take limit (admin-only, low impact)
- R7-21: pruneRuntimesIfNeeded operator precedence (unreachable in practice)
- R7-22: obscura slot busy=true transient state (microsecond window, no impact)

## Files modified
- src/lib/crawl/fetcher.ts (R7-1, R7-2, R7-3, R7-9, R7-10, R7-17)
- src/lib/crawl/types.ts (R7-3 contentProxyUrlMatch field + sanitize, R7-11 warn)
- src/lib/crawl/runner.ts (R7-6, R7-13, R7-14, R7-19)
- src/lib/crawl/parser.ts (R7-7)
- src/lib/crawl/cleaner.ts (R7-12)
- src/lib/crawl/sorter.ts (R7-19 export normalizeUrlKey)
- src/components/public/read-layouts/shared.tsx (R7-8)
- src/components/admin/SitesSection.tsx (R7-4)
- src/app/api/admin/sites/route.ts (R7-5)
