# heis 小说采集与发布系统 — 小白安装部署教程

## 📖 目录

1. [环境准备](#1-环境准备)
2. [获取源码](#2-获取源码)
3. [安装依赖](#3-安装依赖)
4. [配置环境变量](#4-配置环境变量)
5. [初始化数据库](#5-初始化数据库)
6. [启动开发服务器](#6-启动开发服务器)
7. [访问系统](#7-访问系统)
8. [导入采集规则](#8-导入采集规则)
9. [创建采集任务](#9-创建采集任务)
10. [Docker 一键部署（推荐生产环境）](#10-docker-一键部署)
11. [常见问题](#11-常见问题)

---

## 1. 环境准备

### 1.1 必需软件

| 软件 | 版本要求 | 下载地址 |
|------|---------|---------|
| **Bun** | ≥ 1.3 | https://bun.sh |
| **Git** | 任意 | https://git-scm.com |
| **Node.js** | ≥ 22（生产环境） | https://nodejs.org |

### 1.2 安装 Bun

**Windows (PowerShell):**
```powershell
irm bun.sh/install.ps1 | iex
```

**macOS / Linux:**
```bash
curl -fsSL https://bun.sh/install | bash
```

安装后重启终端，输入 `bun --version` 确认：
```
$ bun --version
1.3.14
```

### 1.3 安装 Git

- **Windows**: 下载 https://git-scm.com/download/win 并安装
- **macOS**: 终端输入 `xcode-select --install`
- **Linux**: `sudo apt install git` 或 `sudo yum install git`

---

## 2. 获取源码

打开终端（Windows 用 Git Bash），执行：

```bash
git clone https://github.com/u4399com-beep/heis.git novel-system
cd novel-system
```

---

## 3. 安装依赖

```bash
bun install
```

等待安装完成（约 10-30 秒），看到类似输出：
```
+ next@16.1.3
+ prisma@6.19.2
+ playwright@1.62.1
...
542 packages installed
```

---

## 4. 配置环境变量

复制示例配置文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，设置以下内容：

```env
# 数据库路径（默认即可，不用改）
DATABASE_URL=file:./db/custom.db

# ⚠️ 重要：后台登录密码（必须修改！）
ADMIN_PASSWORD=你的密码

# 会话密钥（留空则自动派生，建议设置）
SESSION_SECRET=你的随机密钥

# 日志级别（debug/info/warn/error，生产用 info）
LOG_LEVEL=info
```

> **🔒 安全提示**: ADMIN_PASSWORD 是后台登录密码，请设置为强密码（至少 12 位，含大小写字母+数字+符号）

---

## 5. 初始化数据库

### 5.1 生成 Prisma Client

```bash
bunx prisma generate
```

输出：
```
✔ Generated Prisma Client (v6.19.2) to ./node_modules/@prisma/client
```

### 5.2 创建数据库表

```bash
bun run db:push
```

输出：
```
🚀 Your database is now in sync with your Prisma schema.
```

### 5.3 导入演示数据（可选）

```bash
bun run scripts/seed.ts
```

这会创建：
- 15 个分类（玄幻/奇幻/武侠/仙侠/都市 等）
- 6 本演示书籍（含封面和章节）
- 3 条示例采集规则
- 1 个默认站点

---

## 6. 启动开发服务器

```bash
bun run dev
```

看到以下输出表示启动成功：
```
▲ Next.js 16.1.3 (Turbopack)
- Local:        http://localhost:3000

✓ Ready in 671ms
```

---

## 7. 访问系统

### 7.1 后台管理

浏览器打开：**http://localhost:3000/**

或：**http://localhost:3000/?admin=1**

输入你在 `.env` 中设置的 `ADMIN_PASSWORD` 密码登录。

> 如果没有设置 ADMIN_PASSWORD，默认密码是 `audit-fix-2025`

### 7.2 前台站点

浏览器打开：**http://localhost:3000/?view=home**

### 7.3 后台功能导航

| 菜单 | 功能说明 |
|------|---------|
| 📊 仪表盘 | 数据统计、图表、系统健康监控 |
| 📜 采集规则 | 配置/导入/测试采集规则 |
| 📋 采集任务 | 创建/启动/监控采集任务 |
| 📚 书籍管理 | 查看/编辑/删除已采集书籍 |
| 🏷️ 分类管理 | 管理书籍分类 |
| 🌐 站群系统 | 配置前台站点+主题 |
| 🔗 友链链轮 | 管理友情链接 |
| 🎨 主题模板 | 查看 50409 套主题组合 |
| 📥 TXT下载 | 生成 TXT 成品 |
| 💬 用户反馈 | 查看用户反馈 |
| 💾 数据备份 | 导出/导入数据库 |
| 🔍 SEO体检 | 站点 SEO 配置检查 |
| ⚙️ 系统设置 | TXT 默认配置 |

---

## 8. 导入采集规则

系统内置 53 条采集规则，可以通过脚本批量导入：

### 8.1 导入全部规则

```bash
# 导入 24 条站点规则（batch-v2）
bun run scripts/seed-rules-batch-v2.ts

# 导入 27 条单站规则（import-all）
bun run scripts/seed-rules-import-all.ts
```

### 8.2 导入特定规则

```bash
# 例如导入笔趣阁规则
bun run scripts/seed-rule-biqugetw.ts

# 导入飘天文学规则
bun run scripts/seed-rule-piaotia.ts
```

### 8.3 使用规则模板

1. 进入后台 → 采集规则 → 点击「模板库」按钮
2. 从 8 套模板中选择一个（笔趣阁标准/XPath/正则/API/JS渲染等）
3. 点击「使用此模板」创建规则
4. 修改 URL 模板为目标站点地址
5. 在「测试面板」输入真实 URL 测试

---

## 9. 创建采集任务

### 9.1 通过向导创建（推荐）

1. 后台 → 采集任务 → 点击「新建任务」
2. **第一步**：选择采集规则
3. **第二步**：配置采集范围（单本/范围）
4. **第三步**：调度参数（线程/间隔/存储模式）
5. **第四步**：确认并启动

### 9.2 范围采集说明

- **列表地址**：支持 `{page}` 占位符，如 `https://example.com/sort/{page}.html`
- **起始页/结束页**：采集的页码范围
- **增量续采**：已完结书籍自动跳过，连载书籍检查新章节
- **跨源去重**：同名同作者不同源自动比较章节数

---

## 10. Docker 一键部署

### 10.1 安装 Docker

```bash
# Linux 一键安装
curl -fsSL https://get.docker.com | bash

# 验证
docker --version
```

### 10.2 一键部署

```bash
git clone https://github.com/u4399com-beep/heis.git novel-system
cd novel-system

# 设置密码（可选，不设则使用默认）
echo "ADMIN_PASSWORD=你的密码" >> .env

# 一键部署
bash install.sh
```

脚本会自动：
- 检测/安装 Docker
- 构建镜像
- 启动容器
- 等待健康检查
- 打印访问地址

### 10.3 Docker 命令

```bash
# 查看状态
docker compose ps

# 查看日志
docker compose logs -f

# 停止
docker compose down

# 重启
docker compose restart

# 升级
git pull
bash install.sh
```

---

## 11. 常见问题

### Q: 后台密码忘记了？

编辑 `.env` 文件，修改 `ADMIN_PASSWORD=新密码`，重启服务器：
```bash
# 停止当前服务 (Ctrl+C)
bun run dev
```

### Q: 前台显示"暂无可用站点"？

1. 后台 → 站群系统 → 新建站点
2. 填写站点名称、域名
3. 选择主题模板
4. 设为默认站点

### Q: 采集任务失败？

1. 后台 → 采集规则 → 编辑规则 → 测试面板
2. 输入真实的列表/书籍/章节 URL 测试
3. 查看可视化调试器定位问题
4. 如遇 403/CF 防护，设置 `engine: auto` 或 `browser`

### Q: 如何修改前台主题？

1. 后台 → 站群系统 → 编辑站点 → 前台主题
2. 搜索主题 ID 或名称（50409 套可选）
3. 或通过 URL 预览：`http://localhost:3000/?view=home&theme=violet-glasswa-grid-cl`

### Q: 端口被占用？

编辑 `.env`，添加：
```env
HOST_PORT=3001
```
或修改 `package.json` 中的 dev 脚本端口号。

### Q: 数据库备份？

```bash
# 停止服务
docker compose down

# 备份
cp -r db data /backup/

# 恢复
cp -r /backup/db data .
```

或使用后台 → 数据备份 → 导出完整数据库

---

## 📞 技术支持

- GitHub 仓库：https://github.com/u4399com-beep/heis
- 详细部署文档：DEPLOY.md
- 完整工作日志：worklog.md

---

*本教程适用于 heis 项目最新版本。如有疑问请提交 Issue。*
