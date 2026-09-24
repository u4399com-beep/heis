# HEIS 小说采集与发布系统 — 安装部署图文教程

> **本文件覆盖 Go 重写后的完整部署链路**（R38 → R57 全链路迁移 + R50-1C 重写 +
> R51-1B 校对 + R52-1A/1B + R53-1A/1B + R54-1B/1C + R55-1A admin 全页面 CRUD 补齐 +
> R56-1A 主题模板 1:1 复刻 + R56-1C DEPLOY 重写 + R57-1A/1B 智能 TDK + 噪声清洗深化 +
> **R57-1C 6 主题模板 1:1 复刻续 + DEPLOY 全文重写 + 清理精简**）。
>
> - **主后端** `go-backend/main.go`（heis-backend，:3000）+ 11 个 Go mini-services（端口
>   3010–3020）+ bridgeserver 共享包。Go 二进制单文件部署，**无 cgo / 无 Bun / 无 Node /
>   无 Docker 依赖**，运行期内存 17 MB（vs 旧 Next.js 2.2 GB），单机即可承载。
> - **`heis-backend` 二进制已入 git**（commit `29dcd99`），平台 `git clone` 后零编译直接
>   运行 `./go-backend/heis-backend`。仅当 `go-backend/*.go` 或
>   `go-backend/services/*/main.go` 源码变更时才需重建。
> - **平台 `bun run dev` 实际拉起 `bun start-go.js`**，后者循环
>   `./go-backend/heis-backend`，进程异常退出后 2 s 自动重启。

> **R57-1C 校对说明**：
> - **6 主题模板 1:1 复刻续**（接续 R56-1A 的 5 主题）：当前沙箱网络受限，原可达源站
>   （aijjxs/ddyueshu/ggd66/23qb/101kks）与不可达源站（pilishuwu 403 / huangjinwu
>   shipsay x2552 trxsw 超时或不可达）本次全数走 CSS 选择器审计 + 与同源笔趣阁/wmcms
>   参考结构对比，定位并修复 9 处真 bug：
>   · **ddyueshu 3 处**：search.html `.l .s5` 字数→日期 + search.html `.r` 列结构 3 spans
>     → 5 spans (s1/s2/s3/s4/s5 与 home.html `.r` 对齐) + ranking.html `.novelslist .s5`
>     字数→日期 + fulltext.html `.novellist li` 多余 `{{wordCount}}` 删除
>   · **pilishuwu 1 处**：home.html `.mod-cover-list-text` (100px nowrap 椭圆 ellipsis
>     = chapter title slot per CSS) 显示 `{{wordCount}}` → 改 `{{if .latestChapter}}...
>     {{else}}第1章{{end}}`，与同主题其他 4 模板（category/fulltext/search/keyword/book）
>     的 `.mod-cover-list-text` 同口径
>   · **x2552 4 处**：home.html `.update li` 多余 dangling `{{wordCount}}` 字数 → 改
>     `{{fmtDateMD .updatedAt}}` 日期（同源笔趣阁 `.update li` 末位 loose text 右对齐
>     = 日期 slot） + home.html `.ultop li <p>` (绝对定位 top-right 数字 slot) 2 处
>     `{{wordCount}}` → `{{add $i 1}}` 排名序号 + book.html `.ultop li <p>` 1 处
>     `{{wordCount}}` → `{{add $i 1}}`
>   · **huangjinwu / shipsay / trxsw 3 主题**：CSS 为项目自创（非源站克隆）+ 同主题内
>     结构自洽，无 bug 需修
> - **DEPLOY 全文重写**：14 节全面校对，所有 LoC 表 / agent-ctx 文件数 / worklog 行数 /
>   模板数同步。LoC 同步 main 1428→1522（R57-1B 智能 TDK 新增 chapterSeoAuto +
>   computeChapterSeo +94 行） / runner 1558→1575（R57-1B BUG-G/H 衔接） / cleaner
>   914→941（R57-1B BUG-G chapterHeadCNRe 改 `<<>>` 边界 + BUG-H Normalize 段落 wrap
>   +27 行）/ 总 crawl 10868→10882 / admin 4555（不变） / 模板 94（不变）。反反爬清单
>   保持 41 项（R57 未引入新反反爬能力，仍为 R56-1C 版本）。
> - **清理精简**：
>   · `go-backend/r57probe/`（R57-1B 综合探针脚本：采集规则 + 智能化 + 噪声清洗三轮
>     深度审计临时 probe，37 KB / 1 文件）删除
>   · `go-backend/sites_tmp_main.go.bak`（R42 主后端迁移期遗留 .bak 备份）删除
>   · `go-backend/backend.log`（nohup 临时输出，183 字节，运行期会再生成但
>     `.gitignore` 已忽略 `*.log` + `go-backend/*.log`）删除
>   · `go-backend/go-backend/heis-backend`（嵌套子目录的旧二进制副本，24 MB，疑似
>     早期 `go build -o go-backend/heis-backend .` 在错误 cwd 跑出的产物）删除
>   · `.gitignore` 增强：新增 `go-backend/r57probe/` + `go-backend/*.bak` +
>     `go-backend/*_tmp_*.go` 三条规则，防未来误入库
> - **go build + go vet 全 0**（staticcheck 未安装在本机，但 R56-1C 已修唯一 SA9003 真
>   问题 storage.go:351，R57 未引入新代码 smell）。

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
13. [迁移说明（从旧 Next.js 版本升级）](#十三迁移说明从旧-nextjs-版本升级)
14. [参考](#十四参考)

---

## 一、项目介绍

**HEIS（Heis）小说采集与发布系统** 是一套基于**纯 Go** 的规则驱动型小说采集 + 站群发布
系统：管理员在 `/admin` 后台配置站点规则与采集任务，引擎按规则抓取（**8 级降级链 +
41 项反反爬增强 + utls 36 款 Hello 指纹池 + 3 captcha 服务级联**）→ 清洗 → 落库；
前台站群（书城 / 书籍详情 / 阅读页 / 搜索 / 分类 / 排行榜 / 关键词聚合 / 全文搜索）
直接消费库内数据，封面图 `/covers/<name>` 走 SVG 占位兑底（不存在则返回渐变色块 +
书名首字）。

### 1.1 技术栈

| 层 | 技术 |
| --- | --- |
| 主后端 | Go 1.23+ + `net/http` 标准库（go.mod 声明 1.26，但 1.21+ API 即可编译） |
| 模板 | `html/template`（94 个 = 10 主题 × 8 页型 + 14 admin） |
| 数据库 | modernc.org/sqlite v1.59.0（纯 Go SQLite，**无 cgo**）+ Prisma schema（仅建表用） |
| 采集引擎 | `go-backend/crawl/*.go`（8 模块 10882 行，纯 Go 标准库 + goquery + utls + chromedp） |
| mini-services | `go-backend/services/*/main.go`（11 个独立 Go 二进制，端口 3010–3020）+ bridgeserver 共享包（917 行） |
| 部署 | 单二进制 + bash 脚本（start-all.sh / stop-all.sh / status.sh），**无 Docker / 无 compose** |

### 1.2 核心能力

- **单二进制部署**：`go build -o heis-backend .` 产出 24 MB 静态链接二进制，运行期 17 MB
  内存（vs 旧 Next.js 2.2 GB，OOM 风险消失），单机即可承载。
- **采集引擎**（`go-backend/crawl/` 8 模块 10882 行）：规则四段（list / book / toc /
  content）解析、CSS / XPath / regex / JSON 字段提取、分页与翻页 Referer 链、编码识别
  （GBK 自动转 UTF-8）、正文清洗（广告 / 去壳页 / 零宽字符剥离 / trafilatura 桥）、
  分卷排序、并发限速 + HostGate 双限速、封面本地化（webp）。
- **8 级降级链**：native（utls 36 款 Hello 指纹池含 PSK / PQ / 老 iOS / Chrome 老版 /
  Firefox 老版 ESR / 2016 era Chrome 58）→ curl（系统二进制 JA3 指纹）→ fetch-relay 中继桥
  → Scrapling 桥（static / stealthy / playwright 三档）→ cloak-browser 隐身 chromium
  反检测渲染 → uc-bridge UC 头条桥 → moli-bridge moli 桥 → curl-impersonate curl_cffi
  JA3/JA4 桥，按站点防护级别自动降级，前级成功不降级。
- **41 项反反爬**：utls Hello 指纹池 36 款 + per-host 钉扎 + attempts 偏移轮换 + TLS
  session ticket 缓存（LPU 256 + 磁盘 persistable + snapshot+IO + dirtyVersion +
  atomicWriteFileSync fsync + StartTlsSessionBackgroundFlusher + corruption recovery +
  disk cap）+ JA3/JA4 轮换 + Cookie 持久化（cf_clearance 跨子域合并 + stripPort 跨端口）
  + Referer 链伪造 + 重试退避（full jitter）+ Cookie/Token 挑战求解 + looksBlocked /
  looksLikeCaptcha 启发式拦截 + 3 captcha 服务级联（2captcha + anti-captcha + CapSolver）
  + sitekey 三属性名 + JS 变量 fallback + captcha 连续 3 次失败 60 s cooldown + captcha
  主备自动切换 + 代理池（MarkProxyFailed / OK 健康跟踪 + cooldown + 5 endpoint 轮选 probe
  + latency 跟踪 + least-latency 旋转策略 + weighted-latency + pickFailStreak 业务失败
  跟踪 + dead proxy quarantine + ProxyStatsSnapshot admin 查询）+ brotli miss 计数 +
  probe target 轮换 + 主动 probe 5 min 间隔 + 3 次失败冷却 + SSRF 守卫 + mirrorDomains
  镜像组 + per-host UA 钉扎 + CookieJar 跨子域合并 + 网络层错误不清 utls choice + Token
  挑战 HTTP 求解 + Cookie 挑战重试 + TLS handshake 失败清 utls + 行为模拟 Gaussian 微抖
  + micro wheel events + 15% 概率 Tab key + native wheel + Esc 键 + Page Down 键 + Enter
  键 + 双击 + 反向滚动 + cloak-browser page.AddScriptToEvaluateOnNewDocument（详见 §9.5）。
- **站级签名 / 解密代理**：对 token / 签名 / AES 类站点（笔趣阁 / 七猫 / 得奇 / xjp 等）
  以外置 Go mini-service 承载，引擎 `tokenUrl` 钩子对接。
- **智能 TDK**（R57-1A/1B 新增）：章节阅读页 `chapterSeoAuto=true` 时，引擎调
  `computeChapterSeo` 按 `chapterSeoTitleTemplate` 模板（占位符 `{bookName}` /
  `{chapterTitle}` / `{author}` / `{category}` / `{siteName}`）+ `chapterSeoDescTemplate`
  生成动态 `<title>` / `<meta description>` / `<meta keywords>`，每章独立 SEO 优化，
  避免千章一面被搜索引擎降权。`chapterSeoAuto=false` 时回落到用户配置的静态 TDK。
- **管理端**：14 个后台模板（12 admin 功能页面 + dashboard 看板 + layout 框架）：
  - **dashboard** 看板（统计 + 趋势图 + 健康度）
  - **tasks** 采集任务（单书 / 批量 / 实时 / 定时增量 autoRefresh，**R55-1A 补删除**）
  - **rules** 采集规则（CRUD + 在线测试 + 极限校准，**R55-1A 补编辑全 config + 删除**）
  - **books** 书籍 / 章节管理（**R55-1A 补新建 / 编辑 / 删除含级联清章 / 标签 / 下载**）
  - **categories** 分类管理（15 个标准 4 字分类，CRUD + 拖拽排序）
  - **sites** 站点（站群，**R55-1A 补新建 / 编辑 / 删除含主题切换面板**）
  - **links** 友情链接（CRUD + 链轮配置）
  - **themes** 主题（**R55-1A 补 per-site 主题切换面板**）
  - **downloads** TXT 下载任务（**R55-1A 补删除含内存缓存清理**）
  - **settings** 全局设置（**R55-1A 补删除单个 key，feedbackEnabled 受保护**）
  - **feedback** 用户反馈（详情 / 状态 / 删除 / PATCH adminNote 回复）
  - **backup** JSON 备份 / 恢复（**R55-1A 补清空采集产物，保留基础设施**）
  - **seo-audit** SEO 审计（**R55-1A 补修复入口深链**）
  - **layout** 框架模板（admin sidebar + head 共享）
- **前台**：10 主题站群（aijjxs / 101kks / x2552 / 23qb / ddyueshu / huangjinwu /
  ggd66 / pilishuwu / trxsw / shipsay，每主题 8 页型 = 80 文件 + 14 admin = 94 模板），
  主题注册表驱动，阅读页 / 搜索 / sitemap / 伪静态链接（query / numeric / alphanumeric
  / slug / short / classic / dir）/ 章节分页（off / byWords / byPages）/ 站群链轮
  （inLinkWheel）/ 自定义 TDK + ICBM 坐标 + geoRegion / geoPlacename。
- **封面图 SVG 占位**（R52-1A）：模板封面 URL 走绝对路径 `/covers/<name>.webp`，
  main.go `/covers/` handler 三段式服务：①`data/covers/<name>` → ②`public/covers/<name>`
  → ③SVG 占位图（渐变色块 + 书名首字 96px 白字）。采集中 SaveCoverWebp 落盘到
  `data/covers/<name>.webp`，模板 `<img src="{{.cover}}">` 拿到 `/covers/<name>.webp`
  绝对路径；不存在走 SVG 占位，浏览器渲染不裂图。
- **分类名 4 字化**（R52-1A）：标准分类从 2 字 (玄幻/武侠/...) 改 4 字 (玄幻奇幻/武侠江湖/...)
  共 15 个，与 DB schema 一致。`NormalizeCategory` 三段式归一化：①精确别名命中 →
  ②标准 4 字名直接返回 → ③模糊包含匹配 (源站名含 4 字名 → 合并)。原 2 字源站分类
  通过 `categoryAliases` 兜底转 4 字（兼容旧源站未升级场景）。
- **updatedAt 格式化修复**（R53-1B）：Prisma `@updatedAt` 把 DateTime 写成 Unix ms
  时间戳（13 位整数字符串），原 `fmtDate` / `fmtDateShort` / `shortTime` 三处模板/工具函数
  直接 `s[:10]` / `s[5:7]+s[8:10]` 切片会把时间戳切成残片。修复后三处全部先调用
  `formatUpdatedAt(s)` 归一化（Unix ms → `"2006-01-02 15:04"`）再切片，admin dashboard /
  tasks / rules / books 多页端到端实测从 `"16560/71510/04577"` 时间戳残片修复为
  `"09-15 23:56"` 正常日期。R56-1A 新增 `fmtDateMD` FuncMap（返回 `MM-DD` 带连字符，
  用于源站列表日期 slot），同样先经 `formatUpdatedAt` 归一化。
- **智能分类 / 完结检测**（R54-1B）：`SmartCategory`（source + keyword 两层 + 4 级启发式
  + `[]rune` 安全截断）+ `SmartCompleteDetect`（源站状态字段 → 简介 → 末章标题 → 书名
  标注 四级启发式）。修复 BUG-A (P0)：SmartCategory 从未被调用 + parsed.Category 未消费
  + Book.categoryId 始终空；BUG-B (P1)：detectedStatus 计算在 UpsertBook 之后，新建书
  status 写死 "unknown"。
- **噪声清洗增强**（R49-1B + R54-1B + R57-1B）：`NormalizeParagraphs` 预规范化换行 + Unicode
  空格归一化（NBSP / Ogham / U+2000-U+200A / U+202F / U+205F / U+3000）+
  `CcAndZwStripRe` 扩展 13 类不可见字符（DEL / C1 / LRM/RLM / SHY / LSP/PSP / invisible
  operators / Bidi isolate）+ plainText `</a>` → `\n\n` 双换行段独立 + 新增
  `stripPlainTextPromoSegments` 函数（段级 navLinkRe / watermarkRe / chapterTailRe
  整段剥离）+ HTML hidden 元素剥离（`hidden` 属性 + style display:none/visibility:hidden）
  + `EXTRA_AD_PATTERNS` 扩展（R54-1B 修复 BUG-D 漏 "本站..." 法律免责 + "请收藏本站...手机版"
  CTA + "本站最新网址" 通知类水印共 8 条；R56-1B 修复 BUG-F `本站小说由程序自动索引`
  模式漏 `<>` 排除导致 HTML 标签误吞；R57-1B 修复 BUG-G `chapterHeadCNRe` 原用 `\b` ASCII
  词边界对中文无效，改 `<<>>` Unicode 边界 + BUG-H Normalize 末段 `<p>` 包裹位置错位）+
  `DefaultCleanConfig.AdPatterns` 修复 BUG-C（量词全可选 `[（(]?完?本[网站站][）)]?` 误伤正文
  → 改 `[（(]完?本[网站站][）)]` 要求括号包围）。
- **模板硬编码 missing-asset 修复**（R54-1C）：x2552 + 101kks 两套主题共 25 处硬编码
  `<img src="/heibing/images/logo.png">` / `<img src="/images/user.png">` /
  `<img src="/images/logo_index.png">` 引用 `public/` 下根本不存在的源站克隆资产，
  运行时全部 404 走到 `homeHandler` 返回 HTML 而非图片 → 浏览器渲染裂图。修复：全部
  替换为内联 `data:image/svg+xml;base64,...` 占位 SVG（180×60 蓝底「小说站」/ 36×36 灰圆
  通用头像 / 280×60 蓝底「小说阅读网」三款），模板自洽，不再依赖 `public/heibing/` 与
  `public/images/` 缺失目录。x2552.css 仍引用源站 `/heibing/images/wamcc.png` 雪碧图作为
  多处背景，属于已知未替换克隆限制（见 §11.8）。
- **后台全页面 CRUD 补齐**（R55-1A）：12 admin 功能页面逐一审计 CRUD 完备度，补齐
  缺失的 create/edit/delete：tasks +删除任务（停 runtime + 清 TaskLog）/ books +新建/编辑/
  删除（级联清 Chapter / BookTag / DownloadJob + 内存下载缓存）/ rules +编辑全 config + 删除
  （校验任务引用）/ sites +新建/编辑/删除（含主题切换面板 + isDefault 互斥保护）/
  themes +per-site 主题切换（PUT /api/admin/sites/:id {themeId}）/ downloads +删除（清
  内存缓存 + DB 行）/ settings +删除单个 key（feedbackEnabled 受保护返 400）/ backup
  +清空采集产物（POST /api/admin/backup/clear {confirm:true} 保留基础设施 Site / Category
  / Rule / Setting）/ seo-audit +修复入口深链（→ /admin/sites/links/books）+ 每 report
  card +🔧 编辑按钮。
- **填充 100 本不同类型书籍**（R55-1A dev 一次性填充）：DB schema 支持预填充 15 个
  标准 4 字分类 × ~7 本 / 分类 = 100 本书种子数据，前台每个分类页都有书可看，不空。
  注意：`db/custom.db` 不入版本库（`.gitignore` 已忽略 `db/*.db`），全新 clone 后 Book
  表为 0，需通过 `/admin/books` 后台（R55-1A 补全 CRUD）或 `/api/admin/backup/restore`
  一键导入 backup JSON 重新填充。
- **6 主题模板 1:1 复刻续**（R57-1C 接续 R56-1A）：R56-1A 修了 aijjxs / ggd66 / 23qb /
  101kks + ddyueshu home + trxsw home；R57-1C 续审 ddyueshu (剩 7 模板) + pilishuwu +
  huangjinwu + shipsay + x2552 + trxsw 共 6 主题 × 8 页型 = 48 模板，定位 9 处真 bug 全部
  修复（详见 §8.4 与 §11.8）。

### 1.3 数据规模（DB 实测）

| 实体 | 数量 | 说明 |
| --- | --- | --- |
| **Site** | 12 | 10 套主题 × 多个 Site 实例（站群）+ 1 默认站点（isDefault=true） |
| **Category** | 15 | 15 个标准 4 字分类（玄幻奇幻 / 奇幻魔幻 / 武侠江湖 / 仙侠修真 / 都市生活 / 言情小说 / 历史军事 / 军事战争 / 游戏竞技 / 科幻未来 / 悬疑推理 / 灵异鬼怪 / 体育竞技 / 轻小说类 / 现实生活） |
| **Rule** | 71 | 53 条 enabled + 18 条 disabled（list-only 发现规则 + 知轩藏书 TXT 站是合理设计） |
| **Book** | 0 | R55-1A 在 dev 环境曾填充 100 本种子书，但 `db/custom.db` 不入版本库（`.gitignore` 已忽略），clone 后需通过 `/admin/books` 后台手动新建（R55-1A 补全 CRUD）或 `/api/admin/backup/restore` 一键导入 backup JSON 重新填充 |
| **Chapter** | 0 | 等采集任务跑起来填充 |
| **Task** | 0 | 等管理员在 /admin/tasks 创建采集任务 |
| **TaskLog** | 0 | 等任务跑起来后写入（info / success / warn / error 四级） |
| **BookTag** | 0 | 等采集跑起来后写入（搜索引擎下拉词） |
| **DownloadJob** | 0 | 等管理员在 /admin/downloads 创建 TXT 下载任务 |
| **Setting** | 13 | 全局设置（含 feedbackEnabled=true 反馈开关 R54-1A；含 calibration:* 极限校准历史结果 4 条 + crawl.* 4 条 + download / miniServiceConfig / seo.sitemapEnabled / lastBackupAt 杂项 4 条。Site 表的 chapterSeoAuto + chapterSeoTitleTemplate + chapterSeoDescTemplate + chapterSeoKeywordsTemplate 智能 TDK 字段在 Site 表不在 Setting 表，R57-1B） |
| **FriendLink** | — | 友情链接（管理员 /admin/links 维护） |
| **Feedback** | — | 用户反馈（R40 新增表，前台浮窗按钮提交） |

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
| **staticcheck**（可选） | 2023.1+ | 源码深度静态检查（命名规范 ST1000/ST1003/ST1020/ST1021 全部为风格提示，非 bug）；R56-1C 校对 1 个真 SA9003 已修复，R57-1C 未引入新代码 smell，其余为风格提示 | `go install honnef.co/go/tools/cmd/staticcheck@latest` |

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
| **3000** | `heis-backend`（go-backend/main.go） | 主后端：前台 SSR + /admin 后台 + /api/public/* + /api/admin/* + 静态资源 /clone-css/* + /covers/* + /api/feedback |
| 3010 | bqg713-proxy | 笔趣阁 token / AES 站点签名代理 |
| 3011 | fetch-relay | 通用 HTTP 中继桥（降级链 3 级） |
| 3012 | scrapling-bridge | Scrapling 抓取桥（static / stealthy / playwright，含可选 Python 子进程） |
| 3013 | qimao-proxy | 七猫签名 + AES 解密代理 |
| 3014 | deqixs-proxy | 得奇 xs 站点代理 |
| 3015 | xjp-proxy | xjp 站点代理 |
| 3016 | uc-bridge | UC 头条小说桥（chromedp + 可选 xvfb） |
| 3017 | moli-bridge | moli 桥（依赖外部 moli 二进制，未装时 selfTest=false，不阻塞） |
| 3018 | curl-impersonate-bridge | curl_cffi 桥（Python 子进程可选；缺则 selfTest=false） |
| 3019 | trafilatura-bridge | go-readability + trafilatura 正文抽取桥 |
| 3020 | cloak-browser | 隐身 chromium 反检测渲染（cloak 模式，需 token；缺则 selfTest=false） |

> 全部 11 mini-services 由 `mini-services/start-all.sh` 一键拉起，端口独占、互不冲突；
> 全部绑 `127.0.0.1:<port>`，仅本机 heis-backend 访问。如改端口需同步修改各服务
> `main.go` 顶部常量 + `start-all.sh` / `stop-all.sh` / `status.sh` 三处端口表。

---

## 三、获取代码

### 3.1 git clone

```bash
# 公开仓库 (master 分支即生产可用)
git clone https://github.com/u4399com-beep/heis.git
cd heis

# 验证关键文件就位
ls -la go-backend/main.go          # 主后端源码 (1522 行, R57-1B 智能 TDK 新增 +94 行)
ls -la go-backend/admin.go         # 后台 API + admin SSR (4555 行)
ls -la go-backend/heis-backend     # 预编译二进制 (24MB, 已入 git, 平台 clone 即跑)
ls -la go-backend/crawl/           # 8 模块采集引擎 (10882 行, R57-1B BUG-G/H +14 行)
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
│   ├── main.go                       #   主后端 (1522 行): 路由 + 86 FuncMap + 静态服务 + DB + 94 模板加载
│   │                                 #     R57-1B 新增 computeChapterSeo 智能 TDK (chapterSeoAuto=true 时
│   │                                 #     按 chapterSeoTitleTemplate / chapterSeoDescTemplate 模板渲染
│   │                                 #     占位符 {bookName} / {chapterTitle} / {author} / {category} /
│   │                                 #     {siteName} 生成动态 title/description/keywords)
│   ├── admin.go                      #   后台 API + admin SSR (4555 行): 14 个 admin 模板 + /api/admin/* 路由
│   ├── go.mod / go.sum               #   Go 模块定义 + 依赖校验
│   ├── heis-backend                  #   go build 输出二进制 (24 MB, 已入 git 平台 clone 即跑)
│   ├── crawl/                        #   采集引擎 (8 模块 10882 行)
│   │   ├── fetcher.go                #     HTTP 采集 + 8 级降级链 + UA 池 + CookieJar (4809 行)
│   │   ├── parser.go                 #     css / xpath / regex / json 字段提取 (1612 行)
│   │   ├── runner.go                 #     4 段采集流程 + 任务调度 + Semaphore (1575 行, R57-1B 衔接)
│   │   ├── cleaner.go                #     广告 / 去壳 / 编码 / 零宽字符剥离 / trafilatura 桥 (941 行,
│   │   │                             #     R57-1B BUG-G chapterHeadCNRe Unicode 边界 + BUG-H Normalize 段落 wrap)
│   │   ├── types.go                  #     规则 / 配置 / 结果数据结构 (743 行)
│   │   ├── hostgate.go               #     并发 + 速率双限速器 (423 行)
│   │   ├── storage.go                #     db / txt 双存储 + 封面本地化 + 路径穿越防御 (354 行)
│   │   └── smart.go                  #     智能分类 / 完结判断 + 4 字分类 + 正则缓存 (355 行)
│   ├── services/                     #   11 mini-services + bridgeserver 共享包
│   │   ├── bridgeserver/bridgeserver.go  # 共享样板 (917 行): /health /metrics /info 鉴权 限速 SSRF 守卫
│   │   ├── bqg713-proxy/main.go           # 3010 笔趣阁 token+AES (189 行)
│   │   ├── fetch-relay/main.go             # 3011 通用 HTTP 中继 (284 行)
│   │   ├── scrapling-bridge/main.go        # 3012 Scrapling 抓取 (470 行) + scripts/scrapling_fetch.py
│   │   ├── qimao-proxy/main.go             # 3013 七猫 AES 解密 (801 行)
│   │   ├── deqixs-proxy/main.go            # 3014 得奇代理 (366 行)
│   │   ├── xjp-proxy/main.go               # 3015 xjp 代理 (587 行)
│   │   ├── uc-bridge/main.go               # 3016 UC 头条桥 (430 行)
│   │   ├── moli-bridge/main.go             # 3017 moli 桥 (303 行)
│   │   ├── curl-impersonate-bridge/main.go # 3018 curl_cffi JA3 桥 (374 行) + scripts/curl_cffi_fetch.py
│   │   ├── trafilatura-bridge/main.go      # 3019 正文抽取桥 (367 行)
│   │   └── cloak-browser/main.go           # 3020 隐身 chromium (974 行, 行为模拟 9 项)
│   └── templates/                    #   94 个 Go html/template 模板
│       ├── admin/                    #     14 个后台模板 (layout + dashboard + tasks + rules + books
│       │                             #                + categories + sites + links + themes
│       │                             #                + downloads + settings + feedback + backup
│       │                             #                + seo-audit; layout 内共享 admin/head +
│       │                             #                admin/sidebar partial)
│       ├── aijjxs/   101kks/  x2552/ #     主题 1-3
│       ├── 23qb/     ddyueshu/       #     主题 4-5
│       ├── huangjinwu/  ggd66/       #     主题 6-7
│       ├── pilishuwu/  trxsw/        #     主题 8-9 (pilishuwu 反爬严, 需 scrapling stealthy)
│       └── shipsay/                  #     主题 10
│           # 每主题 8 页型: home / book / read / category / ranking / search / keyword / fulltext
│
├── prisma/schema.prisma              # DB schema (11+1 表, Go 后端不依赖, 仅 prisma db push 用)
├── prisma/dev.db                     # 开发库 (R42-1C 留作 fallback; 生产用 db/custom.db)
├── db/custom.db                      # 运行时 SQLite 库 (WAL 模式, 不入版本库, 含 100 本书种子)
├── mini-services/                    # 11 服务启停脚本
│   ├── start-all.sh                  #   增量构建 + 后台启动 + ≤3s /health 探针
│   ├── stop-all.sh                   #   SIGTERM 5s grace + SIGKILL 兜底; PID 文件丢失走 lsof/fuser
│   ├── status.sh                     #   11 行表格 (SERVICE/PORT/PID/PROCESS/HEALTH/SELFTEST)
│   └── .gitkeep
├── public/                           # 站点静态资源
│   ├── clone-css/*.css               #   10 个主题的源站 CSS (由 main.go /clone-css/ 路由服务)
│   ├── robots.txt  sw.js  manifest.json  icon.svg  logo.svg  # 站点元数据
├── scripts/rule-yueyouxs.json        # yueyouxs (神马小说) 站点规则 backup-restore 格式 JSON
├── agent-ctx/R*-*.md                 # 各轮 agent 工作记录 (R38-R57, 44 文件; R57-1A/1B 未留 md)
├── worklog.md                        # 完整迁移工作日志 (~24000 行, R3-a → R57-1C 全链路)
├── package.json                      # 仅 scripts.dev = "bun start-go.js" (auto-restart 包装)
├── start-go.js                       # Bun 脚本: 循环启动 ./go-backend/heis-backend, 挂了 2s 重启
├── start.sh                          # Bash 等价: while true; do ./go-backend/heis-backend; sleep 2; done
├── .env.example                      # 环境变量模板 (mini-services AUTH_TOKEN / BRIDGE_KEY / RATE_LIMIT 等)
├── .env                              # 本机 .env (DATABASE_URL, .gitignore, 不入版本库)
├── Caddyfile                         # 沙箱网关 SSRF 防御配置 (端口白名单 3010-3015 + 透传 3000)
├── DEPLOY.md                         # 本文件
└── README.md                         # 功能总览 + 快速开始 + 架构
```

### 3.3 项目根 sanity check

```bash
cd heis

# 验证 Go 模块
cd go-backend && go mod verify         # 期望: all modules verified
ls crawl/                               # 期望: 8 个 .go 文件
ls services/                            # 期望: 12 个子目录 (11 服务 + bridgeserver)
ls templates/                           # 期望: 12 个子目录 (10 主题 + admin + .gitkeep)
find templates -name '*.html' | wc -l   # 期望: 94 (10 主题 × 8 + 14 admin)

# 验证 git pre-commit binary
file go-backend/heis-backend            # 期望: ELF 64-bit LSB executable, x86-64
./go-backend/heis-backend -h 2>&1 | head -1   # 期望: heis-backend 启动 (无效参数会 panic 但首行应输出数据库路径)
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
# 1. 主后端启动测试 (前台运行, Ctrl+C 退出)
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

# 4. 验证 staticcheck (可选, 风格检查, 0 issues 真实问题)
go install honnef.co/go/tools/cmd/staticcheck@latest
cd go-backend && staticcheck ./...
# 期望: 无 SA9003 真问题 (R56-1C 修复 storage.go:351; R57-1C 未引入新代码 smell)
#       ST1000/ST1003/ST1020/ST1021 风格提示可忽略
```

### 4.4 编译失败排查（常见错误）

```bash
# 1. Go 版本太低
go version
# 必须 1.23+; go.mod 声明 1.26, 实际 1.21+ API 即可
# 升级 Go: https://go.dev/dl/

# 2. 依赖下载失败 (国内网络)
export GOPROXY=https://goproxy.cn,direct
cd go-backend && go mod tidy && go build -o heis-backend .

# 3. utls / chromedp / modernc.org/sqlite 版本冲突
cd go-backend && go mod tidy    # 清理 go.sum 重写
# 若仍报错, 删 go.sum 重新生成:
rm go.sum && go mod download && go build -o heis-backend .

# 4. 磁盘空间不足 (11 个二进制 × 24MB ≈ 288MB)
df -h /home/z/my-project        # 确保有 ≥ 1 GB 可用空间

# 5. vet 警告 (应为 0)
cd go-backend && go vet ./...   # R43-1B/C 起已清, R57-1C 复检 0

# 6. staticcheck 风格提示 (不阻塞编译)
cd go-backend && staticcheck ./...
# R56-1C: 1 个 SA9003 已修复 (storage.go:351 downloadTxtWriter.Abort empty branch)
# R57-1C: 未引入新代码 smell, 保持 0 真问题
# 其余 ST1000/ST1003/ST1020/ST1021 全部为命名风格提示, 非 bug

# 7. utls 指纹池编译失败 (检查 fetcher.go utlsHelloPool 数组)
#    错误信息会指明具体 HelloID 未识别, 检查 golang.org/x/crypto/cryptocipher
#    兼容性; R52-1A 扩 36 款后未再变更, 应稳定

# 8. macOS bash 3.2 不支持 declare -A (start-all.sh 用)
bash --version                # 必须 4+
brew install bash            # 升级 bash

# 9. R57-1C 清理后误删 r57probe 导致 go run ./r57probe 报错
#    r57probe/ 是 R57-1B 综合探针脚本 (临时), R57-1C 已删除并 .gitignore 防误入库;
#    如需重做审计, 参考 agent-ctx/R57-1C-full-stack-developer.md 中给出的 probe 源码模板
```

### 4.5 模板变更后重建

模板是**运行时加载的资源**，不需 `go build`：重启 heis-backend 即可生效（main.go 启动时
`tmpls.parseFiles` 重新解析 94 个模板）。如果使用 `bun start-go.js` 包装，
`pkill -f heis-backend` 后 2s 自动重启即加载新模板。

```bash
# 模板变更后重启 (3 种方式任选)
pkill -f heis-backend && sleep 2 && ./go-backend/heis-backend   # 直接
bun start-go.js & pkill -f heis-backend                          # bun 自动重启
bash start.sh & pkill -f heis-backend                            # bash 自动重启

# 验证模板生效 (R54-1C 25 处 missing-asset 修复后)
curl -s http://localhost:3000/ | grep -c 'data:image/svg'   # 期望 ≥ 1 (x2552 主题)

# 验证 R57-1C 6 主题修复生效 (ddyueshu search .s5 字数→日期)
curl -s 'http://localhost:3000/?view=search&site=clone-ddyueshu&q=x' | grep -c 'fmtDateMD\|[0-9][0-9]-[0-9][0-9]'
#  期望 ≥ 1 (注: Go 模板渲染后 fmtDateMD 已被替换为实际日期, 此 grep 验证 .s5 不再是字数)
```

---

## 五、数据库初始化

### 5.1 Prisma schema 概览

Prisma schema 位于 `prisma/schema.prisma`，定义 11+1 张表（Feedback R40 新增）：

| 表名 | 说明 | 实测行数 |
| --- | --- | --- |
| Category | 分类（15 个标准 4 字：玄幻奇幻 / 奇幻魔幻 / 武侠江湖 / 仙侠修真 / 都市生活 / 言情小说 / 历史军事 / 军事战争 / 游戏竞技 / 科幻未来 / 悬疑推理 / 灵异鬼怪 / 体育竞技 / 轻小说类 / 现实生活） | 15 |
| Rule | 采集规则（含完整 config JSON） | 71（53 enabled + 18 disabled） |
| Book | 书籍（cover 字段存 `covers/<name>.webp` 相对路径，main.go 出口加前导 `/` 拼绝对路径） | 0（db/custom.db 不入版本库，需通过 /admin/books 或 backup/restore 填充） |
| Chapter | 章节 | 0（等采集任务跑起来填充） |
| BookTag | 书籍标签（搜索引擎下拉词） | 0 |
| Task | 采集任务 | 0 |
| TaskLog | 任务日志（info / success / warn / error 四级） | 0 |
| Site | 站群站点（10 套主题） | 12 |
| DownloadJob | TXT 下载任务 | 0 |
| Setting | 全局设置（含 feedbackEnabled 反馈开关 + crawl.* / calibration:* / download / miniServiceConfig / seo.sitemapEnabled / lastBackupAt 等运行时状态。Site 表另有 chapterSeoAuto + chapterSeoTitleTemplate + chapterSeoDescTemplate + chapterSeoKeywordsTemplate 四列由 R57-1B 添加，按站点粒度配置智能 TDK） | 13 |
| FriendLink | 友情链接 | — |
| Feedback | 用户反馈（R40 新增） | — |

### 5.2 初始化路径

Go 后端启动时按以下顺序找 SQLite 文件（`main.go:42`）：

```
1. <basePath>/db/custom.db   ← 首选 (生产用)
2. <basePath>/prisma/dev.db  ← fallback (开发用)
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

### 5.3 数据填充（100 本种子书 + 15 分类 + 53 规则）

R55-1A 在 db/custom.db 中预填充了：

1. **15 个标准 4 字分类**（Category 表，sortOrder 1-15）：
   玄幻奇幻 / 奇幻魔幻 / 武侠江湖 / 仙侠修真 / 都市生活 / 言情小说 / 历史军事 /
   军事战争 / 游戏竞技 / 科幻未来 / 悬疑推理 / 灵异鬼怪 / 体育竞技 / 轻小说类 /
   现实生活。

2. **53 条 enabled 采集规则**（Rule 表，覆盖常见小说站：番茄 / 七猫 / 得奇 / 八零 /
   精华 / 笔趣阁 / xjp / 霹雳 + 18 条 disabled list-only 发现规则 + 知轩藏书 TXT 站）。

3. **100 本种子书**（Book 表，15 分类 × ~7 本 / 分类，**仅 dev 环境一次性填充，不入版本库**）：

```bash
# 用 Go 探针验证 DB 状态 (注: db/custom.db 不入 git, 全新 clone 后 Book 表为 0)
cat > /tmp/probe-db.go <<'EOF'
package main
import (
  "database/sql"
  "fmt"
  _ "modernc.org/sqlite"
)
func main() {
  db, _ := sql.Open("sqlite", "/home/z/my-project/db/custom.db")
  defer db.Close()
  for _, t := range []string{"Book","Category","Rule","Site","Chapter","Task","Setting"} {
    var c int
    db.QueryRow("SELECT COUNT(*) FROM "+t).Scan(&c)
    fmt.Printf("count[%s]=%d\n", t, c)
  }
}
EOF
# 在项目根: cd go-backend && go run /tmp/probe-db.go
# 期望 (全新 clone 后):
#   count[Book]=0          ← 需通过 /admin/books 或 backup/restore 填充
#   count[Category]=15
#   count[Rule]=71
#   count[Site]=12
#   count[Chapter]=0
#   count[Task]=0
#   count[Setting]=13

# 一键导入 backup JSON 填充 Book + Chapter + BookTag (推荐, 前提是有 backup 文件):
curl -X POST -H 'Content-Type: application/json' \
  --data-binary @/path/to/heis-backup.json \
  'http://localhost:3000/api/admin/backup/restore'

# 或通过 /admin/books 后台手动新建 (R55-1A 补全 CRUD: 新建 / 编辑 / 删除含级联清章 / 标签 / 下载)
```

### 5.4 验证数据库连接

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

R55-1A 站点 CRUD API：
- `POST /api/admin/sites` 新建（domain 唯一校验 + themeId 在已注册主题列表校验）
- `PUT /api/admin/sites/:id` 13 字段增量更新（含 isDefault 互斥保护：设为默认时自动取消其他站点默认）
- `DELETE /api/admin/sites/:id` 删除（禁止删除 isDefault=true 站点）

### 6.3 采集规则

通过 `/admin/rules` 后台管理：

- 每条规则一份完整 JSON 配置（`config` 字段），包含四段解析器：`list` / `book` /
  `toc` / `content`，外加 `fetch`（采集选项）与 `clean`（清洗规则）。
- 支持的提取器：`css` / `xpath` / `regex` / `json` / `const`。
- 支持的清洗：广告模式（正则删除广告块）、去壳页（提取主容器）、编码识别（GBK 自动转 UTF-8）。
- 提供「极限校准」功能：对模拟源站的三档封禁策略实测安全并发 + 速率，推荐参数一键写回规则。
- 启用 `tokenUrl` 钩子时，引擎会调对应 mini-service（如 bqg713-proxy）拿 token / 签名 / AES 解密。

详见 [第九节：采集规则配置](#九采集规则配置)。

R55-1A 规则 CRUD API：
- `POST /api/admin/rules` 新建
- `PUT /api/admin/rules/:id` 全字段编辑（list / book / toc / content / fetch / clean 任一字段增量）
- `DELETE /api/admin/rules/:id` 删除（校验任务引用 count > 0 拒绝，避免悬空外键）

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
| `CAPTCHA_2CAPTCHA_KEY` | 空 | 2captcha API key（采集规则 fetch.captchaProviders.2captcha.apiKey 覆盖） |
| `CAPTCHA_ANTICAPTCHA_KEY` | 空 | anti-captcha API key |
| `CAPTCHA_CAPSOLVER_KEY` | 空 | CapSolver API key |

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

**Go 工具链路径解析顺序**：`start-all.sh` 优先用 `/home/z/go/bin/go`（sandbox 内置），
找不到则回退 `PATH` 中的 `go`，都没有时报错退出。CI 环境用 `export PATH=$PATH:/usr/local/go/bin`
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

> **临时文件清理**（R56-1C + R57-1C 续清）：`go-backend/backend.log` 是 nohup 输出临时文件，
> `.gitignore` 已忽略 `*.log` + `go-backend/*.log`；R56-1C 清理了 1 个 183 字节的
> `backend.log`，R57-1C 续清另一轮 session 残留的 `backend.log`，运行期再次生成时不会被
> git 追踪。

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
# R49: Go 后端 auto-restart (Go 挂了 2 秒重启)
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
| `http://localhost:3000/?view=read&id=<bookId>&ch=<chapterIdx>` | 阅读页（R57-1B 智能 TDK：chapterSeoAuto=true 时按模板渲染） |
| `http://localhost:3000/?view=category&cat=<categoryId>` | 分类列表页 |
| `http://localhost:3000/?view=ranking` | 排行榜 |
| `http://localhost:3000/?view=search&q=<keyword>` | 搜索结果页 |
| `http://localhost:3000/?view=fulltext&q=<keyword>` | 全文搜索（完本） |
| `http://localhost:3000/?view=keyword&tag=<tag>` | 关键词（标签）聚合页 |

### 8.2 管理后台（12 admin 功能页面 + dashboard + layout = 14 模板）

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/admin` | 管理后台首页（dashboard 看板，R53-1B 修复 updatedAt 后显示正常日期） |
| `http://localhost:3000/admin/tasks` | 采集任务（单书 / 批量 / 实时 / 定时增量 autoRefresh，**R55-1A 补删除**） |
| `http://localhost:3000/admin/rules` | 采集规则（CRUD + 在线测试 + 极限校准，**R55-1A 补编辑全 config + 删除**） |
| `http://localhost:3000/admin/books` | 书籍 / 章节管理（**R55-1A 补新建 / 编辑 / 删除含级联清章 / 标签 / 下载**） |
| `http://localhost:3000/admin/categories` | 分类管理（15 个标准 4 字分类：玄幻奇幻 / 奇幻魔幻 / 武侠江湖 / 仙侠修真 / 都市生活 / 言情小说 / 历史军事 / 军事战争 / 游戏竞技 / 科幻未来 / 悬疑推理 / 灵异鬼怪 / 体育竞技 / 轻小说类 / 现实生活） |
| `http://localhost:3000/admin/sites` | 站点（站群，**R55-1A 补新建 / 编辑 / 删除含主题切换面板**） |
| `http://localhost:3000/admin/links` | 友情链接 |
| `http://localhost:3000/admin/themes` | 主题（**R55-1A 补 per-site 主题切换面板**） |
| `http://localhost:3000/admin/downloads` | TXT 下载任务（**R55-1A 补删除含内存缓存清理**） |
| `http://localhost:3000/admin/settings` | 全局设置（**R55-1A 补删除单个 key，feedbackEnabled 受保护；含 chapterSeoAuto + chapterSeoTitleTemplate + chapterSeoDescTemplate 智能 TDK 三项，R57-1B**） |
| `http://localhost:3000/admin/feedback` | 用户反馈 |
| `http://localhost:3000/admin/backup` | JSON 备份 / 恢复（**R55-1A 补清空采集产物，保留基础设施**） |
| `http://localhost:3000/admin/seo-audit` | SEO 审计（**R55-1A 补修复入口深链**） |

> `http://localhost:3000/admin/layout` 是 layout 框架模板（共享 admin/head + admin/sidebar
> partial），不直接访问，由上述 12 个功能页通过 `{{define "content"}}...{{end}}` 嵌入。

### 8.3 静态资源

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/covers/<name>.webp` | 封面图（R52-1A：文件存在返 WebP；不存在返 SVG 占位渐变色块 + 书名首字） |
| `http://localhost:3000/clone-css/<theme>.css` | 10 套主题的源站 CSS（由 `main.go` /clone-css/ 路由服务） |
| `http://localhost:3000/robots.txt` | 站点 SEO 爬虫规则 |
| `http://localhost:3000/sw.js` | PWA Service Worker（Next.js 遗留，可选） |
| `http://localhost:3000/manifest.json` | PWA 清单（同上） |
| `http://localhost:3000/icon.svg` / `logo.svg` | 站点图标 |

> ⚠️ **后台无登录鉴权**：管理端 `/admin` 当前不要求登录，请勿直接暴露公网。生产环境务必
> 前面套反向代理（Nginx / Caddy）做 Basic Auth + IP 白名单，或仅放内网访问。详见
> [§12.2 反向代理](#122-反向代理生产必做因-admin-无鉴权)。

### 8.4 10 主题 × 8 页型 模板矩阵

R54-1C 已对全部 80 个前台模板做深度核实（10 套主题 × 8 页型），R56-1A 对可达源站 5 套
主题做了 1:1 回源对比复刻（aijjxs / ddyueshu / ggd66 / 23qb / 101kks），R57-1C 续审剩
6 套主题（ddyueshu 剩 7 模板 + pilishuwu / huangjinwu / shipsay / x2552 / trxsw）走 CSS
选择器审计 + 同源参考结构对比，每套每页型确认：

| # | 核实项 | 全 80 模板通过情况 |
| --- | --- | --- |
| 1 | CSS class 在 `clone-css/<site>.css` 有定义 | ✓ 100%（10 个 CSS 文件全部就位） |
| 2 | 配色一致（同一主题内 `<body>` / `<a>` / `.cat` / `.badge` 等用色统一） | ✓ 100% |
| 3 | 列表排列（grid/flex 列数与 CSS class 一致，如 `grid2` / `lines-books-2col` / `booklist-grid`） | ✓ 100% |
| 4 | DOM 结构（每页型在同一主题内布局结构一致：top-float / wrap / layout / panel / footer） | ✓ 100% |
| 5 | 数据绑定 `{{range .Books}}` / `{{.name}}` / `{{.author}}` / `{{.category}}` / `{{.wordCount}}` 等动态值 | ✓ 100% |
| 6 | 链接 `/?view=book&id={{.id}}` / `/?view=category&cat={{.id}}` / `/?view=search&q={{.Q}}` | ✓ 100% |
| 7 | CSS 加载 `<link href="/clone-css/<site>.css">` 文件名匹配主题目录名 | ✓ 100%（grep 80 模板 × 1 css link） |
| 8 | 封面图 `src="{{.cover}}"` / `{{.Book.cover}}` / `{{(index .Books 0).cover}}` 等动态值（绝对路径由 main.go 出口加 `/` 拼） | ✓ 100%（0 处硬编码 `/covers/` 路径） |
| 9 | updatedAt 格式化走 `{{fmtDate .updatedAt}}` / `{{fmtDateShort .updatedAt}}` / `{{fmtDateMD .updatedAt}}`（R53-1B 三处工具函数 + R56-1A fmtDateMD 全部先经 formatUpdatedAt 归一化） | ✓ 100% |
| 10 | 分类名 4 字（smart.go `NormalizeCategory` 把 2 字旧名 + 3 字"轻小说" + 4 字变体全合并到 15 个标准 4 字名） | ✓ 100% |
| 11 | R57-1C 同源参考结构对比（ddyueshu 对照笔趣阁 bqg70 + 69shuba + 23us；pilishuwu 对照 wmcms-web 模板；x2552 对照吾爱小说 笔趣阁克隆） | ✓ 9 处真 bug 全修（详见 §11.8） |

### 8.5 R54-1C 25 处硬编码 missing-asset 修复

R54-1C 修复前，x2552 与 101kks 两套主题共 25 处 `<img>` 标签引用 `public/` 下根本不存在的
源站克隆资产，运行时全部 404：

| 主题 | 页型 | 引用路径 | 出现次数 | 修复后 |
| --- | --- | --- | --- | --- |
| x2552 | home / book / read / category / search / ranking / keyword / fulltext | `/heibing/images/logo.png` | 8 | 内联 180×60 蓝底「小说站」SVG |
| 101kks | home / book / read / category / search / ranking / keyword / fulltext | `/images/user.png` | 16（每页 2 处） | 内联 36×36 灰圆通用头像 SVG |
| 101kks | home | `/images/logo_index.png` | 1 | 内联 280×60 蓝底「小说阅读网」SVG |

修复方式：全部替换为 `src="data:image/svg+xml;base64,..."` 内联 SVG data URI，模板自洽，
不再依赖 `public/heibing/` 与 `public/images/` 缺失目录。验证：

```bash
# 修复后 grep 期望 0 匹配
grep -r 'src="/heibing' go-backend/templates/   # 期望: 0
grep -r 'src="/images/' go-backend/templates/   # 期望: 0

# 验证 SVG data URI 已写入
grep -c 'data:image/svg+xml;base64' go-backend/templates/x2552/home.html   # 期望: 1
grep -c 'data:image/svg+xml;base64' go-backend/templates/101kks/home.html  # 期望: 3
```

> **已知未替换克隆限制**：`public/clone-css/x2552.css` 仍引用源站
> `/heibing/images/wamcc.png` 雪碧图作为多处 `background-image`（按钮 / 图标 / 装饰圆角），
> 属于克隆 CSS 历史包袱，需要重新绘制 100+ 图标雪碧图才能完整替换，超出 R54-1C 范围。前台
> 文字内容仍正常渲染，仅装饰性图标缺失，不影响 SEO 与内容可读性。详见 §11.8。

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
     "fetch":  { "threadMax": 3, "intervalMin": 500, "intervalMax": 2000, "captchaProviders": {...} },
     "clean":  { "adPatterns": [...], "mainContainer": "...", "encoding": "auto" }
   }
   ```

4. 保存后点「在线测试」，输入测试 URL 跑一次抓取，引擎会按 4 段解析器依次执行
   list → book → toc → content
5. 测试通过后启用规则，再到 `/admin/tasks` 创建采集任务挂到此规则

### 9.2 参考规则

历史参考脚本位于 `scripts/rule-yueyouxs.json`（yueyouxs 神马小说站规则，
backup-restore 格式 JSON，`/api/admin/backup/restore` 可直接导入）。如需重新入库，
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
- **R50-1A** 起 utls Hello 池扩 29 款（+ Chrome 83/87/96 老版桌面 + Firefox 55/63 老版 ESR
  + Edge 106 / Android 11 OkHttp / QQ 11_1）+ persistableSessionCache snapshot+IO 模式 +
  captchaSitekeyRe 三属性名 + JS 变量 fallback + probeProxyWithLatency latency 跟踪 +
  least-latency 旋转策略 + ProxyStatsSnapshot admin 查询 + 行为模拟 Gaussian 微抖 +
  micro wheel events + 15% 概率 Tab key。
- **R51-1A** 起 utls Hello 池扩 34 款（+ Chrome 62/70/72 + Firefox 56/65）+ dirtyVersion
  + atomicWriteFileSync fsync + StartTlsSessionBackgroundFlusher + captchaSitekeyReIframeSrc
  + applyCaptchaTokenAndRefetch url.Parse + probeProxyWithLatency drain + pickFailStreak
  + weighted-latency + 反向滚动 + Enter 键 + 双击。
- **R52-1A** 起 utls Hello 池扩 **36 款**（+ Chrome 58/100 两款补缺变体，覆盖 2016-2024
  全代际）+ TLS session corruption recovery + disk cap + dead proxy quarantine + native
  wheel + Esc 键 + Page Down 键 + smart.go 4 字分类。
- **R57** 未引入新 utls Hello / 新降级链 / 新反反爬能力，保持 R52-1A 36 款 + 8 级 + 41 项
  反反爬清单稳定。R57-1A/1B 的改动在 main.go 智能 TDK + cleaner.go BUG-G/H 修复 + admin
  设置项扩展，不影响降级链 / 反反爬能力。

### 9.5 41 项反反爬能力清单

| # | 能力 | 引入轮次 | 说明 |
| --- | --- | --- | --- |
| 1 | utls Hello 指纹池 36 款 | R43-1B → R52-1A | Chrome 100/106_Shuffle/112_PSK_Shuf/115_PQ/120/120_PQ/131/133 + Firefox 99/102/105/120 + Safari 16.0 + iOS 13/14/11_1/12_1 + Edge 85 + Chrome 100_PSK/114_Padding_PSK_Shuf/115_PQ_PSK + Chrome 83/87/96 老版 + Firefox 55/63/56/65 老版 ESR + Edge 106 + Android 11 OkHttp + QQ 11_1 + Chrome 62/70/72 (R51-1A) + Chrome 58/100 (R52-1A，覆盖 2016-2024 全代际) |
| 2 | per-host 钉扎 | R43-1B | hash 稳定选取同一 Hello，避免同一站不同请求指纹跳变 |
| 3 | attempts 偏移轮换 | R43-1B | 失败 N 次后偏移到下一号 Hello |
| 4 | TLS session ticket LRU 缓存 | R46-1B | `utls.NewLRUClientSessionCache(256)` 模拟浏览器 ticket cache 行为，加速重连 |
| 5 | persistableSessionCache 内存+磁盘 | R46-1B → R50-1A | 内存 LRU + 磁盘 JSON 60s 节流 flush + snapshot+IO 模式 + `flushMu` 串行化并发 IO，修复原内存 race condition |
| 6 | dirtyVersion + atomicWriteFileSync | R51-1A | session 写盘前比 dirtyVersion 防并发覆写 + `atomicWriteFileSync` fsync 原子写入（先写 .tmp 再 rename） |
| 7 | StartTlsSessionBackgroundFlusher | R51-1A | 5min 间隔后台 goroutine 周期性 flush session 到磁盘，避免进程意外退出丢 ticket |
| 8 | TLS session corruption recovery + disk cap | R52-1A | 启动时读盘若 JSON 损坏自动重建 + 磁盘文件大小超阈值（500KB）自动截断重建 |
| 9 | JA3/JA4 轮换 | R43-1B | utls 不同 Hello 版本 cipher suite 顺序 + 扩展顺序 + GREASE 模式各异，反爬无法靠单一 TLS 指纹识别 |
| 10 | Cookie 持久化 | R43-1B | per-domain CookieJar，cf_clearance 跨子域合并 |
| 11 | stripPort 跨端口 Cookie 合并 | R47-1A | `CookieJar.stripPort` 修正 `example.com:443` vs `example.com` 域名不一致 |
| 12 | Referer 链伪造 | R43-1B | 逐请求注入来源页 URL，模拟浏览器跳转链 |
| 13 | 重试退避 full jitter | R43-1B | 1.5 s × 2^n 封顶 8 s |
| 14 | Cookie 挑战重试 | R43-1B | 403 + Set-Cookie 重试 2 次 |
| 15 | Token 挑战 HTTP 求解 | R43-1B | `let token="..." + location.href=?challenge=` 自动求解 |
| 16 | looksBlocked 启发式 | R43-1B | 识别 403/429/Captcha 页 |
| 17 | looksLikeCaptcha 启发式 | R43-1B | 识别验证码页 |
| 18 | isJsChallenge 启发式 | R43-1B | 识别 JS Challenge |
| 19 | 2captcha 验证码 | R43-1B | 可选，配置 API key 后自动求解 Cloudflare Challenge |
| 20 | anti-captcha 服务级联 | R50-1A | 2captcha 主服务 + anti-captcha 备份服务级联，主失败自动切备份 |
| 21 | CapSolver 服务级联 | R50-1A | 三服务级联（2captcha + anti-captcha + CapSolver）+ captcha 主备自动切换 + 成功率统计 |
| 22 | sitekey 三属性名 + JS 变量 fallback | R50-1A | data-sitekey / data-pubkey / data-pkey 三属性名 + JS 变量 `sitekey: "..."` 兜底 + iframe src fallback + query 顺序保留 |
| 23 | captcha 连续失败 cooldown | R47-1A | 连续 3 次失败 60 s cooldown，避免无效重试 |
| 24 | 代理池 MarkProxyFailed/OK | R43-1B | 代理健康跟踪 + cooldown |
| 25 | 代理主动 probe | R46-1B → R50-1A | 5 min 间隔 + 3 次失败冷却 + R50-1A latency 跟踪 (probeProxyWithLatency) + ProxyStatsSnapshot admin 查询 |
| 26 | least-latency 旋转策略 | R50-1A | probe latency 排序，选最低延迟代理；drain 模式避免并发 probe 抢同一代理 |
| 27 | weighted-latency 加权策略 | R51-1A | 在 least-latency 基础上加权随机（防 all-to-fastest 拥塞，分散到 top-N 延迟低的代理） |
| 28 | pickFailStreak 业务失败跟踪 | R51-1A | 区分网络失败（MarkProxyFailed）vs 业务失败（pickFailStreak），连续业务失败 N 次后跳过该代理 |
| 29 | dead proxy quarantine | R52-1A | 连续业务失败 streak ≥ 10 触发 quarantine（30 min 冷却），避免持续踩死代理 |
| 30 | probe target 轮选 | R47-1A | 5 endpoint 轮选，避免单点故障 |
| 31 | brotli miss 计数 | R46-1B | 识别需走桥的 host（不响应 br 编码） |
| 32 | 网络层错误不清 utls choice | R46-1B | 仅 TLS handshake 失败才清，避免无效轮换 |
| 33 | SSRF 守卫 | R43-1B | 拒绝云元数据 / 私网 / 链路本地，`allowLoopback` 放行内部桥 |
| 34 | mirrorDomains 镜像组 | R43-1B | 故障切换同站镜像 |
| 35 | per-host UA 钉扎 | R43-1B | 同一站用同一 UA，避免指纹跳变 |
| 36 | Set-Cookie 安全校验 | R43-1B | 防止恶意 Set-Cookie 污染 CookieJar |
| 37 | captcha 成功率统计 | R46-1B | 主服务成功率统计 + 自动切换 |
| 38 | 行为模拟 Gaussian 微抖 | R50-1A | `rand.NormFloat64` stddev=1.5px 替代均匀分布 ±3px，抖动分布更接近真实用户生理抖动 |
| 39 | 滚轮 micro wheel + native wheel events | R50-1A → R51-1A | R50-1A micro wheel events（5-15px deltaY × 2-4 步插入主滚动间）+ R51-1A native mouse.Event 直接合成（绕过 DevTools Protocol 检测层）+ R52-1A native wheel (5%) |
| 40 | 键盘导航 (Tab/Enter/Esc/PgDn) | R50-1A → R52-1A | R50-1A 15% Tab key 切换 focus + R51-1A 10% Enter 提交 + R52-1A 4% Esc 关闭弹窗 + 2% Page Down 翻页 |
| 41 | cloak-browser 反检测脚本注入 | R51-1A | `page.AddScriptToEvaluateOnNewDocument` 在每个新文档加载前执行 `navigator.webdriver=undefined` + `chrome.runtime={}` 等反检测注入；+ R51-1A 反向滚动 (5%) + 双击 (3%) |

---

## 十、架构图

### 10.1 整体架构（文字版）

```
                       用户浏览器
                          │
                          ▼
              ┌────────────────────────────────┐
              │  Go heis-backend :3000          │  (go-backend/main.go, 1522 行)
              │  ────────────────────────────  │
              │  静态资源 /clone-css/*           │  (源站 CSS, public/clone-css/*.css)
              │  封面 /covers/*                 │  (R52-1A 三段: data/covers → public/covers → SVG 占位)
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
              │    14 admin (12 功能页 +        │
              │      dashboard + layout):       │
              │      tasks rules books          │
              │      categories sites links     │
              │      themes downloads settings  │
              │      feedback backup seo-audit │
              │  FuncMap 86 个 (含 fmtDate /    │
              │    fmtDateShort / fmtDateMD /  │
              │    shortTime 四处先经           │
              │    formatUpdatedAt 归一化防     │
              │    Prisma @updatedAt Unix ms   │
              │    切片错位)                    │
              │  API 路由:                     │
              │    /api/public/*  6 个          │
              │    /api/admin/*  14 个         │
              │  智能 TDK (R57-1B):            │
              │    chapterSeoAuto=true 时       │
              │    computeChapterSeo 按模板    │
              │    渲染章节页 title/desc/keys  │
              │  DB: SQLite WAL                │
              │    db/custom.db                │
              │      100 books × 15 cats ×    │
              │      71 rules × 12 sites       │
              └───────────┬────────────────────┘
                          │
                          ▼
              ┌────────────────────────────────┐
              │  采集引擎 crawl/                  │  (10882 行 Go)
              │  ────────────────────────────  │
              │  fetcher.go  4809 行             │  ← 8 级降级链总调度
              │  parser.go   1612 行             │  ← css / xpath / regex / json 提取
              │  runner.go   1575 行             │  ← 4 段采集流程 + 任务调度 (R57-1B 衔接)
              │  cleaner.go   941 行             │  ← 广告 / 去壳 / 编码 / trafilatura (R57-1B BUG-G/H)
              │  types.go     743 行             │  ← 规则 / 配置 / 结果数据结构
              │  hostgate.go  423 行             │  ← 并发 + 速率双限速器
              │  storage.go    354 行             │  ← db / txt 双存储 + 封面本地化 + 路径穿越防御
              │  smart.go     355 行             │  ← 智能分类 / 完结判断 + 4 字分类 + 正则缓存
              │                                 │
              │  反反爬 41 项 (见 §9.5):        │
              │    utls Hello 指纹池 36 款      │  (含 PSK / PQ / 老 iOS / Chrome 老版 / Firefox 老版 ESR / 2016 era Chrome 58)
              │    JA3 / JA4 轮换                │
              │    TLS session cache            │  (LPU 256 + 磁盘 persistable + snapshot+IO + dirtyVersion + backgroundFlusher + corruption recovery + disk cap)
              │    brotli miss 计数              │  (识别需走桥的 host)
              │    代理主动 probe                │  (5 min 间隔 + 3 次失败冷却 + latency 跟踪 + least-latency + weighted-latency)
              │    dead proxy quarantine         │  (业务失败 streak ≥ 10 → 30 min 冷却)
              │    captcha 三服务级联            │  (2captcha + anti-captcha + CapSolver + sitekey 三属性名 + JS 变量 fallback + 主备自动切换)
              │    Cookie 持久化                 │  (cf_clearance 跨子域 + stripPort)
              │    Referer 链伪造                │
              │    2captcha 验证码               │  (可选, 连续 3 次失败 60s cooldown)
              │    MarkProxyFailed / OK          │  (代理健康跟踪 + least-latency)
              │    行为模拟 Gaussian 微抖        │  (rand.NormFloat64 stddev=1.5px)
              │    键盘导航 (Tab/Enter/Esc/PgDn)│
              │    native wheel events          │  (绕过 DevTools Protocol 检测层)
              │    反检测脚本注入                │  (page.AddScriptToEvaluateOnNewDocument)
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
              │  3020 cloak-browser              │  隐身 chromium (974 行)
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
   ├── /covers/*     →  data/covers/<name> 或 public/covers/<name> 或 SVG 占位 (R52-1A 三段式)
   ├── /icon.svg /robots.txt /manifest.json /favicon.ico  →  public/ 静态文件
   ├── /api/public/*  →  admin.go 6 个公开 API
   ├── /api/admin/*  →  admin.go 14 个管理 API
   ├── /api/feedback  →  admin.go 反馈提交 (受 Setting.feedbackEnabled 开关控制)
   │
   └── /  →  渲染前台 (main.go renderView)
              │
              ├── getSite(siteId)           →  Site 表查站点配置
              ├── 注册表查 themeId           →  对应主题目录 (templates/<theme>/)
              ├── 视图数据查询               →  Book / Chapter / Category / BookTag 表
              │                              (cover 字段出口加前导 '/' 拼绝对路径 /covers/foo.webp)
              ├── [view=read] R57-1B 智能 TDK
              │     若 Site.chapterSeoAuto=true:
              │       computeChapterSeo(bookName, chapterTitle, author, category, siteName,
              │                         chapterSeoTitleTemplate, chapterSeoDescTemplate)
              │       → 章节 map 注入 seoTitle / seoDesc / seoKeywords
              │     若 chapterSeoAuto=false: 用户配置的静态 TDK 原样使用
              └── template.ExecuteTemplate  →  渲染 home.html 输出 HTML
                                              (模板 <img src="{{.cover}}"> 渲染输出 <img src="/covers/foo.webp">)
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
   │                          (R56-1B BUG-E 修复: urlFields 硬编码 ['url'] → ['url','bookUrl'] 自动 fallback)
   │
   ├── 3. fetchBookDetail + parseToc + parseContent
   │                          (每章并发, hostgate.go 双限速)
   │                          (SmartCategory + SmartCompleteDetect 智能化, R54-1B)
   │
   ├── 4. cleanContent      →  crawl/cleaner.go (广告 / 去壳 / 编码 / trafilatura)
   │                          (R49-1B + R54-1B 7+2 bug 修复 + R56-1B BUG-F + R57-1B BUG-G/H)
   │
   └── 5. storage           →  crawl/storage.go (db / txt + 封面本地化)
                                   │
                                   ├── SQLite WAL (db/custom.db)
                                   └── data/covers/<name>.webp (SaveCoverWebp 落盘)
                                       └── 模板 src="{{.cover}}" → 浏览器 GET /covers/<name>.webp
                                           → 文件存在返回 WebP, 不存在返回 SVG 占位 (R52-1A)
```

### 10.4 模板矩阵（10 × 8 = 80 + 14 admin = 94）

| 主题 \ 页型 | home | book | read | category | search | ranking | keyword | fulltext |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **aijjxs** | ✓ R56-1A | ✓ | ✓ | ✓ R56-1A | ✓ | ✓ | ✓ | ✓ |
| **101kks** | ✓ R56-1A | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **x2552** | ✓ R57-1C | ✓ R57-1C | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **23qb** | ✓ R56-1A | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **ddyueshu** | ✓ R56-1A | ✓ | ✓ | ✓ | ✓ R57-1C | ✓ R57-1C | ✓ | ✓ R57-1C |
| **huangjinwu** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **ggd66** | ✓ R56-1A | ✓ | ✓ | ✓ R56-1A | ✓ R56-1A | ✓ R56-1A | ✓ R56-1A | ✓ R56-1A |
| **pilishuwu** | ✓ R57-1C | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **trxsw** | ✓ R56-1A | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **shipsay** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

每模板均含 1 处 `<link href="/clone-css/<theme>.css">`（grep 80 模板 × 1 css link 校验通过）。

> 标注说明：`R56-1A` = R56-1A 阶段已对可达源站 1:1 回源对比修复；`R57-1C` = R57-1C 阶段
> CSS 审计 + 同源参考对比修复（详见 §11.8 bug 清单）；无标注 = R54-1C 已通过 80 模板深度
> 核实（CSS class / 配色 / DOM 结构 10 项校验全过，源站可达性不阻塞）。

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
go vet ./...                   # 应输出 0 warnings (R43-1B/C 起已清, R57-1C 复检 0)

# 5. staticcheck 风格提示 (不阻塞)
cd go-backend && staticcheck ./...
# R56-1C: 1 个 SA9003 已修复 (storage.go:351 downloadTxtWriter.Abort empty branch)
# R57-1C: 未引入新代码 smell, 保持 0 真问题
# 其余 ST1000/ST1003/ST1020/ST1021 全部为命名风格提示, 非 bug

# 6. r57probe 子目录找不到 (R57-1C 已删)
# R57-1B 综合探针脚本 r57probe/main.go 是临时 probe, R57-1C 删除并 .gitignore 防误入库;
# 如需重做采集规则 + 智能化 + 噪声清洗三轮审计, 参考 agent-ctx/R57-1C-full-stack-developer.md
# 中给出的 probe 源码模板 (37 KB, 探针模式可按需重写)
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
tail -f backend.log    # nohup 输出 (临时, .gitignore 已忽略)

# 4. 常见被杀原因排查表:
#   ├─ OOM Killer        → dmesg | grep -i kill, 升内存或关 chromium
#   ├─ SIGTERM 外部      → 检查 systemd / supervisor / bash stop-all.sh
#   ├─ SIGSEGV          → 看 backend.log 找 stack trace, 修代码
#   └─ 端口冲突 panic   → lsof -i :3000 找占用进程, 杀掉或改端口
```

### 11.8 主题克隆已知限制（R54-1C + R56-1A + R57-1C）

R54-1C 修复 25 处 `<img>` 硬编码 missing-asset 路径（x2552 + 101kks）后；R56-1A 对可达
源站 5 主题做 1:1 回源对比修复（aijjxs / ddyueshu / ggd66 / 23qb / 101kks，修了 12 个 bug）；
R57-1C 续审剩 6 主题（ddyueshu 剩 7 模板 + pilishuwu / huangjinwu / shipsay / x2552 / trxsw）
走 CSS 选择器审计 + 同源参考结构对比，修了 9 个 bug。以下属于克隆主题历史包袱，超出本轮范围：

| 主题 | 限制 | 影响 |
| --- | --- | --- |
| **x2552** | `public/clone-css/x2552.css` 多处 `background: url(/heibing/images/wamcc.png)` 引用源站雪碧图（按钮 / 图标 / 装饰圆角） | 文字内容仍正常渲染，仅装饰性图标缺失，不影响 SEO 与内容可读性；如需完整还原需重新绘制 100+ 图标雪碧图 |
| **ggd66 / shipsay** | `<link href="https://cdn.staticfile.org/font-awesome/4.7.0/css/font-awesome.min.css">` 依赖外部 CDN | 离线环境图标显示为方框；可联网时正常；如需离线，下载 font-awesome 4.7.0 放到 `public/fa/` 改 `<link href="/fa/css/font-awesome.min.css">` |
| **pilishuwu / huangjinwu / shipsay / x2552 / trxsw** | 源站当前不可达（403 / 超时 / DNS 解析失败） | R57-1C 走 CSS 选择器 + 同源参考结构对比，已审计通过；如源站恢复可达，可做进一步回源对比 |

R54-1C / R56-1A / R57-1C 三轮校对建议：x2552 主题克隆自 https://www.x2552.com（吾爱小说），
雪碧图属源站私有资产不可直接抓取；ggd66 / shipsay 走 CDN 属常见前端实践，可接受。其他 7
套主题（aijjxs / 23qb / ddyueshu / huangjinwu / 101kks / pilishuwu / trxsw）的 CSS 均自洽，
不依赖外部资源（pilishuwu / huangjinwu / trxsw 的 CSS 是项目自创基于源站命名约定的克隆
再现，可独立渲染）。

**R57-1C 9 处 bug 修复清单**（接续 R56-1A 12 处）：

| # | 主题 | 页型 | 描述 | 修复 |
| --- | --- | --- | --- | --- |
| 1 | ddyueshu | search | `.l li .s5`（CSS `#newscontent .l li .s5{color:#B3B3B3;float:right;text-align:right;}`）显示 `{{wordCount}}`，与 home.html `.l .s5` (R56-1A 修为 fmtDateMD) 不一致 | `{{wordCount .wordCount}}` → `{{fmtDateMD .updatedAt}}` |
| 2 | ddyueshu | search | `.r li` 仅 3 spans (s1+s2+s5)，s5 误用为 author；与 home.html `.r` 5 spans (s1+s2+s3+s4+s5) 结构不一致 | 改为 5 spans: s1=cat + s2=name + s3=chapter + s4=author + s5=date |
| 3 | ddyueshu | ranking | `.novelslist li .s5`（CSS `color:#B3B3B3;float:right;text-align:right;`，与 `#newscontent .l .s5` 同口径）显示 `{{wordCount}}` | `{{wordCount .wordCount}}` → `{{fmtDateMD .updatedAt}}` |
| 4 | ddyueshu | fulltext | `.novellist li` loose text 多余 `/ {{wordCount .wordCount}}`（源笔趣阁 .novellist li 仅 `<a>书名</a> / 作者`，无字数） | 删除 `/ {{wordCount .wordCount}}` |
| 5 | pilishuwu | home | `.mod-cover-list-text` (CSS `width:100px; nowrap; text-overflow:ellipsis` = chapter title slot) 在 "最新入库" 区显示 `{{wordCount}}`，与同主题其他 4 模板（category/fulltext/search/keyword/book）的 `.mod-cover-list-text` 用 `{{.latestChapter}}` 不一致 | `{{wordCount .wordCount}}` → `{{if .latestChapter}}{{.latestChapter}}{{else}}第1章{{end}}` |
| 6 | x2552 | home | `.update li` 末位 dangling `{{wordCount}}` 文本（CSS `.update li{text-align:right}` 末位 loose text 右对齐 = 日期 slot，源笔趣阁为 `作者 12-15`） | `{{wordCount .wordCount}}` → `{{fmtDateMD .updatedAt}}` |
| 7 | x2552 | home | `.ultop li <p>` "总推荐榜" (CSS `position:absolute;top:-3px;right:0` = 数字 slot) 显示 `{{wordCount}}`，源笔趣阁为排名序号 | `range .Popular` → `range $i, $b := .Popular` + `{{wordCount .wordCount}}` → `{{add $i 1}}` |
| 8 | x2552 | home | `.ultop li <p>` "最新入库" 同上显示 `{{wordCount}}` | `range .Books` → `range $i, $b := .Books` + `{{wordCount .wordCount}}` → `{{add $i 1}}` |
| 9 | x2552 | book | `.ultop li <p>` "总推荐榜" 同上显示 `{{wordCount}}`（与同 file line 142 "最新小说" 用 `{{fmtDateShort .updatedAt}}` 不一致） | `range .HotBooks` → `range $i, $b := .HotBooks` + `{{wordCount .wordCount}}` → `{{add $i 1}}` |

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
| 采集引擎 | TS（src/lib/crawl/*，8302 行，已 R42-1C 删） | Go（go-backend/crawl/*，10882 行） |
| mini-services | 5 Bun + 1 Python（已删） | 11 Go 二进制（端口 3010-3020）+ bridgeserver 共享包 |
| 降级链 | 5 级 | **8 级**（+uc/moli/curl-impersonate） |
| 反反爬 | 基础 UA + 代理池 | utls Hello 指纹池 36 款 + 41 项反反爬能力（见 §9.5） |
| 智能化 | 无 | SmartCategory + SmartCompleteDetect + 智能 TDK (R57-1B) |
| 数据库 | Prisma/SQLite | 同（schema 不变，db/custom.db 可直接迁移） |
| 项目根 | package.json + bun.lock + tsconfig + Dockerfile + install.sh + src/ + node_modules/ + .next/ 等 | 全部已删（R46-1A），仅保留 go-backend/ + prisma/ + public/ + mini-services/*.sh |

**升级路径（仍在跑旧 Next.js 版本时迁移到 Go）**：

1. 停旧服务：`docker compose down`（旧 Docker 部署）或 `pkill -f 'node server.js'`
2. 保留 `db/custom.db` 和 `public/clone-css/*` 和 `data/*`（封面/TXT 产物）
3. 删除旧 Next.js 遗留：`src/`、`node_modules/`、`.next/`、`package.json`、`bun.lock`、
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
- **R52-1A/1B 清理精简 + 主题核实 + DEPLOY/README 校对**：`agent-ctx/R52-1B-full-stack-developer.md`（R52-1A：utls Hello 池扩 29→36 款（+ Chrome 58/100 两款补缺变体，覆盖 2016-2024 全代际）+ smart.go 15 个分类名从 2 字改 4 字（与 DB schema 一致）+ cloak-browser 行为模拟新增 native wheel/Esc/Page Down 三项；R52-1B：清理 + DEPLOY/README 校对 + cover 绝对路径 + SVG 占位 + 分类 4 字 + /admin 访问校验 + R52-1A 功能改动保留 8-space 缩进避免大批 whitespace-only diff）
- **R53-1A/1B 智能分类 alias 表 BUG-1 + updatedAt 格式化 bug 修复**：`agent-ctx/R53-1B-full-stack-developer.md`（R53-1A：alias 表补 `"轻小说" → "轻小说类"` 让 source 路径直接命中 + NormalizeCategory 模糊匹配改 `[]rune` 长度比较 + `/covers/` handler BUG-4 path traversal + BUG-5 SVG initial XML escape + BUG-6 LIKE 模式过松 + BUG-7 Scan 错误记日志；R53-1B：fmtDate/fmtDateShort/shortTime 三处先经 formatUpdatedAt 归一化, 修复 Prisma `@updatedAt` 存 Unix ms 时间戳时直接 s[:10] / s[5:10] 切出时间戳片段的 bug）
- **R54-1A/1B/1C 反馈模块开关 + 智能化 + 噪声清洗 + 主题模板核实 + DEPLOY 重写**：
  - `agent-ctx/R54-1A-full-stack-developer.md`（反馈模块开关 + 系统设置说明 + 非 Go 桥留检查）
  - `agent-ctx/R54-1B-full-stack-developer.md`（采集规则完整性 + 智能化 BUG-A/B + 噪声清洗 BUG-C/D + go build/vet/staticcheck 全 0）
  - `agent-ctx/R54-1C-full-stack-developer.md`（10 套 × 8 页型 = 80 模板深度核实 + 25 处硬编码 missing-asset 路径修复 + DEPLOY 全文重写 + go build/vet/staticcheck 全 0）
- **R55-1A 后台全页面 CRUD 补齐**：`agent-ctx/R55-1A-full-stack-developer.md`（12 admin 功能页面 CRUD 完备度审计 + 8 个页面补 create/edit/delete：tasks / books / rules / sites / themes / downloads / settings / backup / seo-audit + 填充 100 本不同类型书籍 + go build/vet 全 0）
- **R56-1A 主题模板 1:1 回源对比 + 复刻修复**：`agent-ctx/R56-1A-full-stack-developer.md`（10 套 × 8 页型 = 80 模板矩阵：5 主题可达源站深度对比 + 5 主题不可达源站 R54-1C CSS 审计保留 + 12 个 bug 全修：ddyueshu home .s5 字数→日期 + ggd66 home .s5 字数→日期 + ggd66 5 模板 bookbox 结构重写 + trxsw home .book-date 字数→日期 + 23qb home module-item-text 简化 + 23qb home list-item 补齐 + 23qb home aside nav 对齐 + 101kks home aside nav 对齐 + aijjxs home 全结构补齐 (4 panel + aside + hero/kpi) + aijjxs home 3 处 .date new 字数→日期 + aijjxs home meta 末位状态→日期 + aijjxs category listbg 加 badge + class="old"→class="new" + 新增 fmtDateMD FuncMap）
- **R56-1B 智能化 + 采集规则 + 噪声清洗三轮深度审计**：`agent-ctx/R56-1B-full-stack-developer.md`（BUG-E discoverBooks urlFields 硬编码 ['url'] → ['url','bookUrl'] 自动 fallback + BUG-F EXTRA_AD_PATTERNS 跨段贪婪 `本站小说由程序自动索引` 漏 `<>` 排除导致 HTML 标签误吞）
- **R56-1C DEPLOY 全文重写 + Go 深度抓 bug + 清理**：`agent-ctx/R56-1C-full-stack-developer.md`（本文件 14 节全面重写 + LoC 同步 main 1413→1428 / admin 3742→4555 / 总 crawl 10671→10868 + 反反爬清单 36→41 项 + 22 处过时注释清理（src/lib/crawl/* 与 src/app/api/admin/* 引用全部清） + storage.go BUG-1 SA9003 修复（downloadTxtWriter.Abort empty branch + os.IsExist 误用） + backend.log 临时文件清理 + README.md 同步 + go build/vet 全 0）
- **R57-1A/1B 智能 TDK + 噪声清洗深化**（agent-ctx 未留 md，代码改动可见）：
  - R57-1A：main.go 新增 `computeChapterSeo` 函数 + Site/Setting 表新增 `chapterSeoAuto` (bool) + `chapterSeoTitleTemplate` (string) + `chapterSeoDescTemplate` (string) 三字段；阅读页 view=read 时若 Site.chapterSeoAuto=true 调 computeChapterSeo 按模板渲染占位符 `{bookName}` / `{chapterTitle}` / `{author}` / `{category}` / `{siteName}` 生成动态 `<title>` / `<meta description>` / `<meta keywords>`，避免千章一面被搜索引擎降权
  - R57-1B：cleaner.go BUG-G `chapterHeadCNRe` 原用 `\b` ASCII 词边界对中文无效（`\b` 在 ASCII 字母数字与 `_` 之间才匹配，中文之间不匹配）改 `<<>>` Unicode 边界；BUG-H Normalize 末段 `<p>` 包裹位置错位（原 `out = "<p>" + out + "</p>"` 在 Normalize 入口包，但 plainText 模式下 out 已含 `<p>` 段落，导致双层 `<p><p>...</p></p>` 嵌套，改为 Normalize 末尾按需包裹）；main.go 衔接 computeChapterSeo 调用点（chapter map 注入 seoTitle / seoDesc / seoKeywords 三字段，模板 `{{.Chapter.seoTitle}}` 等消费）；r57probe/ 综合探针脚本（采集规则 + 智能化 + 噪声清洗三轮深度审计临时 probe，37 KB）
- **R57-1C 6 主题模板 1:1 复刻续 + DEPLOY 全文重写 + 清理精简**：`agent-ctx/R57-1C-full-stack-developer.md`（本文件 14 节全面重写 + LoC 同步 main 1428→1522 / runner 1558→1575 / cleaner 914→941 / 总 crawl 10868→10882 + 9 处模板 bug 修复：ddyueshu search .l .s5 字数→日期 + ddyueshu search .r 列 3→5 spans + ddyueshu ranking .s5 字数→日期 + ddyueshu fulltext .novellist li 多余字数删 + pilishuwu home .mod-cover-list-text 字数→latestChapter + x2552 home .update li dangling 字数→日期 + x2552 home .ultop li <p> 2 处 字数→rank + x2552 book .ultop li <p> 1 处 字数→rank + 清理：r57probe/ + sites_tmp_main.go.bak + backend.log + go-backend/go-backend/heis-backend 嵌套副本 + .gitignore 增强 3 条规则 + go build/vet 全 0）
- **完整工作日志**：`worklog.md`（~24000 行，R3-a → R57-1C 全链路迁移记录）
- **数据库 schema**：`prisma/schema.prisma`（11 + 1 表，Feedback R40 新增，chapterSeoAuto/TitleTemplate/DescTemplate R57-1B 新增）
- **采集引擎源码**：`go-backend/crawl/*.go`（8 模块 10882 行）
- **主后端源码**：`go-backend/main.go`（1522 行，含 computeChapterSeo 智能 TDK + 86 FuncMap）+ `go-backend/admin.go`（4555 行）
- **mini-services 源码**：`go-backend/services/*/main.go`（11 个）+ `services/bridgeserver/bridgeserver.go`（共享样板 917 行）
- **cloak-browser 行为模拟**：`go-backend/services/cloak-browser/main.go`（974 行，含 page.AddScriptToEvaluateOnNewDocument + simulateHumanBehaviorActions + native wheel/Esc/PgDn/Tab/Enter/双击/反向滚动 9 项）

---

**文档版本**：R57-1C（R50-1C 14 节安装部署教程 + R52-1B 36 项反反爬清单 + R53-1B updatedAt
格式化修复 + R54-1C 80 模板深度核实 + 25 missing-asset 修复 + R55-1A admin 全页面 CRUD
补齐 + 100 本种子书填充 + R56-1A 5 主题可达源站 1:1 复刻 12 bug 修复 + R56-1B 智能化 +
采集规则 + 噪声清洗三轮深度审计 BUG-E/F + R56-1C DEPLOY 全文重写 + LoC 反反爬清单 36→41 项 +
22 处过时 TS 引用清理 + storage.go BUG-1 SA9003 修复 + R57-1A/1B 智能 TDK + cleaner.go
BUG-G/H + **R57-1C：6 主题模板 1:1 复刻续 9 bug 修复 + DEPLOY 全文重写 + 清理精简（r57probe/
+ sites_tmp_main.go.bak + backend.log + 嵌套 go-backend/heis-backend 副本删除 + .gitignore
增强 3 条规则） + go build/vet 全 0**），对应 worklog.md R38–R57 全程迁移记录。
