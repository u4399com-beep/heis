# Task ID: 1-a · Auth & security hardening

## Files created
- `src/lib/auth.ts` — auth core: HMAC-SHA256 signed cookies, constant-time compare,
  login attempt rate limit (5/60s per IP), random fallback password (printed to log).
- `src/middleware.ts` — Next.js middleware (`runtime: 'nodejs'`): admin API cookie gate,
  per-IP per-route-class token-bucket rate limit (admin 60/min, public 120/min, auth 60/min),
  security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy, X-DNS-Prefetch-Control), removes X-Powered-By.
- `src/app/api/auth/login/route.ts` — POST {password}, sets `heis_admin` signed HttpOnly
  cookie (SameSite=Lax, Path=/, Max-Age=43200, Secure in prod).
- `src/app/api/auth/logout/route.ts` — POST clears cookie.
- `src/app/api/auth/check/route.ts` — GET returns `{authenticated: boolean}`.
- `src/components/admin/LoginGate.tsx` — client component: pulls /api/auth/check on mount,
  shows centered login card (Card + Input + Button + Label + sonner Toaster) on unauth,
  renders children on authed.

## Files modified
- `src/app/page.tsx` — wraps `<AdminApp>` in `<LoginGate>` (only on the admin view).
- `src/lib/crawl/downloader.ts` — `DEFAULT_DOWNLOAD_OPTIONS.obfuscate` flipped `true → false`,
  plus a legal-risk comment block explaining the change is opt-in only.
- `src/app/api/admin/downloads/route.ts` — added a clarifying comment near
  `const options: Partial<DownloadOptions> = {}` reiterating that the obfuscate default
  comes from `DEFAULT_DOWNLOAD_OPTIONS` (now `false`); only explicit `body.obfuscate`
  overrides it.
- `.env.example` — added `ADMIN_PASSWORD` and `SESSION_SECRET` with comments.
- `next.config.ts` — added `poweredByHeader: false` (kept existing `output: "standalone"`,
  rewrites, `typescript.ignoreBuildErrors`, `reactStrictMode: false`).

## Key implementation notes
- **No new auth dependency** — only `node:crypto` (createHmac, timingSafeEqual,
  randomBytes, createHash). No next-auth, no schema change, no User model.
- **Constant-time compare everywhere** — `safeEqualStr()` wraps `timingSafeEqual`,
  length-mismatch path still does a dummy compare to keep timing uniform.
- **Token format**: `base64url(JSON{exp,nonce}).base64url(hmac_sha256(payload, secret))`.
  Verify path: split → recompute HMAC → constant-time compare → decode → check `exp`.
- **dev HMR safety**: random fallback password & derived secret are cached on
  `globalThis.__heisAdminPw` / `__heisAdminSecret` so dev module reloads do NOT regenerate
  the password (which would invalidate every existing session token between requests).
- **Rate limit buckets are keyed `${routeClass}:${ip}`** — admin / public / auth buckets
  are independent so heavy admin traffic cannot starve public/auth buckets.
- **Map cap 10000** with FIFO eviction to bound memory under IP-spoofing attacks.
- **Middleware `runtime: 'nodejs'`** lets us reuse `src/lib/auth.ts` directly (no async
  Web Crypto rewrite needed). Next 16 logs a deprecation warning suggesting rename to
  `proxy.ts`; convention still works. (Spec asked for `src/middleware.ts` — kept as-is.)
- **Stateless logout**: logout only clears the client cookie; the old token remains
  valid until `exp` (12h). This matches the spec (stateless HMAC, no server-side session
  store). Acceptable for single-admin model.

## Test results (dev server, ADMIN_PASSWORD unset → random fallback)
- `/api/admin/stats` (no cookie) → `401 {"ok":false,"error":"未登录或会话已过期","code":"UNAUTHENTICATED"}` ✓
- `/api/auth/check` (no cookie) → `{"ok":true,"data":{"authenticated":false}}` ✓
- Login with wrong password → `401 {"ok":false,"error":"密码错误"}` ✓
- Login with random password (from server log) → `200 {"ok":true,"data":{}}` + `Set-Cookie: heis_admin=...; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200` ✓
- `/api/auth/check` with cookie → `{"ok":true,"data":{"authenticated":true}}` ✓
- `/api/admin/stats` with cookie → `200` real stats payload ✓
- Logout → `200 {"ok":true,"data":{}}` + `Set-Cookie: heis_admin=; Max-Age=0` ✓
- HTML page headers contain `content-security-policy`, `permissions-policy`,
  `referrer-policy`, `x-content-type-options`, `x-dns-prefetch-control`, `x-frame-options`,
  and NO `X-Powered-By` ✓
- Rate limit `/api/admin/*` 65 rapid reqs → 60×401 + 5×429 ✓ (capacity 60)
- Rate limit `/api/auth/*` independent — 5 quick check reqs after admin burst all pass ✓
- Login brute-force 7 attempts → 5×401 + 2×429 ✓ (5/60s window)
- `bun run lint` → clean (no errors) ✓
- `bunx tsc --noEmit` → 4 pre-existing errors in `examples/` and `skills/` only, none from this task's code ✓

## Notes for other agents
- Cookie name: `heis_admin`. All `/api/admin/*` routes now require this cookie — if you
  add a new admin route, it's automatically gated by middleware (no per-route change needed).
- Frontend calls to `/api/admin/*` from inside `<LoginGate>` automatically carry the cookie
  (same-origin, default credentials). No fetch options change required.
- If you need to call admin routes from a server-side context (RSC/server action), inject
  the cookie manually — middleware still gates by cookie.
- `obfuscate` in downloader is now default `false`. UI DownloadsSection already
  defaults the toggle to off; behavior is consistent.
- Did NOT touch: `src/lib/crawl/{fetcher,runner,obscura,hostgate,parser,cleaner,sorter,calibrate}.ts`,
  `mini-services/*`, `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yml`,
  Prisma schema.
