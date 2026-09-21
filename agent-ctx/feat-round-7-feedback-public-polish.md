# feat-round-7: User Feedback System + Public Site Polish

**Task ID:** feat-round-7
**Agent:** Feedback system + public site polish
**Date:** 2026-09-06

## Summary
- Feature A: User feedback system — prisma Feedback model + public POST API (spam protection) + admin list/get/patch/delete + FeedbackWidget floating button with dialog + admin FeedbackSection table+detail
- Feature B: Public site polish — custom 404 page (violet/fuchsia gradient + dot pattern), BackToTop floating button (window scroll, fade in/out), BookGridSkeleton + ChapterListSkeleton utilities wired into HomeView/BookView/BookCard
- Style: CSS keyframes feedbackPulse (3s), feedback-fab mobile sizing, .not-found-bg / .not-found-404, .heis-shimmer

## Files Created (5)
- `src/app/api/public/feedback/route.ts` — POST feedback (validates type/content/contact, spam guards: URL count, all-caps, IP rate limit 5/hr, GET returns 405)
- `src/app/api/admin/feedback/route.ts` — GET list (status/type/q filters, pagination, take cap 100, stats: total/new/resolved)
- `src/app/api/admin/feedback/[id]/route.ts` — GET single / PATCH status+adminNote / DELETE
- `src/components/public/FeedbackWidget.tsx` — floating bottom-right button (pulse animation) + Dialog with 4 type cards (bug red / suggestion amber / praise pink / other zinc), textarea 5-1000 + char counter, contact input, privacy note
- `src/components/public/BackToTop.tsx` — floating bottom-right above feedback widget, appears after 400px scroll, smooth scroll, fade-in/out, detects `[data-reader-scroll]` container
- `src/app/not-found.tsx` — global 404: BookOpen icon, gradient 404 text, "页面不存在" heading, dot pattern background, 返回首页 + 返回后台 buttons
- `src/components/admin/FeedbackSection.tsx` — admin table: type badge / content tooltip / contact / status badge / createdAt / actions, filters (status/type/search), stats cards (total/new/resolved), detail dialog with status select + admin note textarea + auto-mark-read on open

## Files Modified (6)
- `prisma/schema.prisma` — added Feedback model (type/contact/content/url/siteId/userAgent/ip/status/adminNote + @@index[status,createdAt] + @@index[type])
- `src/components/public/PublicSite.tsx` — import + render `<BackToTop />` and `<FeedbackWidget />` outside view router (on every public page)
- `src/components/admin/AdminApp.tsx` — added 'feedback' to SectionKey union + NAV entry "用户反馈" (MessageSquare icon, after "系统设置") + renderSection case
- `src/components/admin/helpers.ts` — added FeedbackRow/FeedbackDetail/FeedbackListResp types + FEEDBACK_TYPE_META + FEEDBACK_STATUS_META + api.patch method
- `src/components/public/bits.tsx` — added BookGridSkeleton + ChapterListSkeleton exports
- `src/components/public/HomeView.tsx` — import + defensive BookGridSkeleton fallback for unknown theme.layout
- `src/components/public/BookView.tsx` — import + ChapterListSkeleton for default TocSkeleton fallback
- `src/components/public/BookCard.tsx` — import + BookGridSkeleton for ThemeBookList grid loading
- `src/app/globals.css` — feedbackPulse keyframe + .feedback-fab (desktop 48px / mobile 40px 16px margin) + .not-found-bg (radial + dot pattern) + .not-found-404 (violet→fuchsia gradient clip) + .heis-shimmer animation

## Database Changes
- New table `Feedback` with indexes `[status, createdAt]` and `[type]` — pushed to SQLite via `bunx prisma db push --skip-generate` + regenerated client via `bunx prisma generate`.

## API Contract
- `POST /api/public/feedback?site=<id>` body `{type, contact?, content, url?}` → `{ok:true, data:{id}}`
  - Validation: type in [bug/suggestion/praise/other], content 5-1000 chars trimmed, contact max 100 chars
  - Spam guards: reject if >3 URLs (regex count), all-caps (6+ letters), IP >5 submissions in last hour
- `GET /api/public/feedback` → 405
- `GET /api/admin/feedback?page=&size=&status=&type=&q=` → `{rows[], total, page, size, pages, stats:{total,new,resolved}}`
- `GET /api/admin/feedback/[id]` → full detail incl userAgent + adminNote
- `PATCH /api/admin/feedback/[id]` body `{status?, adminNote?}` → updated record
- `DELETE /api/admin/feedback/[id]` → `{ok:true}`

## Test Results (curl-verified)
- `bun run lint` → 0 errors / 0 warnings
- `bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | wc -l` → 0
- Dev server: `GET /` 200, `GET /?view=home` 200, `GET /?admin=1` 200, `GET /this-page-does-not-exist` 404 (renders custom not-found with "页面不存在" + "返回首页" + "返回后台")
- API smoke:
  - POST /api/public/feedback (valid) → 200 + `{id}`
  - POST /api/public/feedback (too many URLs) → 400 + "反馈内容包含过多链接"
  - POST /api/public/feedback (all caps) → 400 + "反馈内容请勿全部大写"
  - POST /api/public/feedback (bad type) → 400 + "反馈类型不合法"
  - POST /api/public/feedback (too short) → 400 + "反馈内容至少 5 个字符"
  - POST /api/public/feedback (rate limit: 6th in hour) → 429 + "提交过于频繁, 请稍后再试"
  - GET /api/public/feedback → 405 + "Method Not Allowed"
  - GET /api/admin/feedback (after auth) → 200 + `{rows:[...], total, pages, stats:{...}}`
  - GET /api/admin/feedback?status=new / ?type=praise / ?q=valid → filtered results
  - PATCH /api/admin/feedback/[id] `{status:'resolved', adminNote:'test'}` → 200 + updated record
  - DELETE /api/admin/feedback/[id] → 200 + `{ok:true}`
- 404 page contains `not-found-404`, `not-found-bg`, "页面不存在", "返回首页", "返回后台"
- All test feedback records cleaned up via admin API after verification

## Notes
- Dev server required restart after `prisma generate` (per task instructions). Used `setsid nohup bun run dev` to detach from shell session (earlier attempts died due to shell-session teardown). Killed agent-browser chrome processes first to free 1.7GB RAM (avoid OOM kill of next-server, which had previously consumed 2.9GB and was killed).
- BackToTop polls every 500ms for `[data-reader-scroll]` element (read layouts don't expose one currently — those use window.scrollY which works for classic/pili layouts).
- FeedbackSection auto-marks `new` → `read` on detail open (silent PATCH, fails silently).
- All new client components are `'use client'`; reused shadcn Dialog/Button/Input/Textarea/Badge/Card/Tooltip/Select/Table + lucide-react.
- Constraints honored: only touched allowed files. Did NOT modify /api/* other than feedback routes, did NOT touch /lib/crawl/* or read-layouts/*.
