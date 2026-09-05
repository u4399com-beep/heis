# ============================================================
# 小说管理系统 — 生产镜像 (多阶段构建)
#
# 阶段 1 (builder): oven/bun:1 (Debian glibc) — bun install → prisma generate
#                   → next build (output: standalone) → 裁剪为纯生产依赖
# 阶段 2 (runner) : node:22-slim (同为 Debian glibc) — 构建期下载的 Prisma 引擎/
#                   sharp 平台二进制在运行期直接可用, 无 musl 兼容性问题
#
# 运行形态: standalone server.js (纯 node), 容器首启由 entrypoint 幂等执行
#           `prisma db push` 初始化 SQLite (/app/db/custom.db, 走宿主机 volume)
#           同容器共置 5 个 bun 采集代理(bqg713:3010/fetch-relay:3011/qimao:3013/
#           deqixs:3014/xjp:3015, ss-a 轮起共置) + 后台自动填充引导(AUTO_FILL=1 时导入规则/建任务/自动开跑)
#
# 国内镜像源(可选, uu-a): 构建期经 build args 注入 NPM_REGISTRY(空=官方源, 零回归),
#           由 install.sh 国内模式自动导出; 可选的 Dockerfile.scrapling 另有
#           DEBIAN_MIRROR / PIP_INDEX_URL / PLAYWRIGHT_DOWNLOAD_HOST 三件, 见其文件头
# 基础镜像源(可选, vv): BUN_IMAGE / NODE_IMAGE 经 ARG 可直指国内镜像站(例
#           docker.m.daocloud.io/oven/bun:1) —— BuildKit 拉取对 daemon.json 加速器兼容不稳,
#           镜像名直指镜像站是最稳路径; install.sh 国内模式自动探测可达镜像站并注入
#
# 验证状态 (kk-b): 交付时本机无 docker, 未真实构建; 已做语法/结构层自查
#                   (scripts/verify-kk-b-docker.ts), 详见 DEPLOY.md 顶部说明
# ============================================================

# 基础镜像可经构建参数直指国内镜像站(vv, 见头注); 官方默认 = 海外行为零回归
ARG BUN_IMAGE=oven/bun:1
ARG NODE_IMAGE=node:22-slim

# ---------- 阶段 1: 构建 ----------
FROM ${BUN_IMAGE} AS builder

WORKDIR /app

# 构建内存较大: 放宽 node 侧堆上限(next build 可能派生 node 子进程);
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 容器内采集走 native HTTP 引擎(全功能),
# 不需要 playwright 浏览器, 跳过可避免镜像膨胀数百 MB
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# 先只拷依赖清单与 schema → 层缓存友好(源码改动不触发依赖重装)
COPY package.json bun.lock ./
COPY prisma ./prisma

# 国内镜像源(可选, uu-a): 非空时依赖安装走该 registry(如 https://registry.npmmirror.com);
# 空默认 = 官方源, 行为零回归。由 docker-compose.yml build.args 传入,
# install.sh 国内模式自动导出, 也可手动 export 后自行构建
# (实测 bun 1.3+ 的 --registry 同时覆盖 manifest 解析与 bun.lock 内嵌的 tarball URL,
#  frozen-lockfile 完整性哈希不变, npmmirror 等同源镜像可直接命中)
ARG NPM_REGISTRY=""

RUN if [ -n "$NPM_REGISTRY" ]; then \
      bun install --frozen-lockfile --registry "$NPM_REGISTRY"; \
    else \
      bun install --frozen-lockfile; \
    fi

# 生成 Prisma Client。显式以 bun 执行 CLI 入口文件: oven/bun 镜像内没有 node,
# 走 node_modules/.bin 会因 `#!/usr/bin/env node` shebang 找不到 node 而失败
RUN bun node_modules/prisma/build/index.js generate

# 再拷全部源码与静态资源(.dockerignore 已剔除 db/data/node_modules/.next 等)
COPY . .

# next build (output: "standalone") + 把静态资源复制进 standalone 目录,
# 与 package.json 的 build 脚本完全同构; 同样绕过 .bin shebang 直接用 bun 执行
RUN bun node_modules/next/dist/bin/next build \
 && cp -r .next/static .next/standalone/.next/ \
 && cp -r public .next/standalone/

# 裁剪为纯生产依赖(含 prisma CLI, 供容器首启 db push 使用), 然后重新生成
# Prisma Client(重装 node_modules 后确保引擎二进制在位)。
# NPM_REGISTRY 条件式: 两个分支完整等价, 唯一差别是非空时追加 --registry
RUN if [ -n "$NPM_REGISTRY" ]; then \
      rm -rf node_modules \
      && bun install --production --frozen-lockfile --registry "$NPM_REGISTRY" \
      && bun node_modules/prisma/build/index.js generate; \
    else \
      rm -rf node_modules \
      && bun install --production --frozen-lockfile \
      && bun node_modules/prisma/build/index.js generate; \
    fi

# ---------- 阶段 2: 运行 ----------
FROM ${NODE_IMAGE} AS runner

WORKDIR /app

# HOSTNAME=0.0.0.0: standalone server 按 HOSTNAME 绑定, 容器内必须显式置 0.0.0.0
# DATABASE_URL: 与 docker-compose.yml 注入一致; 宿主机 .env(本机绝对路径)不进镜像
# 注意: 不在此设 AUTO_FILL 默认值 —— 由 compose 显式注入(裸 docker run 不自动填充);
#       也不改代理端口: entrypoint 逐个以 PORT=<port> 前缀覆盖启动(代理源码读 env.PORT,
#       若继承全局 PORT=3000 会与主服务冲突 —— ss-a 盘点实锤的地雷)
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/app/db/custom.db

# openssl: Prisma 引擎运行时依赖(slim 镜像默认不含); ca-certificates: 采集目标站 https 证书链
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# standalone 产物: server.js + 追踪的精简 node_modules + .next/static + public
COPY --from=builder /app/.next/standalone ./
# 完整生产 node_modules 覆盖追踪子集: 保证容器首启有可用 prisma CLI 做 db push
COPY --from=builder /app/node_modules ./node_modules
# schema 留在镜像内(不进 volume, 随镜像版本走)
COPY --from=builder /app/prisma ./prisma

# ── ss-a: 同容器共置采集代理(co-host) ──
# bun 单文件二进制(builder 即 oven/bun 镜像, 同为 Debian glibc、平台一致), 供 5 个采集代理运行;
# 规则 config 内写死 127.0.0.1:<port>, 同容器 localhost 语义与开发模式完全一致, 零配置漂移。
# vv 轮: 改由 builder 阶段拷贝 —— 消除 runner 阶段对镜像名的二次解析
# (基础镜像直指镜像站时, 避免 BuildKit 再去 docker.io 解析 oven/bun:1)
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun
# 5 个 bun 代理: 纯单文件 TS + 零第三方运行时依赖(仅 @types/bun devDep),
# 无需安装依赖直接以 bun 原生执行(scrapling-bridge 为 Python 可选增强, 不进默认镜像,
# 需要 compose --profile stealthy + 自备运行时, 见 DEPLOY.md 第五节)
COPY --from=builder /app/mini-services/bqg713-proxy ./mini-services/bqg713-proxy
COPY --from=builder /app/mini-services/fetch-relay ./mini-services/fetch-relay
COPY --from=builder /app/mini-services/qimao-proxy ./mini-services/qimao-proxy
COPY --from=builder /app/mini-services/deqixs-proxy ./mini-services/deqixs-proxy
COPY --from=builder /app/mini-services/xjp-proxy ./mini-services/xjp-proxy
# 自动填充引导脚本 + 规则/任务清单(entrypoint 后台拉起, 脚本内部轮询等 server 健康)
COPY docker/autofill.mjs docker/autofill-rules.json ./docker/

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/db /app/data/covers /app/data/downloads /app/data/novels /app/logs

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
