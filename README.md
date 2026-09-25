# HEIS 小说采集与发布系统（纯 Go 栈）

> 规则驱动的小说采集 + 多主题站群发布 + 反反爬 60 项。单二进制部署，运行期 17 MB
> 内存，无 cgo / 无 Docker / 无 Node 运行时依赖（Bun 仅用于拉起 wrapper）。

**详细部署教程见 [DEPLOY.md](./DEPLOY.md)**（10 章节 + FAQ，照顾到每一步每一个细节）。
**完整工作日志见 [worklog.md](./worklog.md)**（~25000 行，R3-a → R66 全链路）。

## 项目简介

**HEIS（Heis）小说采集与发布系统** 是一套基于**纯 Go** 的规则驱动型小说采集 +
站群发布系统：管理员在 `/admin` 后台配置站点规则与采集任务，引擎按规则抓取
（**8 级降级链 + 60 项反反爬 + utls 36 款 Hello 指纹池 + 3 captcha 服务级联**）
→ 清洗 → 落库；前台站群（书城 / 书籍详情 / 阅读页 / 搜索 / 分类 / 排行榜 / 关键词
聚合 / 全文搜索）直接消费库内数据，封面图 `/covers/<name>` 走 SVG 占位兜底
（不存在则返回渐变色块 + 书名首字）。

R38 → R66 已完成 Next.js → Go 全面迁移 + 反反爬累计 60 项 + 采集增强 7 项 +
9 主题模板 1:1 复刻 + 智能 TDK + 10 套伪静态风格 + admin 全页面 CRUD 补齐 +
DEPLOY 详细图文教程 + start-go.js 4 项稳定性增强。

## 功能特性

### 采集引擎（`go-backend/crawl/` 8 模块 ~11000 行）

- **规则四段解析**：`list`（列表页发现）→ `book`（书籍详情）→ `toc`（章节目录）
  → `content`（章节正文），CSS / XPath / regex / JSON 字段提取，分页 + 翻页
  Referer 链，编码识别（GBK 自动转 UTF-8），正文清洗（广告模式 / 去壳页 /
  零宽字符剥离 / trafilatura 桥），分卷排序，并发限速 + HostGate 双限速，
  封面本地化（webp）+ SmartCategory/SmartCompleteDetect 智能分类 + 完结检测。
- **8 级降级链**：native (utls 36 款 Hello 指纹池) → curl (系统二进制 JA3)
  → fetch-relay 中继桥 → Scrapling 桥（static / stealthy / playwright 三档）→
  cloak-browser 隐身 chromium 反检测渲染 → uc-bridge UC 头条桥 → moli-bridge
  moli 桥 → curl-impersonate curl_cffi JA3/JA4 桥，按站点防护级别自动降级，
  前级成功不降级。
- **反反爬 60 项**：utls 36 款 Hello 指纹池（覆盖 2016-2024 Chrome/Firefox/Safari/
  iOS/Edge/Android OkHttp/QQ 五品牌）+ per-host 钉扎 + attempts 偏移轮换 +
  TLS session ticket 缓存（模拟浏览器 ticket cache + dirtyVersion + fsync +
  corruption recovery）+ JA3/JA4 轮换 + Cookie 持久化（cf_clearance 跨子域合并 +
  stripPort 跨端口）+ Referer 链伪造 + 重试退避（full jitter）+ Cookie/Token
  挑战求解 + looksBlocked/looksLikeCaptcha 启发式拦截 + 3 captcha 服务级联
  (2captcha + anti-captcha + CapSolver) + 代理池（MarkProxyFailed/OK 健康跟踪 +
  cooldown + 5 endpoint 轮选 probe + least-latency + weighted-latency +
  pickFailStreak + dead proxy quarantine + per-host 钉扎 + 健康度淘汰）+
  HTTP/2 ALPN 协商 + Server 头指纹库（nginx/tengine/apache/IIS/cloudflare/cdn）+
  Retry Budget 全局上限（24h/200 次）+ X-Forwarded-For/X-Real-IP 伪造 +
  采集速率可视化 + 错误分类重试策略可调 + 断点续采 DB 协同。
- **采集增强 7 项**：B1 并发自适应 / B2 错误分类重试 / B3 速率自适应 / B4 代理
  指纹钉扎 / B5 续采优先级排序 / B6 采集速率可视化 / B7 错误分类重试策略可调 /
  B8 断点续采 DB 协同。

### 站群发布（`go-backend/templates/` 95 模板）

- **9 主题前台**（+ x2552 legacy 共 10 套）：aijjxs / 23qb / 101kks / ddyueshu /
  ggd66 / huangjinwu / pilishuwu / shipsay / trxsw，每套 8 页型 = 72 模板，
  clone-{theme} 机制 1:1 复刻源站视觉（CSS 走 `/clone-css/<theme>.css`）。
- **10 套伪静态 URL 风格**：query / numeric / alphanumeric / slug / short /
  classic / dir / hashid / base62 / segmented，per-site 可独立配置。
- **智能 TDK 批量生成**：admin/sites 「智能 TDK」按钮 → 预览 modal（4 列表格：
  站点 ID / 当前 TDK / 预生成 TDK / 差异）→ 确认应用全站点落库；章节 SEO 4
  字段（chapterSeoAuto + 3 模板，占位符 {bookName} {chapterTitle} {page}
  {totalPages} {siteName}）。
- **章节分页 3 模式**：off / byWords（每页字数 500-50000） / byPages（强制拆分
  页数 2-20），per-site 可配置。
- **页脚自定义**：footerText / footerCopyright / footerIcp / footerStats 4 字段。
- **导航模块可调**：navCategoryCount（5-30）/ homeModuleLimit（10-50）。
- **封面 SVG 占位**：`<img src="{{.cover}}">` 走 `/covers/<name>.webp` 绝对路径，
  main.go 三段式服务 ①data/covers → ②public/covers → ③SVG 渐变色块 + 书名首字。
- **分类名 4 字化**：标准分类 15 个（玄幻奇幻 / 武侠江湖 / ...），NormalizeCategory
  三段式归一化（别名 → 标准 4 字 → 模糊包含）。

### 管理端（`/admin` 14 模板）

- **12 功能页 + dashboard + layout**：dashboard / tasks / rules / books /
  categories / sites / links / themes / downloads / settings / feedback / backup /
  seo-audit / layout。
- **全页面 CRUD 补齐**（R55-1A）：tasks +删除 / books +新建/编辑/删除含级联清章 /
  rules +编辑全 config + 删除 / sites +新建/编辑/删除含主题切换 / themes +per-site
  主题切换 / downloads +删除 / settings +删除单个 key（feedbackEnabled 受保护）/
  backup +清空采集产物 / seo-audit +修复入口深链。
- **极校准**：对模拟源站三档封禁策略实测安全并发与速率。
- **JSON 备份 / 恢复**：`/api/admin/backup` 导出 / `/api/admin/backup/restore`
  导入 / `/api/admin/backup/vacuum` VACUUM / `/api/admin/backup/clear` 清空
  采集产物。

### mini-services 支撑服务（11 个 Go 二进制，端口 3010-3020）

| 端口 | 服务 | 用途 |
| --- | --- | --- |
| 3010 | `bqg713-proxy` | 笔趣阁 bqg713 token + AES 签名代理 |
| 3011 | `fetch-relay` | 通用 HTTP 中继桥（降级链 3 级，代理池轮换） |
| 3012 | `scrapling-bridge` | Scrapling 抓取桥（static / stealthy / playwright 三档） |
| 3013 | `qimao-proxy` | 七猫官方 API 双签名 + 正文 AES 解密 |
| 3014 | `deqixs-proxy` | 得奇小说网正文三参数动态签名代理 |
| 3015 | `xjp-proxy` | 新键盘小说网 var c 双层正文解密代理 |
| 3016 | `uc-bridge` | UC 头条小说桥（chromedp + 可选 xvfb） |
| 3017 | `moli-bridge` | moli 桥（依赖外部 moli 二进制，未装时 selfTest=false） |
| 3018 | `curl-impersonate-bridge` | curl_cffi 桥（Python 子进程可选；JA3/JA4 轮换） |
| 3019 | `trafilatura-bridge` | go-readability + trafilatura 正文抽取桥 |
| 3020 | `cloak-browser` | 隐身 chromium 反检测渲染（cloak 模式） |

`bridgeserver` 是 11 个服务共享的 Go 包（917 行），提供 `/health` / `/metrics`
/ `/info` / 鉴权 / 限速 / SSRF 守卫 / 安全响应头 / 优雅关闭 / JSON-IO helper 等
通用样板。由 `mini-services/start-all.sh` 一键拉起，端口独占、互不冲突；mini-services
绑 `127.0.0.1:<port>`，仅本机 heis-backend 访问。

## 快速开始（3 步跑起来）

```bash
# 1. clone（沙箱已是 /home/z/my-project）
cd /home/z/my-project

# 2. 初始化数据库（11 张表）
echo 'DATABASE_URL=file:/home/z/my-project/db/custom.db' > .env
bunx prisma db push --accept-data-loss

# 3. 启动 wrapper + 后端（前台测试 / 后台用 nohup）
bun start-go.js
#   或:  nohup bun start-go.js > wrapper.log 2>&1 & disown
```

启动后验证：

```bash
curl -s http://localhost:3000/health
# 预期: {"ok":true,"lang":"go","memMB":17}

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin
# 预期: 200
```

> 完整部署（含 Go 工具链 / Bun / sqlite3 / Caddy 安装 + 编译错误排查 + Caddy 网关
> 配置 + 首次使用 + 主题配置 + 稳定性排查 + FAQ）见 **[DEPLOY.md](./DEPLOY.md)**。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 主后端 | Go 1.26（`net/http` 标准库，无框架）+ modernc.org/sqlite v1.59.0（纯 Go SQLite，**无 cgo**） |
| 采集引擎 | Go 标准库 + goquery + utls（36 款 Hello 指纹池）+ chromedp |
| 模板 | `html/template`（95 个 = 9 主题 × 8 页型 + x2552 legacy 8 + 14 admin） |
| wrapper | `start-go.js`（Bun 脚本，auto-build + auto-restart + go 工具链自愈 + WAL checkpoint + 心跳死锁检测 + 日志轮转） |
| 数据库 | SQLite + Prisma schema（仅建表用，Go 后端不依赖 Prisma runtime） |
| mini-services | 11 个独立 Go 二进制（端口 3010-3020）+ bridgeserver 共享包 |
| 网关 | Caddy v2（`:81` 反代 `:3000` + SSRF 防御端口白名单 3010-3015） |
| 部署 | 单二进制 + bash 脚本（start-all.sh / stop-all.sh / status.sh），**无 Docker / 无 compose** |

## 目录结构（节选）

```
my-project/
├── go-backend/         # 主体后端（main.go + admin.go + crawl/ + services/ + templates/）
├── prisma/             # DB schema（schema.prisma + dev.db fallback）
├── db/                 # 运行时 SQLite 库（custom.db + WAL）
├── mini-services/      # 11 mini-services 启停脚本
├── public/             # 静态资源（clone-css/ + robots.txt + sw.js + manifest.json + icon）
├── Caddyfile           # 网关配置
├── start-go.js         # Bun wrapper（auto-build + auto-restart + 稳定性增强）
├── package.json        # scripts.dev = "bun start-go.js"
├── .env                # DATABASE_URL=file:/home/z/my-project/db/custom.db
├── DEPLOY.md           # 详细部署教程（10 章节 + FAQ）
├── README.md           # 本文件
└── worklog.md          # 完整工作日志（~25000 行）
```

详见 [DEPLOY.md §2.2](./DEPLOY.md#22-目录结构说明)。

## 数据备份

```bash
# 在线备份（WAL 模式下 cp 是安全的，会拿到一致快照）
cp db/custom.db db/custom.db.bak.$(date +%F)

# 定期 VACUUM 回收空间
sqlite3 db/custom.db 'VACUUM;'

# 一键 JSON 导出（含规则 / 站点 / 分类 / 友链 / 设置）
curl -s http://localhost:3000/api/admin/backup > backup-$(date +%F).json
```

## 免责声明

1. 本项目仅供**学习与研究**用途，**不得用于商业用途**。
2. 采集功能请仅用于你有权访问的目标站点，使用时请**遵守目标站点的服务条款 / robots
   协议**，合理控制访问频率，勿对目标站点造成干扰。
3. 通过本项目采集到的全部内容（文字 / 封面等）**版权归原作者及原网站所有**；请勿
   传播、转载或转售采集所得数据。
4. 因使用本项目而产生的任何法律问题与责任，由**使用者自行承担**；项目作者与贡献者
   不对任何滥用行为负责。
5. 若你是站点所有者、不希望被本项目内置规则采集，请提交 issue 说明，我们会在后续版本
   移除对应规则。

---

**项目版本**：R66-D（2025-09-25，纯 Go 栈；R38→R65 全链路迁移完成；R65-B 反反爬
55→60 项；R66 主控修复 wrapper 监听 `*.html` 模板改动；R66-D DEPLOY 重写为部署
导向 10 章节图文教程 + README 项目概览 + start-go.js 4 项稳定性增强）。详细部署见
[DEPLOY.md](./DEPLOY.md)，完整工作日志见 [worklog.md](./worklog.md)。
