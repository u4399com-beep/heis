# Task 5-a: Structured Logging + Observability

## Agent
Structured logging + observability

## Task
Add leveled structured logger, wire request IDs into middleware, swap console→logger in API error paths, add /api/admin/health endpoint, complete .env.example operator vars.

## Work Log
- Read prior worklog (Tasks 3-a architecture / 4-a engine bugs / 1-a auth / 1-c mini-services docker / 2-fetcher / 2-runner / 2-obscura / 2-other-engine / 4-b API bugs / 2-api-bugs) for context on file boundaries and prior agent work. Confirmed allowed files: `src/lib/logger.ts`, `src/app/api/admin/health/route.ts` (create); `src/middleware.ts`, `src/app/api/_lib/http.ts`, `.env.example`, `docker-compose.yml` (modify only if needed).
- Read existing `src/middleware.ts` (144 lines, nodejs runtime, token-bucket rate limit + HMAC session verify + 5 security headers); confirmed auth/rate-limit/security-headers logic must be preserved verbatim, only reqId generation + X-Request-Id response header added.
- Read existing `src/app/api/_lib/http.ts` (84 lines, withGuard/errText/clampInt/str/likeSafe/httpUrl/safeJoin); confirmed only 2 console.error lines need swap to logger.
- Read `src/lib/db.ts` (PrismaClient singleton via globalThis), `src/lib/auth.ts` (HMAC-SHA256 session), `src/lib/api.ts` (ok/fail envelopes), `src/app/api/admin/stats/route.ts` + `themes/route.ts` + `settings/route.ts` for admin route pattern (`withGuard` + `ok()` envelope).
- Read `src/lib/crawl/hostgate.ts` to confirm `hostGateStats()` export exists (returns `{hosts, cap, sweepEvery}`).
- Read `src/lib/crawl/runner.ts` top (lines 1-280): `TaskRunner` class, singleton via `globalForRunner.__novelTaskRunner`, `runtimes: Map<string, TaskRuntime>` is `private`. Confirmed cannot modify `runner.ts` (constraint: don't touch `src/lib/crawl/*`). Approach: access via type-erased cast `TaskRunner.instance as unknown as { runtimes?: Map<...> }`.
- Read `mini-services/_shared/server.ts` to confirm `/health` endpoint shape: `{ok, service, port, selfTestOk, upstreamProbe?, ts}`. Mapped mini-service ports: bqg713=3010, fetch-relay=3011, scrapling=3012, qimao=3013, deqixs=3014, xjp=3015 (scrapling is optional).
- Read `Dockerfile`, `install.sh`, `docker-entrypoint.sh`, `docker/autofill.mjs` to enumerate all operator-tunable env vars (DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET, LOG_LEVEL, AUTO_FILL, AUTO_FILL_RULES, HOST_PORT, WAIT_TIMEOUT, REPO_URL, INSTALL_DIR, USE_CN_MIRROR, REGISTRY_MIRRORS, SKIP_REGISTRY_MIRROR, BUN_IMAGE, NODE_IMAGE, PYTHON_IMAGE, NPM_REGISTRY, PIP_INDEX_URL, DEBIAN_MIRROR, PLAYWRIGHT_DOWNLOAD_HOST, BRIDGE_KEY, OBSCURA_CONCURRENCY).
- Read `docker-compose.yml` (126 lines): logging driver `json-file` with `max-size:"20m"`, `max-file:"5"` already present on BOTH `novel-system` (lines 67-72) and `scrapling-bridge` (lines 114-118) services — added by Task 1-c. No changes needed; spec satisfied verbatim.

Implementation:
- **Created `src/lib/logger.ts`** (212 lines):
  - `LogLevel` enum: debug=10, info=20, warn=30, error=40.
  - `Logger` class with `debug/info/warn/error(msg, ctx?)` methods; emits JSON to stdout via `process.stdout.write`.
  - Output shape: `{"ts":"2026-09-06T...Z","level":"info","msg":"...","ctx":{...},"reqId":"..."}` (ctx + bindings merged at top level for log searchability).
  - Recursive redaction: any key matching `/password|secret|token|cookie|authorization|api[-_]?key/i` → `"[REDACTED]"`. Depth cap at 3 (only object/array recursions count; scalars preserved at any depth to avoid losing diagnostic fields). Circular-reference safe via WeakSet (returns `"[circular]"`). Error instances folded to `{name, message, stack:500}`. Strings > 4096 chars truncated. Arrays capped at 100 elements.
  - `setLevel(level)` + `getLevel()`. Default level: `LOG_LEVEL` env var if set, else dev=debug, prod=info.
  - `withReqId(reqId)` → child logger with `reqId` binding. `child(bindings)` → child logger with merged bindings (bindings also redacted).
  - `globalThis.__heisLogger` singleton (HMR-safe; dev module reload returns existing instance, preserves level/bindings).
  - Exports: `logger` (root), `setLogLevel`, `withReqId`, `child`, `LogLevel` enum, `Logger` class.
  - Zero dependencies (only `process.stdout`, `JSON.stringify`, `Date`, `WeakSet` builtins).

- **Modified `src/middleware.ts`** (144 → 167 lines, +23):
  - Added `import { withReqId } from '@/lib/logger'`.
  - Top of `middleware()`: generate reqId from `x-request-id` request header (sliced to 64 chars) or fallback `crypto.randomUUID().slice(0, 8)`.
  - Create child logger via `withReqId(reqId)` + debug log of incoming request (method/path/ip — IP not in sensitive regex).
  - `applyHeaders()` signature changed: now `(res, isHtml, reqId)` — sets `X-Request-Id` response header on ALL responses (auth fail, rate-limit, success). All 4 call sites updated.
  - Forward reqId to downstream request headers via `NextResponse.next({ request: { headers: forwardHeaders } })` so API route handlers can read `req.headers.get('x-request-id')` for request-scoped logging.
  - Existing auth (HMAC verifySession), rate-limit (token bucket), security headers, CSP — all preserved verbatim. reqId is additive.

- **Modified `src/app/api/_lib/http.ts`** (84 → 92 lines, +8):
  - Added `import { logger } from '@/lib/logger'`.
  - `withGuard` catch: `console.error('[api] unhandled error:', e?.message || e)` → `logger.error('api unhandled error', { err: e?.message, stack: e?.stack?.slice(0,500), code: e?.code })`.
  - `errText` fallback: `console.error('[api] batch item error:', ...)` → `logger.warn('batch item error', { err: (e as any)?.message, code: (e as any)?.code })`.
  - Sensitive fields auto-redacted by logger (no explicit handling needed).

- **Created `src/app/api/admin/health/route.ts`** (210 lines):
  - GET endpoint, admin-authed (passes through middleware `/api/admin/*` rate-limit + session verify).
  - Returns envelope `{ ok: true, data: { status, uptime, db, runner, hostGate, services, memory, reqId } }`.
  - DB check: `db.$queryRaw\`SELECT 1\`` — fail → status="unhealthy".
  - Runner check: type-erased access to `TaskRunner.instance.runtimes` (private Map). Returns `{activeTasks, runtimes}` where activeTasks counts `running===true`.
  - HostGate check: `hostGateStats()` (Task 2-other-engine export) — narrowed to `{hosts}`.
  - Services: concurrent `Promise.all` of 6 probes (bqg713:3010, fetch-relay:3011, scrapling:3012[optional], qimao:3013, deqixs:3014, xjp:3015). Each probe: `fetch("http://127.0.0.1:{port}/health", {signal: AbortController, 1s timeout})`. Returns `{reachable, selfTestOk?, note?}`.
  - Memory: `process.memoryUsage()` → `{rss, heapUsed, heapTotal}`.
  - Status logic: unhealthy if DB fail; degraded if any required service down OR scrapling (optional) down; healthy otherwise.
  - 10s cache via `globalThis.__heisHealthCache` (avoids hammering on dashboard refresh). Cache hit logs debug, miss logs info with status.
  - reqId from `req.headers.get('x-request-id')` injected into response data (matches middleware X-Request-Id header).
  - Uses child logger `logger.withReqId(reqId)` for health-specific logs.

- **Updated `.env.example`** (9 lines → 73 lines, +64):
  - Kept DATABASE_URL, ADMIN_PASSWORD (with example value `audit-fix-2025` per spec), SESSION_SECRET.
  - Added LOG_LEVEL=info (with level semantics comment).
  - Added full install.sh vars (AUTO_FILL, AUTO_FILL_RULES, HOST_PORT, WAIT_TIMEOUT, REPO_URL, INSTALL_DIR, USE_CN_MIRROR, REGISTRY_MIRRORS, SKIP_REGISTRY_MIRROR) — all commented-out with defaults.
  - Added Docker build args (BUN_IMAGE, NODE_IMAGE, PYTHON_IMAGE, NPM_REGISTRY, PIP_INDEX_URL, DEBIAN_MIRROR, PLAYWRIGHT_DOWNLOAD_HOST) — commented-out with examples.
  - Added BRIDGE_KEY (mini-services bridge auth, commented-out).
  - Added OBSCURA_CONCURRENCY=2 (engine tuning, commented-out).
  - Each var has inline Chinese comment explaining purpose.

- **Verified `docker-compose.yml`** — both `novel-system` (lines 67-72) and `scrapling-bridge` (lines 114-118) services already have:
  ```yaml
  logging:
    driver: json-file
    options:
      max-size: "20m"
      max-file: "5"
  ```
  Added by Task 1-c. No changes needed (would have been duplication).

## Verification
- `cd /home/z/my-project && bun run lint` → clean (no errors, no warnings).
- `cd /home/z/my-project && bunx tsc --noEmit 2>&1 | grep -v "examples\|skills"` → clean (no errors in src/). One initial tsc error in `logger.ts:53` (TS narrowing via intermediate `const t = typeof value` variable doesn't narrow `value`) fixed by using `const s = value as string` local.
- Dev server compiles cleanly; no regression in existing routes (POST /api/auth/login 200, GET /api/admin/rules 200, etc. all still pass).
- **Live health endpoint test** (after login):
  ```
  $ curl -b cookies.txt http://127.0.0.1:3000/api/admin/health
  {"ok":true,"data":{"status":"degraded","uptime":6614,"db":"ok",
   "runner":{"activeTasks":0,"runtimes":0},"hostGate":{"hosts":0},
   "services":{"bqg713":{"reachable":false},"fetch-relay":{"reachable":false},
   "scrapling":{"reachable":false,"note":"optional"},
   "qimao":{"reachable":false},"deqixs":{"reachable":false},"xjp":{"reachable":false}},
   "memory":{"rss":872001536,"heapUsed":187059640,"heapTotal":222400512},
   "reqId":"6604b815"}}
  ```
  Status "degraded" is correct — DB ok, but 5 required mini-services not running in dev (expected). Optional scrapling has `note:"optional"`.
- **Request ID round-trip test**:
  - Default: `X-Request-Id: aa4ef31d` (8-char UUID prefix from middleware).
  - With `x-request-id: custom-req-id-123` request header → response `X-Request-Id: custom-req-id-123` AND `data.reqId` matches.
- **Logger JSON output** (captured in dev.log):
  ```
  {"ts":"2026-09-06T09:24:34.103Z","level":"debug","msg":"incoming request",
   "ctx":{"method":"POST","path":"/api/auth/login","ip":"::ffff:127.0.0.1"},
   "reqId":"223f1a92"}
  ```
- **Redaction unit verification** (via bun -e):
  - Sensitive keys (`password`, `api_key`, `apiKey`, `token`, `cookie`, `secret`) → `"[REDACTED]"` at all depths.
  - Non-sensitive scalars at depth 4+ → preserved (`value:"ok"`, `keep:42`).
  - Circular reference → `"[circular]"`.
  - Error instance → folded to `{name, message, stack}`.

## Stage Summary
- **Files created (2)**:
  - `src/lib/logger.ts` (212 lines) — leveled structured logger, HMR-safe singleton, recursive redaction, child/withReqId bindings, zero deps.
  - `src/app/api/admin/health/route.ts` (210 lines) — admin-authed health endpoint with DB/runner/hostGate/services/memory checks, 10s cache, degraded/healthy/unhealthy status.
- **Files modified (3)**:
  - `src/middleware.ts` (+23 lines) — reqId generation + X-Request-Id response header + forward to downstream request headers + debug log of incoming request.
  - `src/app/api/_lib/http.ts` (+8 lines, -2 console.error lines) — withGuard catch + errText fallback swap to logger.error/warn with err/stack/code fields.
  - `.env.example` (9 → 73 lines) — added LOG_LEVEL + full install.sh vars + Docker build args + BRIDGE_KEY + OBSCURA_CONCURRENCY with inline comments.
- **Files verified, no changes needed (1)**:
  - `docker-compose.yml` — logging driver `json-file` with `max-size:"20m"`, `max-file:"5"` already present on both services (Task 1-c).
- **Tests**:
  - `bun run lint` clean.
  - `bunx tsc --noEmit` clean in src/ (only pre-existing errors in examples/ + skills/ excluded per spec).
  - Live: /api/admin/health returns correct envelope with status="degraded" (DB ok, 5 required services down as expected in dev without mini-services started).
  - X-Request-Id header round-trips correctly (auto-generated UUID short form OR forwarded from x-request-id request header).
  - Logger JSON shape verified in dev.log (ts/level/msg/ctx/reqId all present).
  - Redaction verified: sensitive keys redacted at any depth, scalars preserved at depth >3, circular refs detected.
- **Backward compatibility**:
  - All public API signatures preserved (withGuard/errText/clampInt/str/likeSafe/httpUrl/safeJoin unchanged).
  - Middleware auth/rate-limit/security-headers/CSP unchanged — reqId is purely additive.
  - .env.example existing values (DATABASE_URL/ADMIN_PASSWORD/SESSION_SECRET) preserved; new vars are all commented-out optional with documented defaults.
- **Constraint compliance**:
  - Did NOT touch `src/lib/crawl/*`, `src/components/*`, `prisma/*`, `mini-services/*`, `Dockerfile`, `docker-entrypoint.sh`, `install.sh`, other `src/app/api/admin/**` routes (only added new health route).
  - Only modified allowed files. All changes additive (no breaking changes).
