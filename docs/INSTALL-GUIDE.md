# heis 小说采集与发布系统 — 小白安装部署教程

> 本教程面向零基础用户，每一步都有详细说明，跟着做就能用。

---

## 📖 目录

1. [环境准备](#1-环境准备)
2. [获取源码](#2-获取源码)
3. [安装依赖](#3-安装依赖)
4. [配置环境变量](#4-配置环境变量)
5. [初始化数据库](#5-初始化数据库)
6. [启动服务](#6-启动服务)
7. [首次登录](#7-首次登录)
8. [导入采集规则](#8-导入采集规则)
9. [创建采集任务](#9-创建采集任务)
10. [站群系统配置](#10-站群系统配置)
11. [Docker 一键部署](#11-docker-一键部署)
12. [常见问题](#12-常见问题)

---

## 1. 环境准备

### 1.1 必需软件

| 软件 | 版本要求 | 说明 |
|------|---------|------|
| **Bun** | ≥ 1.3 | JavaScript 运行时(替代 Node.js，更快) |
| **Git** | 任意 | 版本控制工具 |
| **Python** | ≥ 3.12 | scrapling-bridge 和 uc-bridge 依赖 |
| **Moli** | ≥ 1.1 | Rust AI 浏览器引擎(可选，增强采集能力) |

### 1.2 安装 Bun（Ubuntu/Debian）

打开终端（Terminal），逐行复制粘贴执行：

```bash
# 下载并安装 Bun
curl -fsSL https://bun.sh/install | bash

# 让 Bun 命令在当前终端生效
source ~/.bashrc

# 验证安装成功
bun --version
```

如果输出类似 `1.3.14`，说明安装成功。

### 1.3 安装 Python（通常系统自带）

```bash
python3 --version
# 如果提示找不到命令：
sudo apt update && sudo apt install -y python3 python3-pip
```

### 1.4 安装 Moli（可选，推荐）

Moli 是一个 Rust 写的轻量浏览器，内存占用仅 50MB（Chrome 需要 700MB），非常适合服务器环境：

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://github.com/lexmount/moli/releases/latest/download/moli-installer.sh | sh
moli --version
```

---

## 2. 获取源码

```bash
# 克隆项目到本地
git clone https://github.com/u4399com-beep/heis.git

# 进入项目目录
cd heis
```

> 如果在国内访问 GitHub 慢，可以使用代理或镜像站。

---

## 3. 安装依赖

### 3.1 主程序依赖

```bash
bun install
```

等待 1-2 分钟，看到 `Done` 即安装完成。

### 3.2 Mini-services 依赖

系统包含 8 个采集代理服务（端口 3010-3017），需要分别安装依赖：

```bash
# 安装共享库依赖
cd mini-services/_shared && bun install && cd ../..

# 逐个安装各服务依赖
cd mini-services/bqg713-proxy && bun install && cd ../..
cd mini-services/fetch-relay && bun install && cd ../..
cd mini-services/qimao-proxy && bun install && cd ../..
cd mini-services/deqixs-proxy && bun install && cd ../..
cd mini-services/xjp-proxy && bun install && cd ../..
cd mini-services/moli-bridge && bun install && cd ../..
```

### 3.3 Python 依赖（scrapling-bridge）

```bash
cd mini-services/scrapling-bridge
pip3 install -r requirements.txt
cd ../..
```

### 3.4 Playwright 浏览器（CloakBrowser 隐身采集需要）

```bash
bunx playwright install chromium
```

---

## 4. 配置环境变量

```bash
# 复制示例配置文件
cp .env.example .env
```

用文本编辑器打开 `.env` 文件，修改以下关键配置：

```ini
# 数据库路径（默认即可，不用改）
DATABASE_URL=file:./db/custom.db

# 后台登录密码（请修改为自己的密码！）
ADMIN_PASSWORD=audit-fix-2025

# 日志级别：debug（开发）/ info（生产）
LOG_LEVEL=info
```

> **安全提示**：生产环境务必修改 `ADMIN_PASSWORD`！

---

## 5. 初始化数据库

```bash
# 创建数据库表结构
bun run db:push
```

看到 `Generated Prisma Client` 即成功。

---

## 6. 启动服务

### 6.1 启动全部 Mini-services

```bash
bash mini-services/start-all.sh
```

看到 8 个服务的 `OK` 即成功。检查状态：

```bash
bash mini-services/status.sh
```

正常输出类似：
```
bqg713-proxy    :3010  ✓ running
fetch-relay     :3011  ✓ running
scrapling-bridge:3012  ✓ running
qimao-proxy     :3013  ✓ running
deqixs-proxy    :3014  ✓ running
xjp-proxy       :3015  ✓ running
moli-bridge     :3017  ✓ running
```

### 6.2 启动主程序

```bash
bun run dev
```

看到 `✓ Ready` 即启动成功。

### 6.3 访问系统

浏览器打开：`http://localhost:3000`

> 云服务器用户：把 `localhost` 换成你的服务器 IP。

---

## 7. 首次登录

1. 打开 `http://localhost:3000`
2. 输入密码：`audit-fix-2025`（或你在 `.env` 中设置的密码）
3. 点击「登录」

进入后台仪表盘，可以看到：
- 书库统计（书籍数、章节数、字数）
- 采集任务列表
- Mini-services 健康状态（绿点=正常）

---

## 8. 导入采集规则

### 8.1 使用内置模板

1. 后台左侧菜单 → 点击「采集规则」
2. 点击「规则模板」按钮
3. 选择一个模板（如「笔趣阁标准模板」）
4. 修改 URL 为目标站点地址
5. 点击「导入」

### 8.2 使用已有规则

系统已内置 60+ 条采集规则（笔趣阁/七猫/霹雳书屋/黄金屋等），可直接使用。

---

## 9. 创建采集任务

1. 后台左侧菜单 → 点击「采集任务」
2. 点击「新建任务」
3. 选择采集规则
4. 选择模式：
   - **单本采集**：采集指定书籍
   - **范围采集**：采集整页列表
5. 设置线程数（建议 2-3）和间隔（建议 800-1500ms）
6. 点击「创建」
7. 点击「启动」开始采集
8. 在「监控」面板查看实时进度

---

## 10. 站群系统配置

### 10.1 创建站点

1. 后台 → 点击「站群系统」
2. 点击「新建站点」
3. 填写：站点名称、域名、选择主题
4. 保存

### 10.2 主题设置

系统提供 **512 种组合主题**（8配色 × 8风格 × 8布局）+ 12 个精选预设：
- 笔趣阁首页布局（经典板块）
- 网格/列表/书架首页
- 经典/沉浸/分页/霹雳阅读
- aijjxs 精确仿制主题

### 10.3 章节分页 + SEO TDK

在站点编辑中可配置：
- **分页模式**：关闭 / 按字数分页 / 按页数分页
- **自动 TDK**：开启后自动从书籍/章节内容生成 SEO 标题/描述/关键词
- **伪静态 URL**：7 种风格（查询串/纯数字/字母+数字/短路径等）

### 10.4 违禁词过滤

后台 → 系统设置 → 违禁词智能跳过：
- 一行一个违禁词
- 点击「加载预设违禁词」加载 24 个内置词
- 采集时自动检查书名/简介/作者，命中违禁词则跳过

---

## 11. Docker 一键部署

```bash
# 一键安装（包含 Docker 构建 + 规则导入 + 自动填充）
bash install.sh
```

或手动 Docker Compose：

```bash
# 构建并启动
docker compose up -d

# 查看日志
docker compose logs -f

# 停止
docker compose down
```

---

## 12. 常见问题

### Q: 端口被占用怎么办？

```bash
# 查看端口占用
lsof -i :3000

# 杀掉占用进程
kill -9 <PID>

# 或修改 .env 中的端口
```

### Q: Mini-service 启动失败？

```bash
# 检查日志
cat .zscripts/bqg713-proxy.log
cat .zscripts/moli-bridge.log

# 重启全部服务
bash mini-services/stop-all.sh
bash mini-services/start-all.sh
```

### Q: 采集被 Cloudflare 拦截？

1. 在规则配置中把 `fetch.engine` 改为 `browser`
2. 或使用 `fetchMode=moli`（Moli 引擎，低内存）
3. CloakBrowser 隐身模式 + 5级 Turnstile 突破链

### Q: 数据库锁定？

```bash
# SQLite 锁定时重启服务即可
# 所有进程停止后重新启动
```

### Q: 忘记后台密码？

编辑 `.env` 文件，修改 `ADMIN_PASSWORD`，重启服务。

### Q: 如何备份数据？

```bash
# 后台 → 数据备份 → 导出
# 或手动复制数据库
cp db/custom.db db/custom.db.bak
```

### Q: 如何更新系统？

```bash
git pull origin main
bun install
bun run db:push
# 重启服务
```

---

## 系统架构

```
                    ┌─────────────┐
                    │  Next.js    │ :3000 (主程序)
                    │  App Router  │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐
    │ Prisma ORM  │ │ CloakBrowser │ │   Moli     │
    │  (SQLite)   │ │ (Playwright) │ │ (Rust AI)  │
    └─────────────┘ └─────────────┘ └─────────────┘
                           │
    ┌──────────┬───────────┼───────────┬──────────┐
    │          │           │           │          │
┌───┴──┐ ┌───┴──┐ ┌────┴───┐ ┌────┴──┐ ┌───┴────┐
│bqg713│ │fetch │ │scrapling│ │qimao  │ │moli    │
│:3010 │ │relay │ │  :3012  │ │:3013  │ │:3017   │
└──────┘ │:3011 │ └────────┘ └───────┘ └────────┘
         └──────┘
```

---

> 项目地址：https://github.com/u4399com-beep/heis
> 问题反馈：请通过 GitHub Issues 提交
