# HEIS 小说采集与发布系统 — 安装部署图文教程

> 本教程覆盖从空机器到完整跑起来采集站群的全部细节，**照顾到每一步每一个细节**。
> 跟着做即可完成部署。遇到问题先看 §10 常见问题 FAQ。
>
> R66-D 重写。本文不再堆砌历史轮次（R38→R65 累计成果见 [worklog.md](./worklog.md)
> 与 [README.md](./README.md)），只关注**当下部署所需**的命令、配置、验证与故障排查。
>
> 主控 R66 已修复 `start-go.js` 监听 `*.html` 模板改动，R66-D 在此基础上再加 4 项稳定性
> 增强（Go 工具链自愈 / WAL checkpoint / 心跳死锁检测 / 日志轮转），见 §9。
>
> R68-A 在 R66-D 基础上做历史 JS 栈残留深化清理：删 `bun-types` devDependency +
> `.gitignore` 去除历史构建产物与类型定义残留（`.next/` / `next-env.d.ts` /
> `*.tsbuildinfo` / `.vercel` / yarn-pnp / npm-debug 等）+ DEPLOY/README 文案全面
> Go-only 化（环境准备仅列 Bun + Go + sqlite3 + Caddy 四件套，无任何 JS 框架依赖）。

## 目录

1. [环境准备](#一环境准备)
2. [源码获取](#二源码获取)
3. [数据库初始化](#三数据库初始化)
4. [Go 后端编译](#四go-后端编译)
5. [启动 wrapper + 后端](#五启动-wrapper--后端)
6. [Caddy 网关配置](#六caddy-网关配置)
7. [首次使用](#七首次使用)
8. [主题配置](#八主题配置)
9. [预览稳定性排查](#九预览稳定性排查)
10. [常见问题 FAQ](#十常见问题-faq)

---

## 一、环境准备

### 1.1 系统要求

| 项 | 要求 | 推荐 |
| --- | --- | --- |
| 操作系统 | Linux / macOS / Windows | **Linux x86-64**（生产首选） |
| 架构 | amd64 / arm64 | amd64（与本项目预编译 go1.26.8 下载 URL 一致） |
| 内存 | ≥ 512 MB（heis-backend 运行期 17 MB；mini-services 视抓取量另算） | 2 GB |
| 磁盘 | ≥ 1 GB（源码 + DB + 封面 + TXT 下载产物） | 10 GB（长期采集） |
| 网络 | 能访问 `golang.google.cn` 下载 Go 工具链；能访问源站点采集 | 同 |

> Windows 用户建议在 WSL2 + Ubuntu 内部署，避免 cgo / 路径分隔符 / 信号语义差异。

### 1.2 依赖安装

需要 4 个外部工具：**Bun**（JS runtime，拉起 wrapper）+ **Go 1.26+**（编译后端）+
**sqlite3**（DB 维护）+ **Caddy**（网关）。缺任何一个看下面分项命令。

#### 1.2.1 Bun（JS runtime）

`start-go.js` 用 Bun 跑（不是 Node，因为 Bun 内置 fetch / spawn / fs，无需任何 JS 依赖安装即可拉起 Go 后端 wrapper）。

```bash
# Linux/macOS（官方脚本）
curl -fsSL https://bun.sh/install | bash
# 完成后 source 一下让 PATH 生效
source ~/.bashrc   # 或 ~/.zshrc

# 验证
bun --version
# 预期输出: 1.x.x（任何 1.0+ 均可，本项目用 1.3.4 开发）
```

Windows 用户：`powershell -c "irm bun.sh/install.ps1 | iex"`。

#### 1.2.2 Go 1.26+（编译后端）

`go.mod` 声明 `go 1.26`，需 1.26+ 工具链。沙箱默认路径 `/home/z/go/go/bin/go`
（用户自定义安装，非 PATH 全局），任选一种：

**方式 A：从 golang.google.cn 下载（国内推荐）**

```bash
# 创建安装目录
mkdir -p /home/z/go
cd /tmp

# 下载 go1.26.8 linux-amd64（约 66 MB）
curl -fsSL -o go1.26.8.linux-amd64.tar.gz \
  https://golang.google.cn/dl/go1.26.8.linux-amd64.tar.gz

# 校验文件大小（应 ≥ 60 MB）
ls -lh go1.26.8.linux-amd64.tar.gz

# 解压到 /home/z/go/（tar 会自动创建 go/ 子目录）
tar -xzf go1.26.8.linux-amd64.tar.gz -C /home/z/go

# 验证
/home/z/go/go/bin/go version
# 预期输出: go version go1.26.8 linux/amd64
```

**方式 B：从 go.dev 下载（海外）**

把上面 URL 的 `golang.google.cn` 换成 `go.dev` 即可。

**方式 C：apt / brew / 包管理器**（版本可能滞后，不推荐生产）

```bash
# Ubuntu 24.04+ 仓库自带 go 1.22+，但可能不达 1.26
sudo apt update && sudo apt install -y golang
go version    # 若 < 1.26 走方式 A
```

> ⚠️ **系统重启后 Go 工具链丢失**：沙箱偶发 `/home/z/go/go/bin/go` 文件消失
> （重启清理 /tmp 或挂载点变动）。R66-D 已在 `start-go.js` 加自愈逻辑
> （§9.1），但首次部署仍需手动跑一次方式 A 命令。

#### 1.2.3 sqlite3（DB 维护）

仅用于 WAL checkpoint / VACUUM / 手工 SQL 调试，非 heis-backend 运行必需（Go 用
modernc.org/sqlite 纯 Go 驱动，无 cgo）。

```bash
# Debian/Ubuntu
sudo apt install -y sqlite3

# macOS（系统自带）
sqlite3 --version
# 预期输出: 3.x.x

# 验证
sqlite3 --version
# 预期输出: 3.46.1 2024-... （3.35+ 即可，需支持 PRAGMA wal_checkpoint）
```

#### 1.2.4 Caddy（网关）

仅当需要 :81 反代到 :3000 时才装。本机直连 :3000 可跳过此步。

```bash
# Debian/Ubuntu（官方源）
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# macOS
brew install caddy

# 验证
caddy version
# 预期输出: v2.x.x
```

### 1.3 验收：4 件套齐了吗

```bash
bun --version && /home/z/go/go/bin/go version && sqlite3 --version && caddy version
```

预期 4 行输出，均无 `command not found` 即环境就绪。

---

## 二、源码获取

### 2.1 git clone

```bash
# 选一个工作目录
cd /home/z        # 沙箱默认路径
# 或自选: cd /opt

git clone <repo-url> my-project
cd my-project
```

> 若是从沙箱模板克隆，目录已是 `/home/z/my-project`，跳到 §2.2。

### 2.2 目录结构说明

```
my-project/
├── go-backend/               # 主体后端（Go 源码 + 编译产物）
│   ├── main.go               # 路由 + 模板加载 + 静态服务（~1522 行）
│   ├── admin.go              # /admin/* 后台 SSR + /api/admin/* CRUD（~5186 行）
│   ├── crawl/                # 采集引擎 8 模块（~11000 行）
│   │   ├── fetcher.go        #   HTTP 抓取 + 8 级降级链 + 60 项反反爬
│   │   ├── parser.go         #   css / xpath / regex / json 字段提取
│   │   ├── runner.go         #   4 段采集流程 + 任务调度
│   │   ├── cleaner.go        #   广告 / 去壳 / 零宽字符剥离 / trafilatura 桥
│   │   ├── types.go          #   规则 / 配置 / 结果数据结构
│   │   ├── hostgate.go       #   并发 + 速率双限速器
│   │   ├── storage.go        #   db / txt 双存储 + 封面本地化
│   │   └── smart.go          #   智能分类 / 完结判断 + 4 字分类
│   ├── services/             # 11 个独立 Go mini-services（端口 3010-3020）
│   │   ├── bridgeserver/     #   共享样板包（鉴权 / 限速 / SSRF 守卫 / 健康探针）
│   │   ├── bqg713-proxy/     #   3010 笔趣阁 token + AES 签名代理
│   │   ├── fetch-relay/      #   3011 通用 HTTP 中继桥（降级链 3 级）
│   │   ├── scrapling-bridge/ #   3012 Scrapling 抓取桥（含 Python 子进程）
│   │   ├── qimao-proxy/      #   3013 七猫 API 双签名 + AES 解密
│   │   ├── deqixs-proxy/     #   3014 得奇小说签名代理
│   │   ├── xjp-proxy/       #   3015 新键盘小说解密代理
│   │   ├── uc-bridge/        #   3016 UC 头条桥（chromedp）
│   │   ├── moli-bridge/      #   3017 moli 桥（需外部 moli 二进制）
│   │   ├── curl-impersonate-bridge/  # 3018 curl_cffi 桥（JA3/JA4 轮换）
│   │   ├── trafilatura-bridge/       # 3019 go-readability + trafilatura
│   │   └── cloak-browser/    #   3020 隐身 chromium 反检测渲染
│   ├── templates/            # 95 个 Go html/template 模板
│   │   ├── admin/           #   14 个后台页面（layout + dashboard + 12 功能页）
│   │   ├── aijjxs/           #   主题 1: 现代 flexbox（8 页型）
│   │   ├── 23qb/             #   主题 2
│   │   ├── 101kks/           #   主题 3
│   │   ├── ddyueshu/         #   主题 4
│   │   ├── ggd66/            #   主题 5
│   │   ├── huangjinwu/       #   主题 6
│   │   ├── pilishuwu/        #   主题 7: 反爬严，需 scrapling stealthy
│   │   ├── shipsay/          #   主题 8
│   │   ├── trxsw/            #   主题 9
│   │   └── x2552/            #   主题 10: 旧 table 风格（legacy）
│   ├── go.mod                # Go 模块定义（module heis-backend, go 1.26, 7 direct deps）
│   ├── go.sum                # 依赖校验
│   └── heis-backend         # go build 产物（24 MB；运行时生成，不入版本库）
│
├── prisma/                   # Prisma schema（仅建表用，Go 后端不依赖）
│   ├── schema.prisma         #   11 张表 + 1 视图（Category/Rule/Book/Chapter/BookTag/
│   │                         #     Task/TaskLog/Site/DownloadJob/Setting/FriendLink/Feedback）
│   └── dev.db                #   开发库 fallback（生产用 db/custom.db）
│
├── db/                       # 运行时 SQLite 库（WAL 模式，不入版本库）
│   ├── custom.db             #   主库
│   ├── custom.db-shm         #   WAL shared memory（自动生成）
│   └── custom.db-wal         #   WAL 日志（自动生成）
│
├── mini-services/            # 11 mini-services 启停脚本
│   ├── start-all.sh          #   一键拉起（增量构建 + ≤3s /health 探针）
│   ├── stop-all.sh           #   一键停止
│   └── status.sh             #   查状态（11 行 ALIVE 200）
│
├── public/                   # 静态资源
│   ├── clone-css/*.css       #   10 套主题源站 CSS（main.go /clone-css/ 路由服务）
│   ├── robots.txt            #   站点 robots
│   ├── sw.js                 #   Service Worker（PWA 残留，可选）
│   ├── manifest.json         #   PWA manifest
│   ├── icon.svg / logo.svg   #   站点图标
│
├── Caddyfile                 # 网关配置（:81 反代 :3000 + SSRF 防御端口白名单）
├── start-go.js               # Bun wrapper：auto-build + auto-restart heis-backend
├── start.sh                  # 备用 bash wrapper（无 auto-build）
├── package.json              # scripts.dev = "bun start-go.js"
├── .env                      # DATABASE_URL=file:/home/z/my-project/db/custom.db
├── .env.example              # 环境变量模板（mini-services AUTH_TOKEN/BRIDGE_KEY 等）
├── DEPLOY.md                 # 本文件
├── README.md                 # 项目概览
└── worklog.md                # 完整工作日志（~25000 行，R3-a → R66 全链路）
```

> **关键文件 3 件**：`go-backend/`（主体）+ `prisma/schema.prisma`（DB schema）+
> `start-go.js`（wrapper）。其余目录要么是模板 / 静态资源，要么是辅助脚本。

### 2.3 验证源码完整性

```bash
cd /home/z/my-project
ls go-backend/main.go go-backend/admin.go go-backend/crawl/fetcher.go \
   prisma/schema.prisma start-go.js package.json Caddyfile
# 预期: 全部列出，无 "No such file" 错误

wc -l go-backend/main.go go-backend/admin.go start-go.js
# 预期: main.go ~2520 行 / admin.go ~5186 行 / start-go.js ~250 行
```

---

## 三、数据库初始化

### 3.1 prisma db push 建表

`prisma/schema.prisma` 定义 11 张表。首次部署需用 Prisma CLI 一次性建表
（Go 后端启动时**不建表**，只 open 已存在的 DB）。

```bash
cd /home/z/my-project

# 配 DATABASE_URL（沙箱已配，新环境需手动）
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db' > .env

# 用 bunx 跑 prisma（无需全局安装）
bunx prisma db push --accept-data-loss
# 预期输出（节选）:
#   Environment variables loaded from .env
#   Prisma schema loaded from prisma/schema.prisma
#   Applying changes... (An exhaustive list of changes will be printed...)
#   🌱  Your database is now up to date.
```

> `--accept-data-loss` 是因为 sqlite prisma adapter 在某些 schema 变更时会警告
> 可能丢数据。新部署无数据可丢，放心加。后续增量字段也用此命令。

### 3.2 DB 文件位置

建表后 `db/` 目录会出现 3 个文件：

```bash
ls -la db/
# 预期:
#   custom.db          主库（含 11 张表，~30 KB 空表）
#   custom.db-shm      WAL shared memory（自动）
#   custom.db-wal      WAL 日志（自动，待 checkpoint 后回收）
```

DB 路径硬编码在 `go-backend/main.go` 内（基于 basePath 解析）：
- 优先 `db/custom.db`
- 不存在则 fallback `prisma/dev.db`（开发库，仅作占位，生产应删）

### 3.3 首次启动自动建表说明

**注意**：Go 后端 `main.go` 启动时**不会主动建表**（只 `sql.Open` + 跑 `PRAGMA journal_mode=WAL`
+ 检查表存在）。若 `db/custom.db` 不存在且未跑过 prisma db push，heis-backend 启动会失败
报 `no such table: Book`。

因此**首次部署必须先跑 §3.1 的 `bunx prisma db push`**。

### 3.4 验证建表成功

```bash
sqlite3 db/custom.db ".tables"
# 预期输出（11 张表）:
#   Category  Chapter  DownloadJob  Feedback  FriendLink
#   Book      BookTag  Rule         Setting   Site  Task  TaskLog

sqlite3 db/custom.db "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"
# 预期输出: 11  （或 12 含 sqlite_sequence）

sqlite3 db/custom.db "PRAGMA journal_mode;"
# 预期输出: wal   （heis-backend 启动后才会切到 wal；刚 push 完可能是 delete）
```

---

## 四、Go 后端编译

### 4.1 编译命令

```bash
cd /home/z/my-project/go-backend

# 用绝对路径调 go（沙箱默认安装位置）
/home/z/go/go/bin/go build -o heis-backend .

# 或临时把 go 加到 PATH
export PATH=$PATH:/home/z/go/go/bin
go build -o heis-backend .

# 预期: 0 输出（成功），产出二进制
ls -lh heis-backend
# 预期输出: -rwxr-xr-x 1 z z 24M ... heis-backend
```

首次 build 会下载 Go 依赖（modernc.org/sqlite + goquery + utls + chromedp 等），约
50 MB，1-3 分钟。后续增量 build 仅几秒。

### 4.2 常见编译错误排查

#### 错误 1: `go: command not found` 或 `go: not found`

```bash
# 检查 go 是否装好
ls /home/z/go/go/bin/go
# 若不存在 → 走 §1.2.2 方式 A 重装
```

#### 错误 2: `go: errors during module download` / 网络超时

```bash
# 配 GOPROXY 国内镜像（七牛 / 阿里）
/home/z/go/go/bin/go env -w GOPROXY=https://goproxy.cn,direct
/home/z/go/go/bin/go env -w GOSUMDB=sum.golang.google.cn

# 重新 build
cd /home/z/my-project/go-backend
/home/z/go/go/bin/go build -o heis-backend .
```

#### 错误 3: `package requires newer Go version` / `go.mod requires go >= 1.26`

```bash
/home/z/go/go/bin/go version
# 若 < 1.26 → 走 §1.2.2 重装 1.26+
```

#### 错误 4: cgo 相关报错（`gcc: command not found` / `cgo: C compiler "gcc" not found`）

本项目用 `modernc.org/sqlite`（纯 Go SQLite，无 cgo），不应出现此错误。若出现说明
某依赖意外引入 cgo：

```bash
# 检查 CGO_ENABLED 是否被默认打开
/home/z/go/go/bin/go env CGO_ENABLED
# 若 1 → 强制关闭
CGO_ENABLED=0 /home/z/go/go/bin/go build -o heis-backend .
```

#### 错误 5: `dial tcp: lookup proxy.golang.org` DNS 失败

```bash
# 配 Go 内部 DNS 直连（绕过系统 resolver）
/home/z/go/go/bin/go env -w GOSUMDB=off
/home/z/go/go/bin/go env -w GOFLAGS=-insecure
# 重 build
```

### 4.3 验证二进制

```bash
cd /home/z/my-project/go-backend
file heis-backend
# 预期输出: ELF 64-bit LSB executable, x86-64, ... statically linked, ...

# 跑一下看版本（heis-backend 启动后会输出）
./heis-backend &
sleep 2
curl -s http://localhost:3000/health
# 预期输出: {"ok":true,"lang":"go","memMB":17}
kill %1
```

---

## 五、启动 wrapper + 后端

### 5.1 wrapper 是什么

`start-go.js` 是一个 Bun 脚本（约 250 行），承担 4 件事：

1. **auto-build**：每次启动前检查 `go-backend/*.go` + `go-backend/templates/**/*.html`
   的 mtime 是否新于 `heis-backend` 二进制；新则重新 `go build`。
2. **auto-restart**：heis-backend 进程异常退出 → 2 秒后自动重新 spawn。
3. **go 工具链自愈**（R66-D 新增）：检测 `/home/z/go/go/bin/go` 不存在 →
   `which go` → 仍无则从 golang.google.cn 下载 1.26.8 解压。
4. **WAL checkpoint + 心跳死锁检测 + 日志轮转**（R66-D 新增，详见 §9）。

### 5.2 前台启动（调试用）

```bash
cd /home/z/my-project
bun start-go.js
# 预期输出（节选）:
#   [start-go] binary missing, building...
#   [start-go] go build OK
#   [start-go] heis-backend 启动: http://localhost:3000 (内存 17MB)
#   （heis-backend 自身的 stdout 也会直接显示）
# Ctrl-C 退出（会同时停 heis-backend）
```

> 前台启动适合调试，看输出实时排查。生产用 §5.3 后台启动。

### 5.3 后台启动（生产用）

```bash
cd /home/z/my-project

# 用 nohup + disown 后台跑，stdout/stderr 重定向到 wrapper.log
nohup bun start-go.js > wrapper.log 2>&1 &
disown
# disown 让进程脱离 shell job 表，shell 退出后不被 SIGHUP 杀

# 记 PID 便于后续 kill
echo $! > .wrapper.pid
cat .wrapper.pid
# 预期输出: <PID 数字>

# 验证进程存在
ps -p $(cat .wrapper.pid)
# 预期输出: PID / USER / ... / bun start-go.js

# 验证 :3000 = 200
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
# 预期输出: 200

curl -s http://localhost:3000/health
# 预期输出: {"ok":true,"lang":"go","memMB":17}
```

### 5.4 wrapper 自愈机制说明

| 事件 | 行为 |
| --- | --- |
| heis-backend 崩溃（exit code != 0） | 2 秒后重新 spawn |
| heis-backend 二进制不存在 | `go build` 后再 spawn |
| 源码 `*.go` mtime 新于二进制 | 重新 `go build` 后再 spawn |
| 模板 `*.html` mtime 新于二进制 | 重新 `go build`（虽不编译模板，但触发 wrapper spawn 新进程 → 重载模板） |
| `/home/z/go/go/bin/go` 不存在 | `which go` → 仍无则下载 go1.26.8 从 golang.google.cn 解压到 `/home/z/go/go/` |
| `:3000/health` 60 秒内 3 次连续失败（heis-backend hang 但未退出） | wrapper 强制 SIGKILL heis-backend → 触发重启 |
| 每 30 分钟 | `sqlite3 db/custom.db "PRAGMA wal_checkpoint(TRUNCATE)"` 回收 WAL |
| `wrapper.log` > 10 MB | 自动 rename 为 `wrapper.log.<ts>.bak` + 新建 |

### 5.5 停止 wrapper

```bash
# 停 wrapper（会同时停 heis-backend，因为 heis-backend 是 wrapper 的子进程）
kill $(cat .wrapper.pid)

# 若 wrapper 不在但 heis-backend 还在（用 start.sh 启动的旧方式）
pkill -f heis-backend

# 验证
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
# 预期输出: 000   （连接失败，进程已停）
```

### 5.6 验证 :3000 = 200

```bash
# 主首页
curl -s -o /dev/null -w "HTTP %{http_code} (%{time_total}s)\n" http://localhost:3000/
# 预期输出: HTTP 200 (0.0xx s)

# 健康检查
curl -s http://localhost:3000/health | head -c 200
# 预期输出: {"ok":true,"lang":"go","memMB":17}

# admin 后台
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/admin
# 预期输出: HTTP 200

# 模板加载计数（看 wrapper.log 或 heis-backend 启动行）
grep "已加载" wrapper.log | tail -1
# 预期输出: ... 已加载 95 个模板 ...
```

---

## 六、Caddy 网关配置

### 6.1 Caddyfile 说明

项目根有 `Caddyfile`，监听 `:81` 端口反代到 `:3000`，并带 SSRF 防御（仅放行
3010-3015 端口的 `?XTransformPort=N` 查询参数）。

```caddyfile
:81 {
    # SSRF 防御：仅放行 3010-3015 端口的 XTransformPort 查询参数
    @transform_port_3010 { query XTransformPort=3010 }
    # ... 3011 / 3012 / 3013 / 3014 / 3015 同款
    handle @transform_port_3010 {
        reverse_proxy localhost:3010 {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up X-Real-IP {remote_host}
        }
    }
    # ... 其余端口同款

    # 默认反代到 heis-backend :3000
    handle {
        reverse_proxy localhost:3000 {
            header_up Host {host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
            header_up X-Real-IP {remote_host}
        }
    }
}
```

### 6.2 :81 反代 :3000

`Caddyfile` 默认配置即可。如需改端口或加 HTTPS，编辑 `Caddyfile` 第 1 行 `:81`
改成你想要的（如 `:80` 或域名 `example.com`）。

### 6.3 启动 Caddy

```bash
# 前台跑（调试用，看输出）
cd /home/z/my-project
caddy run --config Caddyfile

# 后台跑（生产用）
nohup caddy run --config Caddyfile > caddy.log 2>&1 &
disown
echo $! > .caddy.pid

# 验证 :81 = 200
sleep 2
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:81/
# 预期输出: HTTP 200

# 验证 SSRF 防御（3010 端口放行，3000 默认放行，其他端口拒绝）
curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://localhost:81/?XTransformPort=3010"
# 预期: 200 （3010 mini-service alive 时）或 502 （mini-service 未启动）

curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://localhost:81/?XTransformPort=22"
# 预期: 200 （走到默认 :3000 handler，不反代 22 端口；Caddyfile 不放行 22）
```

### 6.4 停止 Caddy

```bash
kill $(cat .caddy.pid)
# 或
pkill -f "caddy run"
```

---

## 七、首次使用

### 7.1 访问 /admin

浏览器打开 `http://localhost:3000/admin`（或 `http://localhost:81/admin` 走 Caddy）。

> ⚠️ **/admin 无登录鉴权**：当前不要求登录。生产环境务必在 Caddy 前面套 Basic Auth
> + IP 白名单，或仅放内网访问。详见 §10 FAQ。

### 7.2 创建第一个 Site（站点）

1. 进入 `/admin/sites`，点「新建站点」
2. 填字段：
   - **name**：站点名（如「金石为开小说」）
   - **domain**：域名（如 `localhost` 或 `www.example.com`；含端口亦可）
   - **themeId**：选一个主题（如 `aijjxs` / `23qb` / `101kks` / ...，详见 §8）
   - **title / description / keywords**：TDK（首页 SEO；可留空走主题默认）
   - **isDefault**：勾选 → 设为默认站点（首页 `http://localhost:3000/` 显示此站）
3. 保存

验证：
```bash
curl -s "http://localhost:3000/?view=home&site=<siteId>" | head -c 200
# 预期输出: <!DOCTYPE html>... （首页 HTML）
```

### 7.3 配置采集 Rule（规则）

1. 进入 `/admin/rules`，点「新建规则」
2. 填字段：
   - **name**：规则名（如「笔趣阁 bqg713」）
   - **description**：可选描述
   - **config**：完整规则 JSON，4 段解析器：
     - `list`：列表页发现（CSS / XPath / regex 提取书籍 URL）
     - `book`：书籍详情页（提取书名 / 作者 / 简介 / 封面 / 状态）
     - `toc`：目录页（提取章节列表 + 分卷）
     - `content`：章节正文（提取正文 HTML + 清洗规则）
     - `fetch`：抓取选项（UA / Cookie / Referer / 编码 / 超时 / 重试）
     - `clean`：清洗规则（广告模式 / 去壳 / 零宽字符剥离）
3. 保存
4. 点「在线测试」，输入一个测试 URL（如某书籍详情页），跑一次抓取验证
5. 测试通过后启用规则

参考规则（已入库或见 `scripts/rule-yueyouxs.json` 可导入）：

| 站点 | 规则关键点 |
| --- | --- |
| 番茄 fanqie | 静态 HTML，CSS 提取；tokenUrl 走 bqg713-proxy |
| 七猫 qimao | 静态 + AES 加密内容，qimao-proxy 解密 |
| 得奇 deqixs | 静态 HTML，CSS 提取；走 deqixs-proxy |
| 八零 80ge | 静态 HTML |
| 精华 jinghua | 静态 HTML |
| 笔趣阁 bqg713 | token + AES，bqg713-proxy 全套 |
| xjp | 静态 HTML，xjp-proxy |
| 霹雳 pilishuwu | 反爬严，必须 scrapling-bridge 3012 stealthy / playwright |

### 7.4 建采集 Task（任务）

1. 进入 `/admin/tasks`，点「新建任务」
2. 填字段：
   - **name**：任务名（如「玄幻奇幻 Top 100」）
   - **ruleId**：选刚才创建的规则
   - **mode**：
     - `single`：单本模式（填 `bookUrl`）
     - `range`：范围模式（填 `listUrl` + `listStart`/`listEnd` 页码范围 +
       可选 `bookStart`/`bookEnd` 列表内书籍序号）
   - **recrawlMode**：`full`（完全覆盖重采集） / `incremental`（只增量更新）
   - **storageMode**：`db`（正文入 DB） / `txt`（正文写文件，DB 仅存路径）
   - **threadMin/threadMax**：并发线程数随机范围（如 1-3）
   - **intervalMin/intervalMax**：间隔毫秒随机范围（如 500-2000）
   - **smartCategory / smartComplete / autoSuggest**：智能化三开关（默认 true）
   - **autoRefresh**：完成后自动按间隔重启（实时更新模式）
   - **refreshIntervalMin**：完成后 N 分钟重新采集（5-1440，默认 30）
3. 保存

### 7.5 等 autoResumeTasks 自动采集

启动后 heis-backend 会自动恢复所有 status=pending 或 status=running 的 Task（任务
被「暂停」或进程崩溃前的状态）。也可手动点任务列表的「启动」按钮触发立即执行。

```bash
# 看任务状态
curl -s "http://localhost:3000/api/admin/tasks" | head -c 500
# 预期输出: {"ok":true,"data":[{"id":"...","name":"...","status":"running",...}]}

# 看运行时日志（wrapper.log 内 heis-backend 输出）
tail -f /home/z/my-project/wrapper.log
# 预期: 看到 phase-1: book meta / phase-2: chapter content / phase-3: finalize
```

### 7.6 查看采集结果

```bash
# 看首页（默认站点）
curl -s "http://localhost:3000/" | head -c 500
# 预期: HTML 含站点名 + 最新章节列表

# 看书籍数（直接查 DB）
sqlite3 db/custom.db "SELECT COUNT(*) FROM Book;"
# 预期输出: <数字>  （采集任务跑完后应 >0）

# 看章节数
sqlite3 db/custom.db "SELECT COUNT(*) FROM Chapter;"
# 预期输出: <数字>

# 看某个书的章节
sqlite3 db/custom.db "SELECT idx, title FROM Chapter WHERE bookId='<bookId>' ORDER BY idx LIMIT 5;"
# 预期输出: 5 行章节标题

# 阅读页
curl -s "http://localhost:3000/?view=read&id=<bookId>&ch=1" | head -c 500
# 预期: HTML 含章节正文

# admin /books 页面
curl -s -o /dev/null -w "HTTP %{http_code}\n" "http://localhost:3000/admin/books"
# 预期: HTTP 200
```

---

## 八、主题配置

### 8.1 9 主题说明

项目内置 9 套前台主题（每套 8 页型 = 72 模板；另 + x2552 legacy 共 10 套 80 模板；
+ 14 admin 模板 = 总 95 模板）：

| 主题 ID | 风格 | 源站 | 反爬严度 |
| --- | --- | --- | --- |
| `aijjxs` | 现代 flexbox | aijjxs.com | 中（静态 HTML） |
| `23qb` | 现代 grid | 23qb.com | 中 |
| `101kks` | 现代列表 | 101kks.com | 中 |
| `ddyueshu` | 经典 list | ddyueshu.com | 中 |
| `ggd66` | 现代 panel | ggd66.com | 中 |
| `huangjinwu` | 项目自创 | 金石为开 | 低 |
| `pilishuwu` | 反爬严 | pilishuwu.com | **高**（需 scrapling stealthy） |
| `shipsay` | 项目自创 | shipsay.com | 中 |
| `trxsw` | 项目自创 | trxsw.com | 中 |
| `x2552` | 旧 table 风格（legacy） | x2552.com | 中 |

每主题 8 页型：`home`（首页） / `book`（详情） / `read`（阅读） / `category`（分类） /
`ranking`（排行） / `search`（搜索） / `keyword`（标签聚合） / `fulltext`（全文搜索）。

### 8.2 clone-{theme} 机制

每个主题对应一套**源站 CSS**，放在 `public/clone-css/<theme>.css`，由 `main.go`
的 `/clone-css/<theme>.css` 路由服务。模板加载时会引用对应 CSS，实现「视觉上 1:1
复刻源站」效果。

```bash
ls public/clone-css/
# 预期: 10 个 .css 文件
#   101kks.css / 23qb.css / aijjxs.css / ddyueshu.css / ggd66.css /
#   huangjinwu.css / pilishuwu.css / shipsay.css / trxsw.css / x2552.css

# 验证 CSS 路由
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/clone-css/aijjxs.css
# 预期: HTTP 200
```

修改 CSS 后无需重启 heis-backend（CSS 是静态文件，每次请求实时读取）。但若改 HTML
模板 `go-backend/templates/<theme>/*.html`，需等 wrapper 监听到 mtime 变化触发
重新 spawn heis-backend（R66 主控已修复，监听 `*.html`）。

### 8.3 伪静态 10 套风格配置

`Site.pseudoStaticStyle` 字段决定 URL 风格（R63-A 扩展到 10 套）：

| 风格 | URL 示例 |
| --- | --- |
| `query` | `/?view=book&id=abc123` （默认，查询串） |
| `numeric` | `/book/123.html` |
| `alphanumeric` | `/book/a1b2c3.html` |
| `slug` | `/book/ni-hao-shi-jie/` |
| `short` | `/b/abc` |
| `classic` | `/book-abc-123.html` |
| `dir` | `/book/abc/123.html` |
| `hashid` | `/b/x7y8z9` （短哈希，不可逆，本站自解析） |
| `base62` | `/b/aB3xK` （base62 编码，可逆） |
| `segmented` | `/book/abc/12/34/56.html` （ID 分段目录） |

配置方法：`/admin/sites` 编辑站点 → 选 `pseudoStaticStyle` 下拉 → 保存。

```bash
# 验证（不同风格生成不同 URL）
sqlite3 db/custom.db "SELECT id, name, pseudoStaticStyle FROM Site;"
# 预期输出: 列出所有站点 + 当前风格
```

### 8.4 智能 TDK 批量生成

`Site` 表有 4 个章节 SEO 字段（R57-1B 引入）：

- `chapterSeoAuto`（默认 true）：自动生成阅读页 TDK
- `chapterSeoTitleTemplate`：标题模板，占位符 `{bookName}` `{chapterTitle}` `{page}` `{totalPages}` `{siteName}`
- `chapterSeoDescTemplate`：描述模板
- `chapterSeoKeywordsTemplate`：关键词模板

批量生成（R63-B + R65-A）：

1. 进入 `/admin/sites`
2. 选要生成的站点，点「智能 TDK」按钮
3. 弹出**预览 modal**（R65-A），显示 4 列表格：站点 ID / 当前 TDK / 预生成 TDK / 差异
4. 点「确认应用」→ 落库所有站点的 TDK
5. 验证：
   ```bash
   sqlite3 db/custom.db "SELECT id, name, chapterSeoTitleTemplate FROM Site LIMIT 3;"
   # 预期输出: 站点 + 模板（非空）
   ```

---

## 九、预览稳定性排查

用户痛点：**预览总是挂掉**。表现：浏览器访问 `:81` 或 `:3000` 偶发 502 / 000 /
白屏。原因排查按下面 4 类走。

### 9.1 问题 1：系统重启后 go 工具链丢失

**症状**：系统重启后 `curl :3000` 返 000，看 `wrapper.log` 有：

```
[start-go] binary missing, building...
[start-go] go build failed (exit 1)
```

进一步看错误：

```bash
tail -100 /home/z/my-project/wrapper.log | grep -A2 "go build"
# 预期看到: /home/z/go/go/bin/go: No such file or directory
```

**根因**：沙箱重启清理 `/home/z/go/go/bin/go` 文件（挂载点变动 / /tmp 清理 / 容器
overlay reset）。

**解决**：

```bash
# 方式 A：手动重装（同 §1.2.2）
mkdir -p /home/z/go && cd /tmp
curl -fsSL -o go1.26.8.linux-amd64.tar.gz \
  https://golang.google.cn/dl/go1.26.8.linux-amd64.tar.gz
tar -xzf go1.26.8.linux-amd64.tar.gz -C /home/z/go
/home/z/go/go/bin/go version
# 预期: go version go1.26.8 linux/amd64

# 重启 wrapper（让 wrapper 用新 go build）
kill $(cat /home/z/my-project/.wrapper.pid)
cd /home/z/my-project
nohup bun start-go.js > wrapper.log 2>&1 &
disown
echo $! > .wrapper.pid
```

**R66-D 已自愈**：`start-go.js` 加了 `findGoBinary()` 函数，检测 `/home/z/go/go/bin/go`
不存在时自动 `which go` → 仍无则从 `golang.google.cn` 下载 go1.26.8 解压到
`/home/z/go/go/`。下次重启时无需手动跑上面的方式 A，wrapper 自己搞定。

### 9.2 问题 2：wrapper 死了

**症状**：

```bash
ps -p $(cat /home/z/my-project/.wrapper.pid)
# 输出: ps: pid ... not found （进程不存在）

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health
# 输出: 000
```

**根因**：wrapper 进程被 OOM / 手动 kill / shell 退出未 disown 杀掉。

**解决**：

```bash
# 重启 wrapper
cd /home/z/my-project
nohup bun start-go.js > wrapper.log 2>&1 &
disown
echo $! > .wrapper.pid

sleep 3
curl -s http://localhost:3000/health
# 预期: {"ok":true,...}
```

**长期方案**：把 wrapper 注册成 systemd service（生产部署），让系统重启时自动拉起：

```ini
# /etc/systemd/system/heis-wrapper.service
[Unit]
Description=HEIS Bun wrapper (auto-restart Go backend)
After=network.target

[Service]
Type=simple
User=z
WorkingDirectory=/home/z/my-project
ExecStart=/usr/local/bin/bun /home/z/my-project/start-go.js
Restart=always
RestartSec=3
StandardOutput=append:/home/z/my-project/wrapper.log
StandardError=append:/home/z/my-project/wrapper.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now heis-wrapper
```

### 9.3 问题 3：模板改动不生效

**症状**：改了 `go-backend/templates/<theme>/home.html` 后刷新页面看到的还是旧模板。

**根因**：`html/template` 在 heis-backend 启动期一次性 `ParseFiles` 加载到内存，
模板改动后必须**重启 heis-backend** 才会重载。原 `start-go.js` 只监听 `*.go`
mtime 不监听 `*.html`，导致模板改后 wrapper 不触发重启。

**解决**（R66 主控已修复）：

R66 主控已改 `start-go.js` 监听 `*.html` mtime（line 45），模板改后 wrapper 会
检测到 `*.html` mtime 新于 binary → 重新 `go build` → spawn 新 heis-backend
进程 → 重载模板。

**手动触发**（如 wrapper 未自动检测到，或想立即生效）：

```bash
# touch 一个 .go 文件强制触发 wrapper rebuild
touch /home/z/my-project/go-backend/main.go
sleep 3
curl -s http://localhost:3000/ | grep "<新模板的特征字符串>"
# 预期: 看到新模板内容
```

**验证 wrapper 是否监听 *.html**：

```bash
grep "endsWith.*\.html" /home/z/my-project/start-go.js
# 预期输出: } else if (e.name.endsWith('.go') || e.name.endsWith('.html')) {
```

### 9.4 问题 4：DB 数据丢失（WAL 未 checkpoint）

**症状**：采集了 N 万章后系统重启，重启后 `sqlite3 db/custom.db "SELECT COUNT(*) FROM Book"`
返回 0 或远小于采集前的数。

**根因**：SQLite WAL 模式下，写入先到 `custom.db-wal` 文件，定时 checkpoint 才合并
到 `custom.db`。若系统重启时 WAL 文件损坏 / 未 checkpoint，部分数据「看似丢失」
（实际在 WAL 文件里但主库读不到）。

**解决**：

```bash
# 立即 checkpoint（heis-backend 运行时跑也安全）
sqlite3 /home/z/my-project/db/custom.db "PRAGMA wal_checkpoint(TRUNCATE);"
# 预期输出: 0|0|0  （busy|log|checkpointed，全 0 表示无 pending WAL）

# 验证 WAL 文件已回收
ls -lh /home/z/my-project/db/custom.db*
# 预期: custom.db-wal 大小 ≈ 0 字节

# 重新查
sqlite3 /home/z/my-project/db/custom.db "SELECT COUNT(*) FROM Book;"
# 预期: 恢复正常数字

# 若 WAL 文件已损坏（checkpoint 失败），从备份恢复
ls /home/z/my-project/db/custom.db.bak.* 2>/dev/null
# 若有 backup, 拷回:
# cp db/custom.db.bak.<date> db/custom.db
# 重启 wrapper
```

**R66-D 已自愈**：`start-go.js` 加了 `setInterval(walCheckpoint, 30 * 60 * 1000)`
每 30 分钟自动跑 `PRAGMA wal_checkpoint(TRUNCATE)`，sqlite3 CLI 不可用时降级到
`POST /api/admin/backup/vacuum` 端点（heis-backend 内置 VACUUM，比 wal_checkpoint
重但效果等同）。

**定期备份**（仍建议加 cron）：

```bash
# crontab -e
# 每天 03:00 备份 + VACUUM
0 3 * * * cd /home/z/my-project && cp db/custom.db db/custom.db.bak.$(date +\%F) && sqlite3 db/custom.db "VACUUM;" 2>&1 >> wrapper.log
```

---

## 十、常见问题 FAQ

### FAQ 1：:3000 不可达（curl 返 000）

**排查步骤**：

```bash
# 1. wrapper 进程在吗
ps aux | grep -E "bun start-go|heis-backend" | grep -v grep
# 预期: 看到 2 行 (bun start-go.js + ./go-backend/heis-backend)
# 若空 → wrapper 死了 → 走 §9.2 重启

# 2. 端口监听了吗
ss -lntp | grep 3000
# 预期: LISTEN ... :3000 ... users:(("heis-backend",pid=...))
# 若空 → heis-backend 启动失败 → 看 wrapper.log

# 3. go 工具链在吗
ls /home/z/go/go/bin/go
# 若不存在 → 走 §9.1 重装

# 4. 看最近 100 行 wrapper.log
tail -100 /home/z/my-project/wrapper.log
# 看具体错误
```

### FAQ 2：采集 0 本（任务跑完 DB 还是空）

**排查步骤**：

```bash
# 1. Rule listUrl 配对了吗
sqlite3 db/custom.db "SELECT id, name, listUrl FROM Task WHERE status='done' LIMIT 3;"
# listUrl 为空 → 任务配置错（应配 range 模式 + listUrl 起止页）

# 2. 源站可达吗
curl -sI -o /dev/null -w "HTTP %{http_code} (%{time_total}s)\n" "https://<源站域名>"
# 000 / 4xx / 5xx → 源站不可达 / 被封 → 检查网络 + 代理 + UA

# 3. Rule 在线测试通过了吗
# /admin/rules → 选规则 → 「在线测试」→ 输入测试 URL → 看返回的 JSON
# 若 fields 提取为空 → CSS / XPath 选择器写错 → 修规则 config

# 4. 8 级降级链全失败了吗
tail -500 wrapper.log | grep -E "fetch.*fail|fallback|bridge.*error"
# 看降级链走到哪一级，最后一级的错误

# 5. mini-services 起了吗
bash mini-services/status.sh
# 预期: 11 行 ALIVE 200
# 若有 WARN / FAIL → mini-service 挂了 → bash mini-services/start-all.sh 重启
```

### FAQ 3：模板渲染错（页面显示 raw template 语法 `{{.xxx}}`）

**症状**：浏览器看到的不是渲染后的 HTML，而是 `{{.bookName}}` 这种原始模板语法。

**排查步骤**：

```bash
# 1. 模板语法错了吗
grep -E "ParseFiles|template:" /home/z/my-project/wrapper.log | tail -20
# 若有 "template: ...: function xxx not defined" → FuncMap 缺函数
# 若有 "template: ...: unexpected ..." → 模板语法错

# 2. 模板路径对吗
ls /home/z/my-project/go-backend/templates/<theme>/
# 预期: home.html / book.html / read.html / ... 8 个 .html
# 缺哪个 → 从 git 历史 checkout 或参考其他主题同款文件

# 3. wrapper 监听 *.html 了吗（R66 主控修复）
grep "endsWith.*\.html" /home/z/my-project/start-go.js
# 预期: } else if (e.name.endsWith('.go') || e.name.endsWith('.html')) {
# 若无 → start-go.js 还是旧版 → 走 §9.3 touch .go 强制重建

# 4. 强制重启 heis-backend
touch /home/z/my-project/go-backend/main.go
sleep 3
curl -s "http://localhost:3000/?view=home" | grep -E "{{|}}"
# 预期: 无 raw 模板语法
```

### FAQ 4：DB 锁死（heis-backend hang / 写入超时）

**症状**：admin 后台操作卡住，`/api/admin/...` 请求超时，`SELECT` 也卡住。

**排查步骤**：

```bash
# 1. heis-backend 进程在吗
ps aux | grep heis-backend | grep -v grep
# 若 CPU 0% / STAT D (uninterruptible sleep) → hang → 走 §9.4 重启

# 2. DB 文件锁
lsof /home/z/my-project/db/custom.db
# 预期: 看到 heis-backend 进程持有 fd
# 若有多个进程 → 多实例冲突 → kill 多余

# 3. WAL 文件巨大
ls -lh /home/z/my-project/db/custom.db*
# custom.db-wal > 100 MB → WAL 未 checkpoint → 手动跑:
sqlite3 /home/z/my-project/db/custom.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 4. heis-backend hang 但未退出 → wrapper 心跳检测会 SIGKILL（R66-D 新增）
# 看 wrapper.log:
grep -E "health.*fail|SIGKILL|hang" /home/z/my-project/wrapper.log | tail -10
# 预期: 60 秒 × 3 次失败 → "health check failed 3 times, killing heis-backend"

# 5. 重启 wrapper + heis-backend
kill $(cat /home/z/my-project/.wrapper.pid)
sleep 2
cd /home/z/my-project
nohup bun start-go.js > wrapper.log 2>&1 &
disown
echo $! > .wrapper.pid
```

### FAQ 5：mini-services 状态异常

```bash
bash mini-services/status.sh
# 预期: 11 行 ALIVE 200 (moli/cloak/trafilatura selfTest=false 是预期，不阻塞)
# WARN / FAIL → 重启对应服务
bash mini-services/stop-all.sh && bash mini-services/start-all.sh
```

### FAQ 6：Caddy 502 Bad Gateway

```bash
# Caddy 反代 :3000，:3000 不可达 → 502
curl -s http://localhost:3000/health
# 若 000 → heis-backend 没起 → 走 FAQ 1

# Caddyfile 路径对吗
caddy validate --config /home/z/my-project/Caddyfile
# 预期: "Valid configuration"
```

### FAQ 7：管理后台无鉴权被扫描

`/admin` 无登录。生产环境务必：

```bash
# Caddy Basic Auth（Caddyfile 加 :81 块内）
# basicauth /admin/* {
#     admin <bcrypt-hash>
# }
# 生成 hash: caddy hash-password
```

或仅放内网访问（Caddy 监听 127.0.0.1:81 而非 0.0.0.0:81）。

---

## 附录：参考

- [README.md](./README.md) — 项目概览 + 快速开始
- [worklog.md](./worklog.md) — 完整工作日志（~25000 行，R3-a → R66 全链路）
- [package.json](./package.json) — 依赖清单（3 deps: prisma + @prisma/client + z-ai-web-dev-sdk，devDependencies 已 0；scripts.dev = "bun start-go.js"）
- [prisma/schema.prisma](./prisma/schema.prisma) — DB schema（11 表）
- [go-backend/go.mod](./go-backend/go.mod) — Go 依赖（modernc.org/sqlite + goquery + utls + chromedp）
- [Caddyfile](./Caddyfile) — 网关配置
- [.env.example](./.env.example) — 环境变量模板

---

**文档版本**：R68-A（2025-09-25+）。覆盖 R38→R65 累计成果（R66-D 重写为部署导向图文教程，
10 章节 + FAQ）；R67-A 把 package.json 49 deps 瘦身到 3 deps + node_modules
1GB→272MB；R68-A 删 bun-types 后进一步 272MB→243MB + .gitignore 清理历史 JS 栈
残留 + DEPLOY/README 全面 Go-only 化。
