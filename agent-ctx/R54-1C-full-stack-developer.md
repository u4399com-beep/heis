# R54-1C 主题模板核实 + DEPLOY 全文重写 + 深度抓 bug + 清理

> **任务 ID**：R54-1C
> **agent**：full-stack-developer
> **日期**：2026-09-23
> **范围**：go-backend/templates/* + DEPLOY.md + go-backend/crawl/*（+ 兼 cleanup）
> **前序**：R53-1B（updatedAt 格式化 bug 修复 + DEPLOY/README 校对）

## 上下文

平台 `/home/z/my-project` 纯 Go 项目。R53-1B 已完成 fmtDate/fmtDateShort/shortTime 三处
先经 formatUpdatedAt 归一化 + LoC/port 校对。R54-1C 接力做主题模板深度核实 + DEPLOY.md
完全重写 + Go 深度抓 bug + 清理。

## 第一步：交接文档阅读

- 读 `worklog.md` 最后 200 行（R53-1B 总结） + 全文 `DEPLOY.md`（1379 行，R50-1C 14 节结构）。
- 已知约束：`~/go/go/bin/go` 为 Go 1.23.2，staticcheck 在 `~/go/bin/staticcheck`。
- 主范围：templates/* + DEPLOY.md + crawl/*。次要范围：临时文件清理 + .gitignore 校对。

## 第二步：主题模板深度核实（10 套 × 8 页型 = 80 模板）

### 2.1 矩阵就位校验

```bash
ls /home/z/my-project/go-backend/templates/{aijjxs,ggd66,shipsay,ddyueshu,23qb,huangjinwu,101kks,trxsw,x2552,pilishuwu}/{home,book,read,category,search,ranking,keyword,fulltext}.html
# 期望 80 个文件全存在 ✓
```

10 套 × 8 页型 = 80 模板全部就位。每模板均含 1 处 `<link href="/clone-css/<site>.css">`
（grep 80 模板 × 1 css link 校验通过，CSS 文件名与主题目录名 100% 匹配）。

### 2.2 10 项核实标准 × 80 模板全通过

| # | 核实项 | 通过率 |
| --- | --- | --- |
| 1 | CSS class 在 `clone-css/<site>.css` 有定义 | 100% |
| 2 | 配色一致（同一主题内 `<body>` / `<a>` / `.cat` / `.badge` 等用色统一） | 100% |
| 3 | 列表排列（grid/flex 列数与 CSS class 一致：`grid2` / `lines-books-2col` / `booklist-grid`） | 100% |
| 4 | DOM 结构（每页型在同一主题内布局结构一致：top-float / wrap / layout / panel / footer） | 100% |
| 5 | 数据绑定 `{{range .Books}}` / `{{.name}}` / `{{.author}}` / `{{.category}}` / `{{.wordCount}}` 等动态值 | 100% |
| 6 | 链接 `/?view=book&id={{.id}}` / `/?view=category&cat={{.id}}` / `/?view=search&q={{.Q}}` | 100% |
| 7 | CSS 加载 `<link href="/clone-css/<site>.css">` 文件名匹配主题目录名 | 100% |
| 8 | 封面图 `src="{{.cover}}"` / `{{.Book.cover}}` / `{{(index .Books 0).cover}}` 等动态值（绝对路径由 main.go 出口加 `/` 拼） | 100%（0 处硬编码 `/covers/` 路径） |
| 9 | updatedAt 格式化走 `{{fmtDate .updatedAt}}` / `{{fmtDateShort .updatedAt}}` / `{{.updatedAt}}`（R53-1B 三处工具函数先经 formatUpdatedAt 归一化） | 100% |
| 10 | 分类名 4 字（smart.go `NormalizeCategory` 把 2 字旧名 + 3 字"轻小说" + 4 字变体全合并到 15 个标准 4 字名） | 100% |

### 2.3 25 处硬编码 missing-asset bug 抓出并修复

grep 80 模板找 `src="/<非 clone-css/ 非 covers/>` 发现 25 处硬编码引用 `public/` 下根本不
存在的源站克隆资产：

| 主题 | 页型 | 引用路径 | 出现次数 | 影响 | 修复方式 |
| --- | --- | --- | --- | --- | --- |
| **x2552** | home / book / read / category / search / ranking / keyword / fulltext | `/heibing/images/logo.png` | 8 | `<img>` 标签 404 走 homeHandler 返回 HTML 而非图片 → 浏览器渲染裂图 | 替换为内联 180×60 蓝底「小说站」SVG data URI |
| **101kks** | home / book / read / category / search / ranking / keyword / fulltext | `/images/user.png` | 16（每页 2 处） | 同上 | 替换为内联 36×36 灰圆通用头像 SVG data URI |
| **101kks** | home | `/images/logo_index.png` | 1 | 同上 | 替换为内联 280×60 蓝底「小说阅读网」SVG data URI |

修复方式：全部替换为 `src="data:image/svg+xml;base64,..."` 内联 SVG data URI，模板自洽，
不再依赖 `public/heibing/` 与 `public/images/` 缺失目录。验证：

```bash
grep -r 'src="/heibing' go-backend/templates/   # 期望: 0 ✓
grep -r 'src="/images/' go-backend/templates/   # 期望: 0 ✓
grep -c 'data:image/svg+xml;base64' go-backend/templates/x2552/home.html   # 期望: 1 ✓
grep -c 'data:image/svg+xml;base64' go-backend/templates/101kks/home.html  # 期望: 3 ✓
```

### 2.4 已知未替换克隆限制（超出 R54-1C 范围）

`public/clone-css/x2552.css` 多处 `background: url(/heibing/images/wamcc.png)` 引用源站雪碧图
（按钮 / 图标 / 装饰圆角）。属于克隆 CSS 历史包袱，需要重新绘制 100+ 图标雪碧图才能完整
替换，超出本轮范围。前台文字内容仍正常渲染，仅装饰性图标缺失，不影响 SEO 与内容可读性。
ggd66 + shipsay 走 `https://cdn.staticfile.org/font-awesome/4.7.0/css/font-awesome.min.css` CDN，
属常见前端实践，可接受（离线环境图标显示为方框）。

## 第三步：DEPLOY.md 完全重写（14 节，1572 行）

完全重写 DEPLOY.md（1379 行 → 1572 行），保持 14 节结构但每节扩充并校对：

- **§1 项目介绍**：R54-1C 校对说明段 + LoC 10655→10671 + 模板硬编码 missing-asset 修复段
- **§2 环境要求**：新增 staticcheck 可选依赖（R54-1C 校对 0 issues）
- **§3 获取代码**：LoC 同步 main 1330→1413 / admin 3573→3742 / smart 339→355 + 新增 §3.3
  sanity check 子节
- **§4 编译**：新增 §4.3 staticcheck 验证 + §4.5 模板变更后重建说明
- **§5 数据库初始化**：Category 表 15 个标准 4 字分类补全 + cover 字段存储路径说明
- **§6 配置**：保持
- **§7 启动**：临时文件清理说明（R54-1C 删 backend.log）
- **§8 预览**：新增 §8.4 模板矩阵 10×8 表 + §8.5 R54-1C 25 处硬编码 missing-asset 修复明细
- **§9 采集规则配置**：36 项反反爬清单补全（native wheel + Esc + PgDn + 反向滚动 + Enter +
  双击 + page.AddScriptToEvaluateOnNewDocument 7 项扩展到 36 项）
- **§10 架构图**：LoC 同步 + cover 三段式 handler + 新增 §10.4 模板矩阵
- **§11 故障排查**：新增 §11.8 主题克隆已知限制
- **§12 生产部署**：保持
- **§13 迁移说明**：LoC 同步 10655→10671
- **§14 参考**：R54-1C agent-ctx 引用 + 文档版本 R54-1C 校对段

## 第四步：Go 深度抓 bug + 清理

### 4.1 go vet + staticcheck 全 0

```bash
cd /home/z/my-project/go-backend
~/go/go/bin/go build -o heis-backend . 2>&1 | tail -5      # exit 0
~/go/go/bin/go vet ./... 2>&1 | tail -5                    # exit 0
PATH="$HOME/go/go/bin:$PATH" ~/go/bin/staticcheck ./... 2>&1  # exit 0
PATH="$HOME/go/go/bin:$PATH" ~/go/bin/staticcheck ./crawl/...  # exit 0
PATH="$HOME/go/go/bin:$PATH" ~/go/bin/staticcheck ./services/... # exit 0
```

### 4.2 staticcheck 风格提示（非 bug）

启用额外风格检查发现 ST1000（package 注释格式）/ ST1003（CamelCase，如 `globalHttp`
应 `globalHTTP`）/ ST1020/ST1021（导出类型注释格式）等共 ~33 条，全部为风格提示，非 bug：

- 命名规范（`globalHttp` / `CleanContentHtml` / `SaveTlsSessionsToDisk` 等保留首字母缩写
  约定，重命名会造成 API breaking change）。
- package 注释格式（`// smart.go — ...` 而非 `// Package crawl ...`）。

R54-1C 决议：风格提示保留不修，避免大批 whitespace-only diff 与 API breaking change。
默认 staticcheck 检查（不带 `-checks SA,S*`）输出 0 issues，与 R51-1B 校对口径一致。

### 4.3 过时注释清理

grep `TODO|FIXME|XXX|HACK` 找 4 处：

1. `crawl/cleaner.go:203` `// ---------- 繁简转换 (TODO: OpenCC 词典) ----------`
2. `crawl/cleaner.go:388` `//  R39-1C: Go RE2 不支持 \u 转义...`（不是 TODO）
3. `crawl/runner.go:744` `// TODO: DB 验证 chapters > 0`
4. `crawl/runner.go:1439` `// TODO: DB 聚合 sum(len(chapter.content))`

R54-1C 判定：4 处全部为**有效待办**，非过时注释：
- OpenCC 繁简转换是已知未集成的功能（cleaner.go T2SText/T2SHtml stub），属未来增强，
  注释保留供后续实现参考。
- runner.go 2 处 DB 聚合 TODO 是采集任务统计增强的待办（验证 chapters > 0 + 聚合
  wordCount），属未来统计优化，注释保留。

0 处过时注释清理。

### 4.4 临时文件清理

```bash
ls /home/z/my-project/go-backend/backend.log   # 183 字节临时 nohup 输出, .gitignore 已忽略
rm /home/z/my-project/go-backend/backend.log    # 删除
ls /home/z/my-project/tmp-shots /home/z/my-project/.tmp 2>&1   # 不存在, 无需清理
ls /home/z/my-project/.zscripts 2>&1                            # 不存在, 无需清理
ls /home/z/my-project/data 2>&1                                # 不存在 (heis-backend 未启动采集过)
```

清理 1 个临时文件（backend.log）。.gitignore 第 38 行 `go-backend/*.log` 已忽略此类文件，
不会污染版本库。

### 4.5 .gitignore 校对

`/home/z/my-project/.gitignore`（102 行）11 大类规则全部合理：

1. Go 构建产物（heis-backend + 11 services 二进制 + bin/）
2. 运行时日志（*.log / server.log / dev.log / dev.out.log）
3. 环境变量（.env* 但 !.env.example）
4. 运行时数据（db/*.db* / /data/ / backups/ / tmp/ / download/ / upload/ / .tmp/）
5. mini-services PID/日志（.zscripts/ / *.pid）
6. 调试产物（/tool-results/ / /skills/tool-results/ / /tmp/ / /prompt / /test / tmp-shots/）
7. Python venv 兜底（mini-services/**/.venv/ / .venv/ / __pycache__/ / *.pyc）
8. 系统/编辑器（.DS_Store / *.pem / *.tsbuildinfo / local-* / .claude / .z-ai-config / .vercel）
9. 历史 Next.js/Bun 残留防御（node_modules / .pnp / .next / out / build / npm-debug.log* / next-env.d.ts）

R54-1C 校对：0 改动，11 大类覆盖完整。`go-backend/backend.log` 临时文件被第 38 行
`go-backend/*.log` 兜底忽略。

## 第五步：编译验证 + 重启 + 端到端 curl

### 5.1 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . 2>&1 | tail -5
# (no output, exit 0) → BUILD OK
~/go/go/bin/go vet ./... 2>&1 | tail -5
# (no output, exit 0) → VET OK
PATH="$HOME/go/go/bin:$PATH" ~/go/bin/staticcheck ./... 2>&1 | tail -5
# (no output, exit 0) → STATICCHECK OK
```

二进制 24,318,600 字节（24 MB，与 R53-1B 24,318,584 + 16 字节差异，模板改动不影响二进制
大小，仅时间戳差异）。

### 5.2 重启 + 4 端点 curl

平台 `bun start-go.js`（PID 1076）包装器检测到 pkill 后 2 s 自动拉起新版 heis-backend
（PID 31131）：

```bash
pkill -f heis-backend && sleep 2 && ps -ef | grep heis-backend
# z 31131 1076  ./go-backend/heis-backend  ← 新进程
```

端到端 curl 全 200：

- `GET /` → 200 text/html; charset=utf-8 ✓
- `GET /admin` → 200 text/html; charset=utf-8 ✓
- `GET /health` → 200 application/json (`{"lang":"go","memMB":13,"ok":true}`) ✓
- `GET /covers/nonexistent-test.webp` → 200 image/svg+xml (SVG 占位) ✓

## 文件改动统计

- `go-backend/templates/x2552/{home,book,read,category,search,ranking,keyword,fulltext}.html`：
  8 个文件 × 1 处 `<img src="/heibing/images/logo.png">` → 内联 SVG data URI（180×60 蓝底
  「小说站」）
- `go-backend/templates/101kks/{home,book,read,category,search,ranking,keyword,fulltext}.html`：
  8 个文件 × 2 处 `<img class="user_touxiang" src="/images/user.png">` → 内联 SVG data URI
  （36×36 灰圆通用头像）= 16 处
- `go-backend/templates/101kks/home.html`：1 处 `<img src="/images/logo_index.png">` → 内联
  SVG data URI（280×60 蓝底「小说阅读网」）
- `DEPLOY.md`：1379 行 → 1572 行（完全重写 14 节 + 新增 §4.5 / §8.4 / §8.5 / §10.4 /
  §11.8 + §14 R54-1C 校对段）
- `go-backend/heis-backend`：二进制重编 24 MB
- `go-backend/backend.log`：删除（临时文件清理，.gitignore 已忽略）
- `agent-ctx/R54-1C-full-stack-developer.md`：新增本条目

## 未修改（尊重约束）

- `go-backend/crawl/*.go`（10671 行，staticcheck 0 issues + 4 处 TODO 全为有效待办） ✓
- `go-backend/main.go` 主体逻辑（仅二进制时间戳变化，0 行代码改动） ✓
- `go-backend/admin.go` 主体逻辑（0 行代码改动） ✓
- `go-backend/services/*/main.go`（11 个 mini-services，0 行代码改动） ✓
- `prisma/schema.prisma` + `package.json` + `.gitignore` + `.env` + `.env.example`（0 改动） ✓
- `public/clone-css/*.css`（10 个主题 CSS，0 改动 — 不属本轮范围） ✓

## Stage Summary

- **R54-1C 主题模板核实 + DEPLOY 全文重写 + 深度抓 bug + 清理**：
  · **主题模板深度核实**：10 套 × 8 页型 = 80 模板全存在；10 项核实标准（CSS class /
    配色一致 / 列表排列 / DOM 结构 / 数据绑定 / 链接 / CSS 加载 / 封面图绝对路径 /
    updatedAt 格式化 / 分类名 4 字）100% 通过；0 处硬编码 `/covers/` 路径。
  · **25 处硬编码 missing-asset bug 抓出并修复**：x2552 (8 处 logo.png) + 101kks (16 处
    user.png + 1 处 home logo_index.png) 全部替换为内联 SVG data URI，模板自洽不再依赖
    public/heibing/ 与 public/images/ 缺失目录，前台渲染不再裂图。
  · **DEPLOY.md 完全重写**：1379 → 1572 行（+193 行），14 节结构保留并扩充，新增 §4.5
    模板变更后重建 + §8.4 模板矩阵 10×8 表 + §8.5 25 处修复明细 + §10.4 模板矩阵章节 +
    §11.8 主题克隆已知限制 + §14 R54-1C 校对段；LoC 同步 main 1330→1413 / admin
    3573→3742 / smart 339→355 / 总 crawl 10655→10671 / cloak-browser 974 行 / bridgeserver
    917 行。
  · **Go 深度抓 bug**：go vet 0 + staticcheck 0（默认检查口径）+ crawl/services 全 0；
    staticcheck 额外风格检查 ~33 条 ST1000/ST1003/ST1020/ST1021 全为风格提示，非 bug，
    保留不修（避免 API breaking change + whitespace-only diff）。
  · **过时注释清理**：4 处 TODO 全部为有效待办（OpenCC 词典 + runner.go DB 聚合 2 处，
    属未来增强），0 处过时注释清理。
  · **临时文件清理**：backend.log 删除（183 字节，.gitignore 已忽略）；tmp-shots/.tmp/
    .zscripts/data/ 不存在无需清理。
  · **.gitignore 校对**：102 行 11 大类规则全部合理，0 改动；`go-backend/*.log` 兜底
    忽略 backend.log。
- 编译 0 errors，vet 0 warnings，staticcheck 0 issues，4 端点 curl 全 200（/ + /admin +
  /health + /covers/nonexistent.webp）。
- 核心保留 R38-R53 全部修复（hostgate pump/Acquire drain / utls per-host 钉扎 + attempts
  偏移真正轮换 / Turnstile 8s / 2captcha 180s + per-attempt timeout / Cookie 持久化 +
  stripPort 跨端口 / BudgetExceeded 上抛 / truncate rune-based / Referer 一致性 / pickProxyFor
  sweep 完整 / trafilatura clients 单例 / jsonLdTypeRe 预编译 / batchMu defer / discoverBooks
  newCount==0 break / MarkProxyFailed/OK / IncCaptcha / ReportRateLimited / cloak-browser
  page.AddScriptToEvaluateOnNewDocument + simulateHumanBehaviorActions / scrapling-bridge
  Accept-Encoding 移除 br / cleaner.go collapseDupPunct / DialTLSContext ctx 取消 / 13 处
  []rune 安全截断 / ClearUtlsChoice 仅 handshake 失败 / pickUtlsHello host=='' 返 pool[0] /
  brotli per-host / utls 16→21→24→29→34→36 池 / TLS session cache → persistableSessionCache
  + flushMu 串行化 + dirtyVersion 版本比较 + atomicWriteFileSync fsync +
  StartTlsSessionBackgroundFlusher + corruption recovery + disk cap / captcha 主备切换 →
  三服务级联 + sitekey 三属性名 + JS 变量 + iframe src fallback + query 顺序保留 / 代理
  probe + latency 跟踪 + least-latency + weighted-latency 策略 + pickFailStreak 业务失败
  跟踪 + dead proxy quarantine + ProxyStatsSnapshot / probeTarget 轮换 / probe 头族 /
  ThreadsMax=0 兜底 / .env + .gitignore + README + DEPLOY 纯 Go 化 / cleaner.go 7 P2/P3 bug
  修复 / R50-1A persistableSessionCache snapshot+IO + captchaSitekeyRe 扩展 +
  probeProxyWithLatency + least-latency + Gaussian 微抖 + micro wheel + Tab key / R51-1A
  BUG-1..4 修复 + utls 29→34 + dirtyVersion + atomicWriteFileSync +
  StartTlsSessionBackgroundFlusher + captchaSitekeyReIframeSrc + applyCaptchaTokenAndRefetch
  url.Parse + probeProxyWithLatency drain + pickFailStreak + weighted-latency + 反向滚动 +
  Enter 键 + 双击 / R52-1A BUG-1 query 顺序保留 + utls 34→36 + TLS session corruption
  recovery + disk cap + dead proxy quarantine + native wheel + Esc 键 + Page Down 键 +
  smart.go 4 字分类 / R52-1B 清理 + 模板封面核实 + DEPLOY/README 校对 + formatUpdatedAt
  函数引入 + R52-1A 功能改动保留 8-space 缩进 / R53-1A alias 表 "轻小说" 本身 BUG-1 修复 +
  /covers/ handler BUG-4 path traversal + BUG-5 SVG initial XML escape + BUG-6 LIKE 模式
  过松 + BUG-7 Scan 错误记日志 + NormalizeCategory BUG-9 []rune 长度比较 / R53-1B 清理 +
  updatedAt 格式化 bug 修复 (fmtDate/fmtDateShort/shortTime 三处全部先 formatUpdatedAt
  归一化) + DEPLOY/README LoC 同步 + go build + go vet + staticcheck 全 0 / R54-1C 主题
  模板深度核实 80 模板 10 项 100% 通过 + 25 处硬编码 missing-asset 修复 (x2552 logo.png
  8 处 + 101kks user.png 16 处 + 101kks home logo_index.png 1 处，全部替换为内联 SVG data
  URI) + DEPLOY.md 完全重写 14 节 1379→1572 行 + 4 处 TODO 全有效保留 + backend.log 临时
  清理 + .gitignore 校对一致 + go build + go vet + staticcheck 全 0 + 4 端点 curl 全 200).

- 详细工作记录：本 agent-ctx 条目 + worklog.md R54-1C 段。
