---
Task ID: 2-other-engine
Agent: hostgate/calibrate/parser/cleaner/sorter/storage/downloader/smart bug fixes
Task: Fix 10 bugs across 8 engine files + 2 calibrate routes + LRU for hostgate

# Scope & Boundary Awareness

Bugs 6/7/17/13/14/15/16/21/20/28 from Task 4-a's deep-hunt list were assigned to this task.
File ownership verified against prior agent-ctx notes:
- 1-a (auth): middleware/auth.ts/login routes — NOT touching.
- 1-c (mini-services/Docker): mini-services/, docker/, scripts/ — NOT touching.
- 2-fetcher: src/lib/crawl/fetcher.ts — NOT touching (but DID import `parseRetryAfterHeaderMs` for Bug 7, an exported helper).
- 2-runner: src/lib/crawl/runner.ts — NOT touching.
- 2-obscura: src/lib/crawl/obscura.ts — NOT touching.
- 2-other-engine (this task): hostgate/calibrate/parser/cleaner/sorter/storage/downloader/smart + 2 calibrate routes.

# Note on file vs bug-spec line numbers

Bug spec listed "parser.ts:124/131" for Bugs 13/14. The actual `extractChapterNo` function
(and `normalizeUrlKey` for Bug 16 at line 350-358) lives in `sorter.ts`, NOT parser.ts.
Line numbers 124/131/350-358 match sorter.ts exactly. The "parser.ts" reference in the spec
was treated as referring to the chapter-parsing routine; fix applied in its actual home
(sorter.ts) which IS in the allowed-file list. `parser.ts` (822 lines) was read for context
but no edits needed there.

# Files Modified

| File | Bugs | Lines (old→new) | Delta |
|---|---|---|---|
| src/lib/crawl/hostgate.ts | 6 + LRU | 390→481 | +91 |
| src/lib/crawl/calibrate.ts | 7, 17 | 539→554 | +15 |
| src/app/api/admin/rules/[id]/calibrate/route.ts | C3 lockdown | 153→156 | +3 |
| src/app/api/admin/rules/calibrate-all/route.ts | C3 lockdown | 179→182 | +3 |
| src/lib/crawl/sorter.ts | 13, 14, 16 | 358→378 | +20 |
| src/lib/crawl/cleaner.ts | 15 | 410→418 | +8 |
| src/lib/crawl/storage.ts | 21 | 162→165 | +3 |
| src/lib/crawl/downloader.ts | 20 | 226→236 | +10 |
| src/lib/crawl/smart.ts | 28 | 153→171 | +18 |
| **Total** | **10 bugs + LRU + C3** | **2499→2741** | **+171** |

# Bug Fix Summary

## Bug 6 (hostgate minGapMs overwrite)
`acquireHostGate` line 237 changed `st.minGapMs = minGapMs` to
`st.minGapMs = Math.max(st.minGapMs || 0, minGapMs)` so throttle only tightens mid-window.
Additional safeguard: when `st.rateLimitedUntil > now` (rate-limit cooldown active, the
file's actual rate-limit cooldown variable), minGapMs is also kept ≥ remaining cooldown
gap. Spec used variable name `penaltyUntil` but in this file `penaltyUntil` is the
derate-action cooldown (doesn't gate admission); `rateLimitedUntil` is the actual
rate-limit cooldown (429 from origin). Used the semantically correct one and documented
the variable-name choice in the inline comment.

## LRU eviction for gates Map
- `HOSTS_CAP = 1000` soft cap
- `SWEEP_EVERY = 100` — periodic sweep fires on every 100th `acquireHostGate`
- `isHostIdle(st)` = `inFlight===0 && waiters.length===0 && penaltyUntil<now && rateLimitedUntil<now`
- `evictOneIdleHost()` clears gapTimer/penaltyTimer before Map.delete (no dangling setTimeout refs)
- `sweepIdleHosts()` capped at SWEEP_MAX=200 per call to bound worst-case
- `maybeSweepAndEvict()` is the entry point called from `acquireHostGate`
- New export `hostGateStats()` → `{hosts, cap, sweepEvery}` for observability

## Bug 7 (calibrate Retry-After parseFloat)
Imported `parseRetryAfterHeaderMs` from `./fetcher` (exported at fetcher.ts:944 by Task 2-fetcher,
handles HTTP-date form via Date.parse). Replaced `parseFloat(res.headers.get('retry-after') || '')`
+ `ra * 1000` with `parseRetryAfterHeaderMs(...)` → returns ms directly. HTTP-date Retry-After
(e.g., "Wed, 21 Oct 2025 07:28:00 GMT") now correctly parsed instead of NaN→0.

## Bug 17 (3xx treated as success)
Added `else if (rp.status >= 300 && rp.status < 400) other++` in BOTH `probeLevel` (line ~213)
and `stageVerify` (line ~381). Since `probeFetch` uses `redirect: 'manual'`, any 3xx is an
主动源站 redirect (typically 302 → login/challenge page) — semantically a failure. Updated
comment "2xx/3xx 正常响应" → "2xx 正常响应".

## C3 lockdown (calibrate routes)
Both `parseOpts()` functions reject non-loopback `siteBase` with error:
"校准仅允许指向本地模拟源站(127.0.0.1), 请勿对真实站点校准".
Reused existing `resetBefore` loopback regex (no new regex). For `[id]/calibrate`,
lockdown fires after rule-lookup but BEFORE `runCalibration` is invoked — no probe requests
reach a non-loopback target. Defense-in-depth on top of middleware auth.

## Bug 13 (chapter word boundary)
`/chapter\s*(\d+|[ivxlcdm]+)\b/i` → `/chapter\s*(\d+|[ivxlcdm]+)(?=\D|$)/i`.
`\b` between ASCII digit and following word-char (e.g., "chapter12x") doesn't match (both are
word chars) → entire chapter branch silently failed. `(?=\D|$)` lookahead "non-digit or end"
matches both "Chapter 12 标题" and "chapter12x 番外".

## Bug 14 (standalone-number fallback too strict)
Inserted two more permissive patterns BEFORE the existing strict-separator fallback:
1. `第\s*(\d{1,6})\s*[话回节卷集部篇]` — broader unit set than existing `[章节回集]`,
   catches "第123话" (修前因 话 不在 [章节回集] 失配)
2. `(\d{1,6})\s*[话章回节]` — no 第 prefix, catches "123话" 日漫目录形态
Existing strict `[\s._-](\d{1,6})[\s._-]` separator fallback remains as final兜底.
Order: most specific first.

## Bug 15 (`<br><br>`→`</p><p>` unbalanced)
Added `out = '<p>' + out + '</p>'` BEFORE the `<br><br>` replacement. Now the produced
`</p><p>` boundary is properly paired (outer `<p>` acts as first open + last close).
Existing empty-`<p></p>` cleanup regex (covers `<p>空白/&nbsp;/纯<br></p>`) catches
boundary empties produced by leading/trailing `<br><br>`.
Verified: `<div>line1<br><br>line2</div>` → `<p>line1</p><p>line2</p>` (2 open, 2 close).

## Bug 16 (normalizeUrlKey doesn't sort query)
Parsed URL → sorted `searchParams.entries()` by key (localeCompare) → re-serialized with
`encodeURIComponent(k)=encodeURIComponent(v)`. Same URL with different param order now
dedups. URL parse failure falls back to raw URL (catch unchanged).
Verified via `reorderToc`: items with `?b=2&a=1` and `?a=1&b=2` dedup to length=1.

## Bug 21 (filename slug UTF-16 slice)
Both `saveChapterTxt` (line 35-36) and `downloadTxtTarget` (line 121-122) changed
`title.replace(nonSlugChars, '_').slice(0, N)` (UTF-16 unit slice) to
`Array.from(title.replace(nonSlugChars, '_')).slice(0, N).join('')` (code-point slice).
Astral-plane chars (emoji, CJK ext B+) no longer split into half-surrogate garbage filenames.
Verified: 150-codepoint emoji title → filename preserves full 😀 characters, no U+FFFD.

## Bug 20 (Math.floor(adInterval) turns 0.5 into 0)
Replaced `Math.floor(opts.adInterval)` with `Math.max(1, Math.floor(opts.adInterval))`
so any positive value yields at least 1 (0.5→1, 1.5→1, 2.7→2). Also explicit
`adInterval === 0` branch → `adEvery = 0` (ads off, NOT default 10 as before).
NaN/negative/undefined still fall back to default 10 (preserves prior fix for
"negative → adEvery=1 = every chapter ads" extreme). Insertion site now checks
`adEvery > 0` before `count % adEvery === 0`.

## Bug 28 (final matches finally, complete matches completely)
Introduced `wordMatches(t, w)` helper:
- English words (matched by `/^[a-z]+$/i`) use `\b<word>\b` regex (case-insensitive)
- Chinese words (CJK, no word boundaries) and English phrases with separators
  (`on going`, `on-going`) fall through to `t.includes(w)`
Both `ONGOING_WORDS` and `COMPLETE_WORDS` loops now go through `wordMatches`.
Verified: "finally completed" → completed; "He finally arrived" → unknown (修前 completed);
"completely new" → unknown (修前 completed).

# Verification Results

- `cd /home/z/my-project && bun run lint` → CLEAN (no errors, no warnings)
- `bunx tsc --noEmit | grep -E "crawl/(hostgate|calibrate|parser|cleaner|sorter|storage|downloader|smart)|admin/rules"` → NO ERRORS in target files
  (only pre-existing errors in `examples/` and `skills/` folders, unrelated)
- Offline unit tests:
  * `verify-bugs.ts` — 24/24 passed (Bug 6 + LRU + Bug 13 + Bug 14 + Bug 16 + Bug 15 + Bug 28)
  * `verify-storage.ts` — 6/6 passed (Bug 21 emoji filenames)
  * `verify-downloader.ts` — 14/14 passed (Bug 20 adInterval matrix)
  * `verify-hostgate-lru.ts` — 4/4 passed (1200 hosts → 1 after periodic sweep)
  * Total: 48/48 offline tests passed
- Live API tests (running dev server, admin authed):
  * `/api/admin/rules/calibrate-all` + `{"siteBase":"https://example.com/"}` → 400 lockdown ✓
  * `/api/admin/rules/calibrate-all` + `{"siteBase":"http://127.0.0.1:3040/"}` → 200 idle ✓
  * `/api/admin/rules/calibrate-all` + `{}` (default siteBase) → 200 idle ✓
  * `/api/admin/rules/[real-id]/calibrate` + `{"siteBase":"http://example.com/"}` → 400 lockdown ✓
  * Test rule created and deleted cleanly

# Backward Compatibility

All public function signatures preserved:
- `acquireHostGate(url, opts?)` — same params, behavior changes (LRU sweep on entry, MAX on minGapMs)
- `releaseHostGate(ticket)`, `reportHostSuccess(url)`, `reportHostFailure(url)`,
  `reportHostRateLimited(url, retryAfterMs?)`, `hostGateSnapshot(url)`, `hostGateReset()` — unchanged
- New ADDITIVE export `hostGateStats()` — no caller breakage
- `extractChapterNo(title)`, `extractVolumeAnchor(title)`, `reorderToc(items)`,
  `romanToNumber(s)`, `cnNumToNumber(cn)` — same signatures
- `cleanContentHtml(raw, cfgOverride?)` — same signature (cfg.normalize behavior slightly improved)
- `detectCompleteFromText(text)`, `smartCompleteDetect(input)`, `smartCategory(...)` — unchanged
- `saveChapterTxt(bookId, idx, title, content)`, `saveDownloadTxt(name, content)`,
  `openDownloadTxtWriter(name)`, `downloadTxtTarget(name)` — same signatures
- `generateBookTxt(bookId, optionsOverride, defaultSiteName, defaultSiteUrl)` — same signature
  (adInterval handling improved internally)
- Calibrate route handlers (`POST`/`GET`/`DELETE`) — same HTTP shape; parseOpts adds
  lockdown rejection for non-loopback siteBase

# Overlap Check

- `fetcher.ts` — NOT modified (Task 2-fetcher owns). DID import `parseRetryAfterHeaderMs`
  (a Task 2-fetcher export at line 944) for Bug 7 — additive consumer, no fetcher change.
- `runner.ts`, `obscura.ts`, `types.ts`, `themes.ts`, `suggest.ts` — NOT touched.
- `src/app/api/admin/` routes other than the 2 calibrate routes — NOT touched.
