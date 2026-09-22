# HEIS 小说采集与发布系统（纯 Go 栈）

规则驱动的小说采集与发布系统：管理端配置站点规则与采集任务，引擎按规则抓取（8 级降级链）、
清洗、落库；前台站群（书城/书籍详情/阅读页/搜索/分类/排行榜/关键词聚合/全文搜索）直接消费
库内数据。**R38–R47 已完成 Next.js → Go 全面迁移**：单二进制部署、运行期 17 MB 内存、
无 cgo / 无 Bun / 无 Node / 无 Docker 依赖。`heis-backend` 二进制已入 git（commit
`29dcd99`），平台 `git clone` 后零编译直接运行 `./go-backend/heis-backend`。

> 生产部署详细教程见 **[DEPLOY.md](./DEPLOY.md)**；本文覆盖功能总览、快速开始、项目结构与架构。

## 功能特性

- **单二进制部署**：`go build -o heis-backend .` 产出一个 24 MB 静态链接二进制，运行期 17 MB
  内存（vs 旧 Next.js 2.2 GB，OOM 风险消失），单机即可承载。
- **采集引擎 `go-backend/crawl/`（8 模块 9321 行）**：规则四段（list / book / toc / content）
  解析、CSS / XPath / regex / JSON 字段提取、分页与翻页 Referer 链、编码识别（GBK 自动转
  UTF-8）、正文清洗（广告模式 / 去壳页 / 零宽字符剥离 / trafilatura 桥）、分卷排序、并发限速
  + HostGate 双限速、封面本地化（webp）。
- **8 级降级链**：native (utls 16 款 Hello 指纹池含 PSK / PQ) → curl (系统二进制 JA3 指纹) →
  fetch-relay 中继桥 → Scrapling 桥（static / stealthy / playwright 三档）→ cloak-browser 隐身
  chromium 反检测渲染 → uc-bridge UC 头条桥 → moli-bridge moli 桥 → curl-impersonate curl_cffi
  JA3/JA4 桥，按站点防护级别自动降级，前级成功不降级。
- **反反爬**：utls Hello 指纹池 16 款（R46-1B，含 Chrome PSK / PQ / Edge / iOS）+ per-host 钉扎
  + attempts 偏移轮换 + TLS session ticket 缓存（模拟浏览器 ticket cache）+ JA3/JA4 轮换 +
  Cookie 持久化（cf_clearance 跨子域合并）+ Referer 链伪造 + 重试退避（full jitter）+
  Cookie/Token 挑战求解 + looksBlocked / looksLikeCaptcha 启发式拦截 + 2captcha 验证码（可选）+
  代理池（MarkProxyFailed/OK 健康跟踪 + cooldown）。
- **站级签名/解密代理**：对 token / 签名 / AES 类站点以外置 Go mini-service 承载（见下表），
  引擎 `tokenUrl` 钩子对接。
- **管理端**：14 个后台页面（dashboard / tasks / rules / books / categories / sites / links /
  themes / downloads / settings / feedback / backup / seo-audit / layout），规则 CRUD + 在线测试 +
  极限校准（对模拟源站三档封禁策略实测安全并发与速率）、任务（单书 / 批量 / 实时采集 / 定时
  增量 autoRefresh）、书籍 / 章节管理、TXT 下载、统计看板、JSON 备份 / 恢复、SEO 审计。
- **前台**：10 主题站群（aijjxs / 101kks / x2552 / 23qb / ddyueshu / huangjinwu / ggd66 /
  pilishuwu / trxsw / shipsay，每主题 8 页型 = 80 文件 + 14 admin = 94 模板），主题注册表
  驱动，阅读页 / 搜索 / sitemap / 伪静态链接（query / numeric / alphanumeric / slug / short /
  classic / dir）/ 章节分页（off / byWords / byPages）/ 站群链轮（inLinkWheel）/ 自定义 TDK +
  ICBM 坐标 + geoRegion / geoPlacename。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | Go 1.26（go.mod 声明，1.21+ API 即可编译） + `net/http` 标准库 |
| 语言 | Go（无 TypeScript / 无 JSX） |
| 模板 | `html/template`（94 个，10 主题 × 8 页型 + 14 admin） |
| 数据库 | modernc.org/sqlite v1.59.0（纯 Go SQLite，无 cgo）+ Prisma schema（仅建表用） |
| 采集引擎 | `go-backend/crawl/*.go`（8 模块 8691 行，纯 Go 标准库 + goquery + utls + chromedp） |
| mini-services | `go-backend/services/*/main.go`（11 个独立 Go 二进制，端口 3010–3020）+ bridgeserver 共享包 |
| 部署 | 单二进制 + bash 脚本（start-all.sh / stop-all.sh / status.sh），无 Docker / 无 compose |

## 快速开始（5 分钟跑起来）

前置：Go 1.23+ 工具链（go.mod 声明 1.26，但 1.21+ API 即可编译；下载
https://go.dev/dl/ ，选 `go1.23.x.linux-amd64.tar.gz` 解压到 `/usr/local/go` 或 `~/go`，
`export PATH=$PATH:/usr/local/go/bin`）；bash 4+；curl（健康探针）；可选 Prisma CLI（仅建表时
需要，`bunx prisma db push` 或 `npx prisma db push`）。

### 1. 编译主后端

```bash
cd /home/z/my-project/go-backend
go build -o heis-backend .
# 产出二进制 heis-backend (24 MB, 静态链接, 无外部依赖)
# macOS / Linux 通用; Windows 用 GOOS=windows go build -o heis-backend.exe .
```

### 2. 初始化数据库

```bash
cd /home/z/my-project
echo 'DATABASE_URL=file:./db/custom.db' > .env
bunx prisma db push      # 或 npx prisma db push; 仅首次建表需要
# 也可直接放一份现成 db/custom.db 到 db/ 目录, Go 后端启动会自动 open
```

### 3. 启动主后端

```bash
cd /home/z/my-project/go-backend
./heis-backend
# 控制台输出:
#   数据库: /home/z/my-project/db/custom.db
#   已加载 94 个模板
#   heis-backend 启动: http://localhost:3000 (内存 17MB)

# 后台运行用 nohup ./heis-backend > backend.log 2>&1 &; 停止 pkill -f heis-backend
```

### 4. 启动 11 mini-services

```bash
cd /home/z/my-project
bash mini-services/start-all.sh
# Phase 1: 增量构建 (源码 mtime > 二进制 mtime 才重建; 首次跑会构建全部 11 个)
# Phase 2: 启动 + ≤3s /health 探针 (200 = OK, 失败 WARN 不阻塞)
# 输出 PID 写到 .zscripts/<svc>.pid, 日志写到 .zscripts/<svc>.log
```

### 5. 验证

```bash
curl -s http://localhost:3000/health     # 200 OK
curl -s http://localhost:3000/           # 前台首页 HTML
curl -s http://localhost:3000/admin      # 管理后台 HTML
bash mini-services/status.sh             # 11 行全 ALIVE 200 (moli/cloak/trafilatura selfTest=false 是预期)
```

访问地址：

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/` | 默认站点首页（isDefault=true 的 Site） |
| `http://localhost:3000/?view=home&site=<siteId>` | 指定站点首页 |
| `http://localhost:3000/?view=book&id=<bookId>` | 书籍详情页 |
| `http://localhost:3000/?view=read&id=<bookId>&ch=<chapterIdx>` | 阅读页 |
| `http://localhost:3000/?view=category&cat=<categoryId>` | 分类列表页 |
| `http://localhost:3000/?view=ranking` | 排行榜 |
| `http://localhost:3000/?view=search&q=<keyword>` | 搜索结果页 |
| `http://localhost:3000/?view=fulltext&q=<keyword>` | 全文搜索 |
| `http://localhost:3000/?view=keyword&tag=<tag>` | 关键词（标签）聚合页 |
| `http://localhost:3000/admin` | 管理后台（任务 / 规则 / 书籍 / 章节 / 站点 / 分类 / 友链 / 主题 / 下载 / 设置 / 反馈 / 备份 / SEO 审计） |

> ⚠️ **后台无登录鉴权**：管理端 `/admin` 当前不要求登录，请勿直接暴露公网。生产环境务必前面套
> 反向代理（Nginx / Caddy）做 Basic Auth + IP 白名单，或仅放内网访问。详见 DEPLOY.md §8.2。

## mini-services 支撑服务（11 个 Go 二进制，端口 3010–3020）

| 端口 | 服务 | 用途 |
| --- | --- | --- |
| 3010 | `bqg713-proxy` | 笔趣阁 bqg713 token + AES 签名代理 |
| 3011 | `fetch-relay` | 通用 HTTP 中继桥（降级链 3 级，代理池轮换） |
| 3012 | `scrapling-bridge` | Scrapling 抓取桥（static / stealthy / playwright 三档，含可选 Python 子进程） |
| 3013 | `qimao-proxy` | 七猫官方 API 双签名 + 正文 AES 解密 |
| 3014 | `deqixs-proxy` | 得奇小说网正文三参数动态签名代理 |
| 3015 | `xjp-proxy` | 新键盘小说网 var c 双层正文解密代理 |
| 3016 | `uc-bridge` | UC 头条小说桥（chromedp + 可选 xvfb） |
| 3017 | `moli-bridge` | moli 桥（依赖外部 moli 二进制，未装时 selfTest=false，不阻塞） |
| 3018 | `curl-impersonate-bridge` | curl_cffi 桥（Python 子进程可选；JA3/JA4 指纹轮换） |
| 3019 | `trafilatura-bridge` | go-readability + trafilatura 正文抽取桥 |
| 3020 | `cloak-browser` | 隐身 chromium 反检测渲染（cloak 模式，需 token；缺则 selfTest=false） |

全部 11 mini-services 由 `mini-services/start-all.sh` 一键拉起，端口独占、互不冲突；如改端口
需同步修改各服务 `main.go` 顶部常量 + `start-all.sh` / `stop-all.sh` / `status.sh` 三处端口表。
mini-services 绑 `127.0.0.1:<port>`，仅本机 heis-backend 访问；如需多机部署，配
`AUTH_TOKEN` / `BRIDGE_KEY` 鉴权后对外开放。`bridgeserver` 是 11 个服务共享的 Go 包（917 行），
提供 `/health` / `/metrics` / `/info` / 鉴权 / 限速 / SSRF 守卫 / 安全响应头 / 优雅关闭 /
JSON-IO helper 等通用样板，本身不是独立服务。

## 目录结构

```
go-backend/
├── go.mod                       # Go 模块定义 (module heis-backend, go 1.26, 13 direct deps)
├── go.sum                        # 依赖校验
├── main.go                       # 主后端 (1173 行): 路由 + 86 FuncMap + 静态服务 + DB + 94 模板加载
├── admin.go                      # 后台 API + admin SSR (3570 行): 14 个 admin 页面 + /api/admin/* 14 路由
├── heis-backend                  # go build 输出二进制 (24 MB, 已入 git 平台 clone 即跑; .gitignore 仅兜底防误覆盖)
├── backend.log                   # heis-backend 后台运行日志 (.gitignore, 不入版本库)
│
├── crawl/                        # 采集引擎 (8 模块 9321 行)
│   ├── fetcher.go                #   HTTP 采集 + 8 级降级链 + UA 池 + CookieJar (3615 行)
│   ├── parser.go                 #   css / xpath / regex / json 字段提取 (1612 行)
│   ├── runner.go                 #   4 段采集流程 + 任务调度 + Semaphore (1481 行)
│   ├── cleaner.go                #   广告 / 去壳 / 编码 / 零宽字符剥离 / trafilatura 桥 (804 行)
│   ├── types.go                  #   规则 / 配置 / 结果数据结构 (721 行)
│   ├── hostgate.go               #   并发 + 速率双限速器 (423 行)
│   ├── storage.go                #   db / txt 双存储 + 封面本地化 (355 行)
│   └── smart.go                  #   LLM 智能分类 / 完结判断 + 正则缓存 (310 行)
│
├── services/                     # 11 mini-services + bridgeserver 共享包
│   ├── bridgeserver/bridgeserver.go   # 共享样板 (917 行)
│   ├── bqg713-proxy/main.go           # 3010 (189 行)
│   ├── fetch-relay/main.go             # 3011 (284 行)
│   ├── scrapling-bridge/main.go        # 3012 (470 行) + scripts/scrapling_fetch.py
│   ├── qimao-proxy/main.go             # 3013 (801 行)
│   ├── deqixs-proxy/main.go            # 3014 (366 行)
│   ├── xjp-proxy/main.go               # 3015 (587 行)
│   ├── uc-bridge/main.go               # 3016 (430 行)
│   ├── moli-bridge/main.go             # 3017 (303 行)
│   ├── curl-impersonate-bridge/main.go # 3018 (374 行) + scripts/curl_cffi_fetch.py
│   ├── trafilatura-bridge/main.go     # 3019 (367 行)
│   └── cloak-browser/main.go           # 3020 (689 行)
│
└── templates/                    # 94 个 Go html/template 模板
    ├── admin/                    #   14 个后台页面 (layout + dashboard + tasks + rules + books
    │                             #                   + categories + sites + links + themes
    │                             #                   + downloads + settings + feedback + backup
    │                             #                   + seo-audit; layout 内共享 admin/head +
    │                             #                   admin/sidebar partial)
    ├── aijjxs/                   #   主题 1: 现代 flexbox 风格 (8 页型)
    ├── 101kks/                   #   主题 2
    ├── x2552/                    #   主题 3: 旧 table 风格
    ├── 23qb/                     #   主题 4
    ├── ddyueshu/                 #   主题 5
    ├── huangjinwu/               #   主题 6
    ├── ggd66/                    #   主题 7
    ├── pilishuwu/                #   主题 8: 反爬严, 需 scrapling stealthy
    ├── trxsw/                    #   主题 9
    └── shipsay/                  #   主题 10
        # 每主题 8 页型: home / book / read / category / ranking /
        #              search / keyword / fulltext
```

项目根其它文件：

```
prisma/schema.prisma              # DB schema (11 + 1 表, Go 后端不依赖, 仅 prisma db push 用)
prisma/dev.db                    # 开发库 (R42-1C 留作 fallback; 生产用 db/custom.db)
db/custom.db                     # 运行时 SQLite 库 (WAL 模式, 不入版本库)
mini-services/{start-all.sh,stop-all.sh,status.sh,.gitkeep}  # 11 服务启停脚本
public/clone-css/*.css           # 10 个主题的源站 CSS (由 main.go /clone-css/ 路由服务)
public/{robots.txt,sw.js,manifest.json,icon.svg,logo.svg}   # 站点元数据 (Next.js PWA 残留, 可选)
Caddyfile                        # 沙箱网关 SSRF 防御配置 (端口白名单 3010-3015 + 透传 3000)
agent-ctx/R*-*.md                # 各轮 agent 工作记录 (R38-R47, 21 文件)
worklog.md                       # 完整迁移工作日志 (~18500 行, R3-a → R47-1B 全链路)
DEPLOY.md                        # 生产部署详细教程 (systemd / 反代 / 备份 / 升级 / 故障排查)
README.md                        # 本文件
scripts/rule-yueyouxs.json       # yueyouxs (神马小说) 站点规则 backup-restore 格式 JSON (/api/admin/backup/restore 可导入; R47-1B 替代旧 .ts 种子脚本)
package.json                     # 仅保留 dev script = ./go-backend/heis-backend (平台 `bun run dev` 拉起 Go 后端; R47-1B 确认)
.env.example                     # 环境变量模板 (mini-services AUTH_TOKEN / BRIDGE_KEY / RATE_LIMIT 等)
.env                             # 本机 .env (DATABASE_URL, .gitignore, 不入版本库)
.gitignore                       # Go 构建产物 + 日志 + 运行时数据 + .env* 全忽略 (heis-backend 二进制以 git add -f 强制入 git, .gitignore 仅兜底)
```

## 采集规则配置

### 创建规则

1. 浏览器打开 `http://localhost:3000/admin/rules`
2. 点「新建规则」，填名称 + 描述 + 完整 config JSON（schema 见 `prisma/schema.prisma` 中
   `Rule.config`，四段解析器：`list` / `book` / `toc` / `content` + `fetch` 选项 + `clean` 规则）
3. 保存后点「在线测试」，输入测试 URL 跑一次抓取，引擎按 list → book → toc → content 依次执行
4. 测试通过后启用规则，再到 `/admin/tasks` 创建采集任务挂到此规则

### 参考规则

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

### 8 级降级链（采集引擎核心）

引擎对每个 URL 自动按下列顺序尝试，前级成功则不降级；全部失败才记为抓取失败：

```
1. native              Go 标准库 net/http + utls Hello 指纹池 16 款 (R46-1B, 含 PSK/PQ/Edge)
2. curl                系统 curl 二进制 (JA3 指纹绕过 Cloudflare 基础检测)
3. fetch-relay         3011 中继桥 (代理池轮换)
4. scrapling           3012 Scrapling 桥 (static → stealthy → playwright 三档)
5. cloak-browser       3020 本地 chromium 反检测渲染 (cloak 模式)
6. uc-bridge           3016 UC 头条小说桥
7. moli-bridge         3017 moli 桥
8. curl-impersonate    3018 curl_cffi 桥 (Python 子进程, JA3/JA4 指纹轮换)
```

降级由 `go-backend/crawl/fetcher.go` 统一调度，R43-1B 起每级代理失败会被
`MarkProxyFailed` 标记 cooldown，避免连续踩雷；恢复后 `MarkProxyOK` 清状态。R45-1C 起
`DialTLSContext` 替代 deprecated `DialTLS`，支持 per-attempt timeout ctx cancel 立即断 dial。
R46-1B 起新增 TLS session ticket 缓存（模拟浏览器行为，加速重连）+ 网络层错误不清 utls choice
（仅 TLS handshake 失败才清，避免无效轮换）。

## 反反爬能力（R38–R46 累计）

- **utls Hello 指纹池**：R43-1B 起 4 款 → R45-1A 扩 12 款 → R46-1B 扩 16 款
  （Chrome 102 / 106_Shuffle / 112_PSK_Shuf / 115_PQ / 120 / 120_PQ / 131 / 133 +
  Firefox 99 / 102 / 105 / 120 + Safari 16.0 + iOS 13 / 14 + Edge 85）。
  per-host 钉扎（hash 稳定选取）+ attempts 偏移轮换（失败 N 次后偏移到下一号）。
- **TLS session resumption**：R46-1B 起 `utls.NewLRUClientSessionCache(256)` 缓存
  session ticket，模拟浏览器 ticket cache 行为，加速重连 + 反"无 session ticket"识别。
- **JA3 / JA4 指纹轮换**：utls 不同 Hello 版本 cipher suite 顺序 + 扩展顺序 + GREASE 模式各异，
  反爬无法靠单一 TLS 指纹识别。
- **Cookie 持久化**：per-domain CookieJar，cf_clearance 跨子域合并，Set-Cookie 安全校验。
- **Referer 链伪造**：逐请求注入来源页 URL，模拟浏览器跳转链。
- **重试退避**：full jitter（1.5s × 2^n 封顶 8s）+ Cookie 挑战重试（403 + Set-Cookie 重试 2 次）+
  Token 挑战 HTTP 求解（`let token="..." + location.href=?challenge=`）。
- **拦截识别**：`looksBlocked` / `looksLikeCaptcha` / `isJsChallenge` 启发式判断。
- **SSRF 守卫**：拒绝云元数据 / 私网 / 链路本地，`allowLoopback` 放行内部桥。
- **mirrorDomains 镜像组**：故障切换同站镜像。
- **2captcha 验证码**：R43-1B 起可选，配置 API key 后自动求解 Cloudflare Challenge。
- **代理池**：MarkProxyFailed / OK 健康跟踪 + cooldown，避免连续踩雷。

## 数据备份

数据全部在 `db/custom.db`（WAL 模式）+ `data/`（封面 / TXT 下载产物，不入版本库）：

```bash
# 在线备份 (WAL 模式下 cp 是安全的, 会拿到一致快照)
cp db/custom.db db/custom.db.bak.$(date +%F)

# 定期 VACUUM 回收空间 (长期采集后库膨胀)
sqlite3 db/custom.db 'VACUUM;'

# /admin/backup 一键导出 JSON (含规则 / 站点 / 分类 / 友链 / 设置)
curl -s http://localhost:3000/api/admin/backup > backup-$(date +%F).json
```

## 免责声明

1. 本项目仅供**学习与研究**用途，**不得用于商业用途**。
2. 采集功能请仅用于你有权访问的目标站点，使用时请**遵守目标站点的服务条款 / robots 协议**，
   合理控制访问频率，勿对目标站点造成干扰。
3. 通过本项目采集到的全部内容（文字 / 封面等）**版权归原作者及原网站所有**；请勿传播、转载或
   转售采集所得数据。
4. 因使用本项目而产生的任何法律问题与责任，由**使用者自行承担**；项目作者与贡献者不对任何
   滥用行为负责。
5. 若你是站点所有者、不希望被本项目内置规则采集，请提交 issue 说明，我们会在后续版本移除对应
   规则。

---

**项目版本**：R47-1B（纯 Go 栈，自 R38 起从 Next.js 全面迁移完成）。详细部署见 [DEPLOY.md](./DEPLOY.md)，
完整工作日志见 [worklog.md](./worklog.md)（~18500 行，R3-a → R47-1B 全链路）。
