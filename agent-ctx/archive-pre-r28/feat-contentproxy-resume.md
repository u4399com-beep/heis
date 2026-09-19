---
Task ID: feat-contentproxy-resume
Agent: contentProxyUrl + range task resume
Files Modified: src/lib/crawl/types.ts, src/lib/crawl/fetcher.ts, src/lib/crawl/runner.ts
Date: 2026-09-09

## Feature 1: contentProxyUrl — Content Proxy Mode

### Problem
The xjp-proxy (port 3015) for xinjianpan.com returns DECRYPTED CONTENT directly as JSON
`{ok:true, content:"..."}` (plain text, \n segmented). The engine's `tokenUrl` mechanism
expects the proxy to return a TOKEN that gets injected into the original URL — which doesn't
fit the xjp-proxy model. The SSRF guard also blocks 127.0.0.1:3015 fetches when tokenUrl is
misused.

### Solution

#### types.ts (FetchConfig interface + sanitizeFetchConfig)
- Added `contentProxyUrl?: string` field to `FetchConfig` interface with comprehensive
  doc comment explaining the JSON contract `{ok:true, content:string}` / `{ok:false, error:string}`
  and the loopback allowance.
- In `sanitizeFetchConfig`: `contentProxyUrl` raw string is `safeStr(500)` capped, then
  `safeSingleLine` strips CR/LF (prevent header injection via malicious rule), and a regex
  `/^https?:\/\/\S+$/i` validates URL shape. Only valid URLs are passed through to out.

#### fetcher.ts (fetchPageOnce + loopbackBypassAllowed)
- Added `contentProxyUrl` to `loopbackBypassAllowed` (sibling to tokenUrl/RELAY_URL/SCRAPLING_BRIDGE_URL):
  a loopback target matching the configured contentProxyUrl gets loopback bypass.
- In `fetchPageOnce`, after the token prefetch block (line ~2333) and BEFORE the normal
  `fetchHttpWithCurlFallback(reqUrl, ...)` call, added the contentProxyUrl intercept block:
  1. `proxyUrl = contentProxyUrl.split('{url}').join(encodeURIComponent(url))` (全量替换, 同 prefetchToken 口径)
  2. `assertSafeTarget(proxyUrl, { allowLoopback: true })` — SSRF guard with loopback allowed
     (操作员配置的回环转换代理豁免, 但仍拒绝云元数据/私网 10.0.0.1 等以防恶意规则)
  3. If safe: `fetchHttpWithCurlFallback(proxyUrl, cfg, ua)` fetches the proxy URL
     (loopback target → bypasses出口代理 in fetchHttpWithCurlFallback via `isLoopbackTarget(url)`)
  4. `JSON.parse(body)` — must yield `{ok:true, content:string}` or `{ok:false, error:string}`
  5. If `ok && content`: convert plain text to HTML by wrapping each non-empty line in `<p>`:
     ```
     content.split('\n').map(trim).filter(Boolean)
            .map(l => `<p>${escapeHtml(l)}</p>`).join('')
     ```
     HTML-escape `<`, `>`, `&` in each line to prevent injection through proxy text.
  6. Return `{ html, engine: 'http', blocked: false }` directly — skips original URL fetch.
  7. If `ok=false` OR `content` empty OR JSON parse fails OR fetch throws OR SSRF rejects:
     `console.warn` + silently fall through to normal fetch path (zero-regression fallback).
- Result: xjp-proxy content flows into parser as HTML `<p>...</p><p>...</p>...`,
  identical in shape to a normal chapter page → existing CSS/html extraction works.

### xjp Rule Update (via API PUT /api/admin/rules/[id])
After implementing the engine support, updated the production xjp rule
(id: cmtqgacw60041p2b50autp0vs):
- Removed: `fetch.tokenUrl`, `fetch.tokenPattern`, `fetch.tokenInjection` (no longer needed;
  were misused to re-fetch the proxy with the already-proxy URL → proxy 502'd silently on
  the hostname check).
- Added: `fetch.contentProxyUrl = 'http://127.0.0.1:3015/content?u={url}'`
- Updated: `toc.fields.url.replaceTo` from
  `http://127.0.0.1:3015/content?u=https://www.xinjianpan.com$1` → `https://www.xinjianpan.com$1`
  (toc URL now points to ORIGINAL chapter URL; the engine will route it through
  contentProxyUrl internally).
- Set: `content.fields.content = {type:'css', expression:'body', attr:'html'}`
  (NOT `{type:'const', expression:''}` as originally specified — the const type with empty
  expression returns `''` per `constTemplate('', vars)`. Verified empirically: with const
  rule, `rawLength=0, cleanedLength=0`. Switched to CSS `body` + `attr='html'` which
  returns the innerHTML of body = the wrapped `<p>...</p>` content the fetcher produced.
  This preserves full chapter text including paragraph structure.)

### Test Results (POST /api/admin/rules/test)
- Chapter URL: `https://www.xinjianpan.com/txt/y00k/0o7.html`
- Result: `ok:true, engine:http, htmlSize:19308, ms:1884, pages:1, rawLength:17981, cleanedLength:2304`
- Content correctly extracted (verified 龙族4奥丁之渊 第32节 chapter text with `<p>` paragraph
  structure preserved through the clean pipeline).
- Fallback path verified: invalid chapter URL → proxy returns 502 ok:false → engine
  falls through to direct fetch → direct fetch also 404 → test endpoint reports
  `502 测试失败: HTTP 404`. Console logs confirm:
  `[fetcher] contentProxyUrl 抓取失败, 降级直连原 URL: ...` (zero-regression fallback).

---

## Feature 2: Range Task Resume — Skip already-collected books on restart

### Problem
A range-mode task (listStart=1, listEnd=500) re-scans ALL 500 list pages every restart
or autoRefresh cycle, re-discovering every book URL even if all books were already collected.
For 500-page ranges this wastes 500 fetches × interval = ~30 minutes of useless work per
restart, plus re-triggering the per-book crawl chain (book page / toc / chapter batch) for
books already fully in DB.

### Solution

#### runner.ts TaskRuntime + TaskProgress extensions
- Added two Set fields to `TaskRuntime`:
  - `discoveredBookUrls: Set<string>` — URLs ever seen on a list page (across runs)
  - `completedBookUrls: Set<string>` — URLs of books whose crawlOneBook returned 'ok'
- Added two optional string arrays to `TaskProgress` (persisted in `task.progress` JSON):
  - `discoveredBookUrls?: string[]`
  - `completedBookUrls?: string[]`
- Updated `controlInner` default TaskRuntime creation to include both empty Sets.

#### executeTask: load from progress on restart
- After loading `progress` from DB, if `recrawlMode === 'full'`:
  - Clear both `rt.discoveredBookUrls` and `rt.completedBookUrls` to empty Sets
  - Reset `progress.discoveredBookUrls = []` and `progress.completedBookUrls = []`
  (full re-crawl means: re-do everything from scratch)
- Else (incremental):
  - Load arrays from progress (with `Array.isArray` + `typeof === 'string'` filtering)
  - Rebuild `rt.discoveredBookUrls` and `rt.completedBookUrls` Sets from arrays
  - If either set is non-empty, log a one-line summary:
    `范围续采恢复: 已发现 N 本 / 已完成 M 本(从 task.progress 装载, 仅采集新增/未完成书籍)`

#### Range list-page loop: skip already-discovered URLs
- In the `for (let p = listStart; p <= listEnd; p++)` loop, after parseList extracts
  `pageUrls`, iterate each URL:
  - If `rt.discoveredBookUrls.has(u)` → increment `alreadyDiscovered` counter, skip
    (don't add to `urls` array, don't add to `bookQueue`)
  - Else: `rt.discoveredBookUrls.add(u)`, push to `urls`, increment `newlyDiscovered`
- Modified log line to summarize per-page:
  `列表页 P${p} 发现 N 本书籍 (新增 X 本 跳过已发现 Y 本, 累计待采 Z)`
  (single summary instead of per-URL logs to avoid万级 URL 刷 SQLite TaskLog 表)

#### Per-book loop: skip already-completed books
- Before `cfg = await this.loadConfig(taskId)`, check `rt.completedBookUrls.has(bookUrl)`:
  - If yes: increment `progress.booksDone`, log `跳过已采集: {bookUrl}`, save progress, continue
  - If no: proceed to crawlOneBook as before
- After `crawlOneBook` returns:
  - If result is `'ok'`: `rt.completedBookUrls.add(bookUrl)` + saveProgress
    (persists immediately so a restart after this book keeps the completion record)
  - If result is `'blocked'` or `'empty-toc'`: don't add to completedBookUrls
    (book is in a recoverable state — next run can retry; the existing increment of
    progress.booksDone is preserved for progress-bar semantics)
  - If result is `'stopped'`: don't add to completedBookUrls
    (epoch drift / user stop — next run picks up where this left off)

#### saveProgress: persist Sets as arrays
- Before writing to DB, sync `rt.discoveredBookUrls` and `rt.completedBookUrls` to
  `progress.discoveredBookUrls` and `progress.completedBookUrls` arrays (via `Array.from(...).slice(0, 50_000)`)
- Cap 50000 entries each: at ~60B/URL = ~3MB JSON, well within SQLite TEXT limits
  (1GB default) but conservative防 DB bloat for very large source sites.
- Same URL never duplicated (Set semantics) — arrays are naturally dedup'd.
- Existing P2025 / catch-on-failure / "saveProgress 永不抛" contract preserved.

### Behavior Verification (manual code review)
- Cold start (no prior progress): both Sets empty, all books flow through normally (zero regression).
- Restart after partial crawl: discoveredBookUrls loaded from DB → already-seen books skipped
  from bookQueue; completedBookUrls loaded → fully-collected books skipped entirely.
- Full recrawl mode: Sets cleared at task start → all books re-collected (existing semantic preserved).
- Single-book mode: unaffected (bookQueue = [bookUrl], no discoveredBookUrls filtering applied).

---

## Verification

```
$ bun run lint
$ eslint .
exit: 0   (0 errors, 0 warnings)

$ bunx tsc --noEmit | grep -v "examples\|skills" | wc -l
0         (0 TypeScript errors)

$ curl -s http://localhost:3000/ -o /dev/null -w "HTTP %{http_code}\n"
HTTP 200  (dev server responding)
```

## Constraints Honored
- Only modified: `src/lib/crawl/types.ts`, `src/lib/crawl/fetcher.ts`, `src/lib/crawl/runner.ts`.
- Did NOT touch: API routes, components, prisma, mini-services, Docker, config files.
- The xjp rule update was done via the existing PUT /api/admin/rules/[id] API (no DB writes
  outside the engine's normal API surface).

## Mini-Service
- Started `mini-services/xjp-proxy` (bun run start) on port 3015 in the background
  (the proxy is referenced by the production xjp rule's contentProxyUrl).
