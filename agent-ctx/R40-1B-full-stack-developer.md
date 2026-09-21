# R40-1B — full-stack-developer (8 admin页面 + API)

**Task ID**: R40-1B
**Agent**: full-stack-developer
**Task**: 创建 8 个 admin 页面 (categories/links/themes/downloads/settings/feedback/backup/seo-audit) + 对应 API + main.go 路由注册

---

## 1. 接管前状态 (交接文档阅读)

读交接文档 4 份:

1. `go-backend/templates/admin/layout.html` + `dashboard.html` — 学习 admin 模板写法 (深色主题 CSS 变量 + sidebar 模板 + 表格卡 + Modal + Toast)
2. `go-backend/admin.go` — 学习 admin API 模式 (1536 行: adminDB 适配器 + 11 个采集 API + 5 个页面 handler)
3. `src/app/api/admin/{categories,links,themes,downloads,settings,feedback,backup,seo-audit}/route.ts` — 了解 TS 端契约 (URL/方法/字段消毒/响应格式)
4. `src/components/admin/{CategoriesSection,LinksSection,ThemesSection,DownloadsSection,SettingsSection,FeedbackSection,BackupSection,SeoAuditSection}.tsx` — 了解前端 UI 模式

读取 prisma schema 确认字段: Category{name sortOrder} / FriendLink{name url logo sortOrder enabled} / DownloadJob{bookId options status filePath error size} / Setting{key value} / Feedback{type contact content url siteId status adminNote ip userAgent}

---

## 2. 改动范围

### 修改文件 (2 个)

| 文件 | 改动 |
|---|---|
| `go-backend/templates/admin/layout.html` | sidebar 新增 8 个 nav 项 (分类/友链/主题/下载/设置/反馈/备份/SEO审计) |
| `go-backend/main.go` | 注册 8 个新 API 路由 + 8 个新 FuncMap 函数 (fbTypeLabel/fbTypePill/fbStatusLabel/fbStatusPill/scoreColor/severityColor/severityLabel/jobStatusLabel) + 新增 `strconv` 导入 |
| `go-backend/admin.go` | 末尾追加 ~1870 行新代码: 8 个主题静态注册表 + 8 个 API handler + 8 个 page filler + adminPageHandler/renderAdminPage switch 扩展 + 新增 `io/regexp/sort/sync` 导入 |

### 新增文件 (8 个模板)

| 文件 | 行数 | 功能 |
|---|---|---|
| `go-backend/templates/admin/categories.html` | 161 | 分类 CRUD + 拖拽排序 |
| `go-backend/templates/admin/links.html` | 177 | 友链 CRUD + 链轮配置 |
| `go-backend/templates/admin/themes.html` | 70 | 10 套主题预览卡 + 主题统计 |
| `go-backend/templates/admin/downloads.html` | 138 | 下载任务列表 + 新建 Modal + TXT 下载 |
| `go-backend/templates/admin/settings.html` | 102 | 设置项 CRUD + 添加新 key |
| `go-backend/templates/admin/feedback.html` | 158 | 反馈列表 + 状态/类型/搜索过滤 + 详情 Modal |
| `go-backend/templates/admin/backup.html` | 132 | 数据库统计 + 导出按钮 + 导入 dry-run/真实 + VACUUM |
| `go-backend/templates/admin/seo-audit.html` | 81 | 审计概览 + 按站点过滤 + 站点卡片列表 (issues + passed) |

**模板总行数**: 1019

---

## 3. 新增 API 路由 (13 个)

| 路由 | 方法 | handler | 说明 |
|---|---|---|---|
| `/api/admin/categories` | GET / POST | adminCategoriesHandler | 列分类 / 新建 |
| `/api/admin/categories/:id` | PUT / DELETE | adminCategoryByIDHandler | 更新 / 删除 |
| `/api/admin/links` | GET / POST / PUT / DELETE | adminLinksHandler | 列 / 建 / 改(body.id) / 删(?id) |
| `/api/admin/links/:id` | PUT / DELETE | adminLinkByIDHandler | 改 / 删 (path 风格, 兼容 body.id) |
| `/api/admin/themes` | GET | adminThemesHandler | 返回 10 套主题静态数组 |
| `/api/admin/downloads` | GET / POST | adminDownloadsHandler | 列下载 / 新建 (异步生成 TXT) |
| `/api/admin/downloads/:id/file` | GET | adminDownloadFileHandler | TXT 文件下载 |
| `/api/admin/settings` | GET / PUT | adminSettingsHandler | 列设置 / 批量 upsert |
| `/api/admin/feedback` | GET | adminFeedbackHandler | 列反馈 (status/type/q 过滤 + 分页 + stats) |
| `/api/admin/feedback/:id` | GET / PATCH / DELETE | adminFeedbackByIDHandler | 详情 / 改状态+备注 / 删除 |
| `/api/admin/backup` | GET | adminBackupHandler | 导出全库 JSON (含 settings/categories/sites/friendLinks/rules/books+chapters+tags/tasks/downloadJobs) |
| `/api/admin/backup/restore` | POST | adminBackupSubHandler→adminBackupRestoreHandler | 导入 JSON (?dryRun=1 仅预检) |
| `/api/admin/backup/vacuum` | POST | adminBackupSubHandler→adminBackupVacuumHandler | VACUUM 清理碎片 |
| `/api/admin/seo-audit` | GET | adminSeoAuditHandler | 全站 SEO 体检 (?site=:id 单站) |

---

## 4. 关键设计决策

### 4.1 主题静态注册表
- 在 `admin.go` 内嵌 `adminThemes` 切片, 10 套精仿主题 (clone-aijjxs/ddyueshu/pilishuwu/23qb/101kks/huangjinwu/ggd66/shipsay/x2552/trxsw)
- 字段对齐 TS `THEMES` 数组: id/name/desc/layout/dark/contentSelector/read.{layout,fontBase}
- 增加 PreviewBg/PreviewText 用于 themes.html 渲染主题卡片预览
- API `/api/admin/themes` 直接遍历数组返回, + 用 SQL 聚合每主题 Site 数量附加 `siteCount`

### 4.2 链轮配置
- Wheel 配置存在 Setting 表 key='linkwheel' (与 TS `WHEEL_SETTING_KEY='linkwheel'` 同口径)
- 链轮配置修改通过 `/api/admin/settings` PUT, links.html 表单提交 `{linkwheel:{enabled,mode,count}}` 即可
- 链位 count 钳制 1~30, mode 白名单 home/book/mixed

### 4.3 下载任务 (异步生成)
- `MAX_CONCURRENT_DOWNLOAD_JOBS=3`, 用 `sync.Mutex` 保护的 `downloadInFlight` 计数器实现并发占位 (与 TS inFlightGenerations HMR 单例同款语义)
- 陈旧在途任务 (>1h 无终态) 在 POST 入口处清扫 → 标记 error, 防进程重启遗留孤儿
- 异步 goroutine 生成 TXT: 章节序号+标题+正文拼接, 存到 `downloadFiles map[string]string` (内存), DB 写 status='done' + filePath='memory:{jobId}'
- 简化版 TXT 生成 (Go 端未复刻混淆/广告注入/headerTemplate 等), 后续 R41 可补
- `GET /api/admin/downloads/:id/file` 返回内存中的 TXT 文件 (Content-Disposition: attachment; filename="bookname.txt")

### 4.4 数据备份 (导出/导入)
- 导出格式与 TS 路由完全兼容 (version/exportedAt/counts/warnings/data)
- books > 200 (BIG_BOOKS_THRESHOLD) 时仅导出元数据 (不含 chapters + tags)
- 导出时同步写 `Setting.lastBackupAt` 记录备份时间, backup.html 显示
- 导入支持 `?dryRun=1` 预检 (只解析 + 返回 counts, 不写库)
- 真正导入用 SQLite `INSERT ... ON CONFLICT(id) DO UPDATE` upsert (按 ID), 全表覆盖
- 单文件最大 50MB (`io.LimitReader` 限制)
- `/api/admin/backup/vacuum` 执行 `VACUUM` 清理 DB 碎片

### 4.5 SEO 审计
- 完全对齐 TS `auditSite` 逻辑: TDK/domain/content/links/theme/geo/sitemap/offset 8 个维度
- 评分: error -10, warning -3, info -1, 下限 0
- 排序: error 数多的在前, 同错按 score 升序
- regex 私网检测 (10/127/192.168/172.16-31/169.254/100.64-127) + 域名格式校验
- ICBM 经纬度校验 (-90~90 lat, -180~180 lng)
- `lenRune()` 用 rune 计数 (与 TS `.length` 同语义)

### 4.6 反馈管理
- 列表带 status/type/q 三维过滤 + 分页 + 统计 (total/new/resolved)
- PATCH 局部更新 status/adminNote, adminNote 剥 HTML 标签防存储型 XSS
- PATCH/DELETE 前检查存在性 → 404 (与 TS P2025 同语义)

---

## 5. 编译验证

```bash
cd /home/z/my-project/go-backend && export PATH=$HOME/go/go/bin:$PATH && go build -o heis-backend .
```
- **0 errors**, binary 20,510,125 bytes (≈20.5MB)
- `go vet .` (仅主包): 0 warnings
- `go vet ./...` (含 services/qimao-proxy): 1 warning (`normBook redeclared`) — A agent 的 services/qimao-proxy 问题, 与本任务无关

---

## 6. 端到端测试 (heis-backend 启动 → 94 模板加载)

### 6.1 admin 页面全部 HTTP 200

| 页面 | 状态 | 大小 |
|---|---|---|
| /admin/dashboard | 200 | 19.6 KB |
| /admin/tasks | 200 | 36.0 KB |
| /admin/books | 200 | 20.0 KB |
| /admin/rules | 200 | 35.1 KB |
| /admin/sites | 200 | 18.0 KB |
| /admin/categories | 200 | 24.3 KB |
| /admin/links | 200 | 21.1 KB |
| /admin/themes | 200 | 21.7 KB |
| /admin/downloads | 200 | 30.4 KB |
| /admin/settings | 200 | 19.6 KB |
| /admin/feedback | 200 | 19.9 KB |
| /admin/backup | 200 | 35.0 KB |
| /admin/seo-audit | 200 | 21.0 KB |

### 6.2 admin API 全部 HTTP 200

| API | 状态 | 响应大小 | 备注 |
|---|---|---|---|
| /api/admin/categories | 200 | 1.97 KB | 18 个分类 + bookCount |
| /api/admin/links | 200 | 22 B | 空数组 (无友链) |
| /api/admin/themes | 200 | 3.16 KB | 10 套主题 |
| /api/admin/downloads | 200 | 22 B | 空数组 |
| /api/admin/settings | 200 | 3.77 KB | 7 项设置 |
| /api/admin/feedback | 200 | 742 B | 空列表 |
| /api/admin/backup | 200 | 15.58 MB | 全库 JSON |
| /api/admin/seo-audit | 200 | 3.70 KB | 审计结果 |

### 6.3 CRUD 流程测试 (临时数据 + 测后清理)

| 操作 | 响应 | 验证 |
|---|---|---|
| POST /api/admin/categories `{name:"R40-1B-测试分类",sortOrder:99}` | `{"ok":true,"data":{"id":"gtlptu963e4c304d2b9c0f33fa56e21","name":"R40-1B-测试分类","sortOrder":99}}` | cuid-like ID 前缀 'g' (Go 端生成, 防与 Prisma 'cl' 冲突) ✓ |
| PUT /api/admin/categories/:id `{name:"R40-1B-改后分类",sortOrder:50}` | `{"ok":true,"data":{"id":"...","updated":true}}` | 字段级更新 ✓ |
| DELETE /api/admin/categories/:id | `{"ok":true,"data":{"deleted":true,"id":"..."}}` | 删除成功 ✓ |
| POST /api/admin/links `{name:"R40-1B测试友链",url:"https://example.com"}` | `{"ok":true,"data":{"id":"gtlptu9b4f2ce4f65c51380ee26690c","name":"...","url":"https://example.com","sortOrder":5,"enabled":true}}` | 友链创建 ✓ |
| PUT /api/admin/links/:id `{enabled:false}` | `{"ok":true,"data":{"id":"...","updated":true}}` | 启停切换 ✓ |
| DELETE /api/admin/links/:id | `{"ok":true,"data":{"deleted":true,"id":"..."}}` | 删除成功 ✓ |
| PUT /api/admin/settings `{R40_1B_test_key:"hello",R40_1B_obj:{a:1,b:[true,false,null]}}` | `{"ok":true,"data":{"R40_1B_obj":{...},"R40_1B_test_key":"hello",...}}` | 批量 upsert + JSON value 自动类型化 ✓ |
| POST /api/admin/backup/vacuum | `{"ok":true,"data":{"ok":true}}` | VACUUM 完成 ✓ |
| PATCH /api/admin/feedback/nonexistent | `{"ok":false,"error":"反馈不存在"}` | 404 边界 ✓ |
| POST /api/admin/downloads `{}` | `{"ok":false,"error":"请选择书籍"}` | 400 校验 ✓ |
| POST /api/admin/downloads `{bookId:"cmu2j25pz0040prts6i51wfjo"}` | `{"ok":true,"data":{"id":"gtlptvo1ee95b4873df7b288893c528","status":"pending"}}` | 异步生成启动 ✓ |
| GET /api/admin/downloads/:id/file (1s 后) | HTTP 200, 13.94 MB TXT | 内容以 "万相之王" 开头, 章节序号+标题+正文 ✓ |
| GET /api/admin/seo-audit | issues 数组含 severity=error/warning/info, fix 字段齐全 | TDK/domain/links/sitemap/offset 全检 ✓ |

### 6.4 临时测试数据已清理
- DELETE FROM Setting WHERE key LIKE 'R40_1B%' → 1 行
- DELETE FROM DownloadJob WHERE id LIKE 'gtlpt%' → 1 行
- DELETE FROM Setting WHERE key='lastBackupAt' → 1 行 (GET /backup 测试触发写入)
- 数据库回归原状 ✓

---

## 7. 与 TS 端契约对齐

- **响应格式**: 全部 `{ok:true, data:...}` / `{ok:false, error:"..."}` (与 src/lib/api.ts ok/fail 同款)
- **错误码**: 400 (校验失败) / 404 (不存在) / 405 (method not allowed) / 429 (并发上限) / 500 (DB 错误) 与 TS 同款
- **字段消毒**: strField (钳长度) / intField (钳范围) / boolField / httpURL (http(s) 校验) / likeSafe (LIKE 转义) 复用现有工具
- **并发占位**: TS `MAX_CONCURRENT_DOWNLOAD_JOBS=3` + HMR 单例 inFlightGenerations → Go `sync.Mutex` 保护的 int + DB count 双重校验
- **备份大小阈值**: TS `BIG_BOOKS_THRESHOLD=200` → Go `backupBigBooksThreshold=200`
- **设置 key 校验**: TS `KEY_RE=/^[A-Za-z0-9_.-]{1,64}$/` → Go `settingKeyRE` 同正则
- **反馈 adminNote XSS**: TS 剥 `<[^>]+>` HTML 标签 → Go `regexp.MustCompile('<[^>]+>').ReplaceAllString` 同款
- **SEO 评分公式**: TS `error -10, warning -3, info -1, score≥0` → Go 完全相同

---

## 8. 未实现 (Go 端简化)

- 下载 TXT 生成器仅做简单拼接 (无混淆/广告注入/headerTemplate/footerTemplate 实际效果, 仅记录到 options JSON) — 后续 R41 可补
- 设置页 updatedAt 显示为 "-" (Setting 表无 updatedAt 字段, schema 不动)
- 备份导入未对超大 books 数 (≤200) 做分页流式 (TS 用 cursor 分页 + setImmediate 让事件循环, Go 直接全量查) — 站群场景 100~200 本书仍可工作
- 站点 CRUD 在 admin/sites 仍只读 (R39-1C 留下的简化, 未在本任务范围)

---

## 9. 未修改 (尊重约束)

- `go-backend/main.go` home/api/public 路由 (R38-1B 已完成) ✓
- `go-backend/crawl/*` (R38-1C 已完成, 未碰) ✓
- `go-backend/services/*` (A agent 负责, 未碰) ✓
- `go-backend/templates/admin/{dashboard,tasks,books,rules,sites}.html` (R39-1C 已完成, 未碰) ✓
- `go-backend/templates/admin/layout.html` 仅扩展 sidebar nav (新增 8 项, 不改原 5 项) ✓
- `prisma/schema.prisma` + `package.json` + `go.mod` + `go.sum` (0 新依赖) ✓

---

## 10. Stage Summary

R40-1B 完成 admin 后台 8 个新页面 + 13 个 API 路由的 Go 端完整实现. 与 TS 端契约 (URL/方法/字段消毒/响应格式/错误码) 1:1 对齐, 与 R39-1C 既有 6 个页面 (dashboard/tasks/books/rules/sites/layout) 风格统一 (深色主题 + 表格卡 + Modal + Toast). 编译 0 errors, 13 个 admin 页面 + 8 个 admin API 全部 HTTP 200, 9 个 CRUD 流程测试通过 (含下载 TXT 13.94MB 异步生成 + 文件下载). 临时测试数据已清理. 与 R38-1C 采集引擎 + R39-1C admin DBClient 适配器零冲突, admin 路由体系扩展到 13 个页面 + 24 个 API endpoint.

**改动统计**:
- 修改 3 个文件 (admin.go +1906 行 / main.go +89 行 / layout.html +9 nav)
- 新增 8 个模板 (1019 行)
- 主二进制从 20.2MB → 20.5MB (+0.3MB)

**文件清单**:
| 文件 | 行数 | 类型 | 说明 |
|---|---|---|---|
| `go-backend/admin.go` | 3442 (+1906) | Go | 8 API handler + 8 page filler + 10 主题注册表 + adminPageHandler/renderAdminPage switch 扩展 |
| `go-backend/main.go` | 1058 (+89) | Go | 13 路由注册 + 8 FuncMap 函数 + strconv 导入 |
| `go-backend/templates/admin/layout.html` | 263 (+9) | HTML | sidebar 新增 8 nav 项 |
| `go-backend/templates/admin/categories.html` | 161 (新) | HTML | 分类 CRUD + 拖拽排序 |
| `go-backend/templates/admin/links.html` | 177 (新) | HTML | 友链 CRUD + 链轮配置 |
| `go-backend/templates/admin/themes.html` | 70 (新) | HTML | 10 套主题预览卡 |
| `go-backend/templates/admin/downloads.html` | 138 (新) | HTML | 下载任务列表 + 新建 Modal |
| `go-backend/templates/admin/settings.html` | 102 (新) | HTML | 设置项 CRUD + 添加新 key |
| `go-backend/templates/admin/feedback.html` | 158 (新) | HTML | 反馈列表 + 详情 Modal |
| `go-backend/templates/admin/backup.html` | 132 (新) | HTML | 统计 + 导出 + 导入 dry-run + VACUUM |
| `go-backend/templates/admin/seo-audit.html` | 81 (新) | HTML | 审计概览 + 站点卡片 |
| **总计** | **6817** | | 3 修改 + 8 新增 |
