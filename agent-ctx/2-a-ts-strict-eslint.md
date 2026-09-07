# Task 2-a — Re-enable TS strict + ESLint rules

## Goal
Final code-quality gate before verification:
1. Set `next.config.ts` `ignoreBuildErrors:false` + `reactStrictMode:true`.
2. Re-enable high-value ESLint rules; keep pragmatic ones off with documented reasons.
3. Fix all lint errors/warnings introduced by re-enabled rules.
4. Verify `bun run lint` exit 0 + `bunx tsc --noEmit` 0 errors + dev server still serves `/` and `/api/auth/check`.

## Files modified (under src/, eslint.config.mjs, next.config.ts only)
- `next.config.ts` — flip `ignoreBuildErrors` true→false, `reactStrictMode` false→true. `poweredByHeader: false` already set by 1-a.
- `eslint.config.mjs` — rewrite rules block: re-enable 10 rules as error + `react-hooks/exhaustive-deps` as warn; document off rules with reasons; expand ignores to include all of `mini-services/**` and `scripts/**` (separate tsconfig/quality-gate per Task spec).
- `src/app/api/admin/downloads/route.ts` — drop unused import `isPlainObject`.
- `src/app/api/admin/links/batch/route.ts` — drop unused type alias `Action`.
- `src/app/api/admin/tasks/[id]/control/route.ts` — drop unused import `str`.
- `src/components/admin/BookDetail.tsx` — drop unused import `BOOK_STATUS_META`.
- `src/components/public/PublicSite.tsx` — drop unused `useRef`; add `eslint-disable-next-line react-hooks/exhaustive-deps` for mount-once useEffect.
- `src/components/public/SiteHeader.tsx` — `PiliCategoryNav` only uses `navigate` from usePublic; drop unused `theme`/`v`.
- `src/components/public/read-layouts/shared.tsx` — drop unused `useRef`; add `scrollerRef` to useReadingProgress deps (ref stable).
- `src/components/public/bits.tsx` — `round` is intentional useMemo trigger (not consumed in callback); add disable comment with reason.
- `src/hooks/use-toast.ts` — `actionTypes` was value-only-used-as-type via `typeof`; convert to direct `type ActionType = { ADD_TOAST: "ADD_TOAST"; ... }` literal type.
- `src/lib/crawl/cleaner.ts` — `let html = t2sHtml(raw)` → `const html` (never reassigned).
- `src/lib/crawl/downloader.ts` — drop unused import `saveDownloadTxt`.
- `src/lib/crawl/runner.ts` — `catch (firstErr)` → `catch (_firstErr)` (unused error var, `^_` pattern).

## Final state
- `bun run lint` exit 0 — **0 errors, 0 warnings**.
- `bunx tsc --noEmit 2>&1 | grep -v "examples\|skills" | wc -l` = **0**.
- dev server auto-restarted after next.config.ts change; `GET /` 200; `GET /api/auth/check` returns `{"ok":true,"data":{"authenticated":false}}`.
- tsconfig `strict: true` (含 strictNullChecks/useUnknownInCatchVariables) 保持; `noImplicitAny: false` 保持 (Task 指示).

## Skipped (documented)
- Task 5 — `catch (e: any)` → `catch (e)` 机械改造 (62 处跨 27 文件): 跳过并文档化. Task 显式允许跳过 ("optional — if it risks breaking things or takes too long, skip it and document"). strict mode 下 `catch (e)` 推断为 `unknown`, 全部 `e.message` 访问需 narrowing, 风险/收益不划算; 留待未来一次专门 pass.
- `@typescript-eslint/no-explicit-any` 保持 off (119 处合法 DOM-interop + catch 块); 注释已说明原因.

## Rules re-enabled
- error: `@typescript-eslint/no-unused-vars`, `prefer-const`, `no-unreachable`, `no-fallthrough`, `no-useless-escape`, `no-redeclare`, `no-mixed-spaces-and-tabs`, `no-case-declarations`, `no-irregular-whitespace`, `no-debugger`.
- warn: `react-hooks/exhaustive-deps`.

## Rules kept off (with documented reasons in eslint.config.mjs)
- `@typescript-eslint/no-explicit-any` (119 处 DOM-interop + catch, 单独 pass 跟踪)
- `@typescript-eslint/no-non-null-assertion` (Prisma null 返回实用性断言)
- `@typescript-eslint/ban-ts-comment`, `prefer-as-const`, `no-unused-disable-directive`
- `react-hooks/purity`, `react-compiler/react-compiler` (实验性)
- `@next/next/no-img-element`, `@next/next/no-html-link-for-pages`, `react/no-unescaped-entities`, `react/display-name`, `react/prop-types` (shadcn/ui + Next 约定)
- `no-console` (logger/banner), `no-empty` (防御性空 catch), `no-undef` (TS 接管)
