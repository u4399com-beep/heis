# R42-1C — full-stack-developer (清理精简 + 旧 src 清理)

**Task ID**: R42-1C
**Agent**: full-stack-developer (清理精简+旧src清理)
**Date**: 2026-09-21

---

## Task 范围

R41-1C 超时遗留的清理工作收口:
1. 旧 src/ TS 代码 (350 文件 ~81000 行, 已被 Go 后端完整替代) 删除
2. Go dead code 扫描 (go vet + staticcheck)
3. 重复逻辑整合 (go-backend/services/ 9 mini-services helper 收口到 bridgeserver)
4. 过时注释清理 (R10-R30 注释; 保留 R37+ Go 迁移设计决策)
5. 临时文件清理 (scripts/archive/ + agent-ctx/archive-pre-r28/ + go-backend/*.log + 9 个 Go 二进制)
6. .gitignore 更新 (R41-1C 已添加, R42-1C 补充清理状态注释)

## 上下文 (上一轮交接)

R41-1C 超时清理仅完成 .gitignore 入口添加, 未完成实际删除; R42-1C 继续清理.
读 `worklog.md` 末 200 行 + R40-1B/R41-1A 完成状态: Go 后端 16554 行已实现
(8 模块采集引擎 + 94 模板 + 13 admin 页面 + 8 admin API + 9 mini-services).

## Work Log

### 1. 读交接 + 验证 Go 后端不依赖 src/

- 读 `worklog.md` 末 200 行了解 R38-1C Go 采集引擎 + R39-1C adminDB 适配器 + R39-1A 5×7 模板 +
  R40-1B admin 8 新页面 + R41-1A 采集引擎深度审查 (P0/P1 bug 7 大类 + 反反爬增强 7 大类).
- `grep -rn 'src/' go-backend/ --include='*.go'` — 仅注释中提及 (与 src/app/api/admin/*
  同口径), 无代码 import 依赖. Go 后端与 src/ 解耦, 可安全删除 src/*.

### 2. Go 环境准备 (go1.24.0 from go.dev)

系统无 go 二进制, 通过 `curl -sL https://go.dev/dl/go1.24.0.linux-amd64.tar.gz` 下载
到 /home/z/go, 设 GOROOT=/home/z/go, GOPATH=/home/z/.gopath.

baseline 验证 (删 src/* 前):
- `go build -o heis-backend .` → 0 errors, 21.9MB binary
- `go vet ./...` → 0 warnings
- `go vet ./services/...` (逐服务) → 全 0 warnings (R41-1B 并行未完成的编译错误已修复)

### 3. 旧 src/ 清理 (350 → 4 文件)

确认约束: `User can only see the / route defined in src/app/page.tsx`,
故**保留 src/app/* 4 个文件作占位首页**, 删除其余 346 个文件.

**保留 (4 文件, 197 行总):**
- `src/app/page.tsx` (89 行) — 重写为迁移占位首页, 含 Go 后端 5 个核心模块卡片列表
  (main.go/admin.go/crawl/*/templates/*/services/*) + Go 后端说明 + 跳转链接
- `src/app/layout.tsx` (52 行) — 精简: 去 PwaRegister 依赖, 保留 Geist 字体 + 基础 metadata
- `src/app/not-found.tsx` (31 行) — 精简: 去 lucide-react 依赖, 纯文字 404
- `src/app/globals.css` (25 行) — 精简: 仅 tailwindcss 导入 + background/foreground 变量

**删除 (346 文件, ~81000 行):**
- `src/components/admin/*` (32 个 admin 组件: AdminApp/LoginGate/Dashboard/TasksSection/
  BooksSection/RulesSection/SitesSection/CategoriesSection/LinksSection/ThemesSection/
  DownloadsSection/SettingsSection/FeedbackSection/BackupSection/SeoAuditSection/
  TaskWizard/TaskDialog/TaskMonitor/RuleEditor/CalibrateDialog 等)
- `src/components/public/*` (52 个 public 组件: PublicSite/BookView/ReadView/SearchView/
  CategoryView/RankingView/FulltextView/KeywordView/HomeView/SiteHeader/SiteFooter/
  BookCard/BookCover/Pagination 等 + clone-themes/ 10 站点 × 7 文件 + layouts/ 19 +
  read-layouts/ 5 等)
- `src/components/ui/*` (46 个 shadcn/ui 组件: button/card/dialog/form/select/
  table/tabs/toast 等 — 全套)
- `src/components/PwaRegister.tsx` (1 个 client 组件, layout 不再引用)
- `src/app/api/*` (75 个 admin/public API 路由: tasks/books/rules/sites/categories/links/
  themes/downloads/settings/feedback/backup/seo-audit/chapters/stats + auth + public/*)
- `src/hooks/*` (2 个: use-mobile.ts, use-toast.ts)
- `src/lib/*` (15 个: api/auth/db/logger/utils/links/pseudostatic/mini-service-config-cache +
  crawl/ 17 个: fetcher/parser/cleaner/runner/storage/hostgate/smart/types/calibrate/
  downloader/obscura/rule-templates/sorter/suggest/theme-matrix/themes/fetcher-curl-impersonate)
- `src/proxy.ts` (Next.js 16 中间件: 安全头 + admin 鉴权 + 限流 + reqId — 因无 API 路由可保护, 一并删除)

**端到端验证:**
- `bun run lint` → 0 errors (eslint . 通过)
- `curl http://localhost:3000/` → HTTP 200, 89 行 page.tsx 正确渲染 (含 5 模块卡片 + Go 后端说明)
- dev.log 显示 dev server 正常重载无错误

### 4. Go dead code 扫描 (staticcheck)

安装 `staticcheck` (`go install honnef.co/go/tools/cmd/staticcheck@latest`),
对全包跑:

**main + services 包 (R42-1C scope):** 0 warnings ✓
**crawl 包 (B agent scope, 仅 flag 不修):**

```
crawl/cleaner.go:365:43: error parsing regexp: invalid escape sequence: `\1` (SA1000)
crawl/cleaner.go:456:20: should omit nil check; len() for nil slices is defined as zero (S1009)
crawl/cleaner.go:645:32: error parsing regexp: invalid escape sequence: `\1` (SA1000)
crawl/fetcher.go:688:17: (net/http.Transport).DialTLS deprecated since Go 1.14 → DialTLSContext (SA1019)
crawl/fetcher.go:1618:28: error strings should not be capitalized (ST1005)
crawl/fetcher.go:1933:6: type inflightEntry is unused (U1000)
crawl/fetcher.go:1941:9: var inflightMu is unused (U1000)
crawl/fetcher.go:1942:9: var inflightMap is unused (U1000)
crawl/fetcher.go:1947:6: func inflightKey is unused (U1000)
crawl/storage.go:361:6: func runeCount is unused (U1000)
crawl/types.go:696:6: func parseInt is unused (U1000)
```

按约束"不要碰 go-backend/crawl/* (B agent)", 全部 crawl/* 内 11 处 staticcheck
warning 仅在 worklog 中 flag, 不修改. B agent 后续 sweep 时可参考.

### 5. services/ 重复逻辑整合

R41-1C 已完成主要收口 (httpURLRe → bridgeserver.HTTPURLRe; htmlToText → bridgeserver.HTMLToText;
truncStr → bridgeserver.TruncStr; boolStr → bridgeserver.BoolStr; ifStr → bridgeserver.IfStr).
确认现状:

**已用 bridgeserver helper 的服务:**
- qimao-proxy: TruncStr ×3 (line 235, 250, 261), BoolStr ×1 (line 782)
- fetch-relay: HTTPURLRe ×1 (line 85)
- uc-bridge: HTTPURLRe ×3 (line 130, 220), TruncStr ×3 (line 396, 400 ×2), BoolStr ×1 (line 408)
- scrapling-bridge: HTTPURLRe ×1 (line 132), TruncStr ×4 (line 142, 182, 186 ×2), BoolStr ×1 (line 408)
- xjp-proxy: TruncStr ×3 (172, 286, 442), IfStr ×2 (415, via 433), HTMLToText ×2 (189, 433), BoolStr ×1 (564)
- deqixs-proxy: HTMLToText ×2 (90, 94), TruncStr ×3 (168, 199, 219), IfStr ×3 (209, 218, 232)

**R42-1C 新发现 + 修复的重复 (moli-bridge):**
- moli-bridge 此前仍持有本地 ifEmpty/truncStr/boolStr 副本 (3 个函数, 2-3 处调用)
- moli-bridge 还有 dead import: `import "strings"` 仅在 `var _ = strings.NewReader` 一处使用
  (即本身是 unused import 的占位语句, 实际未用 strings 包)

**修复 (services/moli-bridge/main.go):**
- 替换 `ifEmpty(s, fallback)` → `bridgeserver.IfEmpty(s, fallback)` (2 处: line 202, 270)
- 替换 `truncStr(s, n)` → `bridgeserver.TruncStr(s, n)` (1 处: line 214)
- 替换 `boolStr(b)` → `bridgeserver.BoolStr(b)` (1 处: line 301, main 启动日志)
- 删除本地 func ifEmpty/truncStr/boolStr 定义 (3 个函数)
- 删除 `var _ = strings.NewReader` dead 占位语句
- 删除 `import "strings"` (现在真未使用)
- 新增 `bridgeserver.IfEmpty(s, fallback string) string` helper (因 moli-bridge
  ifEmpty 语义"空串兜底"是高频模式, 值得在 bridgeserver 命名收口, 比用 IfStr(s=="", fallback, s)
  更直白). 与 R41-1C 收口的 TruncStr/BoolStr/IfStr 同款命名风格.

**验证:** moli-bridge `go build` + `go vet` + `staticcheck` 全 0 errors.

### 6. 过时注释清理

- `grep -rn 'R1[0-9]\|R2[0-9]\|R30' go-backend/{main,admin,services}` → 0 匹配
  (main.go + admin.go + services/* 已无 R10-R30 注释, 历史清理已收口)
- `grep -rn 'R1[0-9]\|R2[0-9]\|R30' go-backend/crawl/` → 7 处 (全在 crawl/{cleaner,smart}.go,
  均为有效设计决策注释如 "R26-1A: 同口径追加 U+2060"/"R30: 归一化分类名"/"R29-1C useTrafilatura").
  按约束"不要碰 crawl/*", 不动.

### 7. 临时文件清理 (~100MB 释放)

按 task 列表清理:

**删除项:**
- `scripts/archive/` (2.6MB) — 250+ 个 R4-R30 历史 probe/verify TS 脚本, 已 gitignored
- `agent-ctx/archive-pre-r28/` (972KB) — 90+ 个 R1-R27 历史工作记录, 已 gitignored
- `go-backend/backend.log` (4KB) — heis-backend 启动日志, 临时
- `go-backend/heis-backend` (21MB) — 主二进制, go build 产物, 可重建
- `go-backend/bqg713-proxy` (8.5MB) — service 二进制
- `go-backend/deqixs-proxy` (9.5MB) — service 二进制
- `go-backend/fetch-relay` (9.3MB) — service 二进制
- `go-backend/moli-bridge` (9.1MB) — service 二进制
- `go-backend/qimao-proxy` (9.3MB) — service 二进制
- `go-backend/scrapling-bridge` (9.4MB) — service 二进制
- `go-backend/uc-bridge` (12MB) — service 二进制
- `go-backend/xjp-proxy` (9.3MB) — service 二进制

合计释放: ~100MB 工作目录空间.

**未删 (保留参考):**
- `agent-ctx/probe-html/` (1.1MB) + `agent-ctx/probe-html2/` (1.9MB) — R31+ worklog
  仍引用为历史参考 (probe-html2 是 9 主题克隆源 HTML+CSS), 不在 task 显式清理列表.
- `mini-services/*` (TS/Python 旧 mini-services) — task 说"Python, 保留作参考"; TS 版同
  保留作参考 (Go 重写版在 go-backend/services/, 旧 TS 在 mini-services/, 互不冲突).
- `prisma/schema.prisma` — task 明确保留作 Go modernc.org/sqlite 直接读 DB 的 schema 参考.
- `mini-services/_shared/server.ts` — TS 端共享 server 样板, 旧 mini-services 仍依赖.

**git 跟踪状态确认:**
- `git ls-files go-backend/{heis-backend,*-proxy,*-bridge,backend.log}` → 空 (未跟踪, .gitignore
  R41-1C 入口生效)
- `git ls-files scripts/archive/` → 空 (未跟踪)
- `git ls-files agent-ctx/archive-pre-r28/` → 空 (未跟踪)
- 即所有删除项均未进 git, 删除仅影响工作目录, 不影响 git 历史.

### 8. .gitignore 更新

R41-1C 已添加完整 .gitignore 入口 (heis-backend + 8 服务二进制 + 兜底 *-proxy/*-bridge/*-backend
+ services/*/* 含 .go/.mod/.sum/scripts/.env.example 例外 + *.log). R42-1C 仅补充注释
说明清理状态:

```
# R42-1C: 9 个二进制 + backend.log 已从工作目录删除(总计 ~100MB), 需用时 go build 重新生成.
#         scripts/archive/ + agent-ctx/archive-pre-r28/ 同步清理(过时归档).
```

### 9. 最终验证

- `go build -o heis-backend .` (go-backend/) → 0 errors, binary 24MB (重建后再次删除)
- `go vet ./...` (含 services + crawl + main) → 0 errors
- `staticcheck ./services/... .` → 0 warnings (R42-1C scope)
- `staticcheck ./...` → crawl 包 11 warnings (B agent scope, 仅 flag)
- `bun run lint` → 0 errors
- `curl http://localhost:3000/` → HTTP 200, 迁移占位首页正常渲染 (89 行 page.tsx,
  含 5 模块卡片 + Go 后端说明 + 跳转链接)

## Stage Summary

R42-1C 清理精简完成: 旧 Next.js src/ 350 文件 ~81000 行 → 4 文件 197 行
(仅保留 page.tsx 迁移占位首页 + layout.tsx/not-found.tsx/globals.css 精简版).
Go 后端 16554 行源码 0 改动 (除 moli-bridge 1 文件去重 + bridgeserver 1 helper 新增).
临时文件释放 ~100MB (9 个 Go 二进制 + scripts/archive/ + agent-ctx/archive-pre-r28/ +
backend.log). .gitignore 已完整 (R41-1C 入口 + R42-1C 状态注释). crawl/* 11 处
staticcheck warning 仅 flag 不修 (B agent 后续 sweep). go build + go vet + bun run lint
全 0 errors. Next.js dev server 正常服务迁移占位首页 (HTTP 200). 详细工作记录:
agent-ctx/R42-1C-full-stack-developer.md
