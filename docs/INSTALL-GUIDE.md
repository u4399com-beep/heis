# heis 小说采集与发布系统 — 小白零基础安装部署教程

> 📢 **本教程面向完全零基础用户**：哪怕你只会用鼠标点按钮、不会写代码，
> 只要跟着教程**一步一步复制粘贴**命令，就能把整套系统跑起来。
> 每条命令下方都标注了「期望输出」，照着对一下就知道有没有成功。
>
> 📺 **配套截图**：教程中提到的每一步都配有截图，存放在 `docs/images/` 目录下，
> 文件名按步骤编号命名（如 `01-version-check.png`、`02-git-clone.png` …）。

---

## 📖 目录

1. [系统是什么 / 能做什么](#1-系统是什么--能做什么)
2. [系统架构总览（ASCII 图解）](#2-系统架构总览ascii-图解)
3. [小白概念扫盲（术语表）](#3-小白概念扫盲术语表)
4. [环境准备（必装软件）](#4-环境准备必装软件)
5. [获取源码](#5-获取源码)
6. [安装依赖（一次性）](#6-安装依赖一次性)
7. [配置环境变量](#7-配置环境变量)
8. [初始化数据库](#8-初始化数据库)
9. [启动全部 8 个 Mini-services（端口 3010-3017）](#9-启动全部-8-个-mini-services端口-3010-3017)
10. [启动主程序](#10-启动主程序)
11. [首次登录后台](#11-首次登录后台)
12. [导入采集规则](#12-导入采集规则)
13. [创建采集任务并开跑](#13-创建采集任务并开跑)
14. [断点续采 + DB 校验（task resume with DB verification）](#14-断点续采--db-校验task-resume-with-db-verification)
15. [站群系统配置（512 主题 / 智能 TDK / 伪静态 URL / 章节分页）](#15-站群系统配置)
16. [违禁词智能过滤](#16-违禁词智能过滤)
17. [仪表盘卡片显示开关](#17-仪表盘卡片显示开关)
18. [CloakBrowser 隐身模式 + 5 级 Turnstile 突破链](#18-cloakbrowser-隐身模式--5-级-turnstile-突破链)
19. [Moli 引擎详解](#19-moli-引擎详解)
20. [Docker 一键部署（推荐生产环境）](#20-docker-一键部署推荐生产环境)
21. [备份与升级](#21-备份与升级)
22. [常见问题 FAQ（25 问）](#22-常见问题-faq25-问)
23. [故障排查速查表](#23-故障排查速查表)
24. [卸载与清理](#24-卸载与清理)

---

## 1. 系统是什么 / 能做什么

**heis 小说采集与发布系统** 是一套「采集 + 发布」一体化的小说站群平台，让你
30 分钟内从零搭起一个带后台、前台、SEO 优化、防采集突破的完整小说网站。

| 模块 | 能力 |
|------|------|
| 采集引擎 | 8 个站点代理（笔趣阁 / 七猫 / 得奇 / 新键盘 / 番茄 / 霹雳书屋等）+ Moli Rust 引擎 + CloakBrowser 隐身浏览器 |
| 反防护 | 5 级降级链（HTTP → fetch-relay → Scrapling static → Scrapling stealthy → Obscura）+ Cloudflare Turnstile 自动点击 |
| 数据库 | SQLite 单文件（零外部依赖，备份=复制一个文件） |
| 后台 | 规则 CRUD、任务调度、监控看板、规则极限校准、数据备份/还原 |
| 前台 | **512 种主题组合（8 配色 × 8 风格 × 8 布局）+ 12 个精选预设** |
| SEO | 智能 TDK 自动生成、**7 种伪静态 URL 风格**、章节内容分页、sitemap 自动生成 |
| 安全 | 违禁词智能跳过、规则限速、HostGate 域名级隔离 |
| 可视化 | **7 张仪表盘卡片可一键开关**（按需显示） |
| 断点续采 | 任务重启 / 崩溃恢复后自动跳过已采书籍（DB 二次校验，防漏采） |
| 部署 | 一键 Docker 安装脚本（自动检测 / 安装 Docker、配镜像加速、健康探活） |

---

## 2. 系统架构总览（ASCII 图解）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       用户浏览器（你 / 访客）                              │
│                          http://localhost:3000                          │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │ HTTP
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Next.js 16 主程序  (端口 3000, Bun 运行时)                               │
│  ├ 后台 API  /api/admin/{rules,tasks,books,sites,themes,settings,...}   │
│  ├ 公开 API  /api/public/{books,chapter,search,sitemap,download,...}    │
│  ├ 前台页面  /?view=home  /?view=book  /?view=read  /?view=search       │
│  └ 伪静态路由 7 风格 (query/numeric/alphanumeric/slug/short/classic/dir)│
└───────────────┬───────────────────────────────────┬─────────────────────┘
                │                                   │
                ▼                                   ▼
┌───────────────────────────┐        ┌────────────────────────────────────┐
│  Prisma ORM + SQLite      │        │  采集引擎 (src/lib/crawl/)         │
│  db/custom.db (单文件)    │        │  ├ 规则四段解析 (列表/详情/目录/正文)│
│  表: Site/Rule/Task/Book/ │        │  ├ 多引擎降级链 (5 级自动选择)      │
│       Chapter/Setting/    │        │  ├ 违禁词跳过 (cleaner.ts)          │
│       Theme/Feedback/...  │        │  ├ 智能 TDK 生成 (smart.ts)          │
│  断点续采字段:            │        │  ├ 章节分页 (ReadPaginated.tsx)     │
│   progress.discoveredBook │        │  └ 断点续采 (runner.ts + DB 校验)   │
│   progress.completedBook  │        └─────────────────┬──────────────────┘
└───────────────────────────┘                          │
                                                       ▼
                                       ┌──────────────────────────────────┐
                                       │  5 级降级链（按防护自动选择）       │
                                       │  ① native HTTP (Bun 内置)         │
                                       │  ② fetch-relay 中继桥  :3011       │
                                       │  ③ Scrapling static    :3012      │
                                       │  ④ Scrapling stealthy  :3012      │
                                       │  ⑤ Obscura 本地 chromium           │
                                       │     (CloakBrowser 隐身渲染)        │
                                       └──────────────────┬───────────────┘
                                                          │
                ┌─────────────────────────────────────────┴──────────────┐
                ▼                                                        ▼
┌──────────────────────────────────────┐              ┌─────────────────────────────┐
│  8 个 mini-services 侧车              │              │  Moli Rust 引擎桥 :3017     │
│  (各端口 3010-3017)                   │              │  - 内存占用仅 50MB          │
│                                      │              │  - 按需渲染(平时不占显存)    │
│  bqg713-proxy   :3010  AES token     │              │  - CDP 协议 / --dump json   │
│  fetch-relay     :3011  TLS 指纹      │              └─────────────────────────────┘
│  scrapling-bridge :3012  Python      │
│  qimao-proxy    :3013  MD5 + AES     │              ┌─────────────────────────────┐
│  deqixs-proxy   :3014  三参数签名    │              │  持久化卷                    │
│  xjp-proxy      :3015  var c 解密    │              │  ./db/custom.db   (数据库)   │
│  uc-bridge      :3016  Python        │              │  ./data/covers/   (封面)    │
│  moli-bridge    :3017  Rust          │              │  ./data/novels/   (正文)    │
└──────────────────────────────────────┘              │  ./data/downloads/(导出)    │
                                                      └─────────────────────────────┘
```

**数据流简述**：

1. 访客访问 `http://localhost:3000` → 主程序读 DB 渲染前台页面
2. 后台创建任务 → runner 拉起采集 → 调 8 个 mini-service 中合适的代理
3. 代理返回数据 → fetcher 走降级链 → 解析入库 → 自动生成 TDK
4. 任务崩溃 / 重启 → runner 读 `progress.discoveredBookUrls` → 查 DB 二次校验
   → 已采集的整本跳过，未采集的重新入队

---

## 3. 小白概念扫盲（术语表）

如果你第一次接触这些词，先看这张表，心里有底了再继续。

| 术语 | 一句话解释 | 通俗比喻 |
|------|-----------|---------|
| **Bun** | 比 Node.js 更快的 JS 运行时 | 你电脑的「发动机」，跑代码用 |
| **Next.js 16** | React 全栈框架 | 网站的「骨架」 |
| **Prisma** | ORM 工具 | JS 操作数据库的「翻译官」 |
| **SQLite** | 单文件数据库 | 一个 `.db` 文件就是整库 |
| **Mini-service** | 8 个独立小服务 | 每个站点一种「翻译协议」 |
| **Moli** | Rust 写的轻量浏览器 | 内存只占 50MB 的「迷你 Chrome」 |
| **CloakBrowser** | heis 自研隐身浏览器 | 披着「伪装外套」的浏览器 |
| **Turnstile** | Cloudflare 验证码 | 那个「请确认你是人类」的框 |
| **TDK** | Title / Description / Keywords | SEO 三要素 |
| **伪静态 URL** | 把 `?id=123` 变成 `/book/123.html` | 让 URL 好看又对搜索引擎友好 |
| **断点续采** | 任务重启后跳过已采部分 | 像下载工具的「断点续传」 |
| **HostGate** | 域名级隔离 | 不同域名走不同出口 IP |
| **降级链** | 一种方法失败就换下一种 | 5 把钥匙挨个试 |

---

## 4. 环境准备（必装软件）

### 4.1 软件清单

| 软件 | 版本要求 | 用途 | 是否必需 |
|------|---------|------|---------|
| **Bun** | ≥ 1.3 | JavaScript 运行时（替代 Node.js，更快） | ✅ 必需 |
| **Git** | 任意 | 拉取源码 | ✅ 必需 |
| **Python** | ≥ 3.12 | Scrapling 桥 / uc-bridge 依赖 | ⚠️ 可选（强反采集站需要） |
| **Moli** | ≥ 1.1 | Rust AI 浏览器（50MB 内存低耗） | ⚠️ 可选（推荐） |
| **Docker** | ≥ 20.10 | 一键部署（生产推荐） | ⚠️ 可选（生产推荐） |
| **Playwright Chromium** | latest | CloakBrowser 隐身采集 | ⚠️ 可选（过 CF 盾需要） |

> 💡 **小贴士**：如果只是想先看看效果，直接用 Docker 一键部署（第 20 节），
> 连 Bun 都不用装。

### 4.2 安装 Bun（Ubuntu / Debian / WSL）

打开终端（Terminal），逐行复制粘贴执行：

```bash
# 1) 下载并安装 Bun
curl -fsSL https://bun.sh/install | bash
```

期望输出（最后几行）：
```
bun was installed successfully to ~/.bun/bin/bun
Run 'source ~/.bashrc' to add bun to your PATH
```

```bash
# 2) 让 bun 命令在当前终端生效
source ~/.bashrc

# 3) 验证安装成功
bun --version
```

期望输出（版本号 ≥ 1.3 即可）：
```
1.3.14
```

> 🪟 **Windows 用户**：建议装 [WSL2](https://learn.microsoft.com/zh-cn/windows/wsl/)，
> 然后在 WSL 里执行上述命令。原生 Windows 也可用
> `powershell -c "irm bun.sh/install.ps1 | iex"`，但教程后续命令以 Linux 路径为准。

### 4.3 安装 Git（通常已自带）

```bash
git --version
```

期望输出：
```
git version 2.43.0
```

如果提示 `command not found`：

```bash
sudo apt update && sudo apt install -y git
```

### 4.4 安装 Python（仅 Scrapling 桥需要）

```bash
python3 --version
```

期望输出（≥ 3.12）：
```
Python 3.12.3
```

如果未安装或版本过低：

```bash
sudo apt update && sudo apt install -y python3 python3-pip python3-venv
```

### 4.5 安装 Moli（Rust AI 浏览器，推荐）

Moli 是专为 AI Agent 打造的开源浏览器，**内存占用仅 50MB**
（Chrome headless 需 700MB），非常适合服务器环境：

```bash
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/lexmount/moli/releases/latest/download/moli-installer.sh | sh

moli --version
```

期望输出：
```
moli 1.1.0
```

> 🔧 如果 GitHub 下载慢，可以使用代理：
> ```bash
> curl -x http://your-proxy:port --proto '=https' --tlsv1.2 -fsSL \
>   https://github.com/lexmount/moli/releases/latest/download/moli-installer.sh | sh
> ```

### 4.6 安装 Playwright Chromium（CloakBrowser 隐身采集需要）

```bash
bunx playwright install chromium
```

期望输出（最后几行）：
```
Chromium 131.0.6778.x downloaded
```

---

## 5. 获取源码

```bash
# 切到放代码的目录（任意你喜欢的地方）
cd ~

# 克隆项目
git clone https://github.com/u4399com-beep/heis.git

# 进入项目目录
cd heis
```

期望输出（最后几行）：
```
remote: Enumerating objects: 2345, done.
remote: Counting objects: 100% (2345/2345), done.
Receiving objects: 100% (2345/2345), 12.34 MiB | 5.21 MiB/s, done.
```

> 🌏 **国内服务器**：如果 GitHub 下载慢，使用代理：
> ```bash
> git clone https://ghproxy.com/https://github.com/u4399com-beep/heis.git
> ```

---

## 6. 安装依赖（一次性）

### 6.1 主程序依赖

```bash
bun install
```

期望输出（1-2 分钟后）：
```
Resolved 234 packages, installed 234 packages in 87s
Done
```

### 6.2 Mini-services 各服务依赖（8 个）

系统包含 **8 个采集代理服务**（端口 3010-3017），需要分别安装依赖：

```bash
# 安装共享库依赖（其他服务 import 它）
cd mini-services/_shared && bun install && cd ../..

# ① 笔趣阁 bqg713 AES-token 代理
cd mini-services/bqg713-proxy && bun install && cd ../..

# ② Bun fetch 中继桥（TLS 指纹出路）
cd mini-services/fetch-relay && bun install && cd ../..

# ③ Scrapling 桥（Python，按需）
cd mini-services/scrapling-bridge && bun install && cd ../..

# ④ 七猫 API 双签名 + AES 解密
cd mini-services/qimao-proxy && bun install && cd ../..

# ⑤ 得奇小说三参数签名
cd mini-services/deqixs-proxy && bun install && cd ../..

# ⑥ 新键盘 var c 双层解密
cd mini-services/xjp-proxy && bun install && cd ../..

# ⑦ Moli Rust 引擎桥
cd mini-services/moli-bridge && bun install && cd ../..
```

每个目录执行后都应看到：
```
Done
```

### 6.3 Python 依赖（仅 Scrapling 桥需要）

```bash
cd mini-services/scrapling-bridge
pip3 install -r requirements.txt
cd ../..
```

期望输出：
```
Successfully installed scrapling-2.x.x patchright-1.x.x ...
```

---

## 7. 配置环境变量

```bash
# 复制示例配置文件
cp .env.example .env
```

期望输出：无（成功就静默，没有错误信息）。

用文本编辑器（nano 或 vim）打开 `.env` 文件：

```bash
nano .env
```

修改以下关键配置（其他保持默认）：

```ini
# 数据库路径（默认即可，不用改）
DATABASE_URL=file:./db/custom.db

# ★ 后台登录密码（请修改为自己的密码！生产必填！）
ADMIN_PASSWORD=audit-fix-2025

# 日志级别：debug（开发调试）/ info（生产）/ warn / error
LOG_LEVEL=info

# 会话签名密钥（留空则由 ADMIN_PASSWORD 派生 SHA256；改密即令所有会话失效）
SESSION_SECRET=

# CloakBrowser 隐身渲染页面池并发上限（默认 2，提高=更快但内存/CPU 占用更高）
OBSCURA_CONCURRENCY=2
```

> ⚠️ **安全提示**：`ADMIN_PASSWORD` 在生产环境**务必修改**！
> 默认值 `audit-fix-2025` 仅用于初次安装。
>
> 保存退出 nano：`Ctrl+O` 回车保存，`Ctrl+X` 退出。

---

## 8. 初始化数据库

```bash
bun run db:push
```

期望输出：
```
🚀 Your database is now in sync with your Prisma schema. Done in 320ms
✔ Generated Prisma Client (v6.11.1) to ./node_modules/@prisma/client in 180ms
```

> 💡 这条命令会**自动创建** `db/custom.db` 文件（数据库），无需手动建。
> 幂等可重复执行：以后改了 `prisma/schema.prisma` 再跑一次即可同步表结构。

---

## 9. 启动全部 8 个 Mini-services（端口 3010-3017）

### 9.1 一键启动

```bash
bash mini-services/start-all.sh
```

期望输出（看到 8 个 `OK` 即成功，端口 3010-3017）：
```
[start-all] 2025-01-15 10:23:45 starting 8 mini-services...
[start-all] bqg713-proxy (port 3010): OK (pid 12345)
[start-all] fetch-relay (port 3011): OK (pid 12346)
[start-all] scrapling-bridge (port 3012): OK (pid 12347)
[start-all] qimao-proxy (port 3013): OK (pid 12348)
[start-all] deqixs-proxy (port 3014): OK (pid 12349)
[start-all] xjp-proxy (port 3015): OK (pid 12350)
[start-all] uc-bridge (port 3016): OK (pid 12351)
[start-all] moli-bridge (port 3017): OK (pid 12352)
[start-all] done.
```

### 9.2 检查运行状态

```bash
bash mini-services/status.sh
```

期望输出（HEALTH 列全是 200 = 全部正常）：
```
SERVICE             PORT    PID     PROCESS   HEALTH     SELFTEST
-----------------------------------------------------------------------------------
bqg713-proxy        3010    12345   ALIVE     200        true
fetch-relay         3011    12346   ALIVE     200        true
scrapling-bridge    3012    12347   ALIVE     200        true
qimao-proxy         3013    12348   ALIVE     200        true
deqixs-proxy        3014    12349   ALIVE     200        true
xjp-proxy           3015    12350   ALIVE     200        true

[status] All 6 services healthy.
```

### 9.3 单独探活某个服务

```bash
curl http://127.0.0.1:3010/health
```

期望输出（JSON 格式）：
```
{"ok":true,"service":"bqg713-proxy","selfTestOk":true,"uptime":42}
```

### 9.4 停止全部 / 单个重启

```bash
# 停止全部
bash mini-services/stop-all.sh

# 重新启动
bash mini-services/start-all.sh
```

### 9.5 8 个服务端口速查表

| 端口 | 服务名 | 协议 / 能力 | 适用源站 |
|------|--------|------------|---------|
| 3010 | bqg713-proxy | AES token 解密 | 笔趣阁 bqg713 |
| 3011 | fetch-relay | TLS 指纹中继（出口代理池轮换） | 通用换指纹场景 |
| 3012 | scrapling-bridge | Python：curl_cffi + patchright | Cloudflare / DDoS-Guard |
| 3013 | qimao-proxy | 双签名 + AES 解密 | 七猫 API |
| 3014 | deqixs-proxy | 三参数签名 | 得奇小说 |
| 3015 | xjp-proxy | var c 双层解密（contentProxyUrl 模式） | 新键盘 |
| 3016 | uc-bridge | Python 通用桥 | UC 头条等 |
| 3017 | moli-bridge | Rust 引擎调用（CDP） | SPA / 低内存并行 |

---

## 10. 启动主程序

```bash
bun run dev
```

期望输出（最后两行即成功）：
```
- Local:        http://localhost:3000
- Network:      http://192.168.1.5:3000
✓ Ready in 1.2s
```

> 🚀 主程序启动后会**自动连接** 8 个 mini-services（127.0.0.1:3010-3017），无需额外配置。
>
> 按 `Ctrl+C` 可停止主程序（mini-services 不受影响，仍在后台运行）。

**生产环境**（长期跑、稳定优先）：

```bash
bun run start
```

期望输出：
```
- Local:        http://localhost:3000
✓ Ready in 800ms
```

---

## 11. 首次登录后台

1. 浏览器打开：`http://localhost:3000`
2. 输入密码：`audit-fix-2025`（或你在 `.env` 中设置的密码）
3. 点击「登录」

进入后台仪表盘，你将看到：
- 📊 **书库统计**（书籍数、章节数、总字数）
- ✅ **Mini-services 健康状态**（绿点 = 正常，8 个圆点全绿 = OK）
- 📈 **采集任务列表**（运行中 / 暂停 / 待执行）
- 📅 **7 天采集趋势图**
- 🗂️ **分类分布饼图**
- 📉 **采集洞察**（今日采集 / 任务队列 / 规则健康度 / 错误摘要）
- ⚙️ **代理服务卡片**（6+1 采集代理健康指标）

> 🌐 **云服务器**：把 `localhost` 换成你的服务器 IP，例如 `http://123.45.67.89:3000`。
> 防火墙需放行 3000 端口：
> ```bash
> sudo ufw allow 3000/tcp
> ```

---

## 12. 导入采集规则

系统内置了 60+ 条采集规则，开箱即用。也可以从模板创建：

### 12.1 使用内置规则（推荐新手）

1. 后台左侧菜单 → 点击「**采集规则**」
2. 列表里已经有 60+ 条规则（笔趣阁 / 七猫 / 霹雳书屋 / 黄金屋 / 番茄 / 得奇 / 新键盘等）
3. 找一条 `enabled=✓` 的规则，直接创建任务即可

### 12.2 从模板新建规则

1. 在「采集规则」页点击「**规则模板**」按钮
2. 选择一个模板（如「笔趣阁标准模板」「JSON API 模板」「正则兜底模板」）
3. 修改 URL 为目标站点地址
4. 点击「导入」
5. 新规则出现在列表里，可继续编辑字段映射

### 12.3 批量导入规则（脚本方式）

```bash
# 导入全部内置规则（幂等：已有规则会跳过）
bun run scripts/seed-rules-import-all.ts
```

期望输出：
```
Imported 60 rules (skipped 0 duplicates). Done in 1.4s.
```

---

## 13. 创建采集任务并开跑

1. 后台左侧菜单 → 点击「**采集任务**」
2. 点击「**新建任务**」按钮
3. 填写：
   - **任务名**：随便取（如「笔趣阁-玄幻榜单」）
   - **采集规则**：从下拉框选一条
   - **采集模式**：
     - **单本采集**：采集指定一本书
     - **范围采集**：采集整个列表页（listStart / listEnd 范围）
     - **实时采集**：实时监听新章节
     - **定时增量**：每 30 分钟检查新章节
4. 设置参数：
   - **线程数**：建议 `2`（同站并发上限，过高会被封 IP）
   - **间隔**：建议 `1000ms`（每两次请求间隔，过低会触发限速）
5. 点击「**创建**」
6. 在任务列表点「**▶ 启动**」
7. 在「**监控**」面板查看实时进度：
   - 进度条（绿色 = 成功 / 琥珀 = 警告 / 红色 = 错误）
   - 实时日志（按级别过滤：info / success / warn / error）
   - 速率图（每秒采集章节数）

> 🎯 **极限校准**：在规则列表点「极限校准」按钮，系统会自动用三档封禁策略
> 实测安全并发与速率，推荐参数（同站并发上限等）一键写回规则，避免被源站封禁。

---

## 14. 断点续采 + DB 校验（task resume with DB verification）

> 这是 heis 最贴心的功能之一：**任务崩溃 / 重启 / 主动暂停后**，
> 再次启动时**不会**从头重新抓 500 个列表页，而是自动跳过已采集的书籍。
>
> 而且不止「内存里跳过」，还会**二次查 DB 确认**，防止漏采。

### 14.1 工作原理（两道防线）

```
任务启动
   │
   ▼
① 从 task.progress JSON 加载两个集合：
   discoveredBookUrls  ←── 列表页见过的所有书 URL（持久化）
   completedBookUrls   ←── crawlOneBook 返回 'ok' 的书 URL（持久化）
   │
   ▼
② 遍历列表页 → 发现新书 URL 时：
   ├─ 在 discoveredBookUrls 里 → 不再加入 bookQueue（一次跳过）
   │   └─ 但如果 DB 中此书的数据被删除了 ──> 重新加入队列（二次校验！）
   └─ 不在 discoveredBookUrls 里 → 加入 bookQueue + 写入 discoveredBookUrls
   │
   ▼
③ crawlOneBook 返回 'ok' 时：
   └─ URL 写入 completedBookUrls（下次范围扫描整体跳过）
       └─ 但 completedBookUrls 也走 DB 校验 ──> 若 DB 中无书 / 无章节 → 重新加入队列
```

### 14.2 关键源码位置

| 位置 | 作用 |
|------|------|
| `src/lib/crawl/types.ts` | `TaskRuntime.discoveredBookUrls` / `completedBookUrls` Set 字段定义 |
| `src/lib/crawl/types.ts` | `TaskProgress.discoveredBookUrls?` / `completedBookUrls?` 持久化字段 |
| `src/lib/crawl/runner.ts` | `executeTask` 入口从 progress 装载 Set + DB 批量查询校验 |
| `src/lib/crawl/runner.ts` | `discoveredBookUrls` 容量钳 50000 条（防 DB 膨胀） |

### 14.3 实测流程（验证断点续采生效）

```bash
# 1) 创建一个范围任务 listStart=1, listEnd=10（10 页）
# 2) 跑到一半，按 Ctrl+C 强制停止主程序
#    任务状态在 DB 中保存为 'paused'，progress JSON 已落盘
# 3) 在后台「采集任务」列表，把该任务点「▶ 启动」恢复
# 4) 在监控日志里会看到：
#    [runner] 续采: .../book/12345.html 已发现但 DB 中无完整数据, 重新加入队列
#    [runner] 续采: .../book/67890.html 整本跳过(已采完, DB 已存在)
#    [runner] 范围扫描: 跳过 N 本已采集
```

期望日志输出（片段）：
```
[runner] 任务恢复: discoveredBookUrls(23), completedBookUrls(18)
[runner] 范围扫描第 1 页: 发现 30 本, 新增 7 本, 跳过 23 本(已发现)
[runner] 续采: book/12345.html 整本跳过(已采完, DB 已存在)
[runner] 续采: book/23456.html 已发现但 DB 中无完整数据, 重新加入队列
[runner] 范围扫描完成: 本轮跳过 95% 重复工作
```

### 14.4 手动重置断点（强制重采）

如果某条规则字段改了，想强制重新采集：

```bash
# 后台 → 采集任务 → 编辑任务 → 高级 → 把 recrawlMode 改为 'full'
# 或调 API：
curl -X PUT http://localhost:3000/api/admin/tasks/<task-id> \
  -H "Content-Type: application/json" \
  -d '{"progress":{"discoveredBookUrls":[],"completedBookUrls":[]}}'
```

期望输出：
```
{"ok":true,"taskId":"cm...","reset":true}
```

> 💡 **说明**：清空两个 Set 后，下次启动任务会从头扫描列表页，但 DB 中已有
> 章节不会被覆盖（按 `bookId + chapterId` upsert）。

### 14.5 防僵尸暂停（自动清理）

如果一个任务被暂停超过 **1 小时**没有任何操作，系统会自动把它从内存运行时
驱逐（不删 DB 数据），避免占用 TaskRuntime 槽位：

```bash
# 在 dev.log 里会看到：
[runner] paused 任务 cm...xxx 1h 未活跃, 已驱逐(僵尸暂停)
# 之后想恢复时，重新点「▶ 启动」即可，DB progress 会重新装载
```

---

## 15. 站群系统配置

> 这是 heis 最强大的功能之一：**一个数据库可以同时支撑 N 个站点**，
> 每个站点独立的主题、URL 风格、SEO 配置。

### 15.1 创建站点

1. 后台 → 点击「**站群系统**」
2. 点击「**新建站点**」
3. 填写：
   - **站点名称**：如「笔趣阁仿站」
   - **域名**：`penquan.example.com`（前台访问域名）
   - **主题**：从下拉框选（512 种组合 + 12 个预设）
4. 保存

### 15.2 主题设置（512 种组合）

系统提供 **512 种组合主题**：8 配色 × 8 风格 × 8 布局。

| 维度 | 取值 |
|------|------|
| **配色（8）** | violet / emerald / rose / amber / cyan / indigo / slate / crimson |
| **风格（8）** | minimal / glass / classic / modern / neon / paper / magazine / biquge |
| **布局（8）** | biquge-home / grid-home / list-home / shelf-home / classic-read / immersive-read / paginated-read / pili-read |

**外加 12 个精选预设**（直接套用，无需拼装）：
- 笔趣阁首页布局（经典板块）
- 网格 / 列表 / 书架首页
- 经典 / 沉浸 / 分页 / 霹雳阅读
- aijjxs 精确仿制主题
- 等等

主题 ID 格式：`{colorId}-{styleId}-{layoutId}`，例如 `violet-glass-biquge-home`。

**操作步骤**：
1. 站点编辑 → 主题选择器
2. 可在 12 个预设里挑一个，或在 512 组合里自由搭配
3. 实时预览（右侧自动刷新）
4. 满意后点「保存」

> 🧠 **组合惰性合成**：512 个主题不会预生成全部对象（节省内存），
> 而是按需合成。源码在 `src/lib/crawl/theme-matrix.ts`。

### 15.3 智能 TDK（自动 SEO 标题/描述/关键词）

> TDK = Title / Description / Keywords，搜索引擎抓取页面时最先看的三要素。

在站点编辑中开启「**自动 TDK**」后，系统会：
1. **关键词提取**：从书籍简介 / 章节正文自动 N-gram 分词，统计词频，去停用词
2. **描述生成**：取前 N 个有效段落拼接为 ≤150 字摘要
3. **标题构建**：智能拼接「书名 + 章节 + 站点名」格式
4. **更新触发**：每次章节入库时自动更新该书的 TDK，无需手工维护

> 💡 停用词列表已内置（如「的」「了」「小说」「章节」等 100+ 个无 SEO 价值的词）。
>
> 源码位置：`src/lib/crawl/smart.ts` + `src/components/public/auto-tdk.ts`。

### 15.4 伪静态 URL（7 种风格）

在站点编辑中配置「**伪静态设置**」，选一种风格：

| 风格 ID | 名称 | 示例 URL |
|---------|------|----------|
| `query` | 查询串模式 | `/?view=book&id=123456`（默认，无需 rewrite） |
| `numeric` | 纯数字模式 | `/book/123456.html` |
| `alphanumeric` | 字母+数字 | `/book/b123456.html` |
| `slug` | 别名尾斜杠 | `/book/123456/` |
| `short` | 短路径模式 | `/b/123456` |
| `classic` | 经典连字符 | `/book-123456.html` |
| `dir` | 目录分层 | `/book/123/456.html`（防止单目录文件过多） |

> 🔧 `query` 模式无需任何服务器 rewrite 配置，开箱即用；其他模式需配合 Caddy/Nginx 反代规则
> （仓库根目录已附带 `Caddyfile` 示例）。
>
> 源码位置：`src/lib/pseudostatic.ts`。

**Caddyfile 示例片段**（numeric 模式）：

```
penquan.example.com {
    reverse_proxy localhost:3000

    # 伪静态 numeric 风格
    @book path /book/*.html
    rewrite @book /?view=book&id={path.regexp.book.([0-9]+)}

    @read path /read/*/*.html
    rewrite @read /?view=read&bookId={path.regexp.read.([0-9]+)}&chapterId={path.regexp.read.([0-9]+)}

    @category path /category/*/*.html
    rewrite @category /?view=category&id={path.regexp.category.([0-9]+)}&page={path.regexp.category.([0-9]+)}
}
```

### 15.5 章节内容分页

长章节（如 1 万字）一页显示完加载慢、读者疲劳。开启分页后自动拆分：

| 模式 | 说明 |
|------|------|
| `off` | 关闭分页（默认，整章一页） |
| `byWords` | 按字数分页（如每 3000 字一页） |
| `byPages` | 按页数分页（如章节固定分 3 页） |

**配置步骤**：
1. 站点编辑 → 章节分页设置
2. 模式选 `byWords` 或 `byPages`
3. 配置参数：
   - `byWords` → 字数阈值（默认 3000）
   - `byPages` → 页数（默认 3）
4. 保存

前台阅读页底部会出现「上一页 / 1/3 / 下一页」分页导航。

> 源码位置：`src/components/public/read-layouts/ReadPaginated.tsx`。

---

## 16. 违禁词智能过滤

> 防止采集到涉黄 / 赌 / 毒等内容导致站点被搜索引擎降权甚至封禁。

**配置步骤**：

1. 后台 → 「**系统设置**」 → 「违禁词智能跳过」
2. 一行一个违禁词（支持子串匹配）：
   ```
   色情
   赌博
   毒品
   ...
   ```
3. 点击「**加载预设违禁词**」按钮，自动填充 24 个内置违禁词
4. 点击「**保存违禁词**」

期望提示：
```
违禁词已保存(24个), 60秒内生效
```

**工作原理**：
- 采集时自动检查每本书的 **书名 / 简介 / 作者**
- 命中任一违禁词 → 整本书自动跳过，不入库
- 全局生效（也可在某条规则里覆盖 `clean.bannedWords` 字段，做站级差异化）
- 60 秒缓存，修改后无需重启服务

> 源码位置：`src/lib/crawl/cleaner.ts` 的 `bannedWords` 检测逻辑。

---

## 17. 仪表盘卡片显示开关

后台仪表盘有 7 张卡片，你可以按需开关，只看你关心的指标。

| 卡片 ID | 卡片名 | 内容 |
|---------|--------|------|
| `health` | 服务健康 | Mini-services 运行状态（8 个绿点） |
| `miniServices` | 代理服务 | 6+1 采集代理健康指标 |
| `insights` | 采集洞察 | 今日采集 / 任务队列 / 规则健康度 / 错误摘要 |
| `stats` | 采集统计 | 书籍 / 章节 / 字数总量 |
| `trends` | 7天趋势 | 近 7 天采集趋势折线图 |
| `tasks` | 任务概览 | 运行中 / 暂停 / 待执行任务卡片 |
| `categories` | 分类分布 | 书库分类分布饼图 |

**操作步骤**：

1. 后台 → 「**系统设置**」 → 「仪表盘卡片显示开关」
2. 勾选你想显示的卡片（默认全开）
3. 点击「保存」
4. 返回仪表盘，未勾选的卡片会消失，已勾选的重新排列

> 💡 屏幕小 / 性能低的设备可以关掉 `trends` 和 `categories`
> （这两张卡片要查 DB 聚合）。
>
> 源码位置：`src/components/admin/dashboardCards.ts`。

---

## 18. CloakBrowser 隐身模式 + 5 级 Turnstile 突破链

> 遇到 Cloudflare / DDoS-Guard / hCaptcha 等「5 秒盾」或验证码拦截时，开启这条链路。

### 18.1 5 级降级链（自动选择，按需启用）

引擎会根据响应状态码（403 / 429 / 412 / 503 / 验证码特征）**自动降级**到下一级：

| 级别 | 引擎 | 端口 | 适用场景 |
|------|------|------|---------|
| **L1** | native HTTP (Bun 内置) | 主程序 | 普通无防护站点（最快） |
| **L2** | fetch-relay 中继桥 | 3011 | 需要换 TLS 指纹 / 用代理池轮换 |
| **L3** | Scrapling static (curl_cffi) | 3012 | 中等防护，伪造浏览器 JA3 |
| **L4** | Scrapling stealthy (patchright) | 3012 | CF Turnstile 拦截页自动解 |
| **L5** | Obscura 本地 chromium | 主程序内置 | 最强反检测：注入指纹抹平脚本 + Cookie 回传 |

### 18.2 CloakBrowser 隐身模式（Obscura）

Obscura 是 heis 自研的轻量反检测浏览器引擎（基于 Playwright chromium）：

- **页面池常驻**：避免每次冷启动 launch（~1s+ 开销）
- **指纹随机化**：每个域名槽位首次创建时随机 视口 / UA / dpr / locale / 时区
- **抹平脚本注入**：在文档创建前抹平 `navigator.webdriver` / `window.chrome` /
  `plugins` / `WebGL` / `canvas` / `userAgentData` / `permissions`
- **3 级隐身强度**：
  - `lite`：基础抹平（webdriver / chrome / language / headless）— 低指纹站点加速
  - `standard`：全维度抹平（默认）— 通用反检测
  - `maximum`：standard + OfflineAudioContext 噪声 — 强指纹检测站点
- **挑战自动等待**：命中 Cloudflare（"Just a moment..."）等，每 1s 轮询
  最多 `challengeWaitMs`，等站点自动放行
- **Cookie 回传**：渲染完成后把 `cf_clearance` 等凭证回传给 HTTP 引擎 CookieJar
  —— 后续纯 HTTP 抓取也能过盾
- **Turnstile 自动点击**：自动尝试点击 `.cf-turnstile` 复选框（interactive 模式）

> 源码位置：`src/lib/crawl/obscura.ts`。

### 18.3 启用 CloakBrowser（规则配置）

1. 「采集规则」→ 编辑某条规则
2. 找到 `fetch` 配置区
3. 把 `engine` 改为 `browser`
4. （可选）配置 `fetchMode`：
   - `native`（默认，纯 HTTP）
   - `scrapling-static`（伪造 TLS 指纹）
   - `scrapling-stealthy`（patchright 解 CF 挑战）
   - `scrapling-playwright`（标准 playwright）
   - `moli`（Moli Rust 引擎，低内存并行）
5. 保存规则，重启任务即可生效

### 18.4 高级调优（可选）

环境变量（`.env`）：

```ini
# Obscura 隐身渲染页面池并发上限（默认 2，提高=更快但内存/CPU 占用更高）
OBSCURA_CONCURRENCY=2
```

> ⚠️ `OBSCURA_CONCURRENCY=4` 大约多占用 1GB 内存，4GB 以下服务器建议保持默认值 2。

---

## 19. Moli 引擎详解

**Moli** 是专为 AI Agent 打造的开源 Rust 浏览器
（https://github.com/lexmount/moli），特点：

| 特性 | 说明 |
|------|------|
| Rust 内核 | 从零写的浏览器内核，自带 V8 / CSS / 布局 / 软件渲染引擎 |
| 按需渲染 | 平时不布局不绘制不占显存，截图时才渲染一帧 |
| 超低内存 | ~50MB（Chrome headless ~700MB），1/14 占用 |
| CDP 协议 | 兼容 Playwright 直接连接 |
| 输出格式 | `--dump markdown` / `json` / `semantic_tree` / `semantic_tree_text` |
| JS 执行 | 支持 `--eval "JS 表达式"` |
| 截图 | 支持 `--screenshot` 输出 PNG |

**配置某条规则走 Moli 引擎**：

1. 「采集规则」→ 编辑规则
2. `fetchMode` 字段填入：`moli`
3. 保存 → 重启任务

引擎会通过 `moli-bridge`（端口 3017）调用 moli 二进制，按需渲染页面后返回 HTML。

**适用场景**：
- SPA 单页应用（依赖 JS 渲染）
- 防采集诱饵（HTTP 链拿假数据，需真实浏览器执行 JS）
- 低内存并行（同一台机开多个 moli 实例采集多个站）

### 19.1 引擎选型决策树

```
目标站点是否会拦截采集？
├─ 否（普通 HTTP 站）→ fetchMode=native （最快）
├─ 是（403/429/验证码）
│  ├─ 仅 TLS 指纹检测 → fetchMode=scrapling-static
│  ├─ Cloudflare Turnstile 页 → fetchMode=scrapling-stealthy
│  ├─ 强 JS 渲染依赖 → fetchMode=moli（内存敏感）/ engine=browser
│  └─ 强指纹检测 + 挑战页 → engine=browser + stealthLevel=maximum
```

### 19.2 Scrapling 桥详解

**Scrapling** 是基于 Python 的智能采集库，三种模式：

| 模式 | fetchMode | 引擎 | 适用 |
|------|-----------|------|------|
| static | `scrapling-static` | curl_cffi | 伪造浏览器 JA3 TLS 指纹，过基础指纹检测 |
| stealthy | `scrapling-stealthy` | patchright | 解 Cloudflare Turnstile 挑战页 |
| playwright | `scrapling-playwright` | 标准 playwright | 通用浏览器渲染 |

**启用方式**：

1. 安装 Python 依赖（见 6.3 节）
2. 启动 scrapling-bridge：`bash mini-services/start-all.sh`（端口 3012）
3. 规则配置：`fetchMode = scrapling-stealthy`

**Docker 启用 stealthy profile**：

```bash
docker compose --profile stealthy up -d --build
```

> ⚠️ Scrapling 桥镜像约 1GB（含 Chromium），首次构建需 5-10 分钟，构建完后续启动只要几秒。

---

## 20. Docker 一键部署（推荐生产环境）

> 适合：想在云服务器上长期跑、不会装 Bun / Python 一堆东西。

### 20.1 一键脚本（最简方式）

```bash
# 在项目目录内
bash install.sh
```

脚本会自动：
1. 检测 Docker（缺失时询问并自动安装；国内网络自动切换阿里云 / 清华 / 中科大镜像站）
2. 配置 Docker Hub 加速器 + 构建期依赖源加速
3. 预检端口 3000 占用情况
4. `docker compose up -d --build` 构建并启动
5. 轮询容器健康检查（最长等 5 分钟）
6. 打印访问地址

期望输出（最后几行）：
```
[install] ✓ Health check passed (http://127.0.0.1:3000/)
[install] ============================================
[install] 访问地址:
[install]   本机:  http://localhost:3000
[install]   局域:  http://192.168.1.5:3000
[install] ============================================
[install] 自动填充已启动: 7 站点规则已导入, 任务已开跑
[install]   预计 20-40 分钟前台即可有真实书籍
```

> 🔁 **重复执行 `bash install.sh` 是安全的（幂等）**：已有容器会被自动重建，
> 数据在 `./db`、`./data` 中不受影响。

### 20.2 手动 Docker Compose（不跑 install.sh）

```bash
# 构建并启动（首次约 5-10 分钟）
docker compose up -d --build
```

期望输出：
```
✔ Container novel-system  Started
✔ Container novel-scrapling-bridge  Started (with profile stealthy)
```

```bash
# 查看实时日志（自动填充任务日志带 [自动填充] 前缀）
docker compose logs -f
```

按 `Ctrl+C` 退出日志查看（容器仍在后台运行）。

```bash
# 查看容器状态
docker compose ps
```

期望输出：
```
NAME                       STATUS                   PORTS
novel-system               Up (healthy)             0.0.0.0:3000->3000/tcp
novel-scrapling-bridge     Up (healthy)
```

```bash
# 停止
docker compose down

# 重新启动
docker compose up -d
```

### 20.3 关闭自动填充（只想看空后台）

```bash
AUTO_FILL=0 bash install.sh
```

### 20.4 启用 Scrapling 桥（霹雳书屋等强反采集站需要）

```bash
docker compose --profile stealthy up -d --build
```

### 20.5 修改对外端口

编辑 `docker-compose.yml`：

```yaml
ports:
  - "8080:3000"   # 左侧改成 8080 → http://IP:8080
```

然后：

```bash
docker compose up -d
```

### 20.6 主机目录属主（容器非 root 运行）

容器以 `uid 1001` 运行，宿主机需执行一次：

```bash
sudo chown -R 1001:1001 ./db ./data
```

期望输出：无（成功就静默）。

---

## 21. 备份与升级

### 21.1 备份数据

**方法一：后台图形界面**

后台 → 「**数据备份**」 → 「导出」 → 下载 `.json` 备份包

**方法二：手动复制数据库文件**

```bash
# 先停止服务（避免备份到正在写入的文件）
bash mini-services/stop-all.sh

# 复制数据库
cp db/custom.db db/custom.db.bak.$(date +%Y%m%d)

# 重新启动
bash mini-services/start-all.sh
```

期望输出：
```
[stop-all] stopping 8 mini-services...
[stop-all] done.
[stop-all] starting 8 mini-services...
[start-all] bqg713-proxy (port 3010): OK
... (8 个 OK)
```

**方法三：Docker 部署的备份**

```bash
docker compose down
cp -r ./db ./db.bak.$(date +%Y%m%d)
cp -r ./data ./data.bak.$(date +%Y%m%d)
docker compose up -d
```

### 21.2 升级系统

```bash
# 拉取最新代码
git pull origin main

# 更新依赖
bun install

# 同步表结构（如果有变更）
bun run db:push

# 重启服务
bash mini-services/stop-all.sh
bash mini-services/start-all.sh

# 重启主程序
bun run dev
```

Docker 部署的升级：

```bash
git pull origin main
bash install.sh
```

---

## 22. 常见问题 FAQ（25 问）

### Q1：端口被占用怎么办？

**A**：

```bash
# 查看端口占用（以 3000 为例）
lsof -i :3000

# 输出:
# COMMAND   PID  USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME
# bun      1234  root   23u  IPv6   12345      0t0  TCP *:3000 (LISTEN)

# 杀掉占用进程（把 1234 换成上面看到的 PID）
kill -9 1234
```

或者改端口：编辑 `.env` 加一行 `PORT=3001`，重启主程序。

### Q2：Mini-service 启动失败（HEALTH 显示 DOWN）？

**A**：检查日志：

```bash
# 看某个服务的日志（以 bqg713-proxy 为例）
cat .zscripts/bqg713-proxy.log

# 看 moli-bridge 日志（如果 moli 未安装会失败）
cat .zscripts/moli-bridge.log

# 重启全部服务
bash mini-services/stop-all.sh
bash mini-services/start-all.sh
```

### Q3：Moli 桥启动失败 / SELFTEST=false？

**A**：Moli 二进制未找到。检查：

```bash
# 检查 moli 是否在 PATH
which moli

# 检查默认安装路径
ls ~/.local/bin/moli
```

如果都没有，重新安装 Moli（见 4.5 节）。
或者指定自定义路径：编辑 `mini-services/moli-bridge/index.ts` 第 24 行 `MOLI_BIN` 路径。

### Q4：采集被 Cloudflare 拦截（页面显示"Just a moment..."）？

**A**：开启 CloakBrowser 隐身模式 + 5 级降级链：

1. 「采集规则」→ 编辑规则
2. `fetch.engine` 改为 `browser`
3. （可选）`fetchMode` 设为 `scrapling-stealthy`
4. 启用 scrapling 桥：`docker compose --profile stealthy up -d`（Docker 部署）
5. 重启任务

### Q5：SQLite 数据库锁定（错误：`SQLITE_BUSY`）？

**A**：

```bash
# 停止所有服务（释放数据库锁）
bash mini-services/stop-all.sh

# 主程序按 Ctrl+C 停止

# 等待 5 秒后重启
sleep 5
bash mini-services/start-all.sh
bun run dev
```

如果仍报错，检查是否有多个主程序实例在跑：

```bash
ps aux | grep -E 'next|bun' | grep -v grep
```

### Q6：忘记后台密码？

**A**：编辑 `.env` 文件，修改 `ADMIN_PASSWORD=新密码`，重启主程序：

```bash
nano .env
# 改 ADMIN_PASSWORD=your_new_password
bun run dev
```

### Q7：前台访问空白 / 404？

**A**：

1. 确认主程序已启动（看到 `✓ Ready`）
2. 访问 `http://localhost:3000/?view=home`（注意加 `?view=home`，否则进的是后台）
3. 检查浏览器控制台（F12）是否有 JS 报错

### Q8：自动填充任务卡住不动？

**A**：

```bash
# 看实时日志
docker compose logs -f | grep 自动填充

# 或本地开发模式
tail -f dev.log | grep 自动填充
```

如果是源站连不通，把对应站点规则在「自动填充规则列表」里禁用，重启任务。

### Q9：Docker 构建失败 / 镜像拉不下来？

**A**：国内服务器，强制启用国内镜像加速：

```bash
USE_CN_MIRROR=1 bash install.sh
```

或手动指定镜像站：

```bash
BUN_IMAGE=docker.m.daocloud.io/oven/bun:1 \
NODE_IMAGE=docker.m.daocloud.io/library/node:22-slim \
docker compose up -d --build
```

### Q10：内存不足（OOM）/ 构建被杀？

**A**：Next.js 16 Turbopack 构建峰值需 ≥ 2GB 内存，4GB 以下服务器建议：

1. 加 swap：
   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   ```
2. 或在另一台机器构建好后镜像 `docker save` 拷过来 `docker load`。

### Q11：如何采集非内置站点（自定义源）？

**A**：

1. 「采集规则」→「新建规则」
2. 填写源站 URL
3. 用 CSS 选择器 / XPath / 正则配置四个页面（列表 / 详情 / 目录 / 正文）
4. 点「在线测试」逐字段验证
5. 测试通过后保存，创建任务即可开跑

### Q12：如何批量改规则的并发上限 / 间隔？

**A**：

1. 「采集规则」列表 → 勾选要批量改的规则
2. 点击「批量操作」→「修改并发/间隔」
3. 输入新值，确认

### Q13：如何导出书籍为 TXT？

**A**：

1. 后台 → 「书籍管理」→ 找到要导出的书
2. 点击「导出 TXT」
3. 等待生成完成（通知弹出）
4. 「下载中心」里下载

或调 API：

```bash
curl http://localhost:3000/api/public/download?bookId=123 -o book.txt
```

### Q14：如何让站点使用 HTTPS？

**A**：用 Caddy 反代（自动申请 Let's Encrypt 证书）：

仓库根目录已附带 `Caddyfile` 示例：

```bash
# 安装 Caddy
sudo apt install -y caddy

# 复制配置
sudo cp Caddyfile /etc/caddy/Caddyfile

# 修改域名（把 example.com 改成你的）
sudo nano /etc/caddy/Caddyfile

# 重启 Caddy
sudo systemctl restart caddy
```

### Q15：如何更新主题 / 新增预设？

**A**：编辑 `src/lib/crawl/themes.ts`（手写预设）或
`src/lib/crawl/theme-matrix.ts`（512 组合），然后重启主程序。

### Q16：日志文件在哪里？

**A**：

| 类型 | 路径 |
|------|------|
| 主程序 dev 日志 | `dev.log` |
| 主程序生产日志 | `server.log` |
| Mini-services 日志 | `.zscripts/<service>.log` |
| Mini-services PID | `.zscripts/<service>.pid` |
| Docker 日志 | `docker compose logs -f` |

### Q17：如何清理 .zscripts 日志（占用磁盘）？

**A**：

```bash
# 清空日志（不删除文件，保留 PID 文件）
truncate -s 0 .zscripts/*.log

# 或全部删除（服务会重建）
rm -rf .zscripts/*.log
```

### Q18：部署后公网访问不了？

**A**：

1. 检查防火墙：`sudo ufw allow 3000/tcp`
2. 检查云服务商安全组：放行 3000 端口
3. 检查 `docker-compose.yml` 是否 `0.0.0.0` 绑定（默认是）
4. 服务器内访问 `curl http://localhost:3000` 验证服务确实在跑

### Q19：如何彻底卸载？

**A**：见第 24 节「卸载与清理」。

### Q20：怎么联系作者 / 提交 Bug？

**A**：

- 项目地址：https://github.com/u4399com-beep/heis
- 问题反馈：https://github.com/u4399com-beep/heis/issues
- 提交 Issue 时请附上：
  - 系统版本（`uname -a`）
  - Bun 版本（`bun --version`）
  - 关键日志片段（`dev.log` 最后 50 行 + `.zscripts/<相关服务>.log`）

### Q21：断点续采没生效（重启任务又从头采）？

**A**：检查 3 件事：

1. 任务 `recrawlMode` 字段：必须不是 `full`（`full` 模式每次全量重扫）
   - 后台 → 采集任务 → 编辑 → 高级 → recrawlMode 选 `incremental` 或 `auto`
2. 任务 `progress` JSON 里 `discoveredBookUrls` / `completedBookUrls` 字段是否存在：
   ```bash
   # 假设任务 ID 是 cm123abc
   sqlite3 db/custom.db "SELECT json_extract(progress, '\$.discoveredBookUrls') FROM Task WHERE id='cm123abc'"
   ```
   期望输出：`["https://.../book/1.html","https://.../book/2.html",...]`
3. 是否超过 50000 条上限（Set 容量钳 50000，超过会丢弃旧的，但实际场景几乎不会触发）

### Q22：DB 中书被误删，断点续采会不会漏采？

**A**：**不会**。这正是「DB 校验」的作用：

- runner 在判断「已发现」时**不仅看 Set**，还会查 DB 是否有这本书 + 章节
- 若 DB 中无书 / 无章节 → 重新加入队列（日志：`已发现但 DB 中无完整数据, 重新加入队列`）
- `completedBookUrls` 也走同样的二次校验

### Q23：如何强制重采某本书？

**A**：两种方式：

1. **删除该书**（最干净）：
   ```bash
   sqlite3 db/custom.db "DELETE FROM Book WHERE id='<bookId>'"
   sqlite3 db/custom.db "DELETE FROM Chapter WHERE bookId='<bookId>'"
   # 然后任务下次扫描时 DB 校验会判定无数据 → 重新入队
   ```
2. **从 completedBookUrls 里手动移除该 URL**（DB 还在，但任务会重采）：
   ```bash
   # 后台 → 任务详情 → 进度状态 → 手动清空 completedBookUrls 数组
   ```

### Q24：章节内容分页没生效？

**A**：检查 4 件事：

1. 站点配置里开启了分页（模式不是 `off`）
2. 阅读页使用的主题布局是 `paginated-read` 或 `classic-read` / `pili-read` /
   `immersive-read`（只有 `paginated-read` 强制分页，其他按站点配置走）
3. 章节正文字数超过阈值（`byWords` 默认 3000，过短不分页）
4. 浏览器缓存：Ctrl+F5 强制刷新

### Q25：仪表盘卡片开关保存了但没刷新？

**A**：浏览器缓存。两个办法：

1. 强制刷新：`Ctrl + Shift + R`（Mac: `Cmd + Shift + R`）
2. 后台「系统设置」→「仪表盘卡片显示开关」→ 再点一次「保存」（会主动触发前端 refetch）

---

## 23. 故障排查速查表

| 症状 | 第一步检查 | 第二步 |
|------|-----------|--------|
| `bun: command not found` | `which bun` 无输出 | `source ~/.bashrc` 或重装 Bun |
| 端口 3000 占用 | `lsof -i :3000` | 杀进程或改 PORT |
| 8 个绿点缺 1-2 个 | `bash mini-services/status.sh` | 看对应 `.zscripts/<svc>.log` |
| 后台进不去 | 浏览器 F12 看 Network | 确认 ADMIN_PASSWORD 输对了 |
| 前台 404 | URL 有没有 `?view=home` | 看 `next.config.ts` 路由 |
| 采集 403/429 | 切换 fetchMode | 启用 Scrapling stealthy |
| CF "Just a moment" | engine=browser | stealthLevel=maximum |
| `SQLITE_BUSY` | 停所有服务 5 秒再起 | 查是否有重复实例 |
| 任务卡 paused | 1h 自动驱逐了 | 重新点启动（DB progress 仍在） |
| 断点续采失效 | recrawlMode 是否 full | progress 字段是否被清空 |
| 分页不生效 | 站点分页模式 = off | 浏览器 Ctrl+Shift+R |
| 主题切换无效 | 站点主题 ID 是否合法 | 重启主程序 |
| Docker 构建慢 | 国内 `USE_CN_MIRROR=1` | 手动指定镜像源 |
| OOM 杀进程 | 加 swap | 别的机器构建后 load |

---

## 24. 卸载与清理

> ⚠️ **卸载前请先备份 `./db/custom.db`！**

```bash
# 1. 停止所有 mini-services
bash mini-services/stop-all.sh

# 2. 停止主程序（如果在跑）
# 在 bun run dev 的终端按 Ctrl+C

# 3. 停止 Docker 容器（如果是 Docker 部署）
docker compose down

# 4. 删除项目目录
cd ~
rm -rf heis

# 5. 删除 Docker 镜像（可选，回收磁盘）
docker rmi novel-system:latest novel-scrapling-bridge:latest

# 6. 删除 Bun 缓存（可选，彻底清理）
rm -rf ~/.bun/cache
```

期望输出（最后几行）：
```
[stop-all] stopping 8 mini-services...
[stop-all] done.
(后续命令静默成功)
```

---

## 🎉 完成啦！

到这里你已经把整套系统跑起来了。建议接下来：

1. **先跑一个采集任务**，看看流程
2. **建一个站点**，挑一个喜欢的主题
3. **配置 SEO**（智能 TDK + 伪静态 URL + 章节分页）
4. **配违禁词**，避免被搜索引擎降权
5. **接 Caddy 反代 + HTTPS**，正式上线
6. **测试断点续采**：跑到一半 Ctrl+C，再启动，看是否跳过已采

> 📚 更多文档：
> - [DEPLOY.md](./DEPLOY.md) — 生产部署详细手册
> - [README.md](./README.md) — 项目功能总览
> - [docs/rule-limits.md](./rule-limits.md) — 规则字段约束
>
> 🐞 问题反馈：https://github.com/u4399com-beep/heis/issues

---

## 📋 附录：版本与许可

| 项目 | 信息 |
|------|------|
| 系统名称 | heis 小说采集与发布系统 |
| 框架版本 | Next.js 16（Turbopack） |
| 运行时 | Bun ≥ 1.3 |
| 数据库 | SQLite（Prisma ORM v6） |
| 许可证 | MIT License |
| 项目地址 | https://github.com/u4399com-beep/heis |
| 最后更新 | 2025 |

> 本教程面向零基础用户，照着复制粘贴命令即可完成部署。
> 如有疑问优先查第 22 节 FAQ，仍无法解决再提 Issue。
