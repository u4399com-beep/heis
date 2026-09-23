# R54-1A — 反馈模块开关 + 系统设置说明 + 非 Go 橋留检查

**Agent**: full-stack-developer (Go)
**Date**: 2026-09-23
**Scope**: go-backend/main.go + admin.go + templates/admin/settings.html
**Build**: `go build` + `go vet` 0 错误

## 改动摘要

### 1. 反馈模块开关 (Setting.feedbackEnabled)

- **`admin.go` 新增 `settingMeta` map** (12 个常见 key 的中文说明 / 默认值 / 分类 / isFeedback 标记):
  - `feedbackEnabled` (前端功能, 默认 `true`, isFeedback=true)
  - `miniServiceConfig` (采集服务, 默认 `{}`)
  - `linkwheel` (SEO 站群)
  - `lastBackupAt` (运维)
  - `announcement` / `site.default` / `crawl.rateLimit` / `crawl.captchaMode` / `crawl.proxyMode` / `crawl.tlsPoolSize` / `seo.sitemapEnabled` / `seo.robotsTxt`

- **`admin.go` 新增 `getFeedbackEnabled()`**: 读 `Setting.feedbackEnabled`, 缺失或非 `"false"` 字面量均视为 `true` (向后兼容). SQLite 单行查询 <0.1ms, 不需缓存层.

- **`admin.go` 新增 `seedDefaultSettings()`**: 启动时遍历 `settingMeta`, 对有默认值的 key 调 `INSERT OR IGNORE` (不覆盖已存在值). `main.go main()` 模板加载后调用.

- **`admin.go` 新增 `publicFeedbackSubmitHandler`** (路由 `POST /api/feedback`):
  - 先查 `feedbackEnabled`; `false` → 403 `"反馈模块已关闭"` (与前台不渲染按钮一致 — 双保险)
  - 校验 `type` 必为 `bug|suggestion|praise|other`, `content` 1~2000 字符 (rune 安全截断), `contact` 0~100
  - `content` 经 `htmlEscaper` (strings.NewReplacer 转 `<>&"'`) 转义后入库 — 防 admin/feedback.html 详情 modal innerHTML 渲染的 stored XSS
  - `ip` (X-Forwarded-For 优先, 取第一个) + `userAgent` (≤256 rune) + `url` (httpURL 校验) 一并写入
  - `status='new'`, `createdAt/updatedAt=now`, `id=generateID()`
  - **SQL bug 修复**: 初版 `VALUES` 多写 1 个 `?` (10 个 vs 9 个 args), SQLite 报 "13 values for 12 columns"; 改回 9 个 `?` + `''` literal (adminNote) + 2 个 `datetime('now')` literal (createdAt/updatedAt) = 12 值对 12 列

- **`main.go` 新增 `feedbackWidgetHTML` 常量** (前台浮窗):
  - 右下角固定定位 (`position:fixed;bottom:18px;right:18px;z-index:2147483000`)
  - 浮动按钮 💬 反馈 → 模态框 (type select + content textarea + contact input + 提交)
  - IIFE JS: POST `/api/feedback`, Toast 反馈成功/失败, 不污染全局作用域
  - inline style + inline JS, 不依赖主题 CSS 变量 (10 套主题模板共用同一浮窗)
  - 全静态字符串, 无用户可控字段, 无注入风险

- **`main.go homeHandler` 改动**: `ExecuteTemplate` 后, `if getFeedbackEnabled() { buf.WriteString(feedbackWidgetHTML) }`. 一处注入覆盖全部主题模板 (10 套 × 8 页型 = 80 模板). 兜底回退 `shipsay/home` 路径也注入.

- **`main.go` 路由注册**: `http.HandleFunc("/api/feedback", publicFeedbackSubmitHandler)` (在 `/api/public/*` 之后, `/api/admin/*` 之前)

### 2. 系统设置说明 (/admin/settings)

- **`admin.go fillSettingsPageData` 改动**:
  - 每条 setting 附加 `desc` / `defaultValue` / `category` / `isFeedback` 字段 (从 `settingMeta` 查)
  - 新增 `data["FeedbackEnabled"]` = `getFeedbackEnabled()` (供顶部 toggle 卡片高亮显示)
  - 新增 `data["SettingMetas"]` = `settingMeta` 字典序排列的 key/desc/default/category 列表 (供页面顶部"已知设置项说明"表渲染)

- **`templates/admin/settings.html` 重写**:
  - 顶部置顶 "💬 反馈模块开关" 卡片: 显示当前状态徽标 (绿"已开启" / 红"已关闭") + toggle switch (input checkbox + 自定义滑块 span) + 说明文字. 点击触发 `toggleFeedback()` → PUT `/api/admin/settings {feedbackEnabled:bool}` + 失败回滚.
  - "📖 已知设置项说明 (N 项)" 可折叠卡片: 默认折叠 (max-height:320px overflow-y:auto), 展开后显示 4 列表格 (key/说明/默认值/分类).
  - 通用 key-value 编辑卡片: 每张卡片头显示 `key` + JSON/模块开关 pill, 卡片身附加 desc hint + 默认值 hint (`code` 标签显示). `feedbackEnabled` 卡片标记 `pill pill-ok 模块开关`.
  - "添加新设置项" 卡片 hint 更新: 提示常见 key 名 (miniServiceConfig / linkwheel / lastBackupAt / site.default / announcement / crawl.captchaMode 等) + 引用顶部说明表.

### 3. 非 Go 橋留检查

- `find . -name '*.ts' -o -name '*.tsx' -o -name '*.py'` (排除 skills/ node_modules/ .next/ .git/):
  - **2 个 .py 文件存在但合法**: `go-backend/services/curl-impersonate-bridge/scripts/curl_cffi_fetch.py` + `go-backend/services/scrapling-bridge/scripts/scrapling_fetch.py`
    - 被 `services/scrapling-bridge/main.go` `exec python3 scrapling_fetch.py` 调用 (stealthy/playwright 模式)
    - 不应删除 — 是 Go bridge 服务的 Python 子进程脚本 (worklog R42+ 设计)
  - **0 个项目级 .ts/.tsx 文件** (skills/ 下 110 个 .ts/.tsx/.py 文件是技能库, 不计入项目)
  - **0 个 node_modules 目录** (skills/ 下除外)
- `package.json scripts.dev` = `"bun start-go.js"` ✓
- `go-backend/heis-backend` 二进制存在 (24.3 MB, R54-1A 重新编译) ✓
  - .gitignore 显式忽略该二进制 (Go 构建产物, 需时 `go build` 重新生成, 不入版本库)

## 端到端验证 (curl)

```bash
# 1. 前台浮窗注入 (enabled)
curl -s http://localhost:3000/ | grep -c 'heis-fb-btn'
# 1  ✓

# 2. 关闭反馈模块
curl -s -X PUT http://localhost:3000/api/admin/settings -H 'Content-Type: application/json' -d '{"feedbackEnabled":false}'
# {"ok":true,"data":{...,"feedbackEnabled":false,...}}

# 3. 前台浮窗消失
curl -s http://localhost:3000/ | grep -c 'heis-fb-btn'
# 0  ✓

# 4. POST /api/feedback 被拒绝
curl -s -w 'HTTP %{http_code}\n' -X POST http://localhost:3000/api/feedback -H 'Content-Type: application/json' -d '{"type":"bug","content":"test"}'
# {"error":"反馈模块已关闭","ok":false} HTTP 403  ✓

# 5. 重新开启
curl -s -X PUT http://localhost:3000/api/admin/settings -H 'Content-Type: application/json' -d '{"feedbackEnabled":true}'

# 6. POST /api/feedback 正常
curl -s -X POST http://localhost:3000/api/feedback -H 'Content-Type: application/json' -d '{"type":"suggestion","content":"测试建议内容","contact":"user@example.com"}'
# {"data":{"id":"gtlticzd32fb91e434719c374e3826e","submitted":true},"ok":true}  ✓

# 7. Stored XSS 防护: 提交 <script>alert(1)</script> 后查 DB 内容已转义
# DB content: '&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt;'  ✓

# 8. /admin/settings 页面 toggle 状态 + 说明表
curl -s http://localhost:3000/admin/settings | grep -E 'fbToggle|已知设置项说明'
# <input type="checkbox" id="fbToggle" checked onchange="toggleFeedback()" ...>  (enabled)
# <h3 ...>📖 已知设置项说明 (12 项)</h3>  ✓
```

## 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o /tmp/heis-final . 2>&1 | tail -5
# (no output, exit 0) → BUILD OK

~/go/go/bin/go vet ./... 2>&1 | tail -5
# (no output, exit 0) → VET OK
```

替换 heis-backend 二进制 + 重启:
```bash
pkill -9 -f 'go-backend/heis-backend'; sleep 4
rm -f go-backend/heis-backend && cp /tmp/heis-final go-backend/heis-backend && chmod +x go-backend/heis-backend
# bun start-go.js 自动重启
sleep 3
curl -s http://localhost:3000/health
# {"lang":"go","memMB":17,"ok":true}  ✓
```

binary 24,347,307 bytes (24.3 MB, R53-1B 24,318,584 → R54-1A +28K, 主要为 feedbackWidgetHTML 常量 + settingMeta map + 3 个新 handler/seed 函数).

## 文件改动统计

- `go-backend/main.go`: +60 行 (feedbackWidgetHTML 常量 + homeHandler 注入逻辑 + 路由注册 + seedDefaultSettings 调用)
- `go-backend/admin.go`: +130 行 (settingMeta map + getFeedbackEnabled + seedDefaultSettings + publicFeedbackSubmitHandler + htmlEscaper + clientIP + fillSettingsPageData 扩展 + R54-1B 协同: ListCategoryNames/FindCategoryIDByName 由 R54-1B agent 并行添加, 本 agent 仅验证编译通过)
- `go-backend/templates/admin/settings.html`: +63 行 / -8 行 (顶部 toggle 卡片 + 折叠说明表 + 卡片 desc/defaultValue hint + toggleFeedback JS)
- `go-backend/heis-backend`: 二进制重编 24.3MB

## 未修改 (尊重约束)

- `go-backend/admin.go` 主体逻辑 (adminFeedbackHandler/adminFeedbackByIDHandler 原有 PATCH/DELETE 不动, 仅新增 publicFeedbackSubmitHandler 并列) ✓
- `go-backend/main.go` homeHandler 主体 (仅 ExecuteTemplate 后追加 widget 注入, 路由表追加 1 行) ✓
- `go-backend/templates/admin/*.html` 其他 13 个模板 (backup/books/categories/dashboard/downloads/feedback/keywords/layout/links/rules/seo-audit/sites/tasks/themes) ✓
- `go-backend/templates/<theme>/*.html` 80 个主题模板 (浮窗在 homeHandler 注入, 不动模板) ✓
- `prisma/schema.prisma` (Feedback 表已存在, 不需加列; Setting 表已存在, feedbackEnabled 是 key-value 存储) ✓
- `package.json` + `.gitignore` + `start-go.js` (0 改动, dev script 已是 `bun start-go.js`) ✓

## Stage Summary

- R54-1A 反馈模块开关 + 系统设置说明 + 非 Go 橋留检查:
  - **反馈模块开关**: Setting.feedbackEnabled key (seedDefaultSettings 启动灌入默认 true) + 公共 POST /api/feedback handler (开关 false 时 403 拒绝) + 前台 homeHandler 注入浮窗 (开关 false 时不渲染) + admin/settings 顶部 toggle switch (optimistic UI + 失败回滚) — 四层一致.
  - **系统设置说明**: settingMeta map 12 个常见 key 的中文说明 / 默认值 / 分类; /admin/settings 页面加折叠"已知设置项说明"表 + 每张编辑卡片附加 desc/defaultValue hint + 顶部反馈模块开关卡片高亮显示当前状态.
  - **Stored XSS 防护**: 公共反馈提交 content/contact 入库前经 htmlEscaper 转义 (与 admin/feedback.html 详情 modal innerHTML 渲染兼容), 实测 `<script>alert(1)</script>` 入库后变 `&lt;script&gt;alert(1)&lt;/script&gt;` 字面量文本.
  - **非 Go 橋留检查**: 项目级 0 个 .ts/.tsx, 2 个 .py (Go bridge 子进程脚本, 合法); 0 个 node_modules (skills/ 下除外); package.json dev script = bun start-go.js ✓; heis-backend 二进制 24.3MB 存在 (.gitignore 显式忽略, 部署时 go build 重新生成).
  - **并发协同**: R54-1B agent 并行修改 runner.go 加 ListCategoryNames/FindCategoryIDByName interface 方法, 本 agent 编译时撞到 missing method → 等 R54-1B 实现后 (admin.go 已加 adminDB 方法) 编译通过.
- 编译 0 errors, vet 0 warnings, 8 项 curl 端到端测试全 pass (/health + GET / widget inject + PUT settings toggle on/off + POST /api/feedback 403/200 + stored XSS 防护 + /admin/settings toggle UI + 说明表).
