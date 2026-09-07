# Task: feat-round-10 — Task monitor enhancement + reader chapter progress map

Agent: Task monitor enhancement + reader chapter progress map
Started: 2026-09-06

## Goal
A: TaskMonitor real-time log viewer (filter/search/autoscroll) + speed chart + error stats + segmented progress.
B: Reader chapter read tracker + TocDrawer visual progress (status icons + progress bar + read time).

## Allowed file changes
- Create: `src/components/admin/TaskLogViewer.tsx`, `src/components/public/read-layouts/chapter-progress.ts`
- Modify: `src/components/admin/TaskMonitor.tsx`, `src/components/public/read-layouts/shared.tsx`
- DO NOT touch: `src/lib/crawl/*`, `src/app/api/*`, `src/components/admin/TasksSection.tsx`, `prisma/*`, `mini-services/*`

## Plan
1. chapter-progress.ts — localStorage Set<string> of read chapter ids per book (cap 500, LRU)
2. useReadPosMemory in shared.tsx — extend to mark chapters read on scroll > 10% (no per-layout edits needed)
3. TocDrawer — readSet state, status icons per chapter row (current/read/bookmarked/unread), header progress bar
4. TaskLogViewer.tsx — extracted log viewer: filter pills + search + autoscroll + clear + copy + "新日志" floating btn
5. TaskMonitor — add ts to log entries; add useMemo for counts/speedData/rate/eta/segments; replace inline logs with TaskLogViewer; add SpeedChart (recharts AreaChart 80px violet); add ErrorStats row (5 cards); add segmented progress bar + ETA Tooltip

## Progress
- [x] chapter-progress.ts created (95L): getReadChapters/markChapterRead/getReadChapterCount/clearReadChapters
- [x] useReadPosMemory extended: markedReadRef + chapterId-change sync + ready-time ratio check + scroll-debounce mark
- [x] TocDrawer enhanced: readSet state + bookmarkIds + readCount/readPct + header progress bar + status-icon rows
- [x] TaskLogViewer.tsx created (280L): filter/search/autoscroll/clear/copy + floating "↓ N 条新日志" button
- [x] TaskMonitor refactored: ts field, safeTs helper, useMemo for logCounts/speedData/ratePerMin/etaMin/segmentProps
- [x] SpeedChart inline: recharts AreaChart 80px violet gradient (近10分钟章节速率)
- [x] ErrorStats row: 5 cards (success/warn/error/rate/eta) with icons
- [x] Segmented progress bar + ETA Tooltip in progress card
- [x] lint 0/0 + tsc 0 + curl /?admin=1 200 + /?view=read 200 + /?view=book 200 + dev log no errors

## Test results
- bun run lint → 0 errors / 0 warnings
- bunx tsc --noEmit | grep -v examples/skills → 0 errors
- GET / → 200; /?admin=1 → 200; /?view=read&chapter=<id> → 200; /?view=book&id=<id> → 200
- Dev log: no unhandled exceptions, no TypeError/ReferenceError
- No OOM; curl-only testing
