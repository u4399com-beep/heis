# feat-round-11 — Rule Field Visualization + PWA Support

**Task ID**: feat-round-11
**Agent**: Rule field visualization + PWA support
**Date**: 2026-09-06

## Goal

为 heis 小说采集/发布系统添加两项能力:
- **Feature A (Rule Field Visualization)**: 字段类型徽章 + 表达式预览 + 单字段测试 + 字段模板
- **Feature B (PWA Support)**: Web App Manifest + Service Worker + 安装提示

## Prior Work Context

- 项目为 Next.js 16 + App Router + Prisma/SQLite + Tailwind4/shadcn 小说采集/发布站群
- 已完成 10 轮改进(安全/爬虫/阅读器/后台/备份/SEO), 6 demo books / 3 rules / 2 sites, lint/tsc clean
- 既有可视化调试链路: `/api/admin/rules/test` POST 返回 `debugHtml`(注入 `<mark class="heis-debug-match">` 高亮) + `debugMatches`(每条匹配的字段/选择器/索引/值/预览) + `rawHtml`
- 既有 `DebugHtmlViewer` 组件: 接受 `debugHtml` + `rawHtml` + `activeMatch={field, idx}`, 在 sandbox="" iframe 中渲染, 激活匹配加 `.heis-debug-active` 闪烁类
- 既有 `FieldRuleEditor` 组件: 编辑单个字段规则(type/expression/attr + 后处理 stripTags/replaceFrom/replaceTo/index)
- 既有 `RuleEditor` 四段页签(list/book/toc/content + fetch/clean), `PageRulePanel` 在左列渲染 fields.map, 右列渲染 `TestPanel`
- 无 PWA 基础设施(manifest/SW/install prompt 均不存在)

## Files Created

| File | Purpose |
|------|---------|
| `public/manifest.json` | PWA Web App Manifest(name/short_name/start_url/display/background_color #09090b/theme_color #7c3aed/orientation portrait/icons SVG any+maskable/categories/lang zh-CN) |
| `public/icon.svg` | 512x512 紫色圆角方块 + 白色 BookOpen 路径 + 右下角"小"字角标, maskable 安全区留白 |
| `public/sw.js` | ~85 行 vanilla SW: install 预缓存 App Shell, activate 清旧缓存, fetch 三策略分发(导航 network-first / 静态 cache-first / API network-only) + 离线 503 兜底页 |
| `src/components/PwaRegister.tsx` | client 组件, useEffect 注册 SW(仅 production + load 后, dev 跳过避免 HMR 干扰) |
| `src/components/public/InstallPrompt.tsx` | beforeinstallprompt 捕获 + 底部居中横幅(紫边/Download 图标/安装+关闭按钮) + appinstalled toast + localStorage 7 天 dismiss + 懒检测 standalone 模式 |

## Files Modified

| File | Change |
|------|--------|
| `src/components/admin/FieldRuleEditor.tsx` | 完全重写(183→549 行): A1 头部 TypeBadge(css=sky/xpath=amber/regex=rose/json=emerald/const=zinc) + 表达式预览(40 字符 mono zinc-400) + attr pill; A3 未配置态"添加"升级 DropdownMenu(空白规则 + 8 模板); A2 新增 FieldTestButton 子组件 + FieldTestContext 类型 — Popover 触发, 复用 /api/admin/rules/test, 客户端从 debugMatches/fields/sample 过滤本字段值, "查看高亮"按钮内联展开 DebugHtmlViewer 聚焦本字段 |
| `src/components/admin/RuleEditor.tsx` | +FieldTestContext import; PageRulePanel 内 useMemo 构造 testContext(section/pageRule/fetchConfig/cleanConfig/defaultUrl 从 urlTemplate 推导); fields.map 透传 fieldKey + testContext(itemSelector/tocLink/pagination.nextLink 不传, 保持原行为) |
| `src/app/layout.tsx` | +manifest/appleWebApp/icons.apple Metadata + Viewport API 导出 themeColor #7c3aed(Next 16 推荐, metadata.themeColor 已弃用) + head 显式 `<link rel="apple-touch-icon">` + body 末尾挂 `<PwaRegister />` |
| `src/components/public/PublicSite.tsx` | +InstallPrompt import + 挂载(全站可用, embedMode 与公开站均生效) |
| `src/app/globals.css` | +`@keyframes heisInstallSlideUp` + `.heis-install-banner` 类(0.32s cubic-bezier 滑入, translate(-50%,24px) → translate(-50%,0)) |

## Key Design Decisions

1. **单字段测试 = 客户端过滤**: 不改 `/api/admin/rules/test` 路由(避免触碰受保护文件), 直接发送完整 section 配置, 在 Popover 内从 `debugMatches` / `fields` / `sample` 三路兜底提取本字段首条值。这样既复用既有引擎/反反爬/调试 HTML, 又零回归。

2. **FieldTestContext 透传链**: PageRulePanel 在 fields.map 处提供 testContext, 其它 FieldRuleEditor 实例(itemSelector/tocLink/pagination.nextLink)不传 → 自动不显示测试按钮。无需改 FieldRuleEditor 默认行为。

3. **Popover 内嵌 DebugHtmlViewer**: "查看高亮"按钮复用既有组件, 传入 `activeMatch={field: fieldKey, idx: matchIdx}`, iframe 内 mark 闪烁定位。PopoverContent `w-80` 容纳 iframe `h-[400px]`。

4. **set-state-in-effect 反模式修复**: 两处 lint 报错:
   - FieldTestButton 的 defaultUrl→url 同步 effect → 改为 handleOpenChange 打开分支刷新(URL 状态 + 结果状态都在事件处理器中重置)
   - InstallPrompt 的 standalone 检测 → useState 懒初始化, effect 仅注册监听器

5. **SW 缓存策略分层**:
   - 导航(network-first + 离线缓存回退 + 503 兜底页) → 用户离线仍能打开"应用外壳"
   - 静态资源 `_next/static` / icon / manifest / robots / logo(cache-first + 后台 SWR) → 二次访问秒开
   - API `/api/*`(network-only) → 动态数据不缓存, 避免陈旧
   - 跨域放行 → 第三方封面图/CSS 不拦截
   - 仅 GET/HEAD → POST/PUT/DELETE 一律放行(等价 network-only)

6. **PWA 图标 SVG 路径**: 选择 SVG(any+maskable)而非 PNG — 浏览器对 manifest SVG 支持度参差(Chrome/Edge OK, Safari iOS 不支持), 但当前环境无法生成 PNG, SVG 是最简方案。生产环境若需更广兼容, 可用 `sharp`/`rsvg-convert` 从 SVG 预生成 192/512 PNG 补进 icons 数组。

7. **Viewport themeColor**: Next 14+ 已弃用 `metadata.themeColor`, 迁移至独立的 `export const viewport: Viewport = { themeColor: '#7c3aed' }`(Next 16 推荐方式)。

8. **SW 注册时机**: `load` 事件后注册, 避免与首屏关键资源竞争带宽; dev 模式跳过(SW 缓存会干扰 HMR, Next 16 dev 资源带版本 hash 无需 SW 兜底)。

## Test Results

- `bun run lint` → **0 error / 0 warning** ✅
- `bunx tsc --noEmit`(排除 examples/skills) → **0 错误** ✅
- `curl http://localhost:3000/` → **200** ✅
- `curl http://localhost:3000/manifest.json` → **200** application/json ✅
- `curl http://localhost:3000/icon.svg` → **200** image/svg+xml ✅
- `curl http://localhost:3000/sw.js` → **200** application/javascript ✅
- 首页 HTML head 含 `<link rel="manifest">` + `<meta name="theme-color" content="#7c3aed">` + `<link rel="apple-touch-icon" href="/icon.svg">` + `<meta name="apple-mobile-web-app-title" content="小说阅读">` + `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` ✅
- dev.log 无新错误 ✅

## Untouched (per constraints)

- `src/lib/crawl/*`(引擎)
- `src/app/api/*`(路由 — 单字段测试复用既有 test API, 不改后端)
- `prisma/*`, `mini-services/*`, Docker, `next.config.ts`, `eslint.config.mjs`, `tsconfig.json`
- `src/components/admin/TestPanel.tsx`, `DebugHtmlViewer.tsx`(单字段测试复用, 不改)
