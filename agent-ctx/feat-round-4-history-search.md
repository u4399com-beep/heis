# feat-round-4: Reading History Page + Search Enhancements + Style Polish

## Task scope
- **Feature A**: Public "我的书架" / reading history view (`?view=history`).
- **Feature B**: Search experience — header suggestions dropdown + localStorage search history + hot-search chips on SearchView.
- **Style polish**: category count pill (both nav variants), reader chapter fade-in, book card hover.

## Allowed file mutations
- Create: `src/components/public/HistoryView.tsx`, `src/components/public/search-history.ts`.
- Modify: `PublicSite.tsx`, `SiteHeader.tsx`, `SearchView.tsx`, `ReadView.tsx`, `ctx.tsx`, `globals.css` (only if needed), `BookCard.tsx`.
- Do NOT touch: `src/lib/crawl/*`, `src/app/api/*`, `src/components/admin/*`, `prisma/*`, `mini-services/*`, Docker, config files.

## Implementation plan
1. search-history.ts — getSearchHistory / addSearchHistory / removeSearchHistory / clearSearchHistory (localStorage key `heis_search_history`, cap 20).
2. ctx.tsx — extend `PublicView` union with `'history'` + `VIEW_LIST`.
3. HistoryView.tsx — reads `listReadPos()`, batch `fetchBook` per bookId, shows grid with progress / read time / relative time, clear-all with confirm, empty state with BookMarked icon.
4. PublicSite.tsx — import HistoryView, add `case 'history'` to `renderView`, extend `initialView` union type.
5. SiteHeader.tsx — 书架 link (Library icon, mobile icon-only); SearchBox → `SearchBoxWithSuggestions` (debounced 300ms, hot tags fetched once via `/api/public/tags?n=8`, client-filtered; keyboard nav ↑↓ Enter Esc; click-away; Clock history items with per-item X and clear-all). CategoryNav count pill applied to BOTH `CategoryNav` (~line 113) and `PiliCategoryNav` (~line 244). PiliSearchBox gets the same suggestion treatment.
6. SearchView.tsx — when input empty: hot-search chips (`/api/public/tags?n=20`) + history chips (clear button).
7. ReadView.tsx — wrap rendered layout in `<div key={chapterId} className="animate-in fade-in duration-300">`. tw-animate-css verified present.
8. BookCard.tsx already has `transition-transform duration-200 hover:-translate-y-1` — leave as is (matches spec's hover behavior). Add shadow hover optionally.

## Notes
- `tw-animate-css` v1.4.0 installed and imported in globals.css → `animate-in fade-in duration-300` works out of the box.
- `formatRelativeTime` already exported from `read-layouts/bookmarks.ts` — reuse it in HistoryView.
- `formatReadTime`/`formatReadTimeShort` already exported from `reading-memory.ts` — reuse for read-time formatting.
- API param is `n` not `limit` (see `src/app/api/public/tags/route.ts` line 26).
- `fetchBook` returns `{ book, tocTotal, ..., chapters, tags }`; we only use `book.id/name/author/cover`.
