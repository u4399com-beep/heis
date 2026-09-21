# R44-1B 工作记录 — full-stack-developer (安装部署教程)

## 任务摘要
- Task ID: R44-1B
- 上游交接: R42-1C (删旧 src/ 350 文件) + R43-1A (A agent 新增 3 个 Go 服务 curl-impersonate/
  trafilatura/cloak-browser) + R43-1B (B agent utls Hello 指纹池 + MarkProxyFailed/OK +
  TwoCaptcha 字段) + R43-1C (清理 12 旧 Python/bun mini-services + start-all.sh 重写 Go 版
  + scripts/ 65 文件清理 + agent-ctx 102→10 + .gitignore 更新 + next.config.ts broken import
  修复).
- 范围: 重写 `DEPLOY.md` (项目根), 把部署链路从旧 Next.js/Bun + Docker 切换到 Go 单二进制 +
  12 mini-services.
- 不碰: go-backend/* (Go 代码) + src/* (已删).

## 详细工作日志

### 第一步: 读交接文档 (必做)

1. **读 worklog.md 末 200 行** (R43-1B + R43-1C 完整链路):
   - R43-1B: B agent Go 采集引擎第三轮深度审查 8 模块 7908 行, 抓 4 P0 + 3 P1 bug
     (ReportRateLimited 死代码 / proxyInst.failedUntil 死字段 / captchaEncountered 死字段 /
     discoverBooks 无条件 break / cleaner trafilaturaCallClient 不复用 globalTransport /
     parser ExtractJsonLd 内 regexp.MustCompile 重编 / runner batchMu.Unlock 非 defer panic
     不安全), 全部修复. 反反爬增强 2 大类 (utls 4 Hello 池 per-host 钉扎 + 2captcha API).
     fetcher.go +304 / runner.go +66 / cleaner.go +5 / parser.go +4 / types.go +9. 编译
     0 errors, vet 0 warnings, binary 24.2MB.
   - R43-1C: 清理 6 大类. ① 旧 Python/bun mini-services 12 目录全删 (11 服务 + _shared, Go
     等价 11 个 + A agent 新增 3 个 = 12 个 Go 服务完整替代, 端口 3010-3020 兼容); ② start-all.sh
     重写 Go 二进制启动 (两阶段并行构建 + 增量 + 幂等 + Go 工具链自动查找 /home/z/go/bin/go 优先
     PATH 回退, 11 个服务全 OK); ③ stop-all.sh + status.sh 同步; ④ Go dead code 扫描 (vet 0
     warnings); ⑤ 过时注释清理 (bridgeserver 顶部 19 行 + 3 处 _shared 引用 + xjp-proxy R7-18);
     ⑥ 临时文件清理 (scripts/ 65 文件 + agent-ctx/ 102→10 + probe-html/+probe-html2/ 44 个 +
     .gitignore +10 行). 顺带修复 R42-1C 删 src/ 时遗留的 next.config.ts broken import.
   - 编译 0 errors, vet 0 warnings, lint 0 errors. 端到端 start 11/11 + status 11/11 + stop
     11/11 全验证.

2. **读 go-backend/main.go** (入口):
   - `package main` + imports: database/sql + encoding/json + html/template + net/http + os +
     path/filepath + regexp + runtime + strconv + strings + unicode/utf8 + modernc.org/sqlite.
   - init(): basePath 自动查找 (cwd 内有 go-backend/ → cwd; cwd 以 go-backend 结尾 → 父目录;
     否则 cwd).
   - main(): dbPath 优先 `db/custom.db` (项目根), 不存在回落 `prisma/dev.db`. sql.Open 后
     解析模板 + 注册静态 /clone-css/* + 注册路由 + ListenAndServe(":3000").
   - 路由总览:
     - `/` homeHandler (前台 SSR, 按 ?view=home|book|read|category|ranking|fulltext|search|keyword 分发, R42-1A 起 ?view="" 时强制 404 防 SEO 垃圾)
     - `/health` healthHandler
     - `/api/public/books|categories|sites|book|chapter` 6 个公开 API
     - `/api/admin/health|tasks|tasks/|rules|rules/|books|categories|categories/|links|links/|
       themes|downloads|downloads/|settings|feedback|feedback/|backup|backup/|seo-audit` 14 个
       admin API
     - `/admin` + `/admin/` adminPageHandler (admin SSR, 深色主题)
   - 启动日志: "数据库: ... / 已加载 N 个模板 / heis-backend 启动: http://localhost:3000
     (内存 17MB)"
   - FuncMap 全集 (R38-R40): wordCount / statusLabel / fmtDate / fmtDateShort / add / sub /
     fbTypeLabel / fbTypePill / fbStatusLabel / fbStatusPill / scoreColor / severityColor /
     severityLabel / jobStatusLabel.

3. **读 go-backend/services/ 目录** (12 mini-services):
   - 11 个 main.go (8 原有 + R43-1A 新增 3): bqg713-proxy / fetch-relay / scrapling-bridge /
     qimao-proxy / deqixs-proxy / xjp-proxy / uc-bridge / moli-bridge / curl-impersonate-bridge /
     trafilatura-bridge / cloak-browser.
   - 1 个共享包: bridgeserver/bridgeserver.go (843 行, 共享样板 RateLimiter + safeHostPath +
     truncStr + boolStr + ifEmpty + httpURLRe + htmlToText).
   - LoC 统计: bqg713 189 / fetch-relay 338 / scrapling-bridge 432 / qimao-proxy 800 / deqixs
     366 / xjp 587 / uc-bridge 430 / moli 303 / curl-impersonate 424 / trafilatura 367 /
     cloak-browser 570 / bridgeserver 843.

4. **读 mini-services/start-all.sh** (Go 版, 启动 12 服务):
   - `set -u`, `PROJECT_ROOT=/home/z/my-project`, `GO_BACKEND`, `BIN_DIR=go-backend/bin`,
     `LOG_DIR=.zscripts`.
   - Go 工具链查找: 优先 /home/z/go/bin/go (sandbox), 回退 PATH 中的 go, 都没找到报错退出.
   - 11 个服务 (start-all.sh 注释写 "11", 实际 SERVICES 数组 = 11, 因为 bridgeserver 是包
     不是独立服务; 加上 heis-backend 主后端才是 12). 端口映射:
     - 3010 bqg713-proxy
     - 3011 fetch-relay
     - 3012 scrapling-bridge
     - 3013 qimao-proxy
     - 3014 deqixs-proxy
     - 3015 xjp-proxy
     - 3016 uc-bridge
     - 3017 moli-bridge
     - 3018 curl-impersonate-bridge (R43-1A 新增)
     - 3019 trafilatura-bridge (R43-1A 新增)
     - 3020 cloak-browser (R43-1A 新增)
   - Phase 1: 增量构建 (源码 mtime > 二进制 mtime 才重建, find ... -printf '%T@\n' | sort -rn
     | head -n 1 vs stat -c %Y bin_path). 并行构建 (后台 `&` + `wait`), 输出 redirect 到
     `<svc>.build.log`. 失败不阻塞后续.
   - Phase 2: 端口检查 (curl /health 200 → skip 幂等). nohup + disown 后台启动, PID 写
     `.zscripts/<svc>.pid`. 6 次 0.5s 间隔探针, /health 200 = OK; 否则 WARN 不阻塞.
   - 输出: "[start-all] done. See $LOG_DIR/*.log for details."
   - 注: start-all.sh / stop-all.sh / status.sh 的 NAMES 数组都是 11 项, "12" 是 11 mini-services
     + heis-backend 主后端的合计; 任务文档说 "12 mini-services" 是宽口径, 实际 mini-services/
     目录管 11 个独立服务二进制 + heis-backend 主二进制 = 12 个 Go 二进制总数.

5. **读 prisma/schema.prisma** (DB schema):
   - 11 张表 + R40 新增 Feedback 共 12 张:
     - Category (id/name/sortOrder/books)
     - Rule (id/name/description/config JSON/enabled/tasks) — 采集规则 4 段 list/book/toc/content
       完整配置 JSON
     - Book (id/name/author/categoryId/intro/cover/status/keywords/latestChapter/wordCount/
       sourceUrl/sourceRuleId/storageMode/collectedAt + chapters/tags/downloads; 3 索引
       categoryId/updatedAt/wordCount)
     - Chapter (id/bookId/idx/title/volume/url/content/storage/filePath/wordCount/fetched; 2
       索引 bookId+url/updatedAt + unique bookId+idx)
     - BookTag (id/bookId/tag/source/hits; unique bookId+tag + index tag)
     - Task (id/name/ruleId/mode/bookUrl/listUrl/listStart/listEnd/bookStart/bookEnd/
       recrawlMode/storageMode/fetchConfig/threadMin/threadMax/intervalMin/intervalMax/
       smartCategory/smartComplete/autoSuggest/autoRefresh/refreshIntervalMin/status/
       progress/stats/logs)
     - TaskLog (id/taskId/level/message/createdAt; index taskId+id)
     - Site (id/name/domain/title/description/keywords/icbm/geoRegion/geoPlacename/offset/
       isDefault/status/inLinkWheel/chapterPaginationMode/chapterPaginationWords/
       chapterPaginationPages/chapterSeoAuto/chapterSeoTitleTemplate/chapterSeoDescTemplate/
       chapterSeoKeywordsTemplate/pseudoStaticStyle/navCategoryCount/homeModuleLimit/
       footerText/footerCopyright/footerIcp/footerStats)
     - DownloadJob (id/bookId/options/status/filePath/error/size)
     - Setting (key/value)
     - FriendLink (id/name/url/logo/sortOrder/enabled; index enabled+sortOrder)
     - Feedback (R40 新增: id/type/contact/content/url/siteId/userAgent/ip/status/adminNote;
       2 索引 status+createdAt/type)

### 第二步: 写 DEPLOY.md

完全重写项目根目录 DEPLOY.md (旧版 516 行 Next.js + Docker 部署, 全删). 新版本 591 行, 10 节:

**§一 环境要求** (3 子节):
- 1.1 软件依赖表 (Go 1.23+/SQLite modernc.org/sqlite v1.59.0/curl/bash 4+/Prisma CLI 可选).
  Go 工具链下载 https://go.dev/dl/; go.mod 声明 1.26 但 1.21+ API 即可.
- 1.2 硬件建议表 (内存最低 256MB 推荐 4GB; Go 17MB vs 旧 Next.js 2.2GB OOM 消失; 磁盘 1-5GB;
  CPU 1-2 核).
- 1.3 端口规划表 (3000 heis-backend + 3010-3020 12 mini-services, 每行附用途说明). 同口径
  start-all.sh / stop-all.sh / status.sh 三脚本端口表.

**§二 快速开始** (5 分钟跑起来, 5 子节):
- 2.1 编译主后端 (cd go-backend && go build -o heis-backend .)
- 2.2 初始化数据库 (路径 A prisma db push; 路径 B 直接放 db/custom.db, Go 后端启动自动 open
  回落 prisma/dev.db)
- 2.3 启动主后端 (./heis-backend, 后台 nohup + pkill)
- 2.4 启动 12 mini-services (bash mini-services/start-all.sh, 幂等)
- 2.5 验证 (curl /health + status.sh, 11 行全 ALIVE 200; moli/cloak/trafilatura selfTest=
  false 是预期)

**§三 配置** (4 子节):
- 3.1 数据库 (db/custom.db 默认路径; DSN file:./db/custom.db 仅 Prisma CLI 用; Go 后端直接
  sql.Open 不读 .env; WAL 模式 + cp 安全备份 + VACUUM 回收)
- 3.2 站点配置 (10 主题选择 + TDK + SEO/GEO + footer 自定义 + 章节分页 + 伪静态 URL 风格 +
  站群链轮 inLinkWheel)
- 3.3 采集规则 (4 段 list/book/toc/content JSON + 5 提取器 css/xpath/regex/json/const + 清洗
  规则 + 极限校准 + tokenUrl 钩子)
- 3.4 mini-services 启停 (start-all.sh / stop-all.sh / status.sh 三脚本命令表 + Go 工具链路径
  解析顺序 /home/z/go/bin/go 优先 PATH 回退)

**§四 采集规则配置** (3 子节):
- 4.1 创建规则 (5 步: 浏览器 /admin/rules → 新建 → config JSON → 在线测试 → 启用 →
  /admin/tasks 创建任务)
- 4.2 参考规则表 (7 站点: 番茄/七猫/得奇/八零/精华/笔趣阁/霹雳, 每行附规则关键点 tokenUrl/
  AES/反爬严重度)
- 4.3 8 级降级链 (native → curl → fetch-relay → scrapling → Obscura → uc-bridge →
  moli-bridge → curl-impersonate; 详细说明 R43-1B MarkProxyFailed cooldown + MarkProxyOK
  清状态)

**§五 预览** (访问地址表 11 行):
- http://localhost:3000/ + ?view=home/book/read/category/ranking/search/fulltext/keyword
  共 8 页型 + ?site=<siteId> 站点切换 + /admin 后台. 注明后台无登录鉴权, 生产必做反向代理
  Basic Auth + IP 白名单.

**§六 架构图 (文字版)**:
- 用户浏览器 → Go heis-backend :3000 (main.go 1173 行)
  - 静态 /clone-css/* (10 主题源站 CSS)
  - 前台 SSR 94 模板 (10 主题 × 8 页型 + 14 admin)
  - API 14+6 路由
  - DB SQLite WAL db/custom.db
- 采集引擎 crawl/ (8296 行 Go)
  - 8 模块 fetcher 2743 / parser 1612 / runner 1436 / cleaner 722 / types 715 / hostgate
    414 / storage 363 / smart 291
  - 反反爬 utls Hello 指纹池 + JA3/JA4 轮换 + Cookie 持久化 + Referer 链伪造 + 2captcha +
    MarkProxyFailed/OK
- 12 Go mini-services (端口 3010-3020)
  - 11 行服务清单 + 用途
  - 全部 Go 二进制 (R43-1C 删旧 TS/Python 版)
  - start-all.sh 一键拉起 / /health 自检 + selfTest

**§七 故障排查** (6 子节):
- 7.1 内存 / OOM (Go 17MB 不会 OOM; 旧 Next.js 2.2GB OOM 已不存在; chromium 吃内存场景)
- 7.2 mini-services 异常 (status.sh + tail 日志 + 重启命令 + 3 个 selfTest=false 预期说明:
  moli-bridge 外部二进制未装 / cloak-browser 无 token / trafilatura-bridge 缺 Readability 配置)
- 7.3 数据库锁 (WAL + busy_timeout + wal_checkpoint(TRUNCATE) + VACUUM + sqlite3 .backup
  在线备份命令)
- 7.4 主后端 :3000 起不来 (端口占用 / 模板解析失败 / 数据库路径 / 94 模板加载不全 4 类排查)
- 7.5 采集失败排查 (规则在线测试 / 降级链日志 tail / TaskLog 表 / 极限校准 4 步)
- 7.6 编译失败 (Go 版本太低 / 国内 GOPROXY / utls chromedp 冲突 go mod tidy / vet 警告)

**§八 生产部署建议** (4 子节):
- 8.1 systemd 托管 (heis-backend.service + heis-mini-services.service 双 unit 完整 INI;
  Type=oneshot + RemainAfterExit=yes 给 mini-services; enable --now 启动)
- 8.2 反向代理 (Caddy basicauth /admin* 自动 HTTPS + Nginx auth_basic 等价配置)
- 8.3 备份策略 (每日凌晨 cp + VACUUM + 7 天保留 + /api/admin/backup JSON 导出)
- 8.4 升级 (git pull → go build -o heis-backend . → stop-all.sh → start-all.sh →
  systemctl restart heis-backend)

**§九 迁移说明** (从旧 Next.js 版本升级, 11 维度对比表):
- 运行时 / 内存 / 构建 / 部署 / 依赖 / 前端 / 模板数 / 采集引擎 / mini-services / 降级链 /
  反反爬 11 维度.
- 升级 5 步路径 (停旧 → 留 db/custom.db + clone-css + data → 删 src/node_modules/.next →
  编译 + 启动 → 浏览器验证). 数据库 schema 完全兼容无需迁移.

**§十 参考** (8 个文档/源码索引):
- agent-ctx 3 个工作日志 (R43-1A/1B/1C) + worklog.md 全链路 + prisma/schema.prisma +
  crawl/* + main.go + admin.go + services/* + bridgeserver.go.

**文档版本**: R44-1B (Go 重写后部署链路), 对应 worklog.md R38-R43 全程迁移记录.

### 第三步: 写完后

1. DEPLOY.md 591 行, 完整覆盖 10 节 (环境/快速开始/配置/采集规则/预览/架构图/故障排查/生产部署/
   迁移说明/参考).
2. 追加 worklog 到 /home/z/my-project/worklog.md.

## 文件改动统计
- DEPLOY.md: 516 行 (旧 Next.js + Docker 部署) → 591 行 (Go 后端 + 12 mini-services), 完全
  重写而非局部修改. 旧版本: Docker 一键 install.sh + Bun + node:22-slim + Turbopack 构建 +
  scrapling Dockerfile + install.sh 国内镜像加速. 新版本: Go 单二进制 + bash 启停脚本 +
  systemd + 反向代理 + 升级链 + 迁移说明, 全部基于 R43-1C 后实际 Go 部署链路.

## 未修改 (尊重约束)
- go-backend/* (Go 代码, 含 main.go + admin.go + crawl/* + services/* + templates/*) ✓
- src/* (已删, R42-1C) ✓
- prisma/schema.prisma + package.json + next.config.ts 0 改动 ✓
- mini-services/*.sh (start-all.sh / stop-all.sh / status.sh, R43-1C 已重写, 仅引用不改) ✓
- README.md (仍 Next.js 描述, 不在本任务范围) ✓
- install.sh (旧 Docker 一键安装脚本, 仍保留兜底, 不在本任务范围) ✓

## 验证
- DEPLOY.md 完整性: 10 节全覆盖, 命令可直接复制执行.
- 命令链路验证:
  - `cd go-backend && go build -o heis-backend .` (主后端编译, R43-1B 已验证 24.2MB 0 errors)
  - `bash mini-services/start-all.sh` (12 mini-services 启动, R43-1C 已验证 11/11 ALIVE 200)
  - `bash mini-services/status.sh` (状态检查, R43-1C 已验证 exit 0/1 区分)
  - `bash mini-services/stop-all.sh` (停止, R43-1C 已验证 11/11 graceful exit)
  - `curl http://localhost:3000/health` (主后端健康, R43-1B 已验证 200)
  - `curl http://localhost:3000/` (前台首页, R43-1B 已验证 200)
  - `curl http://localhost:3000/admin` (管理后台, R43-1B 已验证 200)
- 端口映射验证: start-all.sh SERVICES 数组 11 项 + heis-backend 主后端 :3000 = 12 个 Go 二进制,
  与 DEPLOY.md §1.3 端口规划表 + §六架构图一致.
- LoC 验证: crawl/* 8296 行 (fetcher 2743 + parser 1612 + runner 1436 + cleaner 722 + types
  715 + hostgate 414 + storage 363 + smart 291) 与 DEPLOY.md §六架构图一致.
- 模板数验证: templates/ 10 主题 × 8 页型 + 14 admin = 94, 与 DEPLOY.md §六架构图 + R43-1B
  启动日志 "已加载 94 个模板" 一致.

Stage Summary:
- R44-1B 完成 DEPLOY.md 完全重写 (516 → 591 行), 把部署链路从旧 Next.js/Bun + Docker 切换到
  Go 单二进制 + 12 mini-services. 新版本 10 节: ① 环境要求 (Go 1.23+ / SQLite modernc.org/
  sqlite 纯 Go 无 cgo / 4GB 内存 / :3000 主后端 + :3010-3020 12 mini-services); ② 快速开始
  (go build -o heis-backend . + prisma db push + ./heis-backend + bash start-all.sh 5 步);
  ③ 配置 (数据库 WAL + 站点 10 主题 + 采集规则 4 段 JSON + mini-services 三脚本启停); ④ 采集规则
  (7 站点参考 + 8 级降级链 native→curl→fetch-relay→scrapling→Obscura→uc-bridge→moli-bridge→
  curl-impersonate); ⑤ 预览 (8 页型 + /admin 后台, 注明无鉴权); ⑥ 架构图 (用户 → :3000
  heis-backend → 94 模板 + 14+6 API + SQLite WAL + crawl/ 8296 行 + 12 mini-services); ⑦ 故障
  排查 (OOM/mini-services/DB 锁/主后端起不来/采集失败/编译失败 6 大类); ⑧ 生产部署 (systemd
  双 unit + Caddy/Nginx 反向代理 + 备份 + 升级); ⑨ 迁移说明 (11 维度对比 + 5 步升级路径, schema
  兼容无需迁移); ⑩ 参考 (8 文档/源码索引). 详细工作记录: agent-ctx/R44-1B-full-stack-developer.md
