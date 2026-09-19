# Task: feat-round-9 — Data backup/restore + site SEO audit

Agent: Data backup/restore + site SEO audit
Started: 2026-09-06

## Goal
Add full DB export/import + per-site SEO audit with score + 2 new admin sections.

## Allowed file changes
- Create: `src/app/api/admin/backup/route.ts`, `src/app/api/admin/backup/restore/route.ts`, `src/app/api/admin/seo-audit/route.ts`
- Create: `src/components/admin/BackupSection.tsx`, `src/components/admin/SeoAuditSection.tsx`
- Modify: `src/components/admin/AdminApp.tsx`, `src/components/admin/helpers.ts`
- DO NOT touch: `src/lib/crawl/*`, `src/components/public/*`, `prisma/*`, `mini-services/*`, Docker, existing admin routes

## Plan
1. Backup API — full DB export with version 1 envelope + counts + data block + 500-book cap (metadata only)
2. Restore API — POST with merge (upsert) / replace (delete-first) modes in `db.$transaction`
3. SEO audit API — scan all sites for TDK/domain/content/friend-links/theme/GEO/sitemap/offset issues, score 0-100
4. BackupSection — two cards (violet export / sky import) + drag-drop + import history (localStorage)
5. SeoAuditSection — per-site scorecards with conic-gradient ring + issues/passed split
6. AdminApp sidebar gets 数据备份 (Database) + SEO 体检 (Stethoscope) entries
7. helpers.ts adds BackupFile / BackupData / RestoreResult / SeoAuditIssue / SeoAuditSite / SeoAuditReport types

## Progress
- [x] Backup API  — GET /api/admin/backup returns JSON with version+counts+data, big-books (>500) graceful degrade
- [x] Restore API — POST /api/admin/backup/restore with merge/replace modes inside db.$transaction
- [x] SEO audit API — GET /api/admin/seo-audit (?site=id) scores 0-100 across TDK/domain/content/links/theme/geo/sitemap/offset
- [x] BackupSection — two cards (violet export + sky import) + drag/drop + import history (localStorage)
- [x] SeoAuditSection — per-site scorecards with conic-gradient ring + collapsible passed checks
- [x] AdminApp wiring — 数据备份 (Database) + SEO 体检 (Stethoscope) sidebar entries
- [x] helpers types — BackupFile / RestoreResult / SeoAuditIssue / SeoAuditSite / SeoAuditReport / SEO_CATEGORY_META
- [x] lint 0/0 + tsc 0 + dev server 200 + backup/restore/seo-audit APIs verified via curl

## Test results
- bun run lint → 0 errors / 0 warnings
- bunx tsc --noEmit | grep -v examples/skills → 0 errors
- GET /api/admin/backup (authed) → 200, 263 KB JSON, 140ms; version=1, 7 books / 234 chapters / 3 rules / 2 sites / 16 categories / 1 setting
- POST /api/admin/backup/restore {mode:merge} → 200 in 860ms; imported: settings=1, categories=16, sites=2, rules=3, books=7, chapters=234, tags=46
- POST /api/admin/backup/restore {version:2} → 400 "备份版本不匹配"
- POST /api/admin/backup/restore (non-json) → 400 "备份格式不正确: 缺少 version 字段"
- GET /api/admin/seo-audit → 200 with 2 sites (scores 78 and 94, avg 86, 7 issues, 1 error)
- GET /api/admin/seo-audit?site=<id> → 200 with just that site
- GET /api/admin/seo-audit?site=nonexistent → 404
- Auth gating: all 3 new endpoints return 401 without admin cookie
- Dev server: GET / → 200; GET /?admin=1 → 200; chunks bundle contains 数据备份 / SEO 体检 / BackupSection / SeoAuditSection / backup / seo-audit

## Notes
- Dev server OOM'd during testing (next-server Turbopack peaks ~2 GB RSS); killed all chrome/agent-browser processes to free ~1.5 GB; restarted dev server with setsid+bash+exec bun pattern (survives shell teardown). Avoid agent-browser to keep memory headroom.
- Restore API chapter upsert uses id-based upsert (not bookId+idx unique) to preserve original chapter IDs from backup; if a chapter with the same id already exists with a different bookId+idx, the conflict is caught per-chapter and reported in warnings (does not abort the transaction).

