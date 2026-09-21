# Task R24-3B — 9 套 HomeClone 接 initialCategories

## 任务摘要
R24-3A 主控修复了 SSR 根因 (page.tsx 改 server fetch + HomeView/CloneCSSLoader 改造 + shipsay HomeClone 接 initialCategories)。本任务把同样改造扩展到其余 9 套 HomeClone.tsx, 让 SSR 时 navigation 有分类数据。

## 接收文档
- `/home/z/my-project/worklog.md` 末尾 (R24-3A 段) — 主控 SSR 根因修复
- `src/components/public/clone-themes/shipsay/HomeClone.tsx` line 17-36 — 主控改好的示范

## 改造范围 (9 套 HomeClone.tsx)
全部位于 `src/components/public/clone-themes/`:
1. aijjxs/HomeClone.tsx
2. 23qb/HomeClone.tsx
3. ddyueshu/HomeClone.tsx
4. pilishuwu/HomeClone.tsx
5. 101kks/HomeClone.tsx
6. huangjinwu/HomeClone.tsx
7. ggd66/HomeClone.tsx
8. x2552/HomeClone.tsx
9. trxsw/HomeClone.tsx

## 每套 3 处改法 (照搬 shipsay 示范)
1. **函数签名加 initialCategories**: 在现有解构 props 后追加 `initialCategories`
2. **useState 函数式初始值**: `useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))`
3. **useEffect 加 `if (cats.length > 0) return` + deps 改 `[cats.length]`**

## huangjinwu 特殊处理
保留 `+ '榜'` 后缀逻辑 (与其 useEffect 内 `(c.name || ...) + '榜'` 一致, sort-section 标题需要):
```tsx
useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: (c.name || c.title || String(c)) + '榜' })))
```

## 未修改的文件 (尊重约束)
- shipsay/HomeClone.tsx (主控已改好)
- shared.ts (HomeCloneProps 已加 initialCategories)
- HomeView.tsx / PublicSite.tsx / page.tsx / CloneCSSLoader.tsx (主控已改)
- 其他页型 BookInfo/CategoryList/ReadChrome/RankingView/FulltextView/SearchView/KeywordView
- themes.ts / books route

## 验证结果
- `bun run lint`: 0 errors / 0 warnings exit 0 ✓
- `bunx tsc --noEmit`: src/components/public/clone-themes/ 下 9 套 HomeClone 0 errors ✓
  - 唯一剩余 error: `src/components/public/HomeView.tsx(73,57)` (R24-3A 主控的 FetchState 类型不匹配, initialBooks inline object 缺 page/size 字段, 与本次 9 套改动无关, 任务明确"不要碰 HomeView.tsx")
- dev server log: ✓ Compiled in 17.5s, /?view=home&site=xxx GET 200 OK render 460ms

## 关键设计权衡
- 完全照搬 shipsay 示范 (R24-3A 主控已稳定运行), 不引入新逻辑
- huangjinwu 保留 `+ '榜'` 后缀 (与其 useEffect 一致, 避免 SSR/Client 不一致)
- 兜底 DEFAULT_NAV 保留 (fetch 失败时使用), 没动这些原有 fallback 逻辑
- deps 改 `[cats.length]`: 与 shipsay 一致 + 让 react-hooks/exhaustive-deps 不警告 (effect 内引用了 cats.length)
