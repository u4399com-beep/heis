# fix-round3 — Fix 30 round-3 bugs + code cleanup

## Summary
Fixed all 30 in-scope bugs from audit-round3 (R3-1..R3-42, skipping false positives R3-7/15/19/21/22/23/29/39/43/44/45).

## Per-bug fix status
All 30 fixed targets are FIXED (or DOCUMENTED for R3-38). See /home/z/my-project/worklog.md Task ID `fix-round3` for the full per-bug breakdown with line-level details.

## Files modified
- src/lib/auth.ts (R3-30/31/32/33)
- src/lib/crawl/cleaner.ts (R3-25)
- src/lib/crawl/downloader.ts (R3-28)
- src/lib/crawl/fetcher.ts (R3-1/2/3/4/5/6/8/9)
- src/lib/crawl/obscura.ts (R3-16/17)
- src/lib/crawl/parser.ts (R3-24)
- src/lib/crawl/runner.ts (R3-10/11/13/14/35)
- src/lib/crawl/sorter.ts (R3-26)
- src/lib/crawl/storage.ts (R3-27)
- src/proxy.ts (R3-30)
- src/app/api/admin/books/[id]/recrawl/route.ts (R3-40)
- src/app/api/admin/chapters/[id]/route.ts (R3-34)
- src/app/api/admin/tasks/[id]/route.ts (R3-41)
- src/app/api/public/feedback/route.ts (R3-36)
- src/app/api/public/sitemap/route.ts (R3-37)
- src/components/public/BookView.tsx (R3-42)
- .env (added ADMIN_PASSWORD=audit-fix-2025)

## Verification
- `bun run lint`: 0 errors
- `bunx tsc --noEmit`: 0 errors (excluding examples/skills)
- GET `/`: HTTP 200
- XSS test: PUT /api/admin/chapters/{id} with payload `<img src=x onerror=alert(1)><script>alert(2)</script><iframe src=javascript:alert(3)></iframe>` → stored content sanitized to `<p><p>正常段落</p></p>` (script/iframe/img/onerror/javascript: all stripped). Public chapter GET returns same sanitized content → no stored XSS.

## What this agent can see in previous work records
Read /home/z/my-project/worklog.md for the complete audit-round3 bug list (line 1815+) and full fix-round3 work log (appended at the end). Also read agent-ctx/2-fetcher.md, 2-runner.md, 2-obscura.md, 2-other-engine.md for the original round-1/2 fixes that established the patterns this round follows.
