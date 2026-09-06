# Task ID: 1-c · Mini-services & Docker hardening

## Files created

### `mini-services/_shared/` (new shared library, 3 files)
- `mini-services/_shared/package.json` — `{name:"heis-mini-shared", private:true, version:"1.0.0"}`,
  no deps (only `node:crypto` + Bun built-ins).
- `mini-services/_shared/server.ts` — exports:
  - `json(data, status=200)` — JSON response helper (replaces per-service `json()`).
  - `safeHeaderKey(k)` — RFC 7230 token whitelist (returns `''` for invalid), ported from
    `fetch-relay/index.ts`.
  - `safeHeaderValue(v)` — strips CR/LF/NUL, slices 8192, ported from `fetch-relay/index.ts`.
  - `constantTimeEqual(a, b)` — uses `crypto.timingSafeEqual`; length-mismatch path still
    does a dummy compare to keep timing uniform (mitigates length-leak timing side-channel).
  - `createBridgeServer({ name, port, idleTimeoutS=120, fetch, selfTest?, healthCheck? })` —
    Bun.serve factory:
      - **HARD `hostname: '127.0.0.1'`** (fixes H4 — Bun default was `0.0.0.0`).
      - Default `idleTimeout=120s` (Bun default ~10s kills in-flight requests; ss-d documented).
      - Auto-mounts `/health` returning `{ ok:true, service, port, selfTestOk, upstreamProbe?, ts }`
        (runs `selfTest` if provided, runs `healthCheck` if provided).
      - **`BRIDGE_KEY` env-gated auth**: if `process.env.BRIDGE_KEY` is set, every
        non-`/health` request must include header `X-Bridge-Key: <value>` (constant-time
        compare) or return `401 {ok:false, error, code:"BRIDGE_KEY_REQUIRED"}`. Lets
        operators lock down bridges in multi-host setups; single-host dev stays zero-config.
      - Accurate startup banner: `[{name}] listening on http://127.0.0.1:{port} (/health[ + X-Bridge-Key 闸门])`.
      - Returns the `Bun.Server` instance for advanced callers.
- `mini-services/_shared/tsconfig.json` — minimal, `types:["bun-types"]`, `target:"es2022"`,
  `strict:true`, `module:"esnext"`.

### Other
- `agent-ctx/1-c-mini-services-docker.md` — this file (work record).

## Files modified

### 5 Bun mini-services refactored to use `_shared`
Each keeps **ALL existing business logic intact** (AES/sign/decrypt logic, route handlers,
self-test vectors). Only `Bun.serve()` boilerplate + local `json()` helper + inline `/health`
handler were deleted and replaced with `createBridgeServer({...})` call. Relative import
`'../_shared/server'` (no package.json deps change — keeps each service standalone-runnable).

- `mini-services/bqg713-proxy/index.ts` (port 3010)
  - Removed local `json()` and inline `/health` block.
  - `selfTest` wired as factory callback (AES token vector `id=2530,chapterid=1`).
  - Kept `/rewrite` + `/token` routes (no business logic change).
  - `idleTimeoutS: 30` (preserves prior value).
- `mini-services/fetch-relay/index.ts` (port 3011)
  - Removed local `safeHeaderKey`/`safeHeaderValue` (now imported from `_shared`).
  - Removed local `/health` block, `HOST` const (no longer needed), trailing `console.log`.
  - Kept `readBodyCapped`, `readRequestCapped`, `safeHostPath`, `/fetch` route intact.
  - `idleTimeoutS: 200` (preserves prior value — covers 120s timeout + 20MB base64 reassembly).
- `mini-services/qimao-proxy/index.ts` (port 3013)
  - Removed local `json()` and inline `/health` block (the inline health probe with 60s
    cache + `healthProbe` Promise de-dup is now in `healthCheck()` callback).
  - `selfTest: aesRoundtripSelfTest` (AES-128-CBC roundtrip vector).
  - Kept all `/search` `/rank` `/detail` `/toc` `/content` routes + sign/decrypt logic.
  - `idleTimeoutS: 120`.
- `mini-services/deqixs-proxy/index.ts` (port 3014)
  - Removed local `json()` and inline `/health` block (3-stage deqixs probe with 60s cache
    moved to `healthCheck()`).
  - `selfTest: () => st.ok` (the 5-stage GBK/three-param/JSON/HTML/URL vector).
  - Kept `fetchContent` chain + GBK codec + chapter.js.php token extraction intact.
  - `idleTimeoutS: 120`.
- `mini-services/xjp-proxy/index.ts` (port 3015)
  - Removed local `json()` and inline `/health` block.
  - `selfTest: () => st.ok` (4-stage: synthetic-c-roundtrip / n-bound-reject /
    HTML→text / chapter-extract).
  - Kept `safeDecryptC`, `extractChapterInner`, `htmlToText`, `fetchContent` intact.
  - `idleTimeoutS: 120` (preserved as `IDLE_TIMEOUT_S`).

### Dockerfile (`Dockerfile`)
- Runner stage: added `RUN groupadd -r -g 1001 app && useradd -r -u 1001 -g app -m -d /app -s /usr/sbin/nologin app`
  **before** the COPY commands (so chown can be done once at the end).
- Added `COPY --from=builder /app/mini-services/_shared ./mini-services/_shared` next to
  the 5 existing proxy COPYs (proxies now import from this).
- Added `RUN chown -R app:app /app` + `USER app` after all COPY/mkdir, before EXPOSE.
- Added `HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD node -e "..."`
  so the image is self-contained (compose healthcheck still overrides).

### `docker-entrypoint.sh` (POSIX sh)
- Added `/app/db` writability precheck at top (after `set -e`, before mkdir): if
  `/app/db` is not writable (uid 1001 mismatch on bind mount), echo clear warning +
  the `chown -R 1001:1001 ./db ./data` instruction. Non-fatal (let prisma fail with
  clearer `SQLITE_READONLY` later).
- **Replaced `(... &)` bare backgrounding with `spawn()` helper** that records each child
  PID in `$CHILDREN`. `start_proxy` now uses `spawn sh -c "... bun run start ..."` instead
  of `( cd ... & )`.
- **Replaced `exec node server.js` with `node server.js &` + `MAIN=$!`**. This keeps the
  shell as PID 1 so SIGTERM/SIGINT traps actually fire (the historical `exec` replaced
  the shell with node, orphaning all mini-service children that node doesn't forward
  signals to — this was the H7 fix).
- Added `trap` for TERM/INT that:
  1. `kill -TERM $MAIN $CHILDREN` (forward signal to node + all proxies)
  2. `wait $MAIN` (let node finish graceful shutdown)
  3. `kill -TERM $CHILDREN` again (paranoid re-kill any stragglers)
  4. `wait` (reap all)
  5. `kill 0` (fallback: kill whole process group, prevents zombie proxies)
  6. `exit 0`
- After main exits naturally, same `kill -TERM $CHILDREN; wait` to clean up proxies.
- `sh -n docker-entrypoint.sh` passes (POSIX-sh syntax-clean).

### `docker-compose.yml`
- `novel-system` service:
  - Added `security_opt: ["no-new-privileges:true"]` (no setuid escalation).
  - Added `cap_drop: ["ALL"]` (node/bun needs no Linux capabilities).
  - Added `logging: { driver: json-file, options: { max-size: "20m", max-file: "5" } }`
    (fixes H6 — was unbounded json-file growth).
  - Existing healthcheck kept (compose overrides Dockerfile HEALTHCHECK).
  - Added comment block above `volumes:` documenting `sudo chown -R 1001:1001 ./db ./data`.
- `scrapling-bridge` service:
  - Added `security_opt: ["no-new-privileges:true"]`.
  - Added `cap_drop: ["ALL"]` + `cap_add: ["SYS_ADMIN"]` (patchright chromium sandbox
    requires namespace setup; document that if `--no-sandbox` is wired up in server.py,
    SYS_ADMIN can be dropped — left as future-pass).
  - Added `logging: { driver: json-file, options: { max-size: "20m", max-file: "5" } }`.
  - Added `healthcheck` hitting `/health` via `python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3012/health')"`.

### `DEPLOY.md`
- Replaced stale "no auth" warning with current state (1-a added `ADMIN_PASSWORD`).
- Added new section "二·五、容器以非 root 运行（1-c 安全加固）" between install and FAQ,
  documenting the `chown 1001:1001 ./db ./data` requirement, the entrypoint `/app/db`
  precheck, two opt-out escape hatches (with `不推荐` warnings), and the optional
  `BRIDGE_KEY` shared-secret gate for multi-host deployments.

## Verification

### Bind to 127.0.0.1 (H4 fix)
All 5 services bound to `127.0.0.1` confirmed via `ss -tlnp`:
```
bqg713-proxy :3010  LISTEN 0 512  127.0.0.1:3010
fetch-relay  :3011  LISTEN 0 512  127.0.0.1:3011
qimao-proxy  :3013  LISTEN 0 512  127.0.0.1:3013
deqixs-proxy :3014  LISTEN 0 512  127.0.0.1:3014
xjp-proxy    :3015  LISTEN 0 512  127.0.0.1:3015
```
(Prior to 1-c, all but `fetch-relay` were `0.0.0.0` — Bun's default when `hostname` is
omitted. The shared `createBridgeServer` factory hard-codes `hostname: '127.0.0.1'`.)

### Self-tests still PASS (business logic intact)
- `bqg713-proxy` self-test(id=2530,chapterid=1): PASS
- `qimao-proxy` self-test(AES-128-CBC 回环): PASS
- `deqixs-proxy` self-test: PASS (GBK解码/三参数提取/GBK-JSON解析/HTML→文本(含双解码)/URL解析 6项全过)
- `xjp-proxy` self-test: PASS (合成c回环/n越界拒绝/HTML→文本/章节抽取 4项全过)
- `fetch-relay`: no self-test vector by design (stateless relay).

### /health endpoint shape (deqixs-proxy example, with upstreamProbe)
```
$ curl -s http://127.0.0.1:3014/health
{
  "ok": true,
  "service": "deqixs-proxy",
  "port": 3014,
  "selfTestOk": true,
  "ts": "2026-09-06T07:08:13.863Z",
  "upstreamProbe": { "upstreamReachable": true, "upstream": 200 }
}
```
Matches the spec `{ ok:true, service, port, selfTestOk, upstreamProbe?, ts }`.

### BRIDGE_KEY gate (functional test on bqg713-proxy)
With `BRIDGE_KEY=test-secret-123`:
- `/health` no header → 200 (gate exempt)
- `/rewrite?url=...` no header → 401 `{ok:false, error:"missing or invalid X-Bridge-Key", code:"BRIDGE_KEY_REQUIRED"}`
- `/rewrite?url=...` wrong header → 401
- `/rewrite?url=...` correct header → passes gate, falls through to business logic (404 because the curl test URL was missing `chapterid` due to shell `&` parsing — that's a test harness issue, not a service issue)

### Type & lint
- `bun run lint` (root) → clean (no errors, no warnings)
- `bunx tsc --noEmit` in each of: `_shared`, `bqg713-proxy`, `fetch-relay`, `qimao-proxy`, `deqixs-proxy`, `xjp-proxy` → all exit 0
- `sh -n docker-entrypoint.sh` → clean
- `python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))"` → clean

## Notes for other agents
- **Do NOT add `mini-services/_shared` to per-service `package.json` deps** — kept
  standalone via relative import `'../_shared/server'`. Bun resolves TS-to-TS relative
  imports natively without package linking.
- The shared `/health` schema is now `{ ok, service, port, selfTestOk, upstreamProbe?, ts }`.
  The previous per-service shapes had slight variations (e.g. `bqg713` used `now` instead
  of `ts`; `qimao` had a flat `apiReachable` field). The 1-c refactor normalizes all to
  the same shape; downstream consumers (engine health poll, monitor scripts) should be
  checked. As of this task, no `src/` consumer reads these fields directly (engine uses
  raw fetch fallback, never `/health` — confirmed by grep).
- The 5 mini-services are no longer drop-in standalone Bun projects if you copy just one
  folder out of `mini-services/` — they need `mini-services/_shared/server.ts` alongside.
  This matches the spec intent ("shared boilerplate"); each service's `tsconfig.json`
  `include: ["*.ts"]` was not extended to cover `_shared` (relative import resolves via
  TS moduleResolution=bundler).
- `Dockerfile.scrapling` (Python) was NOT touched per the constraint; its compose service
  got `cap_add: [SYS_ADMIN]` for the chromium sandbox. If `server.py` is updated to use
  `--no-sandbox`, that `cap_add` can be dropped (then `cap_drop: [ALL]` is sufficient).
- `install.sh` was NOT touched per the constraint; if a future agent touches it, the
  post-install instructions should mention `sudo chown -R 1001:1001 ./db ./data` (already
  documented in DEPLOY.md "二·五" section).
- Entrypoint signal trap: if you add new background services (e.g. a 6th mini-service),
  use `spawn` not `&` so they get the SIGTERM forwarding + cleanup.
- Did NOT touch: `src/**`, `Dockerfile.scrapling`, `install.sh`, Prisma schema.
