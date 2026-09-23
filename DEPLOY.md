# HEIS 小说采集与发布系统 — 安装部署图文教程

> **本文件覆盖 Go 重写后的完整部署链路**（R38–R51 全链路迁移 + R50-1C 重写 + R51-1B 校对）。主后端
> `go-backend/main.go`（heis-backend，:3000）+ 11 个 Go mini-services（端口 3010–3020）+
> bridgeserver 共享包。Go 二进制单文件部署，**无 cgo / 无 Bun / 无 Node / 无 Docker 依赖**，
> 运行期内存 17 MB（vs 旧 Next.js 2.2 GB），单机即可承载。
>
> `heis-backend` 二进制已入 git（commit `29dcd99`），平台 `git clone` 后零编译直接运行
> `./go-backend/heis-backend`。仅当 `go-backend/*.go` 或 `go-backend/services/*/main.go`
> 源码变更时才需重建。平台 `bun run dev` 实际拉起 `bun start-go.js`，后者循环
> `./go-backend/heis-backend`，进程异常退出后 2 s 自动重启。

---

## 目录

1. [项目介绍](#一项目介绍)
2. [环境要求](#二环境要求)
3. [获取代码](#三获取代码)
4. [编译](#四编译)
5. [数据库初始化](#五数据库初始化)
6. [配置](#六配置)
7. [启动](#七启动)
8. [预览](#八预览)
9. [采集规则配置](#九采集规则配置)
10. [架构图](#十架构图)
11. [故障排查](#十一故障排查)
12. [生产部署](#十二生产部署)
13. [迁移说明](#十三迁移说明从旧-nextjs-版本升级)
14. [参考](#十四参考)

---

## 一、项目介绍

**HEIS（Heis）小说采集与发布系统** 是一套基于纯 Go 的规则驱动型小说采集 + 站群发布系统：
管理员在 `/admin` 后台配置站点规则与采集任务，引擎按规则抓取（**8 级降级链 + 36 项反反爬
增强**）→ 清洗 → 落库；前台站群（书城 / 书籍详情 / 阅读页 / 搜索 / 分类 / 排行榜 / 关键词聚合
/ 全文搜索）直接消费库内数据，封面图 `/covers/<name>` 走 SVG 占位兑底（不存在则返回渐变色块 + 书名首字）。

### 1.1 技术栈

| 层 | 技术 |
| --- | --- |
| 主后端 | Go 1.23+ + `net/http` 标准库（go.mod 声明 1.26，但 1.21+ API 即可编译） |
| 模板 | `html/template`（94 个 = 10 主题 × 8 页型 + 14 admin） |
| 数据库 | modernc.org/sqlite v1.59.0（纯 Go SQLite，**无 cgo**）+ Prisma schema（仅建表用） |
| 采集引擎 | `go-backend/crawl/*.go`（8 模块 10655 行，纯 Go 标准库 + goquery + utls + chromedp） |
| mini-services | `go-backend/services/*/main.go`（11 个独立 Go 二进制，端口 3010–3020）+ bridgeserver 共享包 |
| 部署 | 单二进制 + bash 脚本（start-all.sh / stop-all.sh / status.sh），**无 Docker / 无 compose** |

### 1.2 核心能力

- **单二进制部署**：`go build -o heis-backend .` 产出 24 MB 静态链接二进制，运行期 17 MB 内存
  （vs 旧 Next.js 2.2 GB，OOM 风险消失），单机即可承载。
- **采集引擎**（`go-backend/crawl/` 8 模块 10655 行）：规则四段（list / book / toc / content）
  解析、CSS / XPath / regex / JSON 字段提取、分页与翻页 Referer 链、编码识别（GBK 自动转
  UTF-8）、正文清洗（广告 / 去壳页 / 零宽字符剥离 / trafilatura 桥）、分卷排序、并发限速 +
  HostGate 双限速、封面本地化（webp）。
- **8 级降级链**：native（utls 36 款 Hello 指纹池含 PSK / PQ / 老 iOS / Chrome 老版 / Firefox 老版 ESR / 2016 era Chrome 58）→ curl（系统二进制 JA3
  指纹）→ fetch-relay 中继桥 → Scrapling 桥（static / stealthy / playwright 三档）→ cloak-browser
  隐身 chromium 反检测渲染 → uc-bridge UC 头条桥 → moli-bridge moli 桥 → curl-impersonate
  curl_cffi JA3/JA4 桥，按站点防护级别自动降级，前级成功不降级。
- **36 项反反爬**：utls Hello 指纹池 36 款 + per-host 钉扎 + attempts 偏移轮换 + TLS session
  ticket 缓存（LPU + 磁盘 persistable + snapshot+IO 模式）+ JA3/JA4 轮换 + Cookie 持久化
  （cf_clearance 跨子域合并 + stripPort 跨端口）+ Referer 链伪造 + 重试退避（full jitter）+
  Cookie/Token 挑战求解 + looksBlocked / looksLikeCaptcha 启发式拦截 + 2captcha 验证码
  （连续 3 次失败 60 s cooldown + sitekey 三属性名 + JS 变量 fallback + 三服务级联）+
  代理池（MarkProxyFailed / OK 健康跟踪 + cooldown + 5 endpoint 轮选 probe + latency 跟踪 +
  least-latency 旋转策略 + ProxyStatsSnapshot admin 查询）+ brotli miss 计数 + probe target 轮换 +
  主动 probe 5 min 间隔 + 3 次失败冷却 + SSRF 守卫 + mirrorDomains 镜像组 + per-host UA 钉扎 +
  CookieJar 跨子域合并 + 网络层错误不清 utls choice + Token 挑战 HTTP 求解 + Cookie 挑战重试 +
  TLS handshake 失败清 utls + 行为模拟 Gaussian 微抖 + micro wheel events + 15% 概率 Tab key。
- **站级签名 / 解密代理**：对 token / 签名 / AES 类站点（笔趣阁 / 七猫 / 得奇 / xjp 等）以外置
  Go mini-service 承载，引擎 `tokenUrl` 钩子对接。
- **管理端**：14 个后台页面（dashboard / tasks / rules / books / categories / sites / links /
  themes / downloads / settings / feedback / backup / seo-audit / layout），规则 CRUD + 在线测试 +
  极限校准（对模拟源站三档封禁策略实测安全并发与速率）、任务（单书 / 批量 / 实时采集 / 定时
  增量 autoRefresh）、书籍 / 章节管理、TXT 下载、统计看板、JSON 备份 / 恢复、SEO 审计。
- **前台**：10 主题站群（aijjxs / 101kks / x2552 / 23qb / ddyueshu / huangjinwu / ggd66 /
  pilishuwu / trxsw / shipsay，每主题 8 页型 = 80 文件 + 14 admin = 94 模板），主题注册表
  驱动，阅读页 / 搜索 / sitemap / 伪静态链接（query / numeric / alphanumeric / slug / short /
  classic / dir）/ 章节分页（off / byWords / byPages）/ 站群链轮（inLinkWheel）/ 自定义 TDK +
  ICBM 坐标 + geoRegion / geoPlacename。
- **封面图 SVG 占位**（R52-1A）：模板封面 URL 走绝对路径 `/covers/<name>.webp`，main.go
  `/covers/` handler 三段式服务：①`data/covers/<name>` → ②`public/covers/<name>` →
  ③SVG 占位图（渐变色块 + 书名首字 96px 白字）。采集中 SaveCoverWebp 落盘到
  `data/covers/<name>.webp`，模板 <img src="{{.cover}}"> 拿到 `/covers/<name>.webp`
  绝对路径；不存在走 SVG 占位，浏览器渲染不裂图。
- **分类名 4 字化**（R52-1A）：标准分类从 2 字 (玄幻/武侠/...) 改 4 字 (玄幻奇幻/武侠江湖/...)
  共 15 个，与 DB schema 一致。`NormalizeCategory` 三段式归一化：①精确别名命中 →
  ②标准 4 字名直接返回 → ③模糊包含匹配 (源站名含 4 字名 → 合并)。原 2 字源站分类
  通过 `categoryAliases` 兑底转 4 字（兼容旧源站未升级场景）。

---

## 二、环境要求

### 2.1 软件依赖

| 组件 | 版本 | 说明 | 下载 / 安装 |
| --- | --- | --- | --- |
| **Go 工具链** | **1.23+**（go.mod 声明 1.26） | 编译主后端 + 11 mini-services + bridgeserver 共享包，纯 Go 标准库即可，**无 cgo** | https://go.dev/dl/ |
| **SQLite 驱动** | modernc.org/sqlite v1.59.0 | 纯 Go 实现，**无 cgo / 无系统 lib 依赖**，`go build` 直接产出可移植二进制 | 已在 go.mod，go build 自动拉取 |
| **curl** | 任意版本 | mini-services 健康探针 + 采集降级链 + status.sh 探测用，Linux/macOS 系统自带 | 系统 |
| **bash** | 4+ | `mini-services/*.sh` 启动脚本依赖（macOS 默认 bash 3 需 `brew install bash`） | 系统 |
| **Prisma CLI**（可选） | 5+ | 仅当需要 `prisma db push` 重新建表时才需要；Go 后端启动会直接 open 既有 SQLite 文件，不依赖 Prisma | https://www.prisma.io/ 或 `bunx prisma` / `npx prisma` |
| **Node / Bun**（可选） | Node 18+ 或 Bun 1.0+ | 仅当用 `bunx prisma db push` 建表，或用 `bun start-go.js` 自动重启包装时需要；Go 后端本身**不依赖** | https://nodejs.org/ / https://bun.sh/ |

### 2.2 安装 Go 工具链（详细步骤）

#### Linux / macOS（推荐 tarball 方式，不污染系统包管理器）

```bash
# 1. 下载 Go 1.23+ (此处以 1.23.2 linux-amd64 为例；macOS 用 darwin-amd64/arm64)
cd ~
wget https://go.dev/dl/go1.23.2.linux-amd64.tar.gz

# 2. 解压到 ~/go (用户级安装, 不需 sudo) 或 /usr/local/go (系统级, 需 sudo)
mkdir -p ~/go
tar -C ~/go -xzf go1.23.2.linux-amd64.tar.gz
# 此时 ~/go/go/bin/go 即可执行

# 3. 配置 PATH (写入 ~/.bashrc 或 ~/.zshrc 持久化)
echo 'export PATH=$PATH:$HOME/go/go/bin' >> ~/.bashrc
source ~/.bashrc

# 4. 验证
go version
# 期望输出: go version go1.23.2 linux/amd64
```

> **国内网络加速**：若 `go mod download` 慢，配置 GOPROXY：
> ```bash
> go env -w GOPROXY=https://goproxy.cn,direct
> ```

#### Windows

1. 下载 `go1.23.x.windows-amd64.msi` 自 https://go.dev/dl/
2. 双击安装（默认路径 `C:\Program Files\Go`）
3. 安装程序会自动配置 PATH；新开 PowerShell 验证 `go version`

#### 验证安装

```bash
go version      # 必须 1.23+ 输出
go env GOROOT   # Go 安装根目录
go env GOPATH   # 工作区 (默认 ~/go)
```

### 2.3 SQLite（无需安装系统库）

本项目用 `modernc.org/sqlite` v1.59.0 纯 Go SQLite 驱动，**不依赖系统 libsqlite3**。
`go build` 直接产出静态二进制，可在任意 Linux/macOS/Windows 上跑，无需额外安装 SQLite
运行时。仅当你需要手动操作库文件（如 VACUUM / 在线备份）时才需要 `sqlite3` CLI 工具：

```bash
# Linux: apt / yum / dnf install sqlite
# macOS: 系统自带 sqlite3 (在 /usr/bin/sqlite3)
sqlite3 --version   # 验证
```

### 2.4 硬件建议

| 资源 | 最低 | 推荐 | 备注 |
| --- | --- | --- | --- |
| **内存** | 256 MB | **4 GB** | Go 主后端运行期 17 MB；4 GB 是为同时跑 11 mini-services + 采集并发 + 可选 chromium（cloak-browser / scrapling-bridge stealthy 模式） |
| **磁盘** | 1 GB | 5 GB | Go 二进制 24 MB × 12（主后端 + 11 mini-services）≈ 288 MB；SQLite 库 + 封面 + TXT 下载产物随书籍数线性增长 |
| **CPU** | 1 核 | 2 核 | 单核足以承载采集 + SSR，2 核更流畅 |
| **对比旧 Next.js** | — | — | 旧版本 Next.js standalone 运行期 2.2 GB（Turbopack 构建峰值超 2 GB，2 GB 机器直接 OOM）；Go 版本运行期 17 MB，**OOM 风险消失** |

### 2.5 操作系统

- **Linux**：Ubuntu 20.04+ / CentOS 7+ / Debian 11+ 均可（推荐 Ubuntu 22.04 LTS）
- **macOS**：12 Monterey+（注意默认 bash 3.2 需 `brew install bash` 升级到 4+）
- **Windows**：10/11 + WSL2（原生 Windows 也可跑，但 bash 启停脚本需 Git Bash 或 WSL）

### 2.6 端口规划

| 端口 | 进程 | 用途 |
| --- | --- | --- |
| **3000** | `heis-backend`（go-backend/main.go） | 主后端：前台 SSR + /admin 后台 + /api/public/* + /api/admin/* + 静态资源 /clone-css/* |
| 3010 | bqg713-proxy | 笔趣阁 token / AES 站点签名代理 |
| 3011 | fetch-relay | 通用 HTTP 中继桥（降级链 3 级） |
| 3012 | scrapling-bridge | Scrapling 抓取桥（static / stealthy / playwright，含可选 Python 子进程） |
| 3013 | qimao-proxy | 七猫签名 + AES 解密代理 |
| 3014 | deqixs-proxy | 得奇 xs 站点代理 |
| 3015 | xjp-proxy | xjp 站点代理 |
| 3016 | uc-bridge | UC 头条小说桥 |
| 3017 | moli-bridge | moli 桥（依赖外部 moli 二进制，未装时 selfTest=false，不阻塞） |
| 3018 | curl-impersonate-bridge | curl_cffi 桥（Python 子进程可选；缺则 selfTest=false） |
| 3019 | trafilatura-bridge | go-readability + trafilatura 正文抽取桥 |
| 3020 | cloak-browser | 隐身 chromium 反检测渲染（cloak 模式，需 token；缺则 selfTest=false） |

> 全部 11 mini-services 由 `mini-services/start-all.sh` 一键拉起，端口独占、互不冲突；
> 全部绑 `127.0.0.1:<port>`，仅本机 heis-backend 访问。如改端口需同步修改各服务 `main.go`
> 顶部常量 + `start-all.sh` / `stop-all.sh` / `status.sh` 三处端口表。

---

## 三、获取代码

### 3.1 git clone

```bash
# 公开仓库 (master 分支即生产可用)
git clone https://github.com/u4399com-beep/heis.git
cd heis

# 验证关键文件就位
ls -la go-backend/main.go          # 主后端源码 (53KB)
ls -la go-backend/heis-backend     # 预编译二进制 (24MB, 已入 git, 平台 clone 即跑)
ls -la go-backend/crawl/           # 8 模块采集引擎 (10655 行)
ls -la go-backend/services/        # 11 mini-services + bridgeserver 共享包
ls -la go-backend/templates/       # 94 个模板 (10 主题 × 8 + 14 admin)
ls -la prisma/schema.prisma        # 11+1 表 schema (Go 后端不依赖, 仅 prisma db push 用)
ls -la mini-services/*.sh          # start-all.sh / stop-all.sh / status.sh
ls -la public/clone-css/           # 10 套主题的源站 CSS
```

### 3.2 目录结构速览

```
heis/                                 # 项目根
├── go-backend/                       # Go 后端 (主后端 + 采集引擎 + 11 mini-services + 94 模板)
│   ├── main.go                       #   主后端 (1330 行): 路由 + 86 FuncMap + 静态服务 + DB + 94 模板加载
│   ├── admin.go                      #   后台 API + admin SSR (3573 行): 14 个 admin 页面 + /api/admin/* 14 路由
│   ├── go.mod / go.sum               #   Go 模块定义 + 依赖校验
│   ├── heis-backend                  #   go build 输出二进制 (24 MB, 已入 git 平台 clone 即跑)
│   ├── crawl/                        #   采集引擎 (8 模块 10655 行)
│   │   ├── fetcher.go                #     HTTP 采集 + 8 级降级链 + UA 池 + CookieJar (4809 行)
│   │   ├── parser.go                 #     css / xpath / regex / json 字段提取 (1612 行)
│   │   ├── runner.go                 #     4 段采集流程 + 任务调度 + Semaphore (1481 行)
│   │   ├── cleaner.go                #     广告 / 去壳 / 编码 / 零宽字符剥离 / trafilatura 桥 (899 行)
│   │   ├── types.go                  #     规则 / 配置 / 结果数据结构 (737 行)
│   │   ├── hostgate.go               #     并发 + 速率双限速器 (423 行)
│   │   ├── storage.go                #     db / txt 双存储 + 封面本地化 (355 行)
│   │   └── smart.go                  #     LLM 智能分类 / 完结判断 + 正则缓存 (339 行)
│   ├── services/                     #   11 mini-services + bridgeserver 共享包
│   │   ├── bridgeserver/bridgeserver.go  # 共享样板 (917 行): /health /metrics /info 鉴权 限速 SSRF 守卫
│   │   ├── bqg713-proxy/main.go           # 3010 笔趣阁 token+AES
│   │   ├── fetch-relay/main.go             # 3011 通用 HTTP 中继
│   │   ├── scrapling-bridge/main.go        # 3012 Scrapling 抓取
│   │   ├── qimao-proxy/main.go             # 3013 七猫 AES 解密
│   │   ├── deqixs-proxy/main.go            # 3014 得奇代理
│   │   ├── xjp-proxy/main.go               # 3015 xjp 代理
│   │   ├── uc-bridge/main.go               # 3016 UC 头条桥
│   │   ├── moli-bridge/main.go             # 3017 moli 桥
│   │   ├── curl-impersonate-bridge/main.go # 3018 curl_cffi JA3 桥
│   │   ├── trafilatura-bridge/main.go      # 3019 正文抽取桥
│   │   └── cloak-browser/main.go           # 3020 隐身 chromium
│   └── templates/                    #   94 个 Go html/template 模板
│       ├── admin/                    #     14 个后台页面
│       ├── aijjxs/  101kks/  x2552/  #     主题 1-3
│       ├── 23qb/    ddyueshu/        #     主题 4-5
│       ├── huangjinwu/  ggd66/       #     主题 6-7
│       ├── pilishuwu/  trxsw/        #     主题 8-9 (pilishuwu 反爬严, 需 scrapling stealthy)
│       └── shipsay/                  #     主题 10
│           # 每主题 8 页型: home / book / read / category / ranking / search / keyword / fulltext
│
├── prisma/schema.prisma              # DB schema (11+1 表, Go 后端不依赖, 仅 prisma db push 用)
├── prisma/dev.db                     # 开发库 (R42-1C 留作 fallback; 生产用 db/custom.db)
├── db/custom.db                      # 运行时 SQLite 库 (WAL 模式, 不入版本库)
├── mini-services/                    # 11 服务启停脚本
│   ├── start-all.sh                  #   增量构建 + 后台启动 + ≤3s /health 探针
│   ├── stop-all.sh                   #   SIGTERM 5s grace + SIGKILL 兜底; PID 文件丢失走 lsof/fuser
│   ├── status.sh                     #   11 行表格 (SERVICE/PORT/PID/PROCESS/HEALTH/SELFTEST)
│   └── .gitkeep
├── public/                           # 站点静态资源
│   ├── clone-css/*.css               #   10 个主题的源站 CSS (由 main.go /clone-css/ 路由服务)
│   ├── robots.txt  sw.js  manifest.json  icon.svg  logo.svg  # 站点元数据
├── scripts/rule-yueyouxs.json        # yueyouxs (神马小说) 站点规则 backup-restore 格式 JSON
├── agent-ctx/R*-*.md                 # 各轮 agent 工作记录 (R38-R51, 32 文件)
├── worklog.md                        # 完整迁移工作日志 (~20200 行, R3-a → R51-1B 全链路)
├── package.json                      # 仅 scripts.dev = "bun start-go.js" (auto-restart 包装)
├── start-go.js                       # Bun 脚本: 循环启动 ./go-backend/heis-backend, 挂了 2s 重启
├── start.sh                          # Bash 等价: while true; do ./go-backend/heis-backend; sleep 2; done
├── .env.example                      # 环境变量模板 (mini-services AUTH_TOKEN / BRIDGE_KEY / RATE_LIMIT 等)
├── .env                              # 本机 .env (DATABASE_URL, .gitignore, 不入版本库)
├── Caddyfile                         # 沙箱网关 SSRF 防御配置 (端口白名单 3010-3015 + 透传 3000)
├── DEPLOY.md                         # 本文件
└── README.md                         # 功能总览 + 快速开始 + 架构
```

---

## 四、编译

> **平台 clone 后零编译直接运行**：`heis-backend` 二进制已入 git（commit `29dcd99`），仅当
> `go-backend/*.go` 或 `go-backend/services/*/main.go` 源码变更时才需重建。本节适用于
> 源码改动后的重新编译场景。

### 4.1 编译主后端

```bash
cd /home/z/my-project/go-backend

# 设置 GOPROXY (国内网络, 首次编译前一次性配置)
go env -w GOPROXY=https://goproxy.cn,direct

# 拉取依赖 (首次编译或 go.sum 缺失时)
go mod download

# 编译主后端 (产出 heis-backend 二进制, 24 MB, 静态链接, 无外部依赖)
go build -o heis-backend .

# 验证
ls -lh heis-backend
# -rwxr-xr-x 24M heis-backend
file heis-backend
# ELF 64-bit LSB executable, x86-64, ... Go BuildID=...

# 交叉编译 Windows (如需)
GOOS=windows GOARCH=amd64 go build -o heis-backend.exe .
# macOS
GOOS=darwin GOARCH=arm64 go build -o heis-backend.mac .
```

### 4.2 编译 11 mini-services

方式 A：用 `mini-services/start-all.sh` 增量构建（推荐，自动跳过 up-to-date 的服务）：

```bash
cd /home/z/my-project
bash mini-services/start-all.sh
# Phase 1: 增量构建 (源码 mtime > 二进制 mtime 才重建; 首次跑会构建全部 11 个)
# Phase 2: 启动 + ≤3s /health 探针 (200 = OK, 失败 WARN 不阻塞)
# 输出 PID 写到 .zscripts/<svc>.pid, 日志写到 .zscripts/<svc>.log
# 二进制输出到 go-backend/bin/<svc> (不污染源码目录)
```

方式 B：单独编译某个 mini-service：

```bash
cd /home/z/my-project/go-backend

# 单独编译 bqg713-proxy (3010)
go build -o bin/bqg713-proxy ./services/bqg713-proxy

# 单独编译 fetch-relay (3011)
go build -o bin/fetch-relay ./services/fetch-relay

# ...其余 9 个同理 (services/<name> 对应 3010-3020 的服务)
```

### 4.3 编译验证

```bash
# 1. 主后端启动测试 (前台台运行, Ctrl+C 退出)
cd /home/z/my-project
./go-backend/heis-backend
# 期望控制台输出:
#   数据库: /home/z/my-project/db/custom.db
#   已加载 94 个模板
#   heis-backend 启动: http://localhost:3000 (内存 17MB)

# 2. 验证 SSR 渲染
curl -s http://localhost:3000/health
# 期望: {"lang":"go","memMB":17,"ok":true}

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
# 期望: 200

# 3. 验证 go vet (源码静态检查, 应 0 warnings)
cd go-backend && go vet ./...
# 期望: 无任何输出 (0 warnings)
```

### 4.4 编译失败排查

```bash
# 1. Go 版本太低
go version
# 必须 1.23+; go.mod 声明 1.26, 实际 1.21+ API 即可

# 2. 依赖下载失败 (国内网络)
export GOPROXY=https://goproxy.cn,direct
cd go-backend && go mod tidy && go build -o heis-backend .

# 3. utls / chromedp / modernc.org/sqlite 版本冲突
cd go-backend && go mod tidy    # 清理 go.sum 重写

# 4. 磁盘空间不足 (11 个二进制 × 24MB ≈ 288MB)
df -h /home/z/my-project        # 确保有 ≥ 1 GB 可用空间

# 5. staticcheck / deadcode (可选, 不阻塞编译)
# 项目保守策略: 38 个 exported funcs 报 unreachable 但全保留 (供未来用, R48-1B 决议)
```

---

## 五、数据库初始化

### 5.1 Prisma schema 概览

Prisma schema 位于 `prisma/schema.prisma`，定义 11+1 张表（Feedback R40 新增）：

| 表名 | 说明 |
| --- | --- |
| Category | 分类 |
| Rule | 采集规则（含完整 config JSON） |
| Book | 书籍 |
| Chapter | 章节 |
| BookTag | 书籍标签（搜索引擎下拉词） |
| Task | 采集任务 |
| TaskLog | 任务日志（info / success / warn / error 四级） |
| Site | 站群站点（10 套主题） |
| DownloadJob | TXT 下载任务 |
| Setting | 全局设置 |
| FriendLink | 友情链接 |
| Feedback | 用户反馈（R40 新增） |

### 5.2 初始化路径

Go 后端启动时按以下顺序找 SQLite 文件（`main.go:42`）：

```
1. <basePath>/db/custom.db   ← 首选 (生产用)
2. <basePath>/prisma/dev.db   ← fallback (开发用)
```

两条路径任选其一：

#### 路径 A：用 Prisma CLI 建表（推荐，schema 单一来源）

```bash
cd /home/z/my-project

# 1. 配置 .env (Prisma CLI 读 DATABASE_URL 找库文件)
echo 'DATABASE_URL=file:./db/custom.db' > .env

# 2. 用 Prisma CLI 推 schema 到 SQLite (建 11+1 张表)
bunx prisma db push      # Bun 用户 (无需全局安装 prisma)
# 或
npx prisma db push       # Node 用户 (无需全局安装 prisma)
# 或
prisma db push           # 已全局安装 prisma CLI

# 3. 验证表已建好
sqlite3 db/custom.db '.tables'
# 期望输出: Book BookTag Category Chapter DownloadJob Feedback FriendLink Rule Setting Site Task TaskLog
```

#### 路径 B：直接用既有 SQLite 文件

```bash
cd /home/z/my-project
mkdir -p db
# 如果有现成备份 db/custom.db (生产备份 / 同事拷贝), 直接放进 db/ 即可
# Go 后端启动时会自动 open, 不需要跑 prisma db push
cp /path/to/backup/custom.db db/custom.db
ls -lh db/custom.db      # 验证文件就位
```

> **WAL 模式**：SQLite 默认开启 WAL 模式（`PRAGMA journal_mode=WAL`），支持并发读 + 单写，
> 采集并发下不会锁库。库文件旁会生成 `db/custom.db-wal` 与 `db/custom.db-shm` 辅助文件，
> 属正常现象，**不要手动删除**（停止后端进程时会自动 checkpoint 合并）。

### 5.3 验证数据库连接

```bash
cd /home/z/my-project

# 启动主后端 (前台运行)
./go-backend/heis-backend
# 控制台首行日志应打印:
#   数据库: /home/z/my-project/db/custom.db

# 另开一个终端, 直查表
sqlite3 db/custom.db "SELECT name FROM sqlite_master WHERE type='table';"
# 期望输出 11+1 行表名
```

---

## 六、配置

### 6.1 数据库配置

| 项 | 值 | 说明 |
| --- | --- | --- |
| 默认路径 | `db/custom.db`（项目根） | `main.go:42` 优先找此文件；不存在则回落 `prisma/dev.db` |
| DSN | `file:./db/custom.db` | `.env` 中 `DATABASE_URL`，仅供 Prisma CLI 用；Go 后端直接 `sql.Open("sqlite", dbPath)`，不读 `.env` |
| 模式 | **WAL** | SQLite 默认开启 WAL 模式，支持并发读 + 单写，采集并发下不会锁库 |
| busy_timeout | 5 s | `main.go` 启动时 `db.Exec("PRAGMA busy_timeout=5000")`，默认 5 s |
| 备份 | `cp db/custom.db db/custom.db.bak.$(date +%F)` | 在线备份安全（WAL 模式下 `cp` 即可获一致快照） |
| 压缩 | `sqlite3 db/custom.db 'VACUUM;'` | 长期采集后库文件膨胀，定期 VACUUM 回收空间 |

### 6.2 站点配置（站群）

通过 `/admin/sites` 后台管理（10 套主题 × 多个 Site 实例 = 站群）：

| 字段 | 说明 |
| --- | --- |
| **domain** | 站点域名（含端口亦可，例 `www.a.com` 或 `novel.example.com:3000`） |
| **themeId** | 前台主题（10 选 1：`aijjxs` / `101kks` / `x2552` / `23qb` / `ddyueshu` / `huangjinwu` / `ggd66` / `pilishuwu` / `trxsw` / `shipsay`） |
| **title / description / keywords** | TDK（搜索引擎标题/描述/关键词） |
| **icbm / geoRegion / geoPlacename** | ICBM 坐标 + SEO/GEO 区域（默认 35.86166,104.195397 / CN / 中国） |
| **footerText / footerCopyright / footerIcp** | 自定义页脚文案 + 版权 + ICP 备案号 |
| **chapterPaginationMode** | 章节分页（`off` / `byWords` 按字数 / `byPages` 按页数） |
| **pseudoStaticStyle** | 伪静态 URL 风格（`query` / `numeric` / `alphanumeric` / `slug` / `short` / `classic` / `dir`） |
| **isDefault** | 默认站点（访问 `/` 不带 `?site=` 时回落到此站） |
| **inLinkWheel** | 是否参与其他站点页脚互链（站群链轮） |

前台访问：`http://localhost:3000/?view=home&site=<siteId>`（不传 `site` 走 default）。

### 6.3 采集规则

通过 `/admin/rules` 后台管理：

- 每条规则一份完整 JSON 配置（`config` 字段），包含四段解析器：`list` / `book` / `toc` /
  `content`，外加 `fetch`（采集选项）与 `clean`（清洗规则）。
- 支持的提取器：`css` / `xpath` / `regex` / `json` / `const`。
- 支持的清洗：广告模式（正则删除广告块）、去壳页（提取主容器）、编码识别（GBK 自动转 UTF-8）。
- 提供「极限校准」功能：对模拟源站的三档封禁策略实测安全并发 + 速率，推荐参数一键写回规则。
- 启用 `tokenUrl` 钩子时，引擎会调对应 mini-service（如 bqg713-proxy）拿 token / 签名 / AES 解密。

详见 [第九节：采集规则配置](#九采集规则配置)。

### 6.4 mini-services 配置

`mini-services/start-all.sh` 一键拉起 11 个 Go 二进制，无需额外配置。可选环境变量见
`.env.example`：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AUTH_TOKEN` | 空 | mini-services 鉴权 token，与 BRIDGE_KEY 任一非空即开启鉴权 |
| `BRIDGE_KEY` | 空 | 同上 |
| `RATE_LIMIT_PER_MIN` | 60（cloak-browser 30 / trafilatura 120） | 单 IP 每分钟请求上限，超 429 |
| `BRIDGE_SSRF_ALLOW_LOOPBACK` | 服务依赖（fetch-relay/scrapling-bridge/uc-bridge/moli-bridge 默认 1） | SSRF 守卫是否放行回环 |
| `MOLI_BIN` | PATH + `~/.local/bin/moli` | moli-bridge 可执行路径 |
| `SCRAPLING_FETCH_SCRIPT` | `./services/scrapling-bridge/scripts/scrapling_fetch.py` | scrapling Python 脚本路径 |
| `UC_CHROME_PATH` | `which chromium` → `which google-chrome` | uc-bridge Chrome 路径 |
| `PLAYWRIGHT_BROWSERS_PATH` | 默认 | uc-bridge stealthy 模式 Playwright 内核缓存目录 |
| `DISPLAY` | `:99` | uc-bridge 无 headless 时启动 xvfb 的 DISPLAY |
| `MAIN_APP_URL` | `http://127.0.0.1:3000` | xjp-proxy 拉取登录凭证的主应用地址 |
| `XJP_MAX_PAGES` | 10 | xjp-proxy 分页上限 |

> 单机部署默认留空（mini-services 绑 `127.0.0.1`，仅本机 heis-backend 访问）；多机部署或
> 对外暴露端口时必填 `AUTH_TOKEN` / `BRIDGE_KEY`，否则未授权方可调内部桥。

### 6.5 启停命令

| 命令 | 作用 |
| --- | --- |
| `bash mini-services/start-all.sh` | 增量构建 + 后台启动 11 个服务 + 健康探针 |
| `bash mini-services/stop-all.sh` | SIGTERM 5 s grace + SIGKILL 兜底；PID 文件丢失走 `lsof` / `fuser` 按端口找 |
| `bash mini-services/status.sh` | 11 行表格（SERVICE / PORT / PID / PROCESS / HEALTH / SELFTEST）；全 ALIVE 退出码 0，任一 DOWN 退出码 1 |
| `tail -f .zscripts/<svc>.log` | 实时看某服务日志 |
| `tail -f .zscripts/<svc>.build.log` | 看某服务构建失败日志（若构建挂了） |

**Go 工具链路径解析顺序**：`start-all.sh` 优先用 `/home/z/go/bin/go`（sandbox 内置），找不到
则回退 `PATH` 中的 `go`，都没有时报错退出。CI 环境用 `export PATH=$PATH:/usr/local/go/bin`
即可。

---

## 七、启动

### 7.1 方式 1：直接启动（最简，前台运行）

```bash
cd /home/z/my-project
./go-backend/heis-backend
# 控制台输出:
#   数据库: /home/z/my-project/db/custom.db
#   已加载 94 个模板
#   heis-backend 启动: http://localhost:3000 (内存 17MB)
# Ctrl+C 退出
```

后台运行用 `nohup`：

```bash
cd /home/z/my-project
nohup ./go-backend/heis-backend > backend.log 2>&1 &
echo $!  # 记下 PID 用于停止
# 停止:
pkill -f heis-backend
```

### 7.2 方式 2：bun auto-restart（推荐，平台默认）

平台 `bun run dev` 实际拉起 `bun start-go.js`，后者循环启动 `./go-backend/heis-backend`，
进程异常退出后 2 s 自动重启：

```bash
cd /home/z/my-project

# 平台 / 开发机均可 (需 Bun 1.0+)
bun start-go.js
# 或
bun run dev      # 等价 (package.json scripts.dev = "bun start-go.js")
```

`start-go.js` 源码（10 行）：

```javascript
// bun wrapper auto-restart Go 后端
while (true) {
  try {
    const proc = Bun.spawn(['./go-backend/heis-backend'], { stdio: ['ignore', 'inherit', 'inherit'] });
    await proc.exited;
  } catch (e) { console.error('Go crashed:', e); }
  console.log('[start-go] Go exited, restarting in 2s...');
  await Bun.sleep(2000);
}
```

### 7.3 方式 3：bash auto-restart（无 Bun 环境）

```bash
cd /home/z/my-project
bash start.sh
# 等价: while true; do ./go-backend/heis-backend; sleep 2; done
```

`start.sh` 源码（4 行）：

```bash
#!/bin/bash
# Go 后端 auto-restart (Go 挂了 2 秒重启)
cd "$(dirname "$0")"
while true; do ./go-backend/heis-backend; sleep 2; done
```

### 7.4 启动 11 mini-services

```bash
cd /home/z/my-project
bash mini-services/start-all.sh
```

`start-all.sh` 是幂等的：再次执行只补启未在跑的服务，已在跑的（`/health` 返回 200）自动
跳过。

### 7.5 启动顺序

推荐顺序：

```
1. 启动 11 mini-services  (bash mini-services/start-all.sh)
2. 启动 heis-backend      (./go-backend/heis-backend 或 bun start-go.js 或 bash start.sh)
```

> mini-services 先启的好处：heis-backend 启动后立即可调任意桥（采集规则的 tokenUrl 钩子
> 不会因桥未启而失败）。但顺序不强制——heis-backend 自身不依赖 mini-services 起来才能跑，
> 只是采集时如果对应桥未启会触发降级链。

### 7.6 启动后验证

```bash
# 主后端
curl -s http://localhost:3000/health
# 期望: {"lang":"go","memMB":17,"ok":true}

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
# 期望: 200

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/admin
# 期望: 200

# 11 mini-services 状态
bash mini-services/status.sh
# 期望: 11 行全 ALIVE 200
# (其中 moli/cloak/trafilatura selfTest=false 是预期, 见 §11.2)
```

---

## 八、预览

部署完成 + 11 mini-services 全 ALIVE 后，浏览器访问：

### 8.1 前台路由

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/` | 默认站点首页（`isDefault=true` 的 Site） |
| `http://localhost:3000/?view=home` | 同上，显式带 view 参数 |
| `http://localhost:3000/?view=home&site=<siteId>` | 指定站点首页 |
| `http://localhost:3000/?view=book&id=<bookId>` | 书籍详情页 |
| `http://localhost:3000/?view=read&id=<bookId>&ch=<chapterIdx>` | 阅读页 |
| `http://localhost:3000/?view=category&cat=<categoryId>` | 分类列表页 |
| `http://localhost:3000/?view=ranking` | 排行榜 |
| `http://localhost:3000/?view=search&q=<keyword>` | 搜索结果页 |
| `http://localhost:3000/?view=fulltext&q=<keyword>` | 全文搜索（完本） |
| `http://localhost:3000/?view=keyword&tag=<tag>` | 关键词（标签）聚合页 |

### 8.2 管理后台

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/admin` | 管理后台首页（dashboard 看板） |
| `http://localhost:3000/admin/tasks` | 采集任务（单书 / 批量 / 实时 / 定时增量 autoRefresh） |
| `http://localhost:3000/admin/rules` | 采集规则（CRUD + 在线测试 + 极限校准） |
| `http://localhost:3000/admin/books` | 书籍 / 章节管理 |
| `http://localhost:3000/admin/categories` | 分类管理（15 个标准 4 字分类：玄幻奇幻 / 奇幻魔幻 / 武侠江湖 / 仙侠修真 / 都市生活 / 言情小说 / 历史军事 / 军事战争 / 游戏竞技 / 科幻未来 / 悬疑推理 / 灵异鬼怪 / 体育竞技 / 轻小说类 / 现实生活） |
| `http://localhost:3000/admin/sites` | 站点（站群） |
| `http://localhost:3000/admin/links` | 友情链接 |
| `http://localhost:3000/admin/themes` | 主题 |
| `http://localhost:3000/admin/downloads` | TXT 下载任务 |
| `http://localhost:3000/admin/settings` | 全局设置 |
| `http://localhost:3000/admin/feedback` | 用户反馈 |
| `http://localhost:3000/admin/backup` | JSON 备份 / 恢复 |
| `http://localhost:3000/admin/seo-audit` | SEO 审计 |

### 8.3 静态资源

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/covers/<name>.webp` | 封面图（R52-1A：文件存在返 WebP；不存在返 SVG 占位渐变色块 + 书名首字） |
| `http://localhost:3000/clone-css/<theme>.css` | 10 套主题的源站 CSS（由 `main.go` /clone-css/ 路由服务） |
| `http://localhost:3000/robots.txt` | 站点 SEO 爬虫规则 |
| `http://localhost:3000/sw.js` | PWA Service Worker（Next.js 残留，可选） |
| `http://localhost:3000/manifest.json` | PWA 清单（同上） |
| `http://localhost:3000/icon.svg` / `logo.svg` | 站点图标 |

> ⚠️ **后台无登录鉴权**：管理端 `/admin` 当前不要求登录，请勿直接暴露公网。生产环境务必
> 前面套反向代理（Nginx / Caddy）做 Basic Auth + IP 白名单，或仅放内网访问。详见
> [§12.2 反向代理](#122-反向代理生产必做因-admin-无鉴权)。

---

## 九、采集规则配置

### 9.1 创建规则

1. 浏览器打开 `http://localhost:3000/admin/rules`
2. 点「新建规则」，填名称 + 描述 + 完整 config JSON（schema 见 `prisma/schema.prisma` 中
   `Rule.config`）
3. config JSON 四段解析器结构：

   ```json
   {
     "list":   { "url": "...", "extractor": "css", "selector": "...", "fields": { ... } },
     "book":   { "extractor": "css", "selector": "...", "fields": { ... } },
     "toc":    { "extractor": "css", "selector": "...", "fields": { ... } },
     "content":{ "extractor": "css", "selector": "...", "fields": { ... } },
     "fetch":  { "threadMax": 3, "intervalMin": 500, "intervalMax": 2000, ... },
     "clean":  { "adPatterns": [...], "mainContainer": "...", "encoding": "auto" }
   }
   ```

4. 保存后点「在线测试」，输入测试 URL 跑一次抓取，引擎会按 4 段解析器依次执行
   list → book → toc → content
5. 测试通过后启用规则，再到 `/admin/tasks` 创建采集任务挂到此规则

### 9.2 参考规则

历史参考脚本位于 `scripts/seed-rule-*.ts`（22 个站点规则种子，已 R42-1C + R46-1A 清理；
R47-1B 将仅剩的 `seed-rule-yueyouxs.ts` 转为 portable JSON
`scripts/rule-yueyouxs.json`（`/api/admin/backup/restore` 可直接导入）。如需重新入库，
用以下两种方式之一：

1. **后台手动新建**：浏览器 `/admin/rules` 点「新建规则」，填名称 + 描述 + 完整 config
   JSON，保存后点「在线测试」验证，再启用。
2. **一键导入**（推荐）：
   ```bash
   # 先 dry-run 校验
   curl -X POST -H 'Content-Type: application/json' \
     --data-binary @scripts/rule-yueyouxs.json \
     'http://localhost:3000/api/admin/backup/restore?dryRun=1'
   # 去掉 ?dryRun=1 实际入库
   curl -X POST -H 'Content-Type: application/json' \
     --data-binary @scripts/rule-yueyouxs.json \
     'http://localhost:3000/api/admin/backup/restore'
   ```

### 9.3 参考规则关键点

| 站点 | 规则关键点 |
| --- | --- |
| 番茄 fanqie | 静态 HTML，CSS 提取；tokenUrl 走 bqg713-proxy |
| 七猫 qimao | 静态 + AES 加密内容，qimao-proxy 解密 |
| 得奇 deqixs | 静态 HTML，CSS 提取；走 deqixs-proxy |
| 八零 80ge | 静态 HTML |
| 精华 jinghua | 静态 HTML |
| 笔趣阁 bqg713 | token + AES，bqg713-proxy 全套 |
| xjp | 静态 HTML，xjp-proxy |
| 霹雳 pilishuwu | 反爬严，必须 scrapling-bridge 3012 stealthy / playwright 模式 |

### 9.4 8 级降级链（采集引擎核心）

引擎对每个 URL 自动按下列顺序尝试，前级成功则不降级；全部失败才记为抓取失败：

```
1. native              Go 标准库 net/http + utls Hello 指纹池 36 款 (R52-1A, 含 PSK/PQ/老 iOS/Chrome 老版/Firefox 老版 ESR/2016 era Chrome 58)
2. curl                系统 curl 二进制 (JA3 指纹绕过 Cloudflare 基础检测)
3. fetch-relay         3011 中继桥 (代理池轮换)
4. scrapling           3012 Scrapling 桥 (static → stealthy → playwright 三档)
5. cloak-browser       3020 本地 chromium 反检测渲染 (cloak 模式)
6. uc-bridge           3016 UC 头条小说桥
7. moli-bridge         3017 moli 桥
8. curl-impersonate    3018 curl_cffi 桥 (Python 子进程, JA3/JA4 指纹轮换)
```

降级由 `go-backend/crawl/fetcher.go` 统一调度：

- **R43-1B** 起每级代理失败会被 `MarkProxyFailed` 标记 cooldown，避免连续踩雷；恢复后
  `MarkProxyOK` 清状态。
- **R45-1C** 起 `DialTLSContext` 替代 deprecated `DialTLS`，支持 per-attempt timeout
  ctx cancel 立即断 dial。
- **R46-1B** 起新增 TLS session ticket 缓存（模拟浏览器行为，加速重连）+ 网络层错误不清
  utls choice（仅 TLS handshake 失败才清，避免无效轮换）+ brotli miss 计数（识别需走桥的
  host）+ 代理主动 probe（5 min 间隔 + 3 次失败冷却）+ captcha 成功率统计 + 自动切换。
- **R47-1A** 起 utls Hello 池扩 21 款（+ Chrome 100_PSK / 114_Padding_PSK_Shuf /
  115_PQ_PSK + iOS 11_1 / 12_1）+ CookieJar stripPort 跨端口合并 + captcha 连续 3 次失败
  60 s cooldown + probe target 5 endpoint 轮选。
- **R50-1A** 起 utls Hello 池扩 29 款（+ Chrome 83/87/96 老版桌面 + Firefox 55/63 老版 ESR +
  Edge 106 / Android 11 OkHttp / QQ 11_1）+ persistableSessionCache snapshot+IO 模式 +
  captchaSitekeyRe 三属性名 + JS 变量 fallback + probeProxyWithLatency latency 跟踪 +
  least-latency 旋转策略 + ProxyStatsSnapshot admin 查询 + 行为模拟 Gaussian 微抖 +
  micro wheel events + 15% 概率 Tab key。

### 9.5 36 项反反爬能力清单

| # | 能力 | 引入轮次 | 说明 |
| --- | --- | --- | --- |
| 1 | utls Hello 指纹池 36 款 | R43-1B → R52-1A | Chrome 100/106_Shuffle/112_PSK_Shuf/115_PQ/120/120_PQ/131/133 + Firefox 99/102/105/120 + Safari 16.0 + iOS 13/14/11_1/12_1 + Edge 85 + Chrome 100_PSK/114_Padding_PSK_Shuf/115_PQ_PSK + Chrome 83/87/96 老版 + Firefox 55/63/56/65 老版 ESR + Edge 106 + Android 11 OkHttp + QQ 11_1 + Chrome 62/70/72 (R51-1A) + Chrome 58/100 (R52-1A，覆盖 2016-2024 全代际) |
| 2 | per-host 钉扎 | R43-1B | hash 稳定选取同一 Hello，避免同一站不同请求指纹跳变 |
| 3 | attempts 偏移轮换 | R43-1B | 失败 N 次后偏移到下一号 Hello |
| 4 | TLS session ticket 缓存 | R46-1B → R50-1A | `utls.NewLRUClientSessionCache(256)` 模拟浏览器 ticket cache + R50-1A `persistableSessionCache` 内存 LRU + 磁盘 JSON 60s 节流 flush + snapshot+IO 模式 + `flushMu` 串行化并发 IO |
| 5 | JA3/JA4 轮换 | R43-1B | utls 不同 Hello 版本 cipher suite 顺序 + 扩展顺序 + GREASE 模式各异 |
| 6 | Cookie 持久化 | R43-1B | per-domain CookieJar，cf_clearance 跨子域合并 |
| 7 | stripPort 跨端口 Cookie 合并 | R47-1A | `CookieJar.stripPort` 修正 `example.com:443` vs `example.com` 域名不一致 |
| 8 | Referer 链伪造 | R43-1B | 逐请求注入来源页 URL，模拟浏览器跳转链 |
| 9 | 重试退避 full jitter | R43-1B | 1.5 s × 2^n 封顶 8 s |
| 10 | Cookie 挑战重试 | R43-1B | 403 + Set-Cookie 重试 2 次 |
| 11 | Token 挑战 HTTP 求解 | R43-1B | `let token="..." + location.href=?challenge=` 自动求解 |
| 12 | looksBlocked 启发式 | R43-1B | 识别 403/429/Captcha 页 |
| 13 | looksLikeCaptcha 启发式 | R43-1B | 识别验证码页 |
| 14 | isJsChallenge 启发式 | R43-1B | 识别 JS Challenge |
| 15 | 2captcha 验证码 | R43-1B → R50-1A | 可选，配置 API key 后自动求解 Cloudflare Challenge + R50-1A 三服务级联 (2captcha + anti-captcha + CapSolver) + sitekey 三属性名 (data-sitekey/data-pubkey/data-pkey) + JS 变量 fallback |
| 16 | captcha 连续失败 cooldown | R47-1A | 连续 3 次失败 60 s cooldown |
| 17 | 代理池 MarkProxyFailed/OK | R43-1B | 代理健康跟踪 + cooldown |
| 18 | 代理主动 probe | R46-1B → R50-1A | 5 min 间隔 + 3 次失败冷却 + R50-1A latency 跟踪 (probeProxyWithLatency) + least-latency 旋转策略 + ProxyStatsSnapshot admin 查询 |
| 19 | probe target 轮选 | R47-1A | 5 endpoint 轮选，避免单点故障 |
| 20 | brotli miss 计数 | R46-1B | 识别需走桥的 host（不响应 br 编码） |
| 21 | 网络层错误不清 utls choice | R46-1B | 仅 TLS handshake 失败才清，避免无效轮换 |
| 22 | SSRF 守卫 | R43-1B | 拒绝云元数据 / 私网 / 链路本地，`allowLoopback` 放行内部桥 |
| 23 | mirrorDomains 镜像组 | R43-1B | 故障切换同站镜像 |
| 24 | per-host UA 钉扎 | R43-1B | 同一站用同一 UA，避免指纹跳变 |
| 25 | Set-Cookie 安全校验 | R43-1B | 防止恶意 Set-Cookie 污染 CookieJar |
| 26 | captcha 成功率统计 | R46-1B | 主服务成功率统计 + 自动切换 |
| 27 | 行为模拟 Gaussian 微抖 | R50-1A | `rand.NormFloat64` stddev=1.5px 替代均匀分布 ±3px，抖动分布更接近真实用户生理抖动 |
| 28 | 滚轮 micro wheel events | R50-1A | 5-15px deltaY × 2-4 步插入主滚动间，模拟真实用户 wheel 事件连续触发 |
| 29 | 15% 概率 Tab 键 focus 切换 | R50-1A | `chromedp.KeyEvent "\t"` 在 focusable 元素间切换 + 200-500ms 短停顿，避免被检测为无键盘自动化 |

---

## 十、架构图

### 10.1 整体架构（文字版）

```
                       用户浏览器
                          │
                          ▼
              ┌────────────────────────────────┐
              │  Go heis-backend :3000          │  (go-backend/main.go, 1330 行)
              │  ────────────────────────────  │
              │  静态资源 /clone-css/*           │  (源站 CSS, public/clone-css/*.css)
              │  前台 SSR 94 个模板             │  (10 主题 × 8 页型 + 14 admin)
              │    10 主题:                     │
              │      aijjxs   101kks   x2552   │
              │      23qb     ddyueshu         │
              │      huangjinwu ggd66          │
              │      pilishuwu trxsw  shipsay  │
              │    8 页型:                      │
              │      home book read category   │
              │      ranking search keyword    │
              │      fulltext                   │
              │    14 admin:                    │
              │      layout dashboard tasks     │
              │      rules books categories    │
              │      sites links themes        │
              │      downloads settings        │
              │      feedback backup seo-audit │
              │  API 路由:                     │
              │    /api/public/*  6 个          │
              │    /api/admin/*  14 个         │
              │  DB: SQLite WAL                │
              │    db/custom.db                │
              └───────────┬────────────────────┘
                          │
                          ▼
              ┌────────────────────────────────┐
              │  采集引擎 crawl/                  │  (10655 行 Go)
              │  ────────────────────────────  │
              │  fetcher.go  4809 行             │  ← 8 级降级链总调度
              │  parser.go   1612 行             │  ← css / xpath / regex / json 提取
              │  runner.go   1481 行             │  ← 4 段采集流程 + 任务调度
              │  cleaner.go   899 行             │  ← 广告 / 去壳 / 编码 / trafilatura
              │  types.go     737 行             │  ← 规则 / 配置 / 结果数据结构
              │  hostgate.go  423 行             │  ← 并发 + 速率双限速器
              │  storage.go    355 行             │  ← db / txt 双存储 + 封面本地化
              │  smart.go     339 行             │  ← LLM 智能分类 / 完结判断
              │                                 │
              │  反反爬:                        │
              │    utls Hello 指纹池 36 款      │  (含 PSK / PQ / 老 iOS / Chrome 老版 / Firefox 老版 ESR / 2016 era Chrome 58)
              │    JA3 / JA4 轮换                │
              │    TLS session cache            │  (LPU + 磁盘 persistable + snapshot+IO)
              │    brotli miss 计数              │  (识别需走桥的 host)
              │    代理主动 probe                │  (5 min 间隔 + 3 次失败冷却 + latency 跟踪)
              │    captcha 成功率                │  (主服务统计 + 自动切换 + 三服务级联)
              │    Cookie 持久化                 │  (cf_clearance 跨子域 + stripPort)
              │    Referer 链伪造                │
              │    2captcha 验证码               │  (可选, 连续 3 次失败 60s cooldown)
              │    MarkProxyFailed / OK          │  (代理健康跟踪 + least-latency)
              │    行为模拟 Gaussian 微抖        │  (rand.NormFloat64 stddev=1.5px)
              └───────────┬────────────────────┘
                          │
              ┌───────────┴────────────────────┐
              │  11 Go mini-services            │  (端口 3010-3020)
              │  ────────────────────────────  │
              │  3010 bqg713-proxy              │  笔趣阁 token+AES
              │  3011 fetch-relay               │  通用 HTTP 中继
              │  3012 scrapling-bridge           │  Scrapling 抓取
              │  3013 qimao-proxy                │  七猫 AES 解密
              │  3014 deqixs-proxy               │  得奇代理
              │  3015 xjp-proxy                  │  xjp 代理
              │  3016 uc-bridge                  │  UC 头条桥
              │  3017 moli-bridge                │  moli 桥
              │  3018 curl-impersonate-bridge    │  curl_cffi JA3 桥
              │  3019 trafilatura-bridge         │  正文抽取桥
              │  3020 cloak-browser              │  隐身 chromium
              │                                 │
              │  全部 Go 二进制                 │  (R43-1C 删旧 TS/Python 版)
              │  start-all.sh 一键拉起          │
              │  /health 自检 + selfTest        │
              │  bridgeserver 共享包 917 行     │  (/health /metrics /info 鉴权 限速 SSRF)
              └────────────────────────────────┘
```

### 10.2 请求流（前台 SSR）

```
浏览器 GET /?view=home&site=<siteId>
   │
   ▼
heis-backend (main.go mux 路由)
   │
   ├── /clone-css/*  →  public/clone-css/<theme>.css     (静态资源)
   ├── /api/public/*  →  admin.go 6 个公开 API
   ├── /api/admin/*  →  admin.go 14 个管理 API
   │
   └── /  →  渲染前台 (main.go renderView)
              │
              ├── getSite(siteId)           →  Site 表查站点配置
              ├── 注册表查 themeId           →  对应主题目录 (templates/<theme>/)
              ├── 视图数据查询               →  Book / Chapter / Category / BookTag 表
              └── template.ExecuteTemplate  →  渲染 home.html 输出 HTML
```

### 10.3 请求流（采集任务）

```
admin POST /api/admin/tasks/<id>/start
   │
   ▼
admin.go (runTaskHandler)
   │
   ▼
crawl/runner.go (TaskRuntime.Run)
   │
   ├── 1. fetchListPage    →  crawl/fetcher.go (8 级降级链)
   │                          │
   │                          ├── native   (utls 36 款 Hello 池)
   │                          ├── curl     (系统二进制)
   │                          ├── fetch-relay         → mini-service :3011
   │                          ├── scrapling           → mini-service :3012
   │                          ├── cloak-browser        → mini-service :3020
   │                          ├── uc-bridge            → mini-service :3016
   │                          ├── moli-bridge          → mini-service :3017
   │                          └── curl-impersonate    → mini-service :3018
   │
   ├── 2. parseBookList     →  crawl/parser.go (css / xpath / regex / json)
   │
   ├── 3. fetchBookDetail + parseToc + parseContent
   │                          (每章并发, hostgate.go 双限速)
   │
   ├── 4. cleanContent      →  crawl/cleaner.go (广告 / 去壳 / 编码 / trafilatura)
   │
   └── 5. storage           →  crawl/storage.go (db / txt + 封面本地化)
                                   │
                                   └── SQLite WAL (db/custom.db)
```

---

## 十一、故障排查

### 11.1 内存 / OOM

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| heis-backend 进程被 OOM Killer 杀 | 极少见，Go 后端运行期 17 MB；如发生通常是 SQLite 大查询 + chromium（cloak-browser / scrapling-bridge stealthy 模式）同跑 | `dmesg \| grep -i kill` 确认；升内存到 4 GB；关闭 cloak-browser（status 显示 selfTest=false 即未启动） |
| 旧 Next.js 版本 2.2 GB OOM | 已不存在，Go 版本无此问题 | 迁移到 Go 后端即可，无需任何调优 |
| chromium 吃内存 | cloak-browser :3020 或 scrapling-bridge :3012 stealthy 模式启了 chromium | 采集规则改用 static 模式；或停止 cloak-browser（`bash mini-services/stop-all.sh` 后单删 cloak-browser PID） |

### 11.2 mini-services 异常

```bash
# 1. 看整体状态
bash mini-services/status.sh
# 输出示例:
#   SERVICE              PORT    PID     PROCESS   HEALTH     SELFTEST
#   bqg713-proxy         3010    4206    ALIVE     200        true
#   fetch-relay          3011    4208    ALIVE     200        true
#   scrapling-bridge     3012    4210    ALIVE     200        true
#   ...
#   moli-bridge          3017    4222    DEAD      000        false    ← moli 二进制未装, 预期
#   cloak-browser        3020    -       DOWN      000        -       ← 无 token, 未启动, 预期
#   trafilatura-bridge   3019    4228    ALIVE     200        false   ← Readability 配置缺失, 预期

# 2. 看挂掉服务的日志
tail -100 .zscripts/<svc>.log           # 运行时日志
tail -100 .zscripts/<svc>.build.log     # 构建日志(若构建挂了)

# 3. 重启
bash mini-services/stop-all.sh          # 全停
bash mini-services/start-all.sh         # 全启 (增量构建, 已在跑的会 skip)

# 或单独重启某个服务
pkill -f bqg713-proxy                   # 杀掉
cd go-backend && go build -o bin/bqg713-proxy ./services/bqg713-proxy
nohup ./bin/bqg713-proxy > ../.zscripts/bqg713-proxy.log 2>&1 &
```

> **selfTest=false 是否需要处理**：3 个服务的 selfTest=false 是预期，不影响主流程：
> - **moli-bridge**：依赖外部 moli 二进制，默认未装；如需用，自行下载 moli 放到 PATH 中。
> - **cloak-browser**：需要 token 配置；默认未配，cloak 模式不可用，引擎会降级到 scrapling。
> - **trafilatura-bridge**：需要 Readability 额外配置；基础 go-readability 已可用。

### 11.3 数据库锁

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| `database is locked` | SQLite 默认 busy timeout 5 s；高并发写偶发触发 | Go 后端已设 WAL 模式 + busy_timeout=5s，正常场景不会锁；如仍触发，调小采集并发（任务编辑页 `threadMax` 改 1-2） |
| 库文件膨胀 | 长期采集 + WAL 日志未 checkpoint | `sqlite3 db/custom.db 'PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'` |
| 备份后无法恢复 | 在线 `cp` 时库正被写 | WAL 模式下 `cp` 是安全的（会拿到一致快照）；如担心可用 `sqlite3 db/custom.db '.backup db/custom.db.bak'` 在线备份命令 |

### 11.4 主后端 :3000 起不来

```bash
# 1. 端口被占
lsof -i :3000
# 杀掉占用进程或改 go-backend/main.go:270 addr := ":3000" 为别的端口

# 2. 模板解析失败
# 日志会打印 "模板解析警告: ..." 但不会退出; 检查 go-backend/templates/ 是否完整
ls go-backend/templates/admin/        # 应有 14 个 .html
ls go-backend/templates/<theme>/      # 每个主题应有 8 个 .html (home/book/read/category/ranking/search/keyword/fulltext)

# 3. 数据库找不到
# 日志会打印 "数据库: ..." 路径; 若路径错误, 检查启动时 cwd 是否是项目根
cd /home/z/my-project && ./go-backend/heis-backend    # 确保 basePath 解析正确

# 4. 94 个模板加载不全
# 日志 "已加载 N 个模板"; 应 = 94 (10 主题 × 8 + 14 admin). 不全则模板文件缺失, 从 git 重新拉
```

### 11.5 采集失败排查

```bash
# 1. 规则在线测试
# 浏览器 /admin/rules → 选规则 → "在线测试" → 输入测试 URL → 看四段解析结果

# 2. 看降级链是否触达 mini-services
tail -f .zscripts/bqg713-proxy.log    # 若规则挂了 bqg713 token, 应看到请求
tail -f .zscripts/fetch-relay.log      # 降级 3 级会走这里
tail -f .zscripts/scrapling-bridge.log # 降级 4 级

# 3. 看任务日志
# /admin/tasks → 选任务 → "日志" → TaskLog 表 (info/success/warn/error 四级)
# 或数据库直查:
sqlite3 db/custom.db "SELECT level, message, createdAt FROM TaskLog WHERE taskId='<id>' ORDER BY createdAt DESC LIMIT 50;"

# 4. 极限校准
# /admin/rules → "极限校准" → 对模拟源站 3 档封禁策略实测安全并发 + 速率
# 推荐参数一键写回规则 (threadMax / intervalMin/Max)
```

### 11.6 编译失败

```bash
# 1. Go 版本太低
go version              # 必须 1.23+; go.mod 声明 1.26, 实际 1.21+ API 即可
# 升级 Go: https://go.dev/dl/

# 2. 依赖下载失败 (国内网络)
export GOPROXY=https://goproxy.cn,direct
cd go-backend && go mod tidy && go build -o heis-backend .

# 3. utls / chromedp 版本冲突
cd go-backend && go mod tidy    # 清理 go.sum

# 4. vet 警告
go vet ./...                   # 应输出 0 warnings (R43-1B/C 起已清)
```

### 11.7 Go 进程被杀 / 异常退出

```bash
# 1. 用 auto-restart 包装 (推荐)
bun start-go.js        # 或 bash start.sh
# Go 挂了 2s 自动重启, 日志在控制台

# 2. 看系统日志
dmesg | tail -50       # OOM Killer / segfault / signal
journalctl -u heis-backend --since '1 hour ago'    # systemd 模式

# 3. 后台运行模式日志
tail -f backend.log    # nohup 输出
tail -f go-backend/backend.log
```

---

## 十二、生产部署

### 12.1 systemd 托管（推荐）

```ini
# /etc/systemd/system/heis-backend.service
[Unit]
Description=HEIS Go Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/z/my-project
ExecStart=/home/z/my-project/go-backend/heis-backend
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/heis-backend.log
StandardError=append:/var/log/heis-backend.err

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/heis-mini-services.service
[Unit]
Description=HEIS Mini Services
After=network.target heis-backend.service

[Service]
Type=oneshot
ExecStart=/bin/bash /home/z/my-project/mini-services/start-all.sh
ExecStop=/bin/bash /home/z/my-project/mini-services/stop-all.sh
RemainAfterExit=yes
WorkingDirectory=/home/z/my-project

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now heis-backend heis-mini-services
sudo systemctl status heis-backend heis-mini-services

# 日志
sudo journalctl -u heis-backend -f
sudo journalctl -u heis-mini-services -f
```

### 12.2 反向代理（生产必做，因 /admin 无鉴权）

#### Caddy（推荐，自动 HTTPS）

```Caddyfile
# /etc/caddy/Caddyfile
novel.example.com {
    # /admin 路径强制 Basic Auth
    basicauth /admin* {
        admin $2a$14$...   # caddy hash-password 生成
    }
    # 其余路径直接反代
    reverse_proxy localhost:3000
}
```

生成 basicauth 密码哈希：

```bash
caddy hash-password
# 输入密码 → 输出 $2a$14$...
```

#### Nginx 等价配置

```nginx
# /etc/nginx/conf.d/heis.conf
server {
    server_name novel.example.com;
    listen 443 ssl http2;
    ssl_certificate     /etc/letsencrypt/live/novel.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/novel.example.com/privkey.pem;

    location /admin {
        auth_basic           "Admin";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# 重定向 HTTP → HTTPS
server {
    listen 80;
    server_name novel.example.com;
    return 301 https://$host$request_uri;
}
```

生成 htpasswd：

```bash
sudo htpasswd -c /etc/nginx/.htpasswd admin
```

### 12.3 备份策略

```bash
# 每日凌晨备份 (crontab -e)
0 3 * * * cp /home/z/my-project/db/custom.db /backup/custom.db.$(date +\%F).bak && \
          sqlite3 /home/z/my-project/db/custom.db 'VACUUM;'

# 保留 7 天
0 4 * * * find /backup -name 'custom.db.*.bak' -mtime +7 -delete

# /admin/backup 一键导出 JSON (含规则 / 站点 / 分类 / 友链 / 设置)
curl -s http://localhost:3000/api/admin/backup > /backup/heis-$(date +%F).json
```

### 12.4 升级

```bash
cd /home/z/my-project
git pull

# 主后端二进制已入 git (commit 29dcd99, 平台 clone 即跑).
# 仅当 go-backend/*.go 或 go-backend/services/*/main.go 有源码变更时才需重建:
cd go-backend && go build -o heis-backend .

# 重启 mini-services (增量构建会自动识别变更的源码)
cd ..
bash mini-services/stop-all.sh
bash mini-services/start-all.sh

# 重启主后端 (systemd 模式)
sudo systemctl restart heis-backend

# 或 auto-restart 模式: 杀掉旧进程, start-go.js 会自动拉起新版
pkill -f heis-backend
```

> 平台 clone 后零编译直接运行：`cd go-backend && ./heis-backend`（二进制 24 MB 静态链接，
> 无 cgo / 无 Bun / 无 Node / 无 Docker 依赖，Go 工具链仅源码变更时需要）。

### 12.5 监控

```bash
# 主后端健康
curl -s http://localhost:3000/health
# {"lang":"go","memMB":17,"ok":true}

# 11 mini-services 状态
bash mini-services/status.sh
# 全 ALIVE 退出码 0, 任一 DOWN 退出码 1 (供监控脚本用)

# 内存 / CPU
ps -C heis-backend -o pid,rss,vsz,pcpu,etime
#  RSS ~17MB, CPU 通常 < 5%

# 磁盘 (库 + 封面 + TXT)
du -sh db/ data/
```

### 12.6 安全清单

- [ ] `/admin` 已套 Basic Auth + HTTPS（Caddy/Nginx）
- [ ] mini-services 端口 3010–3020 仅绑 `127.0.0.1`（默认即是），不对外暴露
- [ ] 多机部署时配置 `AUTH_TOKEN` / `BRIDGE_KEY`（见 `.env.example`）
- [ ] `/api/admin/backup` 导出 JSON 定期备份 + 异地存
- [ ] `db/custom.db` 定期 VACUUM + 备份
- [ ] Go 工具链版本 ≥ 1.23（`go version`）
- [ ] heis-backend 二进制 mtime 与源码一致（`stat go-backend/heis-backend`）
- [ ] 防火墙仅放行 80/443（Caddy/Nginx）+ 22（SSH），3000/3010-3020 不对外

---

## 十三、迁移说明（从旧 Next.js 版本升级）

| 维度 | 旧 Next.js 版本 | Go 版本（当前） |
| --- | --- | --- |
| 运行时 | Node 22 + standalone server.js | Go 二进制 heis-backend |
| 内存 | 2.2 GB（OOM 风险高） | 17 MB（OOM 风险消失） |
| 构建 | Turbopack，峰值 2 GB+ | `go build`，峰值 < 200 MB |
| 部署 | Docker 多阶段 + compose | 单二进制 + bash 脚本，无 Docker |
| 依赖 | Bun + Node + Prisma Client + React 19 | Go 标准库 + modernc.org/sqlite（无 cgo） |
| 前端 | React 19 SSR（src/app/*，R46-1A 起整目录已删） | Go html/template（go-backend/templates/*） |
| 模板数 | 173 文件（src/components + src/app） | 94 个（10 主题 × 8 页型 + 14 admin） |
| 采集引擎 | TS（src/lib/crawl/*，8302 行，已 R42-1C 删） | Go（go-backend/crawl/*，10655 行） |
| mini-services | 5 Bun + 1 Python（已删） | 11 Go 二进制（端口 3010-3020）+ bridgeserver 共享包 |
| 降级链 | 5 级 | **8 级**（+uc/moli/curl-impersonate） |
| 反反爬 | 基础 UA + 代理池 | utls Hello 指纹池 36 款 + 36 项反反爬能力（见 §9.5） |
| 数据库 | Prisma/SQLite | 同（schema 不变，db/custom.db 可直接迁移） |
| 项目根 | package.json + bun.lock + tsconfig + Dockerfile + install.sh + src/ + node_modules/ + .next/ 等 | 全部已删（R46-1A），仅保留 go-backend/ + prisma/ + public/ + mini-services/*.sh |

**升级路径（仍在跑旧 Next.js 版本时迁移到 Go）**：

1. 停旧服务：`docker compose down`（旧 Docker 部署）或 `pkill -f 'node server.js'`
2. 保留 `db/custom.db` 和 `public/clone-css/*` 和 `data/*`（封面/TXT 产物）
3. 删除旧 Next.js 残留：`src/`、`node_modules/`、`.next/`、`package.json`、`bun.lock`、
   `tsconfig.json`、`next.config.ts`、`Dockerfile`、`docker-compose.yml`、`install.sh`、
   `docker-entrypoint.sh`（已被 R42-1C + R46-1A 清理）
4. 按 §四 编译 + §七 启动 Go 后端 + §7.4 启动 11 mini-services
5. 浏览器访问 `http://localhost:3000/` 验证

数据库 schema 完全兼容，无需迁移；Prisma schema 仅作建表用，Go 后端直接读 SQLite，不依赖
Prisma。

---

## 十四、参考

- **架构审计**：`agent-ctx/R43-1A-full-stack-developer.md`（A agent 新增 3 服务）
- **引擎深度审查**：`agent-ctx/R43-1B-full-stack-developer.md`（B agent utls + 2captcha）
- **清理重构**：`agent-ctx/R43-1C-full-stack-developer.md`（删旧 TS/Python mini-services + start-all.sh 重写）
- **R46-1A 全面 Go 化**：`agent-ctx/R46-1A-full-stack-developer.md`（删 10 根级 Next.js 配置 + src/app + .next + node_modules + scripts/.ts + examples/.tsx）
- **R45-1C 反反爬 + dead code 第五轮**：`agent-ctx/R45-1C-full-stack-developer.md`（cleaner.go `\1` panic 修复 + DialTLSContext + 6 helper 整合到 bridgeserver）
- **R47-1B 清理精简 + DEPLOY 更新**：`agent-ctx/R47-1B-full-stack-developer.md`
- **R48-1B 清理精简 + DEPLOY 更新**：`agent-ctx/R48-1B-full-stack-developer.md`（go vet/staticcheck 复检 0 + deadcode 38 exported funcs 全保留 + auto-restart dev script + 文档版本同步）
- **R49-1A/1B/1C 主题核实**：`agent-ctx/R49-1A/1B/1C-full-stack-developer.md`（10 套 × 8 页型 = 80 模板全面核实 + cleaner.go 7 P2/P3 bug 修复 + 5 套主题 search form BUG 修复）
- **R50-1C 安装教程重写 + 清理精简**：`agent-ctx/R50-1C-full-stack-developer.md`（本文件 14 节重写 + .dockerignore/upload/tool-results 清理 + go vet 0）
- **R51-1B 清理精简 + DEPLOY/README 校对**：`agent-ctx/R51-1B-full-stack-developer.md`（staticcheck 复检 0 + 删除 unused `probeProxy` wrapper + ST1008 修复 + 9321→9226 行 + 21→29 款 + 26→29 项反反爬清单 + TOC 补全 13/14 节）
- **R52-1A/1B 清理精简 + 主题核实 + DEPLOY/README 校对**：`agent-ctx/R52-1B-full-stack-developer.md`（R52-1A：utls Hello 池扩 29→36 款（+ Chrome 58/100 两款补缺变体，覆盖 2016-2024 全代际）+ smart.go 15 个分类名从 2 字改 4 字（与 DB schema 一致）+ cloak-browser 行为模拟新增 native wheel/Esc/Page Down 三项；R52-1B：清理 + DEPLOY/README 校对 + cover 绝对路径 + SVG 占位 + 分类 4 字 + /admin 访问校验 + gofmt 8-space 风格保留 R52-1A 功能改动）
- **R53-1B 清理精简 + updatedAt 格式化修复 + DEPLOY/README 校对**：`agent-ctx/R53-1B-full-stack-developer.md`（fmtDate/fmtDateShort/shortTime 三处先经 formatUpdatedAt 归一化, 修复 Prisma `@updatedAt` 存 Unix ms 时间戳时直接 s[:10] / s[5:10] 切出时间戳片段的 bug; admin dashboard 实测从 "16560/71510/04577" 时间戳残片修复为 "09-15 23:56" 等正常日期; LoC/port 校对一致 9226→10655 / fetcher 4413→4809 / smart 310→339 / main 1173→1330 / admin 3570→3573 / cloak-browser 859→974 / types 733→737 / agent-ctx 32→37 文件 / worklog ~20200→~22000 行）
- **完整工作日志**：`worklog.md`（~22,000 行，R3-a → R53-1B 全链路迁移记录）
- **数据库 schema**：`prisma/schema.prisma`（11 + 1 表，Feedback R40 新增）
- **采集引擎源码**：`go-backend/crawl/*.go`（8 模块 10655 行）
- **主后端源码**：`go-backend/main.go`（1330 行）+ `go-backend/admin.go`（3573 行）
- **mini-services 源码**：`go-backend/services/*/main.go`（11 个）+ `services/bridgeserver/bridgeserver.go`（共享样板 917 行）

---

**文档版本**：R53-1B（R50-1C 14 节安装部署教程 + 36 项反反爬清单 + 文字版架构图 +
故障排查 7 类 + 生产部署 6 项 + 旧 Next.js 迁移说明；R51-1B 校对：TOC 补全 13/14 节 +
staticcheck 复检 0 + 删除 unused `probeProxy` wrapper + ST1008 修复（probeProxyWithLatency
返回值顺序 (error, int64) → (int64, error)）+ LoC/port/template 校对一致（9321→9226 行 +
fetcher 3615→4413 + types 721→733 + utls 21→29 款 + 26→29 项反反爬清单 + R50-1A 4 行
能力表条目补全 + 3 项行为模拟新加：Gaussian 微抖 + micro wheel events + 15% Tab key）。
R52-1A 校对：utls 29→36 款（+ Chrome 58/100 两款补缺变体，覆盖 2016-2024 全代际） +
smart.go 15 个分类名从 2 字改 4 字（与 DB schema 一致） + cloak-browser 行为模拟新增
native wheel/Esc/Page Down 三项（R51-1A + R52-1A 行为模拟总计 6 项新增） +
26→36 项反反爬清单 + R51-1A/R52-1A 7 项能力表条目补全。
R52-1B 校对：cover 绝对路径 + 封面 SVG 占位（`/covers/<name>.webp` handler 三段式服务）+
分类 4 字（15 个标准分类名全部 4 字） + /admin 访问（8.2 后台路径表补全） +
R52-1A 功能改动保留 8-space 缩进（避免 gofmt -w 产生大批 whitespace-only diff） +
go build + go vet + staticcheck 全 0。
R53-1B 校对：fmtDate/fmtDateShort/shortTime 三处先经 formatUpdatedAt 归一化, 修复 Prisma
`@updatedAt` 存 Unix ms 时间戳时直接 s[:10] / s[5:10] 切出时间戳片段的 bug; admin dashboard
实测从 "16560/71510/04577" 时间戳残片修复为 "09-15 23:56" 等正常日期 + go vet 0 +
staticcheck 0 + go build 0 + 4 端点 curl 全 200 (/health + / + /covers/nonexistent.webp
+ /admin) + LoC/port 校对一致 9226→10655 / fetcher 4413→4809 / smart 310→339 / main
1173→1330 / admin 3570→3573 / cloak-browser 859→974 / types 733→737 + agent-ctx
32→37 文件 + worklog ~20200→~22000 行），对应 worklog.md R38–R53 全程迁移记录。
