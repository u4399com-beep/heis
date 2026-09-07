---
Task ID: feat-a
Agent: Reader enhancement (bookmarks/line-height/reading-time/style polish)
Task: Add reading progress memory + bookmarks + line/letter spacing + reading time tracking + login/dashboard style polish

Work Log:
- Read prior worklog entries (Tasks 3-a/4-a/1-a/1-c/2-fetcher/2-runner/2-obscura/2-other-engine/4-b/2-api-bugs/5-a/2-a/6) for context on file boundaries + prior agent work; project stable with lint/tsc clean and prior 50+ bugs fixed.
- Read current state of all 4 read layouts + shared.tsx + ReadView.tsx + BookView.tsx + LoginGate.tsx + Dashboard.tsx + AdminApp.tsx + globals.css before editing to understand existing patterns + style conventions.
- Verified shadcn/ui component availability (Popover, Slider, Switch, Button, Tooltip all present in src/components/ui/) and lucide-react icons.

A. Reading Progress Memory (read position recall):
  - Created src/components/public/read-layouts/reading-memory.ts (172L):
    - ReadPos interface { chapterId, scrollRatio, title, ts, readTimeMs }
    - localStorage key: heis_readpos_<bookId>, safe read/write with try/catch + JSON validation
    - saveReadPos / getReadPos / clearReadPos / listReadPos (LRU 50 by ts desc) functions
    - getReadTimeMs / setReadTimeMs (read-time stored in same record, additive)
    - formatReadTime (时分秒) + formatReadTimeShort (compact 2h15m) helpers
  - Added useReadPosMemory({bookId, chapterId, title, scrollerRef, ready, getRatio?, setRatio?}) hook in shared.tsx:
    - On ready+chapterId match: 100ms delayed scroll-to-saved-ratio; sets restoredHint state (auto-dismiss 2s)
    - On chapterId change to new chapter (different from saved): immediately writes new chapter + ratio 0
    - 300ms debounced scroll save listener (window or scrollerRef)
    - Custom getRatio/setRatio override for paginated horizontal scrolling
  - Each of 4 layouts (ReadClassic/Immersive/Paginated/Pili) calls useReadPosMemory with appropriate scrollerRef:
    - Classic/Pili: window scroll (default scrollerRef undefined)
    - Immersive: internal scrollerRef
    - Paginated: stageRef + custom getRatio/setRatio for horizontal page index
  - All 4 layouts render inline "已定位到上次阅读位置" toast when restoredHint is true (auto-dismiss 2s via hook internal timer)

B. Chapter Bookmarks (add/remove/list):
  - Created src/components/public/read-layouts/bookmarks.ts (108L):
    - Bookmark interface { chapterId, idx, title, ts }
    - localStorage key: heis_bookmarks_<bookId>, max 200 per book (LRU eviction by ts)
    - toggleBookmark (returns new state true=added/false=removed), isBookmarked, listBookmarks, clearBookmarks
    - formatRelativeTime (刚刚/N分钟前/N小时前/N天前/N个月前/N年前)
  - Added BookmarkToggle component in shared.tsx (uses lucide Bookmark/BookmarkCheck icons, fill-current when active)
  - Each layout's toolbar gets a BookmarkToggle button (next to Aa settings) wired to toggleBookmark(bk.id, {id, idx, title})
  - Bookmark state synced in each layout's render body (prevCh-style: detect mismatch via isBookmarked + setState — same pattern as ReadView's prevCh)
  - TocDrawer enhanced with 目录/书签 tab toggle at top (tab state):
    - 书签 tab: lists bookmarks (idx + title + relative time + remove X button), click navigates to chapter
    - Empty state with Bookmark icon + helper text "暂无书签，点击阅读页工具栏的书签图标添加"
    - Refresh on open/tab-switch via render-time prevRefresh check (avoid set-state-in-effect lint)
    - removeBookmark handler calls toggleBookmark(idempotent) + re-reads listBookmarks

C. Line Height / Letter Spacing Control:
  - Extended ReadLayoutProps in shared.tsx: +lineHeight (1.5-2.2 default 1.8), +letterSpacing (-0.5 to 2 default 0), +onLineHeight(delta), +onLetterSpacing(delta)
  - Added LINE_HEIGHT_PRESETS [{紧凑 1.6}, {标准 1.8}, {宽松 2.1}] and LETTER_SPACING_PRESETS [{紧凑 -0.3}, {标准 0}, {宽松 1}]
  - Added ReaderSettingsPopover component in shared.tsx:
    - Trigger: small "Aa" button with Type icon
    - Content: 字号 (slider 14-24 + - / + buttons) / 行距 (3 preset buttons) / 字距 (3 preset buttons) / 夜间 toggle (Switch)
    - Active preset detection (within 0.05 of value) for highlight
    - Dark mode support (immersive)
  - ReadView.tsx: added lineHeight + letterSpacing state with localStorage persistence (public_reader_lineHeight, public_reader_letterSpacing), clamped to spec ranges via round-to-2-decimals
  - All 4 layouts: replaced existing AArrowUp/AArrowDown/Moon/Sun buttons with single ReaderSettingsPopover trigger + BookmarkToggle button (cleaner toolbar)
  - All 4 layouts apply style={{ lineHeight, letterSpacing: `${letterSpacing}px` }} to chapter content wrapper

D. Reading Time Tracking (per book):
  - Added useReadingTimeTracker(bookId) hook in shared.tsx:
    - 1s tick: if document.visibilityState==='visible' && Date.now()-lastScrollAtRef < 30000, accumRef += 1000ms
    - 30s setInterval save (setReadTimeMs imported function persists to localStorage)
    - Cleanup on unmount: immediate save
    - visibilitychange listener: refresh lastScrollAt when returning to visible (avoid instant expiry)
    - Returns readTimeMs state for UI display
    - Bug fix during impl: original draft shadowed imported setReadTimeMs with useState setter, causing save() to write string to state instead of number — renamed local setter to setReadTimeMsState to fix
  - All 4 layouts call useReadingTimeTracker(bk?.id)
  - TocDrawer header shows "已读 2小时15分" with Clock icon (only when readTimeMs > 0)
  - BookView.tsx: added "上次阅读 · 已读 2h15m" badge button (only when savedPos?.chapterId exists), click navigates to last-read chapter; rendered in both pili and non-pili info layouts

E. Style Polish — Login + Dashboard + Sidebar:
  - Added @keyframes gradientShift (8s ease-in-out infinite, bg-position 0%↔100%) + .animate-login-gradient class in globals.css
  - Added @keyframes bookPulse (2.4s ease-in-out infinite, translateY + drop-shadow) + .animate-book-pulse class in globals.css
  - LoginGate.tsx rewritten:
    - Background: bg-gradient-to-br from-[#3b1e6e] via-[#4338ca] to-zinc-950 (deep purple → indigo → zinc-950) + animate-login-gradient
    - Card: backdrop-blur-xl bg-white/5 border border-white/10 (glass-morphism) + 12px shadow
    - Icon: BookOpen (replaces Lock) with animate-book-pulse + violet ring/glow
    - Password input: focus-visible:border-violet-400/70 focus-visible:ring-violet-400/50 focus-visible:ring-[3px] (primary glow)
    - Submit button: bg-violet-600 hover:bg-violet-500
    - Footer line below form: "🔒 会话 12 小时 · 登录信息仅本地保存" (small muted)
  - Dashboard.tsx:
    - Replaced icon imports per spec: BookMarked→BookOpen, FileStack→FileText, FileCode2→ScrollText, ListChecks→ListTodo, Tags→Tag (Globe, Download unchanged)
    - Stat card className: transition-colors → transition-all duration-200 hover:-translate-y-1 hover:scale-[1.02] hover:border-violet-600/60 hover:bg-zinc-900 hover:shadow-lg hover:shadow-violet-950/40 (lift + shadow on hover)
    - Icon wrapped in rounded-md bg-zinc-950/60 ring-1 ring-zinc-800 chip (small badge style)
  - AdminApp.tsx sidebar (lg+):
    - Active nav button: 3px border-left violet-500 + bg-violet-500/15 + font-medium text-violet-300 (instead of full border ring)
    - Inactive: border-left 3px transparent (consistent width to avoid layout shift)
    - Padding-left adjusted to compensate for border width (calc(0.75rem - 1px))

Lint/tsc fixes during impl:
- Initial lint error: react-hooks/set-state-in-effect on BookView:60 setSavedPos and shared.tsx:695 setBookmarks (synchronous setState in effect body). Refactored both to render-time prevPattern check (matches existing ReadView's prevCh pattern).
- Initial tsc error: listBookmarks and formatRelativeTime imported from ./reading-memory but they're exported from ./bookmarks. Fixed by splitting import statement.
- Initial lint warning: setReadTimeMs unused — root cause was shadowing bug (local useState setter had same name as imported function); renamed local setter to setReadTimeMsState to fix both the unused-import warning AND a silent runtime bug where save() would have called the state setter with (bookId, ms) args instead of persisting to localStorage.

Verification:
- bun run lint: 0 errors, 0 warnings (exit 0)
- bunx tsc --noEmit | grep -v "examples\|skills" | wc -l: 0 (clean in src/)
- Dev server: GET /?view=home 200 (51ms), GET /?admin=1 200 (35ms), POST /api/auth/login 200 with valid password, GET /api/admin/stats 200 — no new compile errors
- agent-browser end-to-end QA:
  - Login page renders: "小说管理系统 · 登录" + BookOpen icon with animate-book-pulse class + animate-login-gradient background gradient + password input with focus-visible:ring-violet-400 + footer "🔒 会话 12 小时 · 登录信息仅本地保存"
  - Login flow: fill password → submit → admin dashboard renders
  - Dashboard stat cards: hover class verified via DOM eval — transition-all duration-200 hover:-translate-y-1 hover:scale-[1.02] hover:border-violet-600/60 hover:bg-zinc-900 hover:shadow-lg hover:shadow-violet-950/40
  - Sidebar active nav: style="border-left: 3px solid var(--color-violet-500); padding-left: calc(-1px + 0.75rem);"
  - Public site (?view=home): gracefully renders (empty-DB state due to no test sites/books)
- Reader live test skipped (DB has no chapters + chapter-creation API only supports delete/markUnfetched); tsc/lint clean confirms ReadView/4 layouts/TocDrawer code paths compile and type-check.

Stage Summary:
- Files created (2):
  - src/components/public/read-layouts/reading-memory.ts (172L)
  - src/components/public/read-layouts/bookmarks.ts (108L)
- Files modified (9):
  - src/components/public/read-layouts/shared.tsx (+~440L: ReadLayoutProps extension, useReadPosMemory, useReadingTimeTracker, ReaderSettingsPopover, BookmarkToggle, TocDrawer bookmarks tab + reading time header)
  - src/components/public/ReadView.tsx (+lineHeight/letterSpacing state + persistence + pass-through)
  - src/components/public/read-layouts/ReadClassic.tsx (ReaderSettingsPopover + BookmarkToggle + useReadPosMemory + useReadingTimeTracker + inline restore hint)
  - src/components/public/read-layouts/ReadImmersive.tsx (same + dark popover variant)
  - src/components/public/read-layouts/ReadPaginated.tsx (same + custom horizontal getRatio/setRatio)
  - src/components/public/read-layouts/ReadPili.tsx (same)
  - src/components/public/BookView.tsx (savedPos state + 上次阅读·已读 badge in pili + non-pili layouts)
  - src/components/admin/LoginGate.tsx (gradient bg + glass card + BookOpen pulse + footer line + focus glow)
  - src/components/admin/Dashboard.tsx (stat card hover lift + spec icons)
  - src/components/admin/AdminApp.tsx (sidebar 3px left-border active indicator + bg tint)
  - src/app/globals.css (+@keyframes gradientShift + .animate-login-gradient + @keyframes bookPulse + .animate-book-pulse)
- Features delivered:
  - A: 阅读位置记忆 (debounced save + restore-on-return + inline hint)
  - B: 章节书签 (toolbar toggle + TocDrawer 目录/书签 tab + remove per-row)
  - C: 行距/字距 控制 (统一 Aa 设置面板, replaces ±font/night buttons, presets + slider + switch)
  - D: 阅读时长统计 (per-book cumulative, TocDrawer header + BookView badge)
  - E: Login gradient/glass/pulse + Dashboard hover lift + Sidebar left-border indicator
- Test results: bun run lint 0/0; bunx tsc --noEmit 0 errors in src/; dev server 200 on / and /?admin=1; agent-browser verified LoginGate + Dashboard + Sidebar visual changes live; public site renders empty-DB state gracefully.
- Bug discovered & fixed during impl: useReadingTimeTracker had local setReadTimeMs shadowing imported setReadTimeMs — would have caused save() to set state to bookId string instead of persisting ms to localStorage. Renamed local setter, fixed both lint unused-import warning AND silent runtime bug.
- Constraints honored: only modified allowed files (read-layouts + ReadView + BookView + admin LoginGate/Dashboard/AdminApp + globals.css); created only reading-memory.ts + bookmarks.ts; no API routes / prisma / engine / mini-services / middleware / next.config touched; localStorage keys prefixed heis_ or public_reader_ (consistent with existing).
