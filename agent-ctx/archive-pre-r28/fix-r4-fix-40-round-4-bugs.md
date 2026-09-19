# fix-r4 — Round-4 Bug Fixes Worklog

Task ID: fix-r4
Agent: Fix 40 round-4 bugs (engine 22 + API/frontend 18)
Scope: per spec, modify `src/lib/crawl/*`, `src/app/api/**`, `src/lib/{auth,api,links,logger}.ts`, `src/proxy.ts`, `src/components/**`, `Caddyfile`.

## Engine bugs (22)

- R4-1 fetcher.ts token cache stampede: add `tokenInflight: Map<string, Promise<string>>`; concurrent misses share the in-flight promise.
- R4-2 fetcher.ts native fetch OOM: stream-read `res.body` with running byte counter, abort if > 10MB (matches curl path).
- R4-3 fetcher.ts proxy no backoff: track `consecutiveFailures`, cooldown = `min(300s, 30s * 2^failures)`.
- R4-4 fetcher.ts relayHop OOM: check Content-Length before `res.json()`; reject if > 20MB.
- R4-5 fetcher.ts fetchBinary cookies lost: call `cookieJar.store(originHost(hopUrl), setCookies)` after each redirect hop.
- R4-6 fetcher.ts single-quote token: regex alternation for `"`, `'`, `` ` ``.
- R4-7 fetcher.ts domainUa HMR: bump key to `__novelDomainUa_v3` + shape guard.
- R4-8 runner.ts control() timeout race: post-timeout re-read task status; skip late write if a newer control op mutated state.
- R4-9 runner.ts category P2002: try/catch around upsert, re-find by name on P2002.
- R4-10 runner.ts bookTag race: on P2002 re-find by `(bookId, tag)` and continue.
- R4-11 runner.ts existChapters memory: select only `{ id, url, title, idx, volume, fetched }` (already minimal); cap with take.
- R4-12 obscura.ts slot orphan leak: in `withObscuraPage`, after acquiring slot, check `S.shuttingDown`; if true, close slot ctx and throw.
- R4-13 obscura.ts turnstile deadline: 8s overall deadline in `tryClickTurnstile`.
- R4-14 hostgate.ts minGapMs poison: track `minGapMsEpoch` per host; reset on new epoch.
- R4-15 hostgate.ts hostGateReset waiter leak: iterate waiters, clearTimeout, reject with reset error.
- R4-16 calibrate.ts SSRF: call `assertSafeTarget(siteBase + '/...')` before probe fetches.
- R4-17 calibrate.ts timeout=0: use `timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 10_000`.
- R4-18 parser.ts jsonGet &-split: split on `]` and `[` boundaries.
- R4-19 parser.ts applyTransform ReDoS: length cap (1000) + nested-quantifier gate + 100ms execution budget.
- R4-20 cleaner.ts plainText script leak: remove `<script>/<style>/<noscript>/<iframe>/<object>/<embed>` tags AND content before tag-strip.
- R4-21 cleaner.ts t2s homograph bypass: in catch block, `continue` instead of falling through to `set.add(ch)`.
- R4-22 types.ts smuggling headers: blacklist `host`, `content-length`, `transfer-encoding`, `connection`, `upgrade`, `te`, `trailer`, `expect` in `safeHeaderKey`.

## API/Frontend bugs (18)

- R4A-1 login route XFF bypass: prefer `req.ip` over XFF.
- R4A-2 feedback route XFF bypass: prefer `req.ip` over XFF.
- R4A-3 backup restore XSS: run `cleanContentHtml(String(c.content))` before upsert.
- R4A-4 public/book unbounded skip: cap `effectiveSkip = Math.min((tocPage-1)*tocSize, 10000)`.
- R4A-5 admin toc unbounded skip: cap at 10000.
- R4A-6 shared.tsx read-side sanitize: regex strip `<script>`, `<iframe>`, `on*` attrs, `javascript:` URLs.
- R4A-7 links.ts N+1 query: single `findMany({ take: need*3, orderBy: { wordCount: 'desc' } })` + Fisher-Yates shuffle + dedupe.
- R4A-8 Caddyfile open-proxy SSRF: whitelist specific ports 3010-3015.
- R4A-9 restore no body limit: check Content-Length, reject > 200MB with 413.
- R4A-10 restore content no cap: `String(c.content).slice(0, 500_000)`.
- R4A-11 t2s unbounded loop: per-book chapter cap 5000.
- R4A-12 backup export OOM: lower BIG_BOOKS_THRESHOLD to 200; stream chapters in batches of 50.
- R4A-13 sitemap unbounded query: reduce PAGE_SIZE to 5000; add 5min server cache.
- R4A-14 auth.ts null payload: add `if (parsed === null || typeof parsed !== 'object') return false`.
- R4A-15 health probe body cap: check Content-Length; cap at 64KB.
- R4A-16 rules batch dead catch: remove P2005 branch from deleteMany catch.
- R4A-17 t2s file-write race: write to temp file, atomic rename after DB update.
- R4A-18 restore transaction timeout: `db.$transaction(async (tx) => {...}, { timeout: 600_000, maxWait: 30_000 })`.

## Verification

- `bun run lint` = 0 errors, 0 warnings (target).
- `bunx tsc --noEmit` (filtering examples/skills) = 0 errors.
- Dev server `/` returns 200.
