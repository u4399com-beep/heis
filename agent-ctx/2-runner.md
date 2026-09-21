# Task 2-runner: runner.ts bug fixes + enhancements

## Scope
ONLY modified `src/lib/crawl/runner.ts` (1174 → 1298 lines, +124). Did not touch any other file.

## Bugs fixed (7)
- **Bug 8** (recoverOnBoot): moved `g.__novelRecoveredAt = Date.now()` assignment to AFTER all DB operations succeed; catch leaves flag unset so recovery retries on next boot/API call.
- **Bug 5** (stages A/B/D + volumeBackfill .catch): added `swallowExpectedDb(e)` helper that rethrows non-P2025/P2002 errors; replaced 4× `.catch(() => {})` with `.catch(swallowExpectedDb)`. Stage C `db.chapter.create` catch now rethrows non-P2025/P2002 after logging (book reorder aborts cleanly on real DB failure).
- **Bug 10** (Stage E): added delete of chapters where `bookId && idx > tocItems.length && url NOT IN currentUrls`. Guarded by `currentUrls.length > 0` (skips when all toc items have empty url, avoids `notIn:[]` matching-all footgun). Logs count deleted.
- **Bug 19** (live.status paused window): restructured DB read into its own try/catch; on failure sets `rt.paused = true` + `continue` (skips queue.splice). On success, clears stale pause flag set by prior DB failure (prevents permanent hang).
- **Bug 24** (book stats update): `.catch` now logs non-P2025 errors via `console.warn('[runner] book stats update failed:', ...)`.
- **Bug 25** (done overwrite): added `let doneWritten = false`; set `true` right after `db.task.update({status:'done'})` succeeds; inner catch only writes `status:'error'` if `!doneWritten`.
- **Bug 26** (paused-return dead code): confirmed via grep that `crawlOneBook` never returns `'paused-return'`; removed the dead `if (bookResult === 'paused-return')` branch.

## Enhancements (4)
- **E1** (unref timers): added `if (typeof timer.unref === 'function') timer.unref()` after creating the autoRefresh `setTimeout`. The only other `setTimeout` calls in the file (line 716 retry delay, line 1210 `sleep` helper) are awaited promises in active code paths — left as-is (unref would not change behavior and await semantics must be preserved).
- **E2** (LRU eviction): added `pruneRuntimesIfNeeded()` (cap 200, evicts oldest `running===false` entry in insertion order; skips if all active). Called after `runtimes.set` in `control('start')`. Added `disposeRuntime(taskId)` (only disposes if `!rt.running` AND not in circuit cooldown); wired into `cancelAutoRefresh` so the DELETE route's existing `cancelAutoRefresh(id)` call proactively prunes the runtime (satisfies "prune on task delete" without modifying the API route).
- **E3** (abortControllers): confirmed via grep that `stop`/`pause` use `rt.epoch` generation-bumping (not AbortController sets). The field was never populated anywhere. Removed `abortControllers?: Set<AbortController>` from `TaskRuntime` interface.
- **E4** (circuit cooldown): added `circuitTrippedAt?: number` to `TaskRuntime` + `CIRCUIT_COOLDOWN_MS = 60_000` constant. Set `rt.circuitTrippedAt = Date.now()` when circuit breaks (crawlOneBook). In `control('start')` entry, if `rt.circuitTrippedAt && Date.now() - rt.circuitTrippedAt < 60_000` → reject with `熔断冷却中，请 ${wait}s 后再试`. New start resets `circuitTrippedAt = undefined` (fresh round). `disposeRuntime` preserves runtime during cooldown window.

## Verification
- `bun run lint` → clean (no errors)
- `bunx tsc --noEmit` → 4 pre-existing errors in examples/ + skills/ only; ZERO errors in `src/lib/crawl/runner.ts`
- dev.log shows app compiling and serving requests (502s only from mini-services on ports 3010/3011 not running — unrelated)

## Backward compatibility
- All function signatures preserved (no parameter/return-type changes)
- `cancelAutoRefresh` behavior: clears timer (unchanged) + now also calls `disposeRuntime` (additive, safe — only disposes terminal non-cooldown runtimes)
- Added new private methods (`pruneRuntimesIfNeeded`, `disposeRuntime`) — internal, no API surface change
- Added new public-ish fields on TaskRuntime (`circuitTrippedAt`) — interface is internal
