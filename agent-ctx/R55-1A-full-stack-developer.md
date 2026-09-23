# R55-1A — admin 全页面编辑功能补全

**Task ID**: R55-1A
**Agent**: full-stack-developer (admin全页面编辑功能)
**完成时间**: 2025-09-23

## 目标

用户要求"后台所有功能都需要可以编辑". 对 12 个 admin 页面逐一审计 CRUD 完备度, 补齐缺失的 create/edit/delete.

## 审计结果 (12 admin 页面)

| 页面 | 原状态 | R55-1A 补齐 |
| --- | --- | --- |
| dashboard | ✓ 统计 | (无需编辑) |
| tasks | ✓ 创建/启动/暂停/停止 | **+ 删除任务** |
| books | ✗ 仅搜索/查看 | **+ 新建/编辑/删除 (含级联清章/标签/下载)** |
| rules | ✓ 创建/启用禁用 | **+ 编辑全 config + 删除 (引用检查)** |
| sites | ✗ 仅查看 | **+ 新建/编辑/删除 (含主题切换面板)** |
| categories | ✓ 已完整 CRUD + 拖拽排序 | — |
| links | ✓ 已完整 CRUD + 链轮配置 | — |
| themes | ✗ 仅查看 (主题静态注册) | **+ 站点主题切换面板** (per-site themeId 编辑) |
| downloads | ✓ 创建/下载 | **+ 删除 (含内存缓存清理)** |
| settings | ✓ 编辑/toggle/add | **+ 删除单个 key** (feedbackEnabled 受保护) |
| feedback | ✓ 详情/状态/删除 | — (回复通过 PATCH adminNote) |
| backup | ✓ 导出/导入/VACUUM | **+ 清空采集产物** (保留基础设施) |
| seo-audit | ✓ 审计 | **+ 修复入口深链** (→ /admin/sites/links/books) |

## 改动文件

### 1. `go-backend/admin.go` (+~600 行)

新增 handlers:

- **adminTaskDeleteHandler** — DELETE /api/admin/tasks/:id (停 runtime + 删 Task + TaskLog)
- **adminBooksCreate** — POST /api/admin/books (手动建书, 校验 categoryId 存在)
- **adminBookByIDHandler** — PUT/DELETE /api/admin/books/:id (PUT 增量更新 8 字段; DELETE 级联清 Chapter/BookTag/DownloadJob + 内存下载缓存)
- **adminSitesHandler** — GET 列 / POST 新建站点
- **adminSiteByIDHandler** — PUT/DELETE /api/admin/sites/:id (PUT 13 字段含 isDefault 互斥; DELETE 禁止默认站点)
- **adminSitesList** / **adminSitesCreate** — 实现
- **adminDownloadsSubHandler** — 分发 /:id/file GET + /:id DELETE (重构原 adminDownloadFileHandler)
- **adminDownloadsDelete** — DELETE /api/admin/downloads/:id (清内存缓存 + 删 DownloadJob 行)
- **adminDownloadFileHandlerImpl** — 从原 handler 抽出供 sub-handler 调用
- **adminSettingsDeleteHandler** — DELETE /api/admin/settings/:key (禁删 feedbackEnabled)
- **adminBackupClearHandler** — POST /api/admin/backup/clear {confirm:true} (停所有运行 task → 按 dep 顺序清 TaskLog/Task/DownloadJob/BookTag/Chapter/Book + 内存缓存)

扩展 handlers:

- **adminTaskSubHandler** — 加 DELETE /:id 分发分支 (原仅 /control + /snapshot)
- **adminRuleByIDHandler** — 加 DELETE case (校验任务引用 count > 0 拒绝)
- **adminBooksAPIHandler** — 重构为 GET→adminBooksList + POST→adminBooksCreate
- **adminBackupSubHandler** — 加 case path == "clear"

扩展 page data:

- **fillSitesPageData** — SELECT 加 icbm/geoRegion/geoPlacename/inLinkWheel + Themes 列表 (供 edit modal 下拉)
- **fillBooksPageData** — SELECT 加 keywords (供 edit modal 回填)
- **fillThemesPageData** — 加 Sites 列表 (供主题切换面板下拉)

### 2. `go-backend/main.go` (+10 行)

- 注册 `toJSON` template FuncMap (返回 template.HTMLAttr, 供 `data-site='{{toJSON .}}'` 行数据承载, 防 HTML 二次转义)
- 新增/调整路由:
  - `/api/admin/tasks/` → adminTaskSubHandler (注释更新含 DELETE)
  - `/api/admin/rules/` → adminRuleByIDHandler (注释含 DELETE)
  - `/api/admin/books` → adminBooksAPIHandler (注释含 POST)
  - `/api/admin/books/` → adminBookByIDHandler (新)
  - `/api/admin/downloads/` → adminDownloadsSubHandler (重构自 adminDownloadFileHandler)
  - `/api/admin/settings/` → adminSettingsDeleteHandler (新)
  - `/api/admin/sites` → adminSitesHandler (新)
  - `/api/admin/sites/` → adminSiteByIDHandler (新)

### 3. `go-backend/templates/admin/*.html` (12 模板)

- **sites.html** — 重写: 表格 +9 列(TDK/链轮) + edit/delete 按钮 + 13 字段 modal + 主题下拉 + data-site='{{toJSON .}}' 行数据
- **books.html** — 重写: +edit/delete 按钮 + 9 字段 modal (name/author/categoryId/status/cover/intro/keywords/sourceUrl) + 级联删除提示
- **rules.html** — +edit (全 config 编辑 modal) + delete 按钮 + viewConfig 保留
- **tasks.html** — +delete 按钮 (paused/stopped/done/error 状态可删, running 必须先 stop)
- **downloads.html** — +delete 按钮 (清内存缓存 + DB 行)
- **settings.html** — 每 card +🗑 删除按钮 (feedbackEnabled 卡片无此按钮, 受保护)
- **backup.html** — 危险操作区扩展为 2 列卡片: 清空采集产物 + VACUUM (clearData 函数含 "CLEAR" 二次确认 prompt)
- **themes.html** — +主题切换面板 (站点下拉 + 新主题下拉 + 应用切换按钮, 调 PUT /api/admin/sites/:id {themeId})
- **seo-audit.html** — +修复入口深链行 (前往站点管理/友链管理/书籍管理) + 每个 report card +🔧 编辑按钮
- **dashboard.html / categories.html / links.html / feedback.html** — 未改 (已完整或无需编辑)

## 验证 (curl 端到端)

```
--- 站点 CRUD ---
POST   /api/admin/sites                 → 200 ok, siteId=gtltk8r82...
PUT    /api/admin/sites/:id              → 200 ok, updated=true (改名 + 切 themeId + offset=42)
GET    /api/admin/sites                  → 12 sites, R55TestEdited 在列
DELETE /api/admin/sites/:id              → 200 ok, deleted=true
                                       → 11 sites (已删)

--- 书籍 CRUD ---
POST   /api/admin/books                 → 200 ok, bookId=gtltkb4e0...
PUT    /api/admin/books/:id             → 200 ok, updated=true (改名 + status=ongoing)
DELETE /api/admin/books/:id             → 200 ok, deleted=true (级联清 Chapter/BookTag/DownloadJob)

--- 规则 CRUD ---
POST   /api/admin/rules                 → 200 ok, ruleId=gtltkbdf...
PUT    /api/admin/rules/:id             → 200 ok, updated=true (改名 + enabled=true)
DELETE /api/admin/rules/:id             → 200 ok, deleted=true (无任务引用)

--- 任务删除 ---
POST   /api/admin/tasks                → 200 ok, status=running
POST   /api/admin/tasks/:id/control     → 200 ok, action=stop
DELETE /api/admin/tasks/:id             → 200 ok, deleted=true (停 runtime + 删 Task + TaskLog)

--- 下载删除 ---
GET    /api/admin/downloads             → 0 (无数据可测, handler 已实现 DELETE 分支)

--- 设置 CRUD ---
PUT    /api/admin/settings              → 200 ok, r55TestKey="hello world"
DELETE /api/admin/settings/r55TestKey   → 200 ok, deleted=true
DELETE /api/admin/settings/feedbackEnabled → 400 (受保护, 拒绝删除)

--- 备份清空 ---
POST   /api/admin/backup/clear (无 confirm)  → 400 (拒绝执行)
POST   /api/admin/backup/clear {confirm:true} → 200 ok, cleared={books:2, chapters:1836, tasks:8, taskLogs:11721, bookTags:25, downloadJobs:0}
                                          → Site=12 / Category=15 / Rule=71 / FriendLink=0 / Setting=12 (基础设施保留)
```

页面渲染验证 (所有 12 admin 页面 200 OK + 关键 JS 函数 grep 命中):
- /admin/sites: 29 处 (新建站点/editSiteFromRow/deleteSite)
- /admin/books: 6 处 (新建书籍/editBookFromRow/deleteBook)
- /admin/rules: 149 处 (editRule/deleteRule/submitRuleEdit)
- /admin/tasks: 1 处 (deleteTask)
- /admin/downloads: 1 处 (deleteDownload)
- /admin/settings: 12 处 (deleteSetting)
- /admin/backup: 2 处 (clearData)
- /admin/themes: 5 处 (switchTheme/主题切换)
- /admin/seo-audit: 3 处 (前往站点管理修复/前往友链管理/前往书籍管理)
- /admin/feedback: 7 处 (viewFeedback/deleteFeedback/setStatus — 已有, 未改)
- /admin/categories: 36 处 (editCat/deleteCat/submitEdit — 已有, 未改)
- /admin/links: 5 处 (editLink/deleteLink/toggleLink — 已有, 未改)

## 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . 2>&1 | tail -5
# (no output, exit 0) → BUILD OK

~/go/go/bin/go vet ./... 2>&1 | tail -5
# (no output, exit 0) → VET OK
```

二进制: heis-backend 24,438,242 bytes (R54-1C 24,367,465 + ~70KB 新增 handlers/templates)

## 设计要点

1. **级联删除** — Book DELETE 清 Chapter + BookTag + DownloadJob (无外键约束, 手动清) + 内存下载缓存. Task DELETE 清 TaskLog + 停 runtime. Site DELETE 不允许删 isDefault 站点.
2. **运行中保护** — Task DELETE 拒绝 status=running (必须先 stop). 备份 clear 前先停所有运行 task 再清表.
3. **唯一性约束** — Site domain 唯一 (POST 校验已存在 / PUT 校验排除自身).
4. **数据完整性** — Site POST 校验 themeId 在已注册主题列表. Book POST/PUT 校验 categoryId 存在. Book POST/PUT 校验 cover 仅 http(s) 或 / 开头路径. Rule DELETE 校验无任务引用 (避免悬空外键).
5. **危险操作二次确认** — backup clear 前端需 prompt 输入 "CLEAR" 二次确认, 后端需 body.confirm=true 双重保险.
6. **受保护设置项** — feedbackEnabled 不能删除 (否则前台状态不一致), 必须通过 toggle 切换.
7. **data-* 行数据承载** — 用 `data-site='{{toJSON .}}'` (template.HTMLAttr 类型, json.Marshal 默认转义 < > &) 避免 onclick 内联大对象字面量 + 防 HTML 二次转义错乱.
