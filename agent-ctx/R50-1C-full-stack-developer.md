# R50-1C — 安装部署教程完整重写 + 项目清理精简

## 任务背景

用户要求"重写编写详细的安装部署图文教程, 要照顾到每一步每一个细节" + 清理精简.
本轮 (R50-1C) 接手, 完全重写 DEPLOY.md (12 节), 同步更新 README.md 版本号, 清理
过时文件 / 临时产物 / 误置二进制, 验证 go build + go vet 0.

## 第一步: 读交接文档

- 读 `/home/z/my-project/DEPLOY.md` (旧版 618 行, R48-1B 版): 已有十节结构, 但用户
  要求"照顾每一步每一个细节", 需补全 12 节 (新增项目介绍 + 获取代码 + 启动方式 3 选 1 +
  数据库初始化 2 路径 + 26 项反反爬清单 + 6 项生产清单).
- 读 `/home/z/my-project/worklog.md` 末 150 行: R49-1A/1B/1C 完成 10 套主题核实 +
  search form BUG 修复 (51 处 / 18 文件) + cleaner.go 7 P2/P3 bug 修复 (+95 行 804→899).
- 检查项目根:
  - `go-backend/heis-backend` 24 MB 二进制 (commit 29dcd99 已入 git).
  - 11 mini-services 端口 3010-3020 (注意: 用户任务描述写"12 mini-services", 实际是 11 个,
    本轮按实际写 11 — `services/` 11 个目录 + bridgeserver 共享包非独立服务).
  - 94 模板 (10 主题 × 8 + 14 admin) ✓.
  - 过时产物: `.dockerignore` (R46-1C 删 Docker 后已无意义) / `tool-results/` (984 KB
    agent 调试产物) / `download/README.md` (空目录占位) / `go-backend/backend.log`
    (运行时日志) / `go-backend/cloak-browser` (误置二进制, 应在 `bin/` 下) / `.tmp/`
    (agent 临时脚本) — 全删.
  - `upload/` 是 sandbox root 挂载, 无法删, 但已空 (内部文件已清).

## 第二步: 重写 DEPLOY.md (完全重写, 12 节 + 2 附录)

新版 DEPLOY.md 共 14 节 (12 主节 + 迁移说明 + 参考), 62257 字节, 主要改动:

### 2.1 新增 4 节 (旧版缺)
- **§一 项目介绍**: 技术栈表 + 核心能力清单 (单二进制 / 采集引擎 8 模块 9321 行 / 8 级降级链 /
  26 项反反爬 / 11 mini-services + bridgeserver / 14 后台页面 / 10 主题 × 8 页型 = 94 模板).
- **§三 获取代码**: git clone 步骤 + 目录结构速览 (树状图含每行注释).
- **§四 编译** (拆分独立节): 主后端编译 + 11 mini-services 编译 (方式 A start-all.sh 增量 /
  方式 B 单独编译) + 编译验证 + 5 类编译失败排查.
- **§五 数据库初始化** (拆分独立节): Prisma schema 11+1 表概览 + 2 路径 (A: prisma db push /
  B: 直接放 db/custom.db) + WAL 模式说明 + 连接验证.

### 2.2 重写 7 节 (旧版过于简略)
- **§二 环境要求**: 软件依赖表 + Go 工具链详细安装步骤 (Linux/macOS/Windows 三平台 + GOPROXY
  国内加速 + 验证) + SQLite 无 cgo 说明 + 硬件建议 (内存 256MB→4GB / 磁盘 1GB→5GB / CPU
  1→2 核) + 操作系统 (Linux/macOS/Windows) + 端口规划表 (12 行, 3000 + 3010-3020).
- **§六 配置**: 数据库 6 项 + 站点配置 9 字段 + 采集规则概要 + mini-services 配置 (12 个环境
  变量 + 启停命令 5 条).
- **§七 启动**: 3 种方式 (直接启动 / bun auto-restart / bash auto-restart) + start-go.js 与
  start.sh 源码 (10 行 + 4 行) + 启动顺序 + 启动后验证.
- **§八 预览**: 前台路由 10 条 + 管理后台 13 条 + 静态资源 5 条 + 后台无鉴权警示.
- **§九 采集规则配置**: 创建步骤 (5 步 + config JSON 四段结构示例) + 参考规则 2 路径 + 8 站
  规则关键点 + 8 级降级链 + **26 项反反爬能力清单** (新表, 每项标引入轮次 + 说明).
- **§十一 故障排查**: 7 类故障 (内存 OOM / mini-services 异常 / 数据库锁 / 主后端起不来 /
  采集失败 / 编译失败 / Go 进程被杀), 每类含现象表 + bash 命令示例.
- **§十二 生产部署**: systemd 2 服务 unit + Caddy/Nginx 反代配置 + 备份策略 + 升级 +
  监控 + 安全清单 8 项.

### 2.3 新增 2 附录
- **§十三 迁移说明**: 旧 Next.js → Go 维度对比表 (12 维度) + 5 步升级路径.
- **§十四 参考**: agent-ctx 历史轮次 R43-R50 链接 (12 文件) + worklog.md + schema + 源码定位.

### 2.4 文字版架构图 (3 张)
- **整体架构**: heis-backend :3000 (94 模板 / API 路由 / DB) + 采集引擎 crawl/ (8 模块 9321
  行 + 反反爬 7 大能力) + 11 Go mini-services (端口表).
- **请求流 (前台 SSR)**: 浏览器 → main.go mux → getSite → 注册表 → 视图数据查询 →
  template.ExecuteTemplate → HTML.
- **请求流 (采集任务)**: admin → runner.Run → fetchListPage (8 级降级链) → parseBookList →
  fetchBookDetail+parseToc+parseContent (hostgate 双限速) → cleanContent → storage → SQLite WAL.

## 第三步: 更新 README.md

3 处微调 (不重写):
- 第 4 行: `R38–R48 已完成` → `R38–R50 已完成 + 安装教程重写`
- 第 215-216 行: `R38-R48, 22 文件` → `R38-R50, 23 文件`; `~19000 行, R3-a → R48-1B` →
  `~19500 行, R3-a → R50-1C`
- 第 322-323 行 (项目版本): `R48-1B (纯 Go 栈, 自 R38 起从 Next.js 全面迁移完成)` →
  `R50-1C (纯 Go 栈, 自 R38 起从 Next.js 全面迁移完成; R50-1C 重写 12 节安装部署教程
  + 26 项反反爬清单 + 清理 .dockerignore/upload/tool-results 等过时产物)`

## 第四步: 清理精简

### 4.1 过时文件删除 (6 类)
- `.dockerignore` (70 行) — 项目 R46-1C 起纯 Go 化无 Docker, 该文件已无意义.
- `tool-results/` (984 KB, 19 个 bash_*.txt + read_*.txt 调试产物) — agent 工作过程
  产物, .gitignore 已忽略但堆积占空间, 全删.
- `download/README.md` + `download/` 目录 — 34 字节占位, .gitignore 已新增 `download/`
  pattern 防误入库.
- `go-backend/backend.log` (183 字节运行时日志) — .gitignore 已忽略, 清.
- `go-backend/cloak-browser` (12.4 MB 误置二进制) — 该二进制应在 `go-backend/bin/` 下,
  被误放进源码目录, .gitignore 已忽略, 清 (start-all.sh 重建会自动产出到 bin/).
- `.tmp/r50_css_check.py` (5.5 KB agent 临时脚本) — 上轮 R50 css check 残留, 清.

总清理体积 ≈ 13.4 MB (其中 cloak-browser 误置二进制 12.4 MB + tool-results 984 KB).

### 4.2 .gitignore 加固
新增 3 个 pattern (§运行时数据):
- `download/` — 运行时沙箱挂载/产物目录, 防误入库.
- `upload/` — 同上.
- `.tmp/` — agent 工作过程临时目录, 防误入库.

旧规则全部保留 (历史 Next.js/Bun 残留防御块 + Go 构建产物 + 运行时日志 + .env* + Python
venv 兜底 + 系统编辑器), 兜底策略不变.

### 4.3 Go dead code (R48-1B 决议保留)
- `~/go/go/bin/go vet ./...` → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass).
- `deadcode ./...` (GOPATH 配 PATH 后跑) → 38 unreachable funcs (CookieJar.Count/Clear/
  SaveToDisk/LoadFromDisk + ClearDomainUA + ClearHostReferer + SaveTlsSessionsToDisk +
  IsJSChallenge + BrotliMissHostSnapshot + CaptchaServiceStatsSnapshot + boolToInt64 +
  Semaphore.TryAcquire + TaskRuntime.SetMaxRequests/CurrentURL/IsDiscovered/
  SetBookLastChapter/GetBookLastChapter + smart.NormalizeCategory/MatchCategoryByText/
  SmartCategory + storage.DataRoot/NovelsDir/CoversDir/DownloadsDir/sanitizeBookId/
  sanitizeChapterSlug/SaveChapterTxt/ReadChapterTxt/DeleteBookTxt/ReadCover/
  downloadTxtTarget/OpenDownloadTxtWriter + downloadTxtWriter.Rel/Write/Finish/Abort +
  SafeStr/ClampInt + bridgeserver.QueryEscape).
- 按 R48-1B 决议 "38 exported funcs 全保留" 原则, **本轮不动** (供未来用 + 已 exported
  避免破坏 API 兼容).

## 第五步: 代码规则 (遵守)

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . 2>&1 | tail -3
# 无输出 (0 errors)

~/go/go/bin/go vet ./... 2>&1 | tail -3
# 无输出 (0 warnings)

ls -lh heis-backend
# -rwxr-xr-x 24M heis-backend (24287512 bytes, 与 R49-1C 持平)
```

## 第六步: 启动验证

```bash
# heis-backend 前台启动
nohup ./go-backend/heis-backend > /tmp/hb.log 2>&1 &
# PID 6700
sleep 2

curl -s --max-time 3 http://localhost:3000/health
# {"lang":"go","memMB":13,"ok":true} ✓

curl -s --max-time 3 -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:3000/
# HTTP 200 ✓

curl -s --max-time 3 -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:3000/admin
# HTTP 200 ✓

# 日志:
#   数据库: /home/z/my-project/db/custom.db
#   已加载 94 个模板
#   heis-backend 启动: http://localhost:3000 (内存 13MB)

pkill -f heis-backend
```

## 文件改动统计 (本 R50-1C 轮)

- DEPLOY.md: 完全重写, 618 行旧版 → 14 节新版 (~62 KB, 含 12 主节 + 迁移 + 参考 +
  3 张文字版架构图 + 26 项反反爬清单表).
- README.md: 3 处微调 (版本号 R48-1B → R50-1C + agent-ctx 文件数 22→23 + worklog 行数
  ~19000→~19500 + 第 4 行增加"安装教程重写"说明).
- .gitignore: 新增 3 个 pattern (download/ + upload/ + .tmp/), 总从 97 → 102 行.
- 删除文件 (6 类):
  - `.dockerignore` (70 行 stale Docker context)
  - `tool-results/` (19 个 bash_*.txt + read_*.txt, 共 984 KB)
  - `download/README.md` + `download/` 目录 (34 字节占位)
  - `go-backend/backend.log` (183 字节运行时日志)
  - `go-backend/cloak-browser` (12.4 MB 误置二进制)
  - `.tmp/r50_css_check.py` (5.5 KB agent 临时脚本)

未修改 (尊重约束):
- `go-backend/*.go` (深度审查无 R50-1C 后边缘 case, 38 deadcode exported funcs 按 R48-1B
  决议保留) ✓
- `go-backend/services/*` 11 个 services + bridgeserver (无边缘 case) ✓
- `go-backend/templates/*.html` 94 个模板 (无边缘 case) ✓
- `public/clone-css/*.css` 10 套 CSS (无边缘 case) ✓
- `prisma/schema.prisma` + `package.json` + `start-go.js` + `start.sh` + `Caddyfile` +
  `.env.example` + `mini-services/*.sh` 0 改动 ✓
- `agent-ctx/*.md` (R38-R49 全部保留) ✓

Stage Summary:
- DEPLOY.md 完全重写为 14 节 (12 主节 + 迁移说明 + 参考), 62257 字节, 涵盖项目介绍 +
  环境要求 (Go 安装三平台 + 硬件 + 端口) + 获取代码 + 编译 (主后端 + 11 mini-services
  增量 + 单独) + 数据库初始化 (2 路径) + 配置 (12 环境变量) + 启动 (3 种方式 含源码) +
  预览 (10 前台 + 13 admin + 5 静态) + 采集规则 (创建步骤 + 26 项反反爬清单) + 架构图
  (3 张文字版) + 故障排查 (7 类) + 生产部署 (systemd + Caddy/Nginx + 备份 + 升级 + 监控 +
  安全清单 8 项) + 迁移说明 + 参考.
- README.md 同步更新版本号 R48-1B → R50-1C + 文件统计.
- 清理 6 类过时产物: .dockerignore (Docker 残留) + tool-results/ (984KB agent 调试) +
  download/ (占位) + go-backend/backend.log + go-backend/cloak-browser (12.4MB 误置) +
  .tmp/ (agent 临时), 总清理 ~13.4 MB. .gitignore 加固 3 pattern (download/ + upload/
  + .tmp/) 防误入库.
- 编译 0 errors, vet 0 warnings, binary 24 MB (24287512 bytes, 与 R49-1C 持平). heis-backend
  启动 :3000 加载 94 模板无解析警告. health/home/admin 三端点 curl 全 200.
- 38 deadcode exported funcs 按 R48-1B 决议全保留 (供未来用 + 避免破坏 API 兼容).
- 核心保留 R38-R49 全部修复 (R49-1C 5 套主题 51 处 search form BUG 修复 + R49-1B cleaner.go
  7 P2/P3 bug 修复 899 行 + R48-1A utls 24 池 + TLS session ticket + 三服务级联 captcha +
  R47-1A utls 21 款 + cleaner.go ~40 段 regexp 预编译 + fetcher.go stripPort cookie 跨子域
  + captcha 连续失败 cooldown + probe target 轮换 + R46 全面 Go 化 + R43 8 级降级链 等).
- 详细工作记录: 本 worklog 条目 + agent-ctx/R50-1C-full-stack-developer.md
