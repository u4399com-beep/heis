# R39-1C — 采集引擎 wiring + 管理后台 Go SSR

**Task ID**: R39-1C
**Agent**: full-stack-developer (采集wiring+管理后台)
**Task**: main.go 采集 API + admin templates + admin 路由
**开始时间**: 2026-09-21 12:00 (UTC+8)
**完成时间**: 2026-09-21 12:25 (UTC+8)
**总耗时**: ~25 分钟

---

## 1. 读交接文档

### 1.1 worklog.md 最后 150 行 — R38-1C 采集引擎 Go 重写
- 8 文件 7063 行: types.go / hostgate.go / fetcher.go / parser.go / cleaner.go /
  smart.go / storage.go / runner.go
- 核心架构: 8 级降级链 + R31-1B 三阶段并发 (Semaphore + crawlBookMeta/
  crawlChapterContent/finalizeBook) + CookieJar + cleaner trafilatura 桥
- R26-1A 路径穿越防御 + R33-1B sibling-prefix + Bug 21/17/28 修复
- 已知差异: XPath 暂不支持, OpenCC stub, SmartCategory LLM 兜底返回 none,
  SaveCoverWebp 无 sharp

### 1.2 go-backend/crawl/*.go API 学习
- `crawl.DBClient` 接口 (13 方法):
  - Task: UpdateTaskStatus/UpdateTaskProgress/InsertTaskLog
  - Book: FindBookBySourceURL/UpsertBook/UpdateBookStatus/
    UpdateBookWordCount/UpdateBookLatestChapter/UpdateBookCover
  - Chapter: FindChapterByURL/UpsertChapter/MarkChapterFetched
- `crawl.Book`/`crawl.Chapter` 实体字段 (与 Prisma 同款)
- `crawl.TaskStats`/`crawl.TaskProgress`/`crawl.LogLevel`/`crawl.LogEntry`
  - 注: Go json.Marshal 默认首字母大写键 (Phase/PhaseNote/BooksDone/...)
- `crawl.ExecuteTaskConfig` 任务执行配置:
  - TaskID/Rule/Override/URLTemplate/ThreadsMin~Max/IntervalMin~Max/
    MaxRequests/RecrawlMode/DB/Logger
- `crawl.ExecuteTask(ctx, cfg)` 三阶段采集主入口
- `crawl.GetTaskRunner().GetRuntime(taskID)` + `.Snapshot()` 实时快照
- TaskRuntime 控制: IsRunning/IsPaused/IsStopped + MarkRunning/Paused/Stopped/Resumed
- `crawl.ParseRuleConfig(raw)` 解析规则 JSON + `crawl.DefaultFetchConfig` 默认值
- `crawl.DefaultRuleConfig()` 默认规则配置

### 1.3 go-backend/main.go (928 行)
- basePath 解析 (找项目根: CWD 含 go-backend 子目录 → CWD; CWD 以 go-backend 结尾
  → 上级)
- db 路径: 优先 db/custom.db, 退回 prisma/dev.db
- 模板解析: templates/*.html + templates/*/*.html + templates/*/*/*.html 递归
  (admin/* 自动包含)
- 现有路由: `/` (homeHandler 视图分发) + `/health` + `/api/public/{books,
  categories,sites,book,chapter}`
- homeHandler: switch view (home/book/read/category/ranking/fulltext/
  search/keyword/history) → `<theme>/<view>` 模板渲染 + fallback shipsay/home
- FuncMap: wordCount/statusLabel/fmtDate/fmtDateShort/add/sub

### 1.4 src/app/api/admin/* TS 路由参考
- `tasks/route.ts` GET: db.task.findMany + 状态过滤 + include rule + take 500
- `tasks/route.ts` POST: normalizeTaskData + validateTaskPair + retryFailedFromTaskId
- `tasks/_shared.ts`: TASK_STATUSES + NormalizedTask 字段全量白名单 +
  clampInt + httpUrl + isPlainObject
- `tasks/[id]/control/route.ts` POST: ACTIONS = ['start','pause','stop'] +
  TaskRunner.control + DB 状态同步
- `rules/route.ts` GET/POST: configToString (≤200KB) + regexGate + db.rule.create
- `books/route.ts` GET: q + categoryId + status 过滤 + skip/take 分页
- prisma/schema.prisma 字段: Task (27 字段) / Rule (7) / Book (16) / Chapter (12) /
  TaskLog (5) / Site (30+)

---

## 2. adminDB 实现 crawl.DBClient (admin.go ~230 行)

`adminDB struct { db *sql.DB }` 实现 crawl.DBClient 接口 13 方法:

```go
// Task 操作
UpdateTaskStatus(taskID, status string) error              // UPDATE Task SET status=?
UpdateTaskProgress(taskID, progress, stats) error           // JSON 序列化 progress+stats 写 Task 表
InsertTaskLog(taskID, level, message string) error          // INSERT INTO TaskLog

// Book 操作
FindBookBySourceURL(sourceURL string) (Book, error)         // SELECT BY sourceUrl
UpsertBook(b Book) (Book, error)                            // 按 sourceUrl 查存在则 UPDATE 否则 INSERT
UpdateBookStatus/WordCount/LatestChapter/Cover              // 单字段 UPDATE

// Chapter 操作
FindChapterByURL(bookID, sourceURL string) (Chapter, error)
UpsertChapter(c Chapter) (Chapter, error)
MarkChapterFetched(chapterID string, fetched bool) error
```

- generateID: `g` + base36 timestamp + 12 字节随机 hex (24 字符, 与 Prisma cuid
  前缀 cl 不冲突, 防并发碰撞)
- nullIfEmpty: categoryId 空串传 nil (SQL 外键约束)
- 与 Prisma schema 字段对齐: Book.sourceUrl/cover/storageMode, Chapter.url/
  storage/wordCount

---

## 3. 采集 API 路由 (admin.go ~800 行)

| Method | Path | Handler | 功能 |
|---|---|---|---|
| GET | /api/admin/health | adminHealthHandler | 健康检查 (memMB + time) |
| GET | /api/admin/tasks | adminTasksHandler | 列任务 (status 过滤 + include ruleName) |
| POST | /api/admin/tasks | adminTasksHandler | 创建任务 + 异步调 crawl.ExecuteTask |
| POST | /api/admin/tasks/:id/control | adminTaskControlHandler | start/pause/stop |
| GET | /api/admin/tasks/:id/snapshot | adminTaskSnapshotHandler | 实时快照 + recentLogs |
| GET | /api/admin/rules | adminRulesHandler | 列规则 (含 taskCount) |
| POST | /api/admin/rules | adminRulesHandler | 创建规则 (config ≤200KB) |
| GET | /api/admin/rules/:id | adminRuleByIDHandler | 单规则详情 |
| PUT | /api/admin/rules/:id | adminRuleByIDHandler | 增量更新 (enabled/name/desc/config) |
| GET | /api/admin/books | adminBooksAPIHandler | 列书籍 (q/categoryId/status + 分页) |

- `adminTaskSubHandler` 按 path 后缀分发 control / snapshot
- `startCrawlTask(taskID, ruleID, ruleConfig, mode, bookURL, listURL, ...)`:
  1. 解析 `crawl.ParseRuleConfig(ruleConfig)`
  2. `json.Unmarshal(fetchConfigStr, &override)` (override 默认 DefaultFetchConfig)
  3. 按 mode 处理 URLs: single→override.URLs=[bookUrl], urls→已在 override,
     range→rule.List.URLTemplate=listUrl
  4. 构建 `crawl.ExecuteTaskConfig` (含 DB=adminDB + Logger)
  5. goroutine 调 `crawl.ExecuteTask(ctx, cfg)` 三阶段并发采集主入口
  6. 终态写回 DB (done/error)

### 任务控制状态机
- **start**: runtime 不存在 → 启动新 goroutine; paused → MarkResumed; running +
  非暂停 → 拒绝
- **pause**: rt.IsRunning → MarkPaused
- **stop**: rt.MarkStopped (幂等)

### 字段白名单 + 钳制 (与 _shared.ts 同口径)
- mode: single | range | urls
- recrawlMode: full | incremental
- storageMode: db | txt
- threadMin~Max: 钳 1~32, min≤max
- intervalMin~Max: 钳 0~600000, min≤max
- refreshIntervalMin: 钳 5~1440
- fetchConfig: ≤50000 字符
- smartCategory/Complete/autoSuggest: 默认 true
- autoRefresh: 默认 false

---

## 4. 管理后台 Go templates (templates/admin/* 共 925 行)

### layout.html (255 行)
- 深色主题 CSS 变量: `--bg:#0b1120 / --card:#131c2e / --border:#243049 /
  --accent:#10b981 (emerald)` 等
- `.app` flex 布局, `.sidebar` 220px 固定宽度 + `.content` 弹性
- 响应式 768px 断点: sidebar 折叠 56px, 文字隐藏
- 模板定义:
  - `admin/head`: 含 CSS (cards/table/pill/btn/modal/logs/progress-bar/pagination)
  - `admin/sidebar`: 含 nav + active 高亮 (按 .Active 字段判断)

### dashboard.html (102 行)
- 4 个 stat card: 书籍总数 (BooksCompleted/Ongoing 分项) / 章节总数
  (24h 新增) / 任务数 (running 数) / 站点+规则
- 最近任务表 (8 条): 任务名 + 规则 + pill 状态 + progress-bar + 进度文案 + 更新
- 最近书籍表 (8 条): 书名 + 作者 + pill 状态 + 更新

### tasks.html (270 行)
- 任务列表表头: 任务名 / 规则+模式 / 状态 / 进度 / 统计 / 更新 / 操作
- 每行操作按钮 (按状态联动): running→暂停+停止; paused→恢复+停止; 其他→启动
- 新建任务 modal: 全字段表单 (name/ruleId/mode/bookUrl/listUrl/listStart~End/
  bookStart~End/recrawlMode/storageMode/threadMin~Max/intervalMin~Max/
  fetchConfig JSON)
- 任务详情 modal: fetch /api/admin/tasks/:id/snapshot 显示 runtime + 日志流
- 状态过滤下拉 + 计数
- 内联 JS: openCreateModal/openDetailModal/controlTask/submitCreate/showToast

### books.html (88 行)
- 工具栏: 搜索框 + 分类下拉 + 状态下拉 + 筛选按钮 + 计数
- 书籍列表表头: 书名+id / 作者 / 分类 / 状态 pill / 字数 / 章节数 / 存储模式 /
  更新 / 查看
- 分页: buildPageList + 上一页/下一页 + 当前页高亮

### rules.html (149 行)
- 规则列表表头: 规则名+id / 描述 / 状态 pill / 任务数 / 更新 / 操作
- 操作按钮: 查看配置 + 启用/禁用切换
- 新建规则 modal: name + description + config JSON textarea + enabled
- 查看配置 modal: fetch /api/admin/rules/:id + JSON 美化显示
- 内联 JS: openCreateModal/viewConfig/toggleRule/submitCreate

### sites.html (61 行)
- 计数 + 默认站点名
- 站点列表表头: 站点名+id / 域名 code / 主题 / 状态 pill / 默认 / 偏移 / 操作
- 访问按钮 (https://domain) + 前台按钮 (/?site=id)

---

## 5. main.go wiring (增 11 行)

```go
// R39-1C: 采集后台 API (与 src/app/api/admin/* 同口径, 调 crawl 包)
http.HandleFunc("/api/admin/health", adminHealthHandler)
http.HandleFunc("/api/admin/tasks", adminTasksHandler)
http.HandleFunc("/api/admin/tasks/", adminTaskSubHandler) // /:id/control + /:id/snapshot
http.HandleFunc("/api/admin/rules", adminRulesHandler)
http.HandleFunc("/api/admin/rules/", adminRuleByIDHandler) // /:id
http.HandleFunc("/api/admin/books", adminBooksAPIHandler)

// R39-1C: 采集后台页面 (Go templates SSR, 深色主题)
http.HandleFunc("/admin", adminPageHandler)
http.HandleFunc("/admin/", adminPageHandler) // /admin/tasks, /admin/books, ...
```

`adminPageHandler` 按 r.URL.Path 后缀分发:
- `""` or `"dashboard"` → `admin/dashboard` 模板
- `"tasks"` → `admin/tasks`
- `"books"` → `admin/books`
- `"rules"` → `admin/rules`
- `"sites"` → `admin/sites`

`renderAdminPage` 统一装配通用 data (Title/Active) + 按 tmplName 调对应 fill
函数 (fillDashboardData / fillTasksPageData / fillBooksPageData /
fillRulesPageData / fillSitesPageData) + ExecuteTemplate 渲染.

---

## 6. 修复 crawl/cleaner.go init bug (R39-1C 顺带修)

### 问题
- heis-backend 启动 panic: `regexp: Compile(...): error parsing regexp:
  invalid escape sequence: \u`
- 原因: cleaner.go:297/300 用了 `\u200B \u200D \u2060 \uFEFF` 转义, 但 Go RE2
  正则不支持 `\u` 转义 (仅支持 `\x{XXXX}`)
- R38-1C 时 `go build` 仅编译通过 (init 函数运行时才 panic), 之前 main.go 未
  import crawl 包, init 未触发, bug 未暴露
- R39-1C admin.go 引入 `import "heis-backend/crawl"`, init() 运行时 panic

### 修复
- cleaner.go:297/300 改 `\u200B-\u200D` → `\x{200B}-\x{200D}` 等
- 不动 cleaner 其他逻辑 (仅 3 行正则转义)
- 修后 heis-backend 启动正常: "已加载 N 个模板" + "heis-backend 启动: localhost:3001"

### 三处正则修复
```go
// 修前: regexp.MustCompile(`[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D\u2060\uFEFF]`)
// 修后: regexp.MustCompile(`[\x00-\x08\x0B\x0C\x0E-\x1F\x{200B}-\x{200D}\x{2060}\x{FEFF}]`)
// 同款 ZWStripOnlyRe (line 300)
```

---

## 7. 编译确认 + 端到端测试

### 编译
- `go build -o heis-backend . 2>&1 | tail -5` → exit 0, binary 20209608 bytes ✓
- `go vet ./... 2>&1` → exit 0, 0 warnings ✓

### 端到端 curl 测试 (15+ case 全通过)
```
/admin            → HTTP 200 (dashboard 渲染 + stat card + 最近任务/书籍)
/admin/tasks      → HTTP 200 (任务列表 + pill + progress-bar + 进度文案)
/admin/books      → HTTP 200 (书籍列表 + 搜索/过滤/分页)
/admin/rules      → HTTP 200 (规则列表 + 状态切换)
/admin/sites      → HTTP 200 (4 站点 + 默认 dewew)
/api/admin/health → {"ok":true,"lang":"go","memMB":11,"time":"..."}
/api/admin/tasks  → 列任务 JSON 含 progress/stats 解析
/api/admin/tasks?status=done → 状态过滤 ✓
/api/admin/rules → 列规则 JSON 含 config + taskCount
/api/admin/books?size=3 → 列书籍 JSON 含 chapterCount
POST /api/admin/tasks (real ruleId + invalid URL) → HTTP 200 + 异步 startCrawlTask
POST /api/admin/tasks/:id/control action=stop → HTTP 200 + 状态 stopped
POST /api/admin/tasks/:id/control action=foo → HTTP 400 "无效操作"
POST /api/admin/tasks/:id/control nonexistent-id → HTTP 404 "任务不存在"
GET  /api/admin/tasks/:id/snapshot (未在运行) → HTTP 404 "无运行时快照"
POST /api/admin/rules → HTTP 200 + 含 id
PUT  /api/admin/rules/:id enabled=false → HTTP 200 + 更新成功
GET  /api/admin/rules/:id → HTTP 200 + config 解析为对象
GET  /api/admin/rules/nonexistent → HTTP 404 "规则不存在"
```

### 测试期间发现的 Bug (admin.go 内修复)
1. **INSERT INTO Task VALUES 子句 ? 数量错**
   - 25 个 `?` 但 22 个 args → SQLite 报 "30 values for 27 columns"
   - 修: 改为 22 个 `?` 匹配 22 个 args
2. **INSERT INTO Rule VALUES 子句 ? 数量错**
   - 6 个 `?` 但 5 个 args → "8 values for 7 columns"
   - 修: 改为 5 个 `?` 匹配 5 个 args
3. **adminTaskControlHandler path 切分校验**
   - 原 `len(parts) < 3` 错误 (parts=[id, action], len=2)
   - 修: `len(parts) < 2 || parts[0] == "" || parts[1] != "control"`
4. **adminTaskSnapshotHandler path 切分校验** 同款修
5. **TaskLog INSERT 简化**
   - 原 INSERT "2026-01-01" + UPDATE last_insert_rowid() 二段写
   - 修: INSERT datetime('now') 一步搞定
6. **Dashboard/Tasks JSON 字段大小写**
   - crawl.TaskProgress/TaskStats Go 字段首字母大写 (json.Marshal 默认)
   - 修: progObj["phase"] → progObj["Phase"] (Phase/PhaseNote/BooksDone/
     BooksTotal/ContentDone/ContentTotal/BooksCreated/BooksUpdated/
     ChaptersCreated/ChaptersUpdated/Errors 全部对齐)

### 清理测试数据
- python3 + sqlite3 模块 DELETE FROM Task/Rule WHERE id LIKE 'gtl%' OR name
  LIKE 'R39-1C-%' ✓

---

## 8. 未修改 (尊重约束)

- `go-backend/crawl/*` (R38-1C 重写, 不动逻辑; 仅 cleaner.go 修 3 行 RE2 转义
  init bug, 不改语义) ✓
- `go-backend/templates/{shipsay,aijjxs,23qb,...}/*` (A/B agent 负责, 不动) ✓
- `src/*` (旧代码, 不动) ✓
- `prisma/schema.prisma` (不动) ✓
- `package.json` / `go.mod` / `go.sum` (不动) ✓

---

## 9. 已知简化 (不影响核心 wiring 闭环)

### 未实现的 admin API (TS 端有, Go 端暂缺, 后续补)
- 任务: PUT /tasks/:id (编辑), DELETE /tasks/:id, POST /tasks/batch (批量),
  GET /tasks/:id/logs (日志历史), GET /tasks/:id/failed-books
- 规则: POST /rules/test (规则测试), POST /rules/calibrate-all, POST /rules/:id/
  duplicate, POST /rules/:id/calibrate + apply
- 书籍: POST /books (手动新增), GET/PUT /books/:id, GET /books/:id/toc, POST
  /books/:id/keywords, /recrawl, /pseo
- 章节: GET/PUT /chapters/:id, POST /chapters/batch
- 其他: sites/*, downloads/*, feedback/*, backup/*, themes/*, settings/*,
  links/*, categories/*, stats/*, seo-audit

### 管理后台简化
- 无登录鉴权 (TS 端 NextAuth 在 Go 端未复刻) — 任何人均可访问 /admin ⚠
- 任务详情 modal 仅显示 runtime 快照 + recentLogs, 未展示 DB 中的 progress/stats
  历史 JSON 字段
- 任务列表每页 200 条, 无翻页 (足够用, 大部分场景任务数 < 200)
- 规则配置编辑 textarea (无 JSON 语法高亮 / 折叠)
- 站点管理只读 (无新增/编辑/删除按钮)

### Go 改造优于 TS 的部分 (已实现)
- goroutine + channel 异步启动采集 (无 Promise.all 内存开销) ✓
- http.ServeMux 路径前缀匹配 (无 express 路由解析开销) ✓
- html/template 编译后复用 (无 React JSX 重新渲染开销) ✓
- 适配器模式 adminDB 实现 DBClient 接口 (crawl 包不直接依赖 sqlite/Prisma) ✓

---

## 10. 验证清单

- [x] go build -o heis-backend . → 0 errors, binary 20209608 bytes
- [x] go vet ./... → 0 warnings
- [x] heis-backend 启动正常 (init 不再 panic)
- [x] /admin + 4 子页全部 HTTP 200
- [x] /api/admin/* 11 个路由全部 HTTP 200 (或符合预期的 4xx)
- [x] 任务创建 → 异步启动 crawl.ExecuteTask (real ruleId 测试)
- [x] 任务控制 (stop) → 状态写回 DB
- [x] 规则创建 → 返回 id; toggle 启用/禁用
- [x] Edge case: 不存在的 id → 404, 非法 action → 400, 非法 mode → 404 (ruleId
  not found)
- [x] 测试数据清理完毕

---

## 11. 文件清单

| 文件 | 行数 | 类型 | 说明 |
|---|---|---|---|
| `go-backend/admin.go` | 1536 | Go | 新增: adminDB + 11 API + 5 页面 handler |
| `go-backend/main.go` | 940 (+12) | Go | 增: 注册 admin API + admin 页面路由 |
| `go-backend/crawl/cleaner.go` | 705 (改 3 行) | Go | 修: \u 转义 → \x{} (init bug) |
| `go-backend/templates/admin/layout.html` | 255 | HTML | 新增: head + sidebar 模板 |
| `go-backend/templates/admin/dashboard.html` | 102 | HTML | 新增: 仪表盘 |
| `go-backend/templates/admin/tasks.html` | 270 | HTML | 新增: 任务列表 + modal |
| `go-backend/templates/admin/books.html` | 88 | HTML | 新增: 书籍管理 |
| `go-backend/templates/admin/rules.html` | 149 | HTML | 新增: 规则管理 |
| `go-backend/templates/admin/sites.html` | 61 | HTML | 新增: 站点管理 |
| **总计** | **2601** | | 1 Go 新文件 + 1 Go 修文件 + 6 HTML 新文件 |

---

## 12. 与 R38-1C 采集引擎接驳点

```
main.go (admin 路由注册)
    ↓
admin.go (adminPageHandler + 11 API handler)
    ↓ HTTP
admin.go (adminDB 实现 crawl.DBClient 接口)
    ↓ 适配器模式
crawl.ExecuteTask(ctx, cfg)  ← R38-1C 三阶段采集主入口
    ↓ 阶段 0: discoverBooks
    ↓ 阶段 1: 并发 CrawlBookMeta (Semaphore + goroutine + sync.WaitGroup)
    ↓ 阶段 2: 全局并发 CrawlChapterContent (channel 限 N)
    ↓ 阶段 3: 串行 FinalizeBook
crawl.GetTaskRunner().GetRuntime(taskID) ← 运行时控制 (MarkPaused/Stopped/Resumed)
crawl.GetTaskRunner().Snapshot(taskID) ← 实时快照 (供 admin UI 查询)
```

适配器模式让 crawl 包不直接依赖 sqlite/Prisma, wiring 层实现 DBClient 接口注
入, 解耦清晰. 后续如换 MySQL/Postgres, 只需替换 adminDB 实现即可.
