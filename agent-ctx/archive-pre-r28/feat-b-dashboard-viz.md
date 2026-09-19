# feat-b: Dashboard data viz + health monitoring

**Task ID**: feat-b
**Agent**: Dashboard data viz + health monitoring
**Scope**: Stats API time-series + recharts dashboard (area/pie/bar) + health card widget

## Files modified

- `src/app/api/admin/stats/route.ts` (+75L)
  - Added `empty7d()` + `bucketize7d(rows)` helpers (7 MM-DD day buckets, oldest first, includes zero-count days).
  - Added 5 try/catch-wrapped aggregations (each non-blocking, returns `[]` / empty buckets on failure):
    - `wordsByCategory`: `db.book.groupBy({ by:['categoryId'], _sum:{wordCount:true}, where:{categoryId:{not:null}} })` merged with `categories` names → sorted desc.
    - `booksByStatus`: `db.book.groupBy({ by:['status'], _count:true })`.
    - `chaptersLast7d`: `db.chapter.findMany({ where:{createdAt:{gte:since}}, select:{createdAt:true} })` → bucketize7d.
    - `booksLast7d`: same via `db.book.findMany`.
    - `taskStatusBreakdown`: `db.task.groupBy({ by:['status'], _count:true })`.
  - Existing fields unchanged; new fields appended to `data` envelope.

- `src/components/admin/helpers.ts` (+44L)
  - Added 5 new fields to `StatsData` interface.
  - Added `HealthStatus` type, `HealthService` interface, `HealthData` interface (mirrors `/api/admin/health` payload).
  - Added `fmtUptime(seconds)` → "运行 X天Y小时Z分钟" (skips zero parts).
  - Added `fmtMB(n)` → "153.5MB".

- `src/components/admin/Dashboard.tsx` (~280L → ~510L, rewritten)
  - `CHART_COLORS` constant (zinc/violet/fuchsia/sky/emerald/amber/red/blue + dark-theme grid/tick/tooltip).
  - `BOOK_STATUS_CHART_COLOR` (completed=emerald, ongoing=blue, unknown=zinc).
  - `TASK_STATUS_CHART_COLOR` (running=emerald, paused=amber, stopped=zinc, done=blue, error=red, pending=zincLight).
  - `ChartCard` wrapper: header (icon chip + title + optional action) + body (loading skeleton / empty state / chart, all 240px tall).
  - Row2 (xl:grid-cols-2): AreaChart "近7天采集活动" (2 stacked gradient areas: 章节 violet + 书籍 sky, custom dark Tooltip, Legend) + PieChart "书籍状态分布" (donut innerRadius=56 outerRadius=86, per-status Cell fill, custom Tooltip with count + pct, vertical Legend with count + pct).
  - Row3 (xl:grid-cols-2): BarChart "分类字数排行 (Top 10)" (horizontal, gradient violet→fuchsia, X tick fmtWords 万) + BarChart "任务状态分布" (horizontal, fixed 6-status order, per-status Cell color).
  - Empty state per chart: "暂无数据，开始采集后这里会显示统计图表" with faded icon when data sums to 0.
  - Bottom row preserved: recent tasks list + (recent books list + category distribution bar list) in xl:grid-cols-2.
  - StrictMode-safe load pattern: replaced fragile `aliveRef.current=false on unmount` (which breaks in dev StrictMode — cleanup fires before re-mount, aliveRef stays false forever, setLoading(false) never fires) with `cancelled` local flag in useEffect.

## Files created

- `src/components/admin/HealthCard.tsx` (~260L)
  - Status badge with pulsing dot (animate-ping): healthy=emerald / degraded=amber / unhealthy=red.
  - Uptime formatted via `fmtUptime` (运行 X天Y小时Z分钟).
  - Heap memory Progress bar with "153.5MB / 176.5MB" label.
  - 6 mini-service status dots (bqg713/fetch-relay/scrapling/qimao/deqixs/xjp): green=reachable, gray=optional-unreachable (scrapling only), red=required-unreachable. Each in shadcn Tooltip with service name + status + (自检失败) note.
  - DB indicator: emerald "DB 正常" / red "DB 异常".
  - Manual 刷新 button (RefreshCw → Loader2 spin during refreshing).
  - 401 handling: direct fetch (bypasses api.get envelope) detects `res.status===401` → "会话已失效, 请重新登录" amber banner + `onSessionExpired` callback (ref-stored to keep load callback stable).
  - Auto-refresh every 30s via `setInterval`; cleanup clears interval.
  - Same StrictMode-safety fix as Dashboard: stable `useCallback` (empty deps) + `{isFirst}` opts param + `cbRef` for onSessionExpired (avoids parent inline-arrow effect re-fires).

## Bugs discovered & fixed during impl

1. **React StrictMode + aliveRef pattern**: original `aliveRef.current = false` on unmount + `if (aliveRef.current) setLoading(false)` in load finally → in dev StrictMode, cleanup fires before re-mount, aliveRef stays false forever, setLoading(false) never fires, entire dashboard stuck in loading state (stat cards show spinners, chart cards show skeleton forever). Rewrote both Dashboard and HealthCard with cancelled-flag-in-effect pattern.

2. **recharts Legend `formatter` TypeScript type**: original `renderStatusLegend(value, entry: {payload?:{count,pct}})` failed tsc because recharts' `Formatter` expects `entry.payload` to include `strokeDasharray`. Relaxed signature to `{payload?:unknown}` + internal cast. tsc clean.

## Test results

- `bun run lint`: 0 errors, 0 warnings (exit 0).
- `bunx tsc --noEmit | grep -v examples|skills`: 0 lines (clean).
- Dev server (manually restarted via `setsid bun run dev` after system watcher stopped — unrelated to code): GET / 200, GET /?admin=1 200.
- agent-browser end-to-end:
  - Login with `audit-fix-2025` → dashboard mounts.
  - HealthCard renders live: status="部分降级" (mini-services not running in dev — expected degraded), uptime "运行 28秒" → "运行 1分钟" after 30s (auto-refresh verified), heap "153.5MB / 176.5MB", 6 service dots colored, DB indicator emerald "DB 正常".
  - Stat cards: 1 book, 0 chapters, 0 rules, 0 tasks, 2 sites, 0 tags, 0 downloads. No loaders.
  - 4 chart card titles render. 2 SVG charts render (470x240 each): area chart (with 1 book today) + pie chart (1 completed book).
  - 2 bar charts show empty state ("暂无数据，开始采集后这里会显示统计图表") because category words all 0 + task count all 0.
  - Health auto-refresh every 30s verified via dev.log timestamps. Stats only fetched on mount (no auto-refresh) — verified via dev.log call pattern.

## Constraints honored

- Modified only allowed files: `src/app/api/admin/stats/route.ts`, `src/components/admin/Dashboard.tsx`, `src/components/admin/helpers.ts`, new `src/components/admin/HealthCard.tsx`.
- Did NOT touch: `src/app/api/admin/health/route.ts` (already done by prior agent), `src/lib/crawl/*`, `src/components/public/*`, `prisma/*`, other API routes, Docker, config files.
- Used `recharts` 2.15.4 (already in package.json).
- Used shadcn `Card`, `Badge`, `Progress`, `Skeleton`, `Tooltip`, `Button` (all pre-existing in `src/components/ui/`).
- Dashboard performant: stats fetched once on mount + manual refresh; health auto-refreshes every 30s but stats don't.
