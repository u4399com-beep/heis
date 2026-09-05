# 小说管理系统（Next.js 16 + Prisma/SQLite）

规则驱动的小说采集与发布系统：管理端配置站点规则与采集任务，引擎按规则抓取（多引擎降级链）、清洗、落库；前台站群（书城/书籍详情/阅读页/搜索）直接消费库内数据。

> 生产/服务器部署（Docker 一键安装）请看 **[DEPLOY.md](./DEPLOY.md)**；本文覆盖功能总览、快速开始、本地开发与项目结构。

## 功能特性

- **零基础一键部署**：`bash install.sh` 自动检测（必要时安装）Docker、构建、启动、等健康检查、打印访问地址；装完自动导入 7 个实测站点规则并开跑采集任务，约 20~40 分钟前台即有真实书籍可读（可关闭）。
- **采集引擎**（`src/lib/crawl/`）：规则四段（列表/详情/目录/正文）解析、CSS/正则/JSON 字段提取、分页与翻页 Referer 链、编码识别（GBK 等）、正文清洗（广告模式/去壳页）、分卷排序、并发限速 + HostGate、封面本地化（webp）。
- **多引擎降级链**：native HTTP（curl 链）→ 代理池轮换 → 中继桥（3011）→ Scrapling 桥（3012，static/stealthy/playwright）→ Obscura 本地 chromium 反检测渲染，按站点防护级别自动降级。
- **站级签名/解密代理**：对 token/签名/AES 类站点以外置 mini-service 承载（见下表），引擎 `tokenUrl` 钩子对接。
- **管理端**：站点规则 CRUD + 在线测试、任务（单书/批量/实时采集/定时增量 autoRefresh）、书籍/章节管理、TXT 下载、统计看板。
- **前台**：多主题站群（主题注册表驱动，如 pili 霹雳书屋仿站）、阅读页、搜索、sitemap、伪静态链接。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | Next.js 16（App Router）+ React 19 + TypeScript 5 |
| 数据库 | Prisma ORM 6 + SQLite（单文件，零外部依赖） |
| UI | Tailwind CSS 4 + shadcn/ui |
| 运行时 | Bun 1.3+（开发/构建）；生产容器内为标准 node:22 |
| 采集侧 | 引擎运行于 node/next 进程；5 个 Bun 单文件代理 + 1 个可选 Python(Scrapling) 桥 |
| 部署 | Docker 多阶段构建（bun 构建 standalone → node:22-slim 运行）+ docker compose |

## 快速开始（Docker 一键安装，推荐）

前置：一台能装 Docker 的 Linux 服务器（或 macOS + Docker Desktop）；首次构建约需 **4GB 内存 / 4GB 磁盘**。

```bash
git clone https://github.com/u4399com-beep/heis.git novel-system
cd novel-system
bash install.sh
```

脚本会自动：检测 Docker（缺失时询问并自动安装；国内网络自动切换阿里云/清华/中科大镜像站）→ 配置 Docker Hub 拉取加速器与构建期依赖源加速（可关），基础镜像直指国内可达镜像站并构建前预拉兜底（失败自动换站重试，官方名经加速器拉取兜底）→ 预检端口 → `docker compose up -d --build` → 等健康检查通过（最长 5 分钟）→ 打印访问地址。重复执行安全（幂等），数据不受影响。无需预装 git：脚本检测到缺失会自动补装（apt/dnf/yum），git 不可用时自动改走 GitHub 压缩包下载兜底（详见 [DEPLOY.md](./DEPLOY.md) FAQ 第 14 条）；系统缺 gpg 时自动补装或走免 gpg 的 `.asc` 密钥方式（详见 [DEPLOY.md](./DEPLOY.md) FAQ 第 15 条）。国内部署全链路说明见 [DEPLOY.md](./DEPLOY.md) FAQ 第 11 条。部署完成后，还可在管理后台「采集规则」页对每条规则一键「极限校准」——对着模拟源站的三档封禁策略实测安全并发与速率，推荐参数（同站并发上限等）一键写回规则（用法见 [DEPLOY.md](./DEPLOY.md) 第六节）。

装完后**自动填充默认开启**（`AUTO_FILL=1`）：自动导入番茄/七猫/得奇/八零/精华/天天看/笔趣阁 7 个站点规则，创建「自动填充·」任务并开跑，首次跑完约 20~40 分钟前台就有书；每条任务完成后每 30 分钟自动增量续采。不想自动填充：`AUTO_FILL=0 bash install.sh`。

访问地址：

| 地址 | 用途 |
| --- | --- |
| `http://localhost:3000/` | 后台管理（规则/任务/书籍/章节） |
| `http://localhost:3000/?view=home` | 前台站点（书城/阅读/搜索） |

> ⚠️ 系统当前**后台无登录鉴权**，请勿直接暴露公网；生产建议放内网或前面加反向代理做 Basic Auth / IP 白名单。
> 改端口、备份、升级、卸载与常见问题全部见 **[DEPLOY.md](./DEPLOY.md)**。

## 本地开发快速开始

前置：安装 [Bun](https://bun.sh)（v1.3+）；可选 Python（仅 scrapling 桥需要）。

```bash
bun install                          # 安装依赖
cp .env.example .env                 # 环境变量模板(内容即一行 DATABASE_URL, 按需修改)
bun run db:push                      # 建表(幂等, SQLite 首次会自动创建 db/custom.db)
bun run dev                          # 启动 http://localhost:3000
```

默认入口：`http://localhost:3000/` 后台管理；`http://localhost:3000/?view=home` 前台站点。
⚠️ 后台无登录鉴权，勿直接暴露公网（生产部署方案见 DEPLOY.md，含反向代理建议）。

常用脚本（package.json）：`db:push` 建表同步 / `db:generate` 生成 Prisma Client / `lint`、`tsc --noEmit` 质量门。
注意 `db:reset` 是破坏性操作（清库），生产数据上禁用。

## mini-services 支撑服务（按需启动）

| 端口 | 服务 | 用途 | 启动 |
| --- | --- | --- | --- |
| 3010 | `bqg713-proxy` | 笔趣阁 bqg713 AES-token 外置转换代理（`/rewrite` `/token`） | `cd mini-services/bqg713-proxy && bun run dev` |
| 3011 | `fetch-relay` | bun fetch 中继桥（TLS 指纹出路，`RequestInit.proxy`） | `cd mini-services/fetch-relay && bun run dev` |
| 3012 | `scrapling-bridge` | Scrapling 桥：static(curl_cffi)/stealthy(patchright 解 CF 挑战)/playwright 三模式 | `cd mini-services/scrapling-bridge && bun run dev`（需先按其说明装 Python venv） |
| 3013 | `qimao-proxy` | 七猫官方 API 逐请求 MD5 双签名 + 正文 AES 解密 | `cd mini-services/qimao-proxy && bun run dev` |
| 3014 | `deqixs-proxy` | 得奇小说网正文三参数动态签名链路代理 | `cd mini-services/deqixs-proxy && bun run dev` |
| 3015 | `xjp-proxy` | 新键盘小说网 var c 双层正文解密代理 | `cd mini-services/xjp-proxy && bun run dev` |

- 本地开发模式下属可选增强：用到对应站点的签名/解密代理时才需启动；
- **Docker 部署时 5 个 bun 代理（3010/3011/3013/3014/3015）已随主容器共置**，容器内 `127.0.0.1:301x` 语义与开发模式一致，无需任何配置；仅 Python 版 `scrapling-bridge` 不进默认镜像（可选增强，见 DEPLOY.md 第四节）；
- 站级签名/解密代理按需增补（命名范式 `mini-services/<site>-proxy`，端口 301x 顺延），规则侧以 `127.0.0.1:301x` URL 直连或引擎 `tokenUrl` 钩子对接；
- 请勿把 3010~3015 端口暴露到不受信任的网络（`fetch-relay` 与 `scrapling-bridge` 源码钉死仅绑 127.0.0.1）。

## 目录结构

```
prisma/schema.prisma        # 数据模型: Category/Site/Rule/Task/Book/Chapter 等
db/custom.db                # SQLite 运行时数据(不入版本库)
data/                       # 封面 covers/、TXT 下载产物(不入版本库)
src/app/                    # Next.js App Router: /api/admin|public|download + 前台页面
src/components/             # 业务组件 + ui/(shadcn 完整组件库)
src/lib/crawl/              # 采集引擎(fetcher/parser/cleaner/sorter/runner/storage/obscura/...)
scripts/                    # 质量资产(见下)
mini-services/              # 上表六个支撑服务(各自独立 package.json)
docker/                     # 自动填充引导: autofill.mjs + autofill-rules.json(9 站点清单)
Dockerfile docker-compose.yml install.sh docker-entrypoint.sh   # 生产部署(见 DEPLOY.md)
```

### scripts/ 约定

- `verify-ss-a-docker.ts` / `verify-kk-b-docker.ts` / `verify-ll-a-docker.ts`：三套 Docker 断言资产（断言计数 + `process.exit` 码），CI 级质量关，长期保留。
- `seed-rule-*.ts`：单站真实采集规则幂等入库脚本；`seed-rules-v2.ts`：真实站点批量入库。
- `seed.ts`：全新库演示数据种子（分类/默认站点/示例规则 3 条/演示书 6 本，空库守卫，可重复执行）。
- `mock-novel-site.ts`：本地 mock 站点（离线验证用）。
- `export-autofill-rules.ts` / `fix-dd-b-stale-task.ts`：运维工具。
- `archive/`：历史轮次验证脚本归档（历史 verify-*/e2e-*/探针/取证样本，只移不删，不参与 tsc/lint 质量门），考古与复跑参考用途，见 `archive/README.md`。

### 质量门

```bash
bun run lint          # 必须 0 错误 0 警告
bunx tsc --noEmit     # 主代码 + scripts 零错误
```

## 数据备份

本地模式下数据全部在 `db/custom.db` 与 `data/`：停掉 dev server 后直接拷贝这两个目录即可。Docker 模式见 DEPLOY.md FAQ 第 2 条。

## 免责声明

1. 本项目仅供**学习与研究**用途，**不得用于商业用途**。
2. 采集功能请仅用于你有权访问的目标站点，使用时请**遵守目标站点的服务条款/robots 协议**，合理控制访问频率，勿对目标站点造成干扰。
3. 通过本项目采集到的全部内容（文字/封面等）**版权归原作者及原网站所有**；请勿传播、转载或转售采集所得数据。
4. 因使用本项目而产生的任何法律问题与责任，由**使用者自行承担**；项目作者与贡献者不对任何滥用行为负责。
5. 若你是站点所有者、不希望被本项目内置规则采集，请提交 issue 说明，我们会在后续版本移除对应规则。
