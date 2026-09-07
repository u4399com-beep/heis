# feat-round-5: Book Detail + Reader Enhancements + Style Polish

## Task scope

### Feature A — Book Detail Page Enhancement
- **A1**: Related books recommendation (相关推荐 section after TOC, 6 cards, same-category first then top-by-wordCount).
- **A2**: Chapter preview tooltip on TOC entries (hover 300ms debounce + cache, shows first 100 chars + wordCount + 点击阅读 hint).
- **A3**: Reading stats bar below book info (chapters / total words / avg per chapter / reading time estimate @ 300字/分钟).

### Feature B — Reader Page Enhancement
- **B1**: Keyboard shortcuts across all 4 layouts (←/→ prev/next chapter, Home/End top/bottom, b bookmark, t TOC, s settings, ? help, Esc close).
- **B2**: Top 3px fixed progress bar (window scroll for classic/pili; immersive/paginated keep their own internal progress bars).
- **B3**: Chapter transition slide animation (next from right, prev from left, none for drawer jumps) — direction inferred from old data.prev/next.id comparison at chapterId change render-time check.

### Style Polish
- **S1**: Gradient glow behind book covers (BookView both pili & non-pili; BookCard & BookPoster — `radial-gradient(circle at 50% 25%, primary 50%, transparent 70%)` with `blur-2xl`).
- **S2**: Book detail layout refinement — already 2-col desktop; added 3 dividers between sections; current-chapter highlight in TOC (reads URL `?chapter=`, applies `aria-current` + colored bg).
- **S3**: Drop-cap on first paragraph (`::first-letter` 3.2em float-left) for ReadClassic + ReadPili via `.read-content-dropcap` class + CSS vars `--reader-accent` / `--reader-title-font`.

## Allowed file mutations
- Created: `src/app/api/public/related/route.ts`.
- Modified: `src/components/public/BookView.tsx`, `src/components/public/BookCard.tsx`, `src/components/public/ReadView.tsx`, `src/components/public/read-layouts/shared.tsx`, `src/components/public/read-layouts/ReadClassic.tsx`, `src/components/public/read-layouts/ReadImmersive.tsx`, `src/components/public/read-layouts/ReadPaginated.tsx`, `src/components/public/read-layouts/ReadPili.tsx`, `src/app/globals.css`.
- Untouched (per constraints): `src/lib/crawl/*`, `src/app/api/admin/*`, `src/app/api/public/book/route.ts`, other public API routes, `src/components/admin/*`, `prisma/*`, `mini-services/*`, Docker, config files.

## Implementation notes

### Module-level readerActionsRef
- `shared.tsx` exposes `readerActionsRef: { current: ReaderActions }` (module-level singleton).
- Each layout registers onPrev/onNext/onScrollTop/onScrollBottom into the ref via `useEffect` (no deps — runs every render, cleanup-on-unmount clears if still ours).
- ReadView's `keydown` listener reads from ref and dispatches.
- DOM-driven triggers (`b`/`t`/`s`) use `document.querySelector('[data-reader-*-trigger]').click()` — BookmarkToggle / ReaderSettingsPopover / TOC toolbar buttons all carry these data-attributes.
- ReadPaginated's `onStageKey` adds `stopPropagation` so ArrowLeft/Right on the focused stage trigger page-flip (not chapter nav); when stage isn't focused, window listener fires for chapter nav.

### Direction inference (B3)
- ReadView tracks `prevCh` (state) vs `chapterId` (prop). On mismatch, before clearing data, compares new chapterId with current `data.next.id` / `data.prev.id` (still old data at this point). Sets `direction` state to `'next'` / `'prev'` / `'none'`.
- `wrapKey = ${chapterId}-${direction}` forces wrapper remount on both chapter AND direction change. The wrapper applies `animate-in fade-in slide-in-from-right-4` (next) / `slide-in-from-left-4` (prev) / plain fade-in (none).
- Drawer jumps (clicking a chapter in TOC) result in direction='none' (new chapter doesn't match prev/next of old data).

### Tooltip (A2)
- `TocChapterButton` wraps each TOC entry with shadcn `<Tooltip delayDuration={300}>`. On `onMouseEnter` / `onFocus`, debounced 300ms `fetchChapter(ch.id)` → strip HTML to plain text → cache in `previewCacheRef` (a `useRef<Map<string,string>>` in BookView). Skeleton in tooltip while loading.
- Caches are cleared on book change via `useEffect([bookId])` (avoids ref mutation during render — eslint-safe).
- Each of 7 theme variants (pili/aurora/paper/mango/bamboo/rose/ocean) uses the same TocChapterButton with its theme-specific className/style.

### Related API (A1)
- `GET /api/public/related?id=<bookId>&site=<siteId>&limit=6`:
  - Step 1: same-category books (excluding current), ordered by wordCount desc, take `limit`.
  - Step 2: if fewer than `limit`, fill with top-by-wordCount books across all categories (excluding already-selected + current).
  - Returns `{ books: BookItem[] }` with id/name/author/cover/status/wordCount/category/categoryId.

### Stats bar (A3)
- `BookStatsBar` component: 4 chips (FileText/Type/Sparkles/Clock icons) — chapters / total words / avg per chapter / reading time @ 300字/分钟.
- Reading time formatted as "X 小时 Y 分" or "Y 分钟".

### Drop-cap (S3)
- `.read-content-dropcap > p:first-of-type::first-letter` in globals.css: 3.2em float-left, line-height 0.85, theme accent color via `--reader-accent`, theme title font via `--reader-title-font`.
- ReadClassic + ReadPili apply the class on their content div + set CSS vars from theme.
- ReadImmersive + ReadPaginated have different aesthetics; drop-cap intentionally NOT applied there per spec.

## Test results

- `bun run lint` → 0 errors / 0 warnings.
- `bunx tsc --noEmit` (excluding examples/skills) → 0 errors.
- Dev server: `GET /?view=home` 200, `GET /?view=book&id=...` 200, `GET /?view=read&chapter=...` 200, `GET /api/public/related?id=...&limit=6` 200.
- Compiled CSS contains `slide-in-from-right`, `slide-in-from-left`, `read-content-dropcap`.
- agent-browser smoke (single short session, closed immediately):
  - Book detail page: 4 sections render (书籍信息 / 本书标签 / 章节目录 / 相关推荐). Stats chips present (章节/总字数/平均/阅读). 5 related books for the lone-category book. Gradient glow div present.
  - Reader page (classic layout): 1 TOC trigger, 1 bookmark trigger, 1 settings trigger. dropcap class on content div. Help button (HelpCircle) at bottom-20 left-4. Top progress bar (h-[3px]) at top.
  - `?` key → help dialog opens (shows full shortcut list). Esc → dialog closes.
  - ArrowRight → URL chapter id changes from `...005s...` to `...005t...` (next chapter).
  - `b` key → bookmark icon flips from `lucide-bookmark` to `lucide-bookmark-check` (filled).
  - `t` key → TOC drawer opens (role=dialog aria-label="章节目录"). Esc → drawer closes.
