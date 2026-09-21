# HEIS 小说管理系统 — Go 后端部署文档

> **本文件覆盖 Go 重写后的部署链路**（R38–R43 完整迁移）。原 Next.js/Bun + Docker 部署链路已被
> 替换：主后端 `go-backend/main.go`（heis-backend，:3000）+ 12 个 Go mini-services（端口
> 3010–3020，已 R43-1C 全删旧 TS/Python 版本）。Go 二进制单文件部署，**无 cgo、无 Bun、无
> Node、无 Docker 依赖**，运行期内存 17 MB（vs 旧 Next.js 2.2 GB），单机即可承载。

---

## 一、环境要求

### 1.1 软件依赖

| 组件 | 版本 | 说明 | 下载 |
| --- | --- | --- | --- |
| **Go 工具链** | **1.23+**（go.mod 声明 1.26） | 编译主后端 + 12 mini-services，纯 Go 标准库即可，**无 cgo** | https://go.dev/dl/ |
| **SQLite 驱动** | modernc.org/sqlite v1.59.0 | 纯 Go 实现，无 cgo/系统 lib 依赖，`go build` 直接产出可移植二进制 | 已在 go.mod |
| **curl** | 任意版本 | mini-services 健康探针 + 采集降级链用，Linux/macOS 系统自带 | 系统 |
| **bash** | 4+ | `mini-services/*.sh` 启动脚本依赖（macOS 默认 bash 3 需 `brew install bash`） | 系统 |
| **Prisma CLI**（可选） | 5+ | 仅当需要 `prisma db push` 重新建表时才需要；Go 后端启动会直接打开/读取既有 SQLite 文件，不依赖 Prisma | https://www.prisma.io/ |

> **Go 版本说明**：go.mod 声明 `go 1.26`，但所有源码仅使用 Go 1.21+ 标准库 API；Go 1.23 及以上
> 均能编译通过。下载地址：https://go.dev/dl/ ，选 `go1.23.x.linux-amd64.tar.gz` 解压到
> `/usr/local/go` 或 `~/go`，`export PATH=$PATH:/usr/local/go/bin`。

### 1.2 硬件建议

| 资源 | 最低 | 推荐 | 备注 |
| --- | --- | --- | --- |
| **内存** | 256 MB | **4 GB** | Go 主后端运行期 17 MB；4 GB 是为同时跑 12 mini-services + 采集并发 + 浏览器桥（cloak-browser/scrapling 可选启 chromium 时吃内存） |
| **磁盘** | 1 GB | 5 GB | Go 二进制 24 MB × 13 ≈ 312 MB；SQLite 库 + 封面 + TXT 下载产物随书籍数线性增长 |
| **CPU** | 1 核 | 2 核 | 单核足以承载采集 + SSR，2 核更流畅 |
| **对比旧 Next.js** | — | — | 旧版本 Next.js standalone 运行期 2.2 GB（Turbopack 构建峰值超 2 GB，2 GB 机器直接 OOM）；Go 版本运行期 17 MB，**OOM 风险消失** |

### 1.3 端口规划

| 端口 | 进程 | 用途 |
| --- | --- | --- |
| **3000** | `heis-backend`（go-backend/main.go） | 主后端：前台 SSR + /admin 后台 + /api/public/* + /api/admin/* + 静态资源 /clone-css/* |
| 3010 | bqg713-proxy | 笔趣阁 token/AES 站点签名代理 |
| 3011 | fetch-relay | 通用 HTTP 中继桥（降级链 3 级） |
| 3012 | scrapling-bridge | Scrapling 抓取桥（static/stealthy/playwright，含可选 Python 子进程） |
| 3013 | qimao-proxy | 七猫签名 + AES 解密代理 |
| 3014 | deqixs-proxy | 得奇 xs 站点代理 |
| 3015 | xjp-proxy | xjp 站点代理 |
| 3016 | uc-bridge | UC 头条小说桥 |
| 3017 | moli-bridge | moli 桥（依赖外部 moli 二进制，未装时 selfTest=false，不阻塞） |
| 3018 | curl-impersonate-bridge | curl_cffi 桥（Python 子进程可选；缺则 selfTest=false） |
| 3019 | trafilatura-bridge | go-readability + trafilatura 正文抽取桥 |
| 3020 | cloak-browser | 隐身 chromium 反检测渲染（cloak 模式，需 token；缺则 selfTest=false） |

> 全部 12 mini-services 由 `mini-services/start-all.sh` 一键拉起，端口独占、互不冲突；如改端口需
> 同步修改各服务 `main.go` 顶部常量 + `start-all.sh`/`stop-all.sh`/`status.sh` 三处端口表。

---

## 二、快速开始（5 分钟跑起来）

### 2.1 编译主后端

```bash
cd /home/z/my-project/go-backend
go build -o heis-backend .
# 产出二进制 heis-backend (24 MB, 静态链接, 无外部依赖)
# macOS/Linux 通用; Windows 用 GOOS=windows go build -o heis-backend.exe .
```

### 2.2 初始化数据库

Prisma schema 已位于 `prisma/schema.prisma`（11 张表：Category/Rule/Book/Chapter/BookTag/
Task/TaskLog/Site/DownloadJob/Setting/FriendLink + R40 新增 Feedback）。两条路径任选其一：

```bash
# 路径 A: 用 Prisma CLI 建表（推荐，schema 单一来源）
cd /home/z/my-project
echo 'DATABASE_URL=file:./db/custom.db' > .env
bunx prisma db push     # 或 npx prisma db push; bunx 无需全局安装

# 路径 B: 直接用既有 SQLite 文件（首次启动若 db/custom.db 不存在, heis-backend 会
# 自动回落到 prisma/dev.db; 都没有时 Go 后端启动会报错 —— 此时执行路径 A 建表）
mkdir -p db
# 如果有现成备份 db/custom.db 直接放进去即可, Go 后端启动时会自动 open
```

### 2.3 启动主后端

```bash
cd /home/z/my-project/go-backend
./heis-backend
# 控制台输出:
#   数据库: /home/z/my-project/db/custom.db
#   已加载 94 个模板
#   heis-backend 启动: http://localhost:3000 (内存 17MB)
```

> 后台运行用 `nohup ./heis-backend > backend.log 2>&1 &`；停止 `pkill -f heis-backend`。
> 进程启动后监听 `:3000`，根路径 `/` 渲染前台首页（`?view=home`），`/admin` 渲染管理后台。

### 2.4 启动 12 mini-services

```bash
cd /home/z/my-project
bash mini-services/start-all.sh
# Phase 1: 增量构建 (源码 mtime > 二进制 mtime 才重建; 首次跑会构建全部 12 个)
# Phase 2: 启动 + ≤3s /health 探针 (200 = OK, 失败 WARN 不阻塞)
# 输出 PID 写到 .zscripts/<svc>.pid, 日志写到 .zscripts/<svc>.log
```

`start-all.sh` 是幂等的：再次执行只补启未在跑的服务，已在跑的（`/health` 返回 200）自动跳过。

### 2.5 验证

```bash
# 主后端
curl -s http://localhost:3000/health         # 200 OK
curl -s http://localhost:3000/               # 前台首页 HTML
curl -s http://localhost:3000/admin         # 管理后台 HTML

# 12 mini-services 状态
bash mini-services/status.sh
# 期望: 11 行全 ALIVE 200 (其中 moli/cloak/trafilatura selfTest=false 是预期, 见第六节)
```

---

## 三、配置

### 3.1 数据库

| 项 | 值 | 说明 |
| --- | --- | --- |
| 默认路径 | `db/custom.db`（项目根） | `main.go:42` 优先找此文件；不存在则回落 `prisma/dev.db` |
| DSN | `file:./db/custom.db` | `.env` 中 `DATABASE_URL`，仅供 Prisma CLI 用；Go 后端直接 `sql.Open("sqlite", dbPath)`，不读 `.env` |
| 模式 | **WAL** | SQLite 默认开启 WAL 模式，支持并发读 + 单写，采集并发下不会锁库 |
| 备份 | `cp db/custom.db db/custom.db.bak.$(date +%F)` | 在线备份安全（WAL 模式下 `cp` 即可获一致快照） |
| 压缩 | `sqlite3 db/custom.db 'VACUUM;'` | 长期采集后库文件膨胀，定期 VACUUM 回收空间 |

### 3.2 站点配置（站群）

通过 `/admin/sites` 后台管理：

- **domain**：站点域名（含端口亦可，例 `www.a.com` 或 `novel.example.com:3000`）
- **themeId**：前台主题（10 选 1：`aijjxs`/`101kks`/`x2552`/`23qb`/`ddyueshu`/`huangjinwu`/`ggd66`/`pilishuwu`/`trxsw`/`shipsay`）
- **TDK + SEO/GEO**：title/description/keywords + ICBM 坐标 + geoRegion/geoPlacename
- **footerText / footerCopyright / footerIcp**：自定义页脚文案 + 版权 + ICP 备案号
- **chapterPaginationMode**：章节分页（off / byWords 按字数 / byPages 按页数）
- **pseudoStaticStyle**：伪静态 URL 风格（query / numeric / alphanumeric / slug / short / classic / dir）
- **isDefault**：默认站点（访问 `/` 不带 `?site=` 时回落到此站）
- **inLinkWheel**：是否参与其他站点页脚互链（站群链轮）

前台访问：`http://localhost:3000/?view=home&site=<siteId>`（不传 site 走 default）。

### 3.3 采集规则

通过 `/admin/rules` 后台管理：

- 每条规则一份完整 JSON 配置（`config` 字段），包含四段解析器：`list` / `book` / `toc` / `content`，
  外加 `fetch`（采集选项）与 `clean`（清洗规则）。
- 支持的提取器：`css` / `xpath` / `regex` / `json` / `const`。
- 支持的清洗：广告模式（正则删除广告块）、去壳页（提取主容器）、编码识别（GBK 自动转 UTF-8）。
- 提供「极限校准」功能：对模拟源站的三档封禁策略实测安全并发 + 速率，推荐参数一键写回规则。
- 启用 `tokenUrl` 钩子时，引擎会调对应 mini-service（如 bqg713-proxy）拿 token / 签名 / AES 解密。

### 3.4 mini-services 启停

| 命令 | 作用 |
| --- | --- |
| `bash mini-services/start-all.sh` | 增量构建 + 后台启动 12 个服务 + 健康探针 |
| `bash mini-services/stop-all.sh` | SIGTERM 5 s grace + SIGKILL 兜底；PID 文件丢失走 `lsof`/`fuser` 按端口找 |
| `bash mini-services/status.sh` | 11 行表格（SERVICE/PORT/PID/PROCESS/HEALTH/SELFTEST）；全 ALIVE 退出码 0，任一 DOWN 退出码 1 |
| `tail -f .zscripts/<svc>.log` | 实时看某服务日志 |
| `tail -f .zscripts/<svc>.build.log` | 看某服务构建失败日志（若构建挂了） |

**Go 工具链路径解析顺序**：`start-all.sh` 优先用 `/home/z/go/bin/go`（sandbox 内置），找不到则回退
`PATH` 中的 `go`，都没有时报错退出。CI 环境用 `export PATH=$PATH:/usr/local/go/bin` 即可。

---

## 四、采集规则配置

### 4.1 创建规则

1. 浏览器打开 `http://localhost:3000/admin/rules`
2. 点「新建规则」，填名称 + 描述 + 完整 config JSON（schema 见 `prisma/schema.prisma` 中 `Rule.config`）
3. 保存后点「在线测试」，输入测试 URL 跑一次抓取，引擎会按 4 段解析器依次执行 list→book→toc→content
4. 测试通过后启用规则，再到 `/admin/tasks` 创建采集任务挂到此规则

### 4.2 参考规则

历史参考脚本位于 `scripts/seed-rule-*.ts`（22 个站点规则种子，已 R43-1C 删除 src/ 同时一并清理；
如需重新入库，请用 `docker/autofill-rules.json`（已备份的 7 个站点规则）或后台手动新建）：

| 站点 | 规则关键点 |
| --- | --- |
| 番茄 fanqie | 静态 HTML，CSS 提取；tokenUrl 走 bqg713-proxy |
| 七猫 qimao | 静态 + AES 加密内容，qimao-proxy 解密 |
| 得奇 deqixs | 静态 HTML，CSS 提取；走 deqixs-proxy |
| 八零 80ge | 静态 HTML |
| 精华 jinghua | 静态 HTML |
| 笔趣阁 bqg713 | token + AES，bqg713-proxy 全套 |
| xjp | 静态 HTML，xjp-proxy |
| 霹雳 pilishuwu | 反爬严，必须 scrapling-bridge 3012 stealthy/playwright 模式 |

### 4.3 8 级降级链（采集引擎核心）

引擎对每个 URL 自动按下列顺序尝试，前级成功则不降级；全部失败才记为抓取失败：

```
1. native        Go 标准库 net/http + utls Hello 指纹池 (R43-1B)
2. curl          系统 curl 二进制 (JA3 指纹绕过 Cloudflare 基础检测)
3. fetch-relay   3011 中继桥 (代理池轮换)
4. scrapling     3012 Scrapling 桥 (static → stealthy → playwright 三档)
5. Obscura       本地 chromium 反检测渲染 (cloak 模式)
6. uc-bridge     3016 UC 头条小说桥
7. moli-bridge   3017 moli 桥
8. curl-impersonate  3018 curl_cffi 桥 (Python 子进程, JA3/JA4 指纹轮换)
```

降级由 `go-backend/crawl/fetcher.go` 统一调度，R43-1B 起每级代理失败会被
`MarkProxyFailed` 标记 cooldown，避免连续踩雷；恢复后 `MarkProxyOK` 清状态。

---

## 五、预览

部署完成 + 12 mini-services 全 ALIVE 后，浏览器访问：

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/` | 默认站点首页（isDefault=true 的 Site） |
| `http://localhost:3000/?view=home` | 同上，显式带 view 参数 |
| `http://localhost:3000/?view=home&site=<siteId>` | 指定站点首页 |
| `http://localhost:3000/?view=book&id=<bookId>` | 书籍详情页 |
| `http://localhost:3000/?view=read&id=<bookId>&ch=<chapterIdx>` | 阅读页 |
| `http://localhost:3000/?view=category&cat=<categoryId>` | 分类列表页 |
| `http://localhost:3000/?view=ranking` | 排行榜 |
| `http://localhost:3000/?view=search&q=<keyword>` | 搜索结果页 |
| `http://localhost:3000/?view=fulltext&q=<keyword>` | 全文搜索 |
| `http://localhost:3000/?view=keyword&tag=<tag>` | 关键词（标签）聚合页 |
| `http://localhost:3000/admin` | **管理后台**（任务/规则/书籍/章节/站点/分类/友链/主题/下载/设置/反馈/备份/SEO 审计） |

> ⚠️ **后台无登录鉴权**：管理端 `/admin` 当前不要求登录，请勿直接暴露公网。生产环境务必前面套
> 反向代理（Nginx/Caddy）做 Basic Auth + IP 白名单，或仅放内网访问。

---

## 六、架构图（文字版）

```
                       用户浏览器
                          │
                          ▼
              ┌───────────────────────┐
              │  Go heis-backend :3000 │  (go-backend/main.go, 1173 行)
              │  ───────────────────  │
              │  静态资源 /clone-css/* │  (源站 CSS, public/clone-css/*.css)
              │  前台 SSR 94 个模板    │  (10 主题 × 8 页型 + 14 admin)
              │    10 主题:           │
              │      aijjxs 101kks   │
              │      x2552  23qb     │
              │      ddyueshu        │
              │      huangjinwu      │
              │      ggd66 pilishuwu │
              │      trxsw  shipsay  │
              │    8 页型:           │
              │      home book read │
              │      category ranking│
              │      search keyword  │
              │      fulltext        │
              │    14 admin:         │
              │      layout dashboard│
              │      tasks rules books│
              │      categories sites │
              │      links themes     │
              │      downloads settings│
              │      feedback backup  │
              │      seo-audit        │
              │  API 路由:            │
              │    /api/public/* 6 个 │
              │    /api/admin/* 14 个 │
              │  DB: SQLite WAL       │
              │    db/custom.db      │
              └───────────┬───────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  采集引擎 crawl/        │  (8296 行 Go)
              │  ───────────────────  │
              │  fetcher.go  2743 行  │  ← 8 级降级链总调度
              │  parser.go   1612 行  │  ← css/xpath/regex/json 提取
              │  runner.go   1436 行  │  ← 4 段采集流程 + 任务调度
              │  cleaner.go   722 行  │  ← 广告/去壳/编码/trafilatura
              │  types.go     715 行  │  ← 规则/配置/结果数据结构
              │  hostgate.go  414 行  │  ← 并发 + 速率双限速器
              │  storage.go    363 行  │  ← db/txt 双存储 + 封面本地化
              │  smart.go     291 行  │  ← LLM 智能分类/完结判断
              │                       │
              │  反反爬:              │
              │    utls Hello 指纹池  │  (R43-1B)
              │    JA3/JA4 轮换       │
              │    Cookie 持久化      │
              │    Referer 链伪造     │
              │    2captcha 验证码    │  (R43-1B, 可选)
              │    MarkProxyFailed/OK │  (R43-1B 代理健康跟踪)
              └───────────┬───────────┘
                          │
              ┌───────────┴───────────┐
              │  12 Go mini-services   │  (端口 3010-3020)
              │  ───────────────────  │
              │  3010 bqg713-proxy    │  笔趣阁 token+AES
              │  3011 fetch-relay     │  通用 HTTP 中继
              │  3012 scrapling-bridge│  Scrapling 抓取
              │  3013 qimao-proxy     │  七猫 AES 解密
              │  3014 deqixs-proxy    │  得奇代理
              │  3015 xjp-proxy       │  xjp 代理
              │  3016 uc-bridge       │  UC 头条桥
              │  3017 moli-bridge     │  moli 桥
              │  3018 curl-impersonate │  curl_cffi JA3 桥
              │  3019 trafilatura     │  正文抽取桥
              │  3020 cloak-browser   │  隐身 chromium
              │                       │
              │  全部 Go 二进制       │  (R43-1C 删旧 TS/Python 版)
              │  start-all.sh 一键拉起│
              │  /health 自检 + selfTest│
              └───────────────────────┘
```

---

## 七、故障排查

### 7.1 内存 / OOM

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| heis-backend 进程被 OOM Killer 杀 | 极少见，Go 后端运行期 17 MB；如发生通常是 SQLite 大查询 + chromium（cloak-browser/scrapling stealthy 模式）同跑 | `dmesg \| grep -i kill` 确认；升内存到 4 GB；关闭 cloak-browser（status 显示 selfTest=false 即未启动） |
| 旧 Next.js 版本 2.2 GB OOM | 已不存在，Go 版本无此问题 | 迁移到 Go 后端即可，无需任何调优 |
| chromium 吃内存 | cloak-browser :3020 或 scrapling-bridge :3012 stealthy 模式启了 chromium | 采集规则改用 static 模式；或停止 cloak-browser（`bash mini-services/stop-all.sh` 后单删 cloak-browser PID） |

### 7.2 mini-services 异常

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

### 7.3 数据库锁

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| `database is locked` | SQLite 默认 busy timeout 5 s；高并发写偶发触发 | Go 后端已设 WAL 模式 + busy_timeout，正常场景不会锁；如仍触发，调小采集并发（任务编辑页 `threadMax` 改 1-2） |
| 库文件膨胀 | 长期采集 + WAL 日志未 checkpoint | `sqlite3 db/custom.db 'PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'` |
| 备份后无法恢复 | 在线 `cp` 时库正被写 | WAL 模式下 `cp` 是安全的（会拿到一致快照）；如担心可用 `sqlite3 db/custom.db '.backup db/custom.db.bak'` 在线备份命令 |

### 7.4 主后端 :3000 起不来

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

### 7.5 采集失败排查

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

### 7.6 编译失败

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
go vet ./...                   # 应输出 0 warnings (R43-1B/C 已清)
```

---

## 八、生产部署建议

### 8.1 systemd 托管（推荐）

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
```

### 8.2 反向代理（生产必做，因 /admin 无鉴权）

```Caddyfile
# /etc/caddy/Caddyfile (推荐 Caddy, 自动 HTTPS)
novel.example.com {
    basicauth /admin* {
        admin $2a$14$...   # htpasswd 生成
    }
    reverse_proxy localhost:3000
}
```

```nginx
# Nginx 等价配置
server {
    server_name novel.example.com;
    location /admin {
        auth_basic "Admin";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://localhost:3000;
    }
    location / {
        proxy_pass http://localhost:3000;
    }
}
```

### 8.3 备份策略

```bash
# 每日凌晨备份 (crontab -e)
0 3 * * * cp /home/z/my-project/db/custom.db /backup/custom.db.$(date +\%F).bak && \
          sqlite3 /home/z/my-project/db/custom.db 'VACUUM;'

# 保留 7 天
0 4 * * * find /backup -name 'custom.db.*.bak' -mtime +7 -delete

# /admin/backup 一键导出 JSON (含规则/站点/分类/友链/设置)
curl -s http://localhost:3000/api/admin/backup > backup-$(date +%F).json
```

### 8.4 升级

```bash
cd /home/z/my-project
git pull

# 重建主后端
cd go-backend && go build -o heis-backend .

# 重启 mini-services (增量构建会自动识别变更的源码)
cd ..
bash mini-services/stop-all.sh
bash mini-services/start-all.sh

# 重启主后端 (systemd 模式)
sudo systemctl restart heis-backend
```

---

## 九、迁移说明（从旧 Next.js 版本升级）

| 维度 | 旧 Next.js 版本 | Go 版本（当前） |
| --- | --- | --- |
| 运行时 | Node 22 + standalone server.js | Go 二进制 heis-backend |
| 内存 | 2.2 GB（OOM 风险高） | 17 MB（OOM 风险消失） |
| 构建 | Turbopack，峰值 2 GB+ | `go build`，峰值 < 200 MB |
| 部署 | Docker 多阶段 + compose | 单二进制 + bash 脚本，无 Docker |
| 依赖 | Bun + Node + Prisma Client + React 19 | Go 标准库 + modernc.org/sqlite（无 cgo） |
| 前端 | React 19 SSR（src/app/*） | Go html/template（go-backend/templates/*） |
| 模板数 | 173 文件（src/components + src/app） | 94 个（10 主题 × 8 页型 + 14 admin） |
| 采集引擎 | TS（src/lib/crawl/*，8302 行） | Go（go-backend/crawl/*，8296 行） |
| mini-services | 5 Bun + 1 Python（已删） | 12 Go 二进制（端口 3010-3020） |
| 降级链 | 5 级 | **8 级**（+uc/moli/curl-impersonate） |
| 反反爬 | 基础 UA + 代理池 | utls Hello 指纹池 + JA3/JA4 轮换 + 2captcha + Cookie 持久化 |
| 数据库 | Prisma/SQLite | 同（schema 不变，db/custom.db 可直接迁移） |

**升级路径**：
1. 停旧服务：`docker compose down`（旧 Docker 部署）或 `pkill -f 'node server.js'`
2. 保留 `db/custom.db` 和 `public/clone-css/*` 和 `data/*`（封面/TXT 产物）
3. 删除 `src/`、`node_modules/`、`.next/`（已被 R42-1C 清理）
4. 按 §二 编译 + 启动 Go 后端 + 启动 12 mini-services
5. 浏览器访问 `http://localhost:3000/` 验证

数据库 schema 完全兼容，无需迁移；Prisma schema 仅作建表用，Go 后端直接读 SQLite，不依赖 Prisma。

---

## 十、参考

- **架构审计**：`agent-ctx/R43-1A-full-stack-developer.md`（A agent 新增 3 服务）
- **引擎深度审查**：`agent-ctx/R43-1B-full-stack-developer.md`（B agent utls + 2captcha）
- **清理重构**：`agent-ctx/R43-1C-full-stack-developer.md`（删旧 TS/Python mini-services + start-all.sh 重写）
- **完整工作日志**：`worklog.md`（17291 行，R3-a → R43-1C 全链路）
- **数据库 schema**：`prisma/schema.prisma`（11 + 1 表，Feedback R40 新增）
- **采集引擎源码**：`go-backend/crawl/*.go`（8 模块 8296 行）
- **主后端源码**：`go-backend/main.go`（1173 行）+ `go-backend/admin.go`（3562 行）
- **mini-services 源码**：`go-backend/services/*/main.go`（12 个）+ `services/bridgeserver/bridgeserver.go`（共享样板 843 行）

---

**文档版本**：R44-1B（Go 重写后部署链路），对应 worklog.md R38–R43 全程迁移记录。
