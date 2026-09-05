# 小说管理系统 — Docker 一键部署文档

> **验证状态（诚实声明）**：本套 Docker 交付物（Dockerfile / docker-compose.yml / install.sh /
> docker-entrypoint.sh）已通过两层验证：
> ① 语法与结构层自动化验证（`bun run scripts/verify-kk-b-docker.ts`：Dockerfile 分层/COPY 顺序/
>    EXPOSE、compose 键、脚本 `bash -n`/`sh -n` 语法、幂等与安全分支等数十项断言）；
> ② **ll 轮等价模拟生产验证**（`bun run scripts/verify-ll-a-docker.ts`）：因交付机器无 Docker
>    daemon（无 root），按 Dockerfile 逐命令在隔离目录**真实执行**了等价构建流程 —— bun install →
>    prisma generate → `next build`(standalone) → 裁剪生产依赖 → 按 runner 布局组装 →
>    容器 ENV 下运行 entrypoint（`prisma db push` 首建 + 幂等复跑 + 容错分支）→ `node server.js`
>    生产模式启动 → compose 同款 healthcheck 探活 → 首页/公开 API/管理 API/sitemap 端到端全 200。
>    实测确认了内存需求（Turbopack 构建峰值超 2GB，见下）；真实 Docker 构建的差异点仅剩基础镜像
>    拉取与 COPY 合并语义（模拟已按合并语义对齐）；
> ③ 自动填充链路 e2e（ss-a，对 dev server 全流程实测）：DRY_RUN 意图打印 / 规则幂等导入 /
>    建「自动填充·」任务并开跑 / 状态机续跑 / 幂等二连；结构断言见 `scripts/verify-ss-a-docker.ts`
>    （Dockerfile/entrypoint/compose/install.sh/autofill/构建源加速/基础镜像预拉兜底/加速器自检/镜像站清单/set-u 加固等十二段 106 项，实跑 106/106 ALL PASS）。<!-- count-sync -->

---

## 一、这套部署是什么

| 组成 | 说明 |
| --- | --- |
| 应用 | Next.js 16 小说管理系统（后台管理 + 前台站群），单服务 |
| 数据库 | SQLite（`db/custom.db`），容器首启自动 `prisma db push` 建表，**无需手动初始化** |
| 持久化 | 宿主机 `./db`（数据库）与 `./data`（封面/正文/下载产物）两个目录挂载进容器，**删容器不丢数据** |
| 采集引擎 | 容器内使用内置 **native HTTP 采集引擎（全功能）**，开箱即用 |
| mini-services | 5 个 bun 站点代理（3010/3011/3013/3014/3015）**随主容器共置自动启动**；仅 Python 版 `scrapling-bridge` 不启用（见文末第四节） |

硬件建议：首次构建约需 **4GB 内存 / 4GB 磁盘**（ll-a 真实构建实测: Turbopack 构建峰值超 2GB, 2GB 内存机器会被 OOM 杀）；运行期占用很小（单 SQLite + node 进程）。
支持架构：x86_64 与 arm64（镜像在部署机上现场构建，按机器架构自动适配）。

---

## 二、安装方式

### 方式 ① 一键脚本（推荐，适合零基础）

```bash
# 1) 拿到代码（任选其一）
git clone https://github.com/u4399com-beep/heis.git novel-system && cd novel-system
# 或者：把整个项目目录(含 Dockerfile/docker-compose.yml/install.sh)拷到服务器上

# 2) 一键安装：自动检测 Docker → 构建 → 启动 → 等健康检查 → 打印访问地址
bash install.sh
```

脚本会自动做这些事：

1. 检测 Docker 与 Docker Compose；**没有则询问你是否自动安装**
   （安装源多级自动切换：官方 `get.docker.com` → 阿里云 → 清华 → 中科大 —— 国内服务器官方源
   连不通时无需任何配置，脚本自动改用国内镜像站安装 Docker + compose 插件；
   服务器缺 gpg 时自动补装 gnupg 或改走免 gpg 的 `.asc` 密钥写 Docker 源（详见 FAQ 第 15 条）；
   macOS 给出 Docker Desktop 安装指引）；
2. 国内网络自适应：自动把 Docker Hub 拉取加速器合并写入 `/etc/docker/daemon.json` 并重启 docker，
   基础镜像直指可达镜像站并构建前预拉兜底（失败自动换站重试）；
   构建期依赖源（npm/pip/apt/playwright）同步切国内经 compose build args 注入；
   GitHub 克隆直连失败自动走加速代理（详见 FAQ 第 11 条）；
   未安装 git 自动补装（apt/dnf/yum），git 不可用或克隆全败时自动改走压缩包下载兜底（详见 FAQ 第 14 条）；
3. 预检端口 3000 占用情况；
4. `docker compose up -d --build` 构建并启动；
5. 轮询容器健康检查（最长等 5 分钟），失败时打印最近 50 行日志与中文排查清单；
6. 成功后打印访问地址（本机 + 局域网 IP）。

**重复执行 `bash install.sh` 是安全的（幂等）**：已有容器会被自动重建，
数据在 `./db`、`./data` 中不受影响。

远程一键（脚本直链方式，需要仓库可公开访问并填 `REPO_URL`）：

```bash
curl -fsSL https://raw.githubusercontent.com/u4399com-beep/heis/main/install.sh \
  | REPO_URL=https://github.com/u4399com-beep/heis.git bash
```

> 管道执行（`curl | bash`）模式下无法交互提问：若缺少 Docker，脚本会直接打印安装指引后退出。

### 方式 ② 手动部署（适合想看每一步在做什么的用户）

前置条件：已安装 Docker 20.10+（含 compose 插件，`docker compose version` 能出版本号）。

```bash
cd <项目目录>
docker compose up -d --build      # 构建镜像并后台启动
docker compose ps                 # STATUS 列出现 (healthy) 即就绪
```

访问 `http://localhost:3000` 即可。

容器首启时入口脚本会自动执行 `prisma db push`（幂等）：
- 全新部署：自动创建 `db/custom.db` 并建好全部表；
- 重复重启：库结构已一致则直接通过，**不会报"表已存在"，也不会动已有数据**。

### 自动填充：装完即有书（默认开启）

安装完成、服务健康检查通过后，容器内的引导脚本（`docker/autofill.mjs`）会**自动**：

1. 把 7 个实测站点的采集规则幂等导入数据库（番茄小说聚合API、七猫官方API、得奇小说网、八零电子书、精华书阁、天天看小说、笔趣阁bqg713；
   同名规则已存在则**跳过，绝不清空/覆盖你改过的规则**）；
2. 为每个站点创建一条「自动填充·」前缀的单书采集任务并自动开跑——首次跑完约 20~40 分钟内，
   前台 `/?view=home` 就会有真实书籍与正文可读；
3. 每条任务完成后每 30 分钟自动增量续采（autoRefresh），持续保持内容更新；
   容器重启后未完成的任务自动续跑（已完成的不会重跑）。

进度与明细：

```bash
docker compose logs -f | grep 自动填充   # 引导日志（[自动填充] 前缀）
docker compose logs -f                    # 全部日志（含各采集代理）
# 或打开后台 http://<IP>:3000/ 的「采集任务」页看实时进度
```

常用开关（重启容器后生效）：

```bash
AUTO_FILL=0 bash install.sh                                  # 关闭自动填充
AUTO_FILL_RULES=fanqie,qimao bash install.sh                 # 只自动填充指定站点
# 等价: 编辑 docker-compose.yml 的 environment 后 docker compose up -d
```

> 站点 key 对照：`fanqie`(番茄) / `qimao`(七猫) / `deqixs`(得奇) / `80ge`(八零电子书)
> / `jhssd`(精华书阁) / `ttkan`(天天看) / `bqg713`(笔趣阁) / `pili`(霹雳书屋，
> 默认不参与——依赖可选 scrapling 桥，见第四节) / `xjp`(新键盘小说网，默认不参与——
> 单书 6254 章体量大，需时加 `AUTO_FILL_RULES=...,xjp` 启用)。想采集更多书，装完在后台
> 「采集任务」里用任意规则再建任务即可。

### 默认入口

| 地址 | 用途 |
| --- | --- |
| `http://<IP>:3000/` | 后台管理 |
| `http://<IP>:3000/?view=home` | 前台站点（书城/阅读/搜索） |

> ⚠️ 安全提醒：系统当前**后台无登录鉴权**，请勿直接暴露公网。
> 生产建议放在内网，或前面加一层反向代理做 Basic Auth / IP 白名单。

---

## 三、常见问题 FAQ

### 1. 端口 3000 被占用了怎么办

编辑 `docker-compose.yml`，把 ports 左侧（宿主机端口）改成空闲端口，右侧容器端口**不要动**：

```yaml
    ports:
      - "8080:3000"     # 改成这样 → http://<IP>:8080 访问
```

然后 `docker compose up -d` 重建。查端口占用：`lsof -i :3000` 或 `ss -ltnp | grep 3000`。

### 2. 怎么备份数据

数据全部在宿主机项目目录下，备份 = 拷贝目录：

```bash
docker compose down                 # 停服（保证 SQLite 落盘一致）
cp -r db data /你的备份路径/         # 整体拷走
docker compose up -d                # 再启动
```

恢复：把备份的 `db/`、`data/` 放回项目目录后 `docker compose up -d`。

### 3. 怎么升级到新版本

```bash
git pull                            # 拉新代码（拷贝目录部署的用新代码覆盖）
bash install.sh                     # 重新跑一键脚本（幂等，会重建镜像与容器）
# 等价手动操作：docker compose up -d --build
```

- 升级**只替换程序**，`./db`、`./data` 里的数据不受影响；
- 若新版本改了数据库结构：首启的 `prisma db push` 会自动增量同步（安全字段都会自动加上）。

### 4. 数据库结构变更（需要删数据的破坏性变更）

入口脚本**刻意不带** `--accept-data-loss`，绝不静默销毁数据。若日志出现
`[警告] 数据库结构同步失败`：

```bash
docker compose down
cp -r db db.bak.$(date +%F)                              # 1) 先备份！
docker compose run --rm --entrypoint node novel-system \
  node_modules/prisma/build/index.js db push \
  --schema prisma/schema.prisma --accept-data-loss       # 2) 明确确认后强制同步
docker compose up -d
```

> 注意 `--entrypoint node` 不能省：镜像入口是 `docker-entrypoint.sh`（会做幂等 db push 并拉起
> 服务），不覆盖入口的话 `run` 后附的命令不会被执行。

### 5. 怎么看日志 / 重启 / 卸载

```bash
docker compose logs -f              # 跟踪日志（应用日志走 docker logs，不写文件）
docker compose logs --tail 100      # 最近 100 行
docker compose restart              # 重启
docker compose down                 # 停止并删除容器（数据保留）
docker compose down --rmi local     # 连同本机构建的镜像一起清理（卸载）
```

### 6. 无权限操作 Docker（permission denied）

```bash
sudo bash install.sh                       # 临时方案：sudo 执行
sudo usermod -aG docker "$USER"            # 长期方案：加入 docker 组
# 然后退出重新登录生效
```

### 7. 首次构建很慢 / 失败

- 首次构建要下载依赖并编译前端，**3~10 分钟属正常**；重复构建走缓存会快很多；
- 内存不足 2GB 可能被 OOM 杀掉（日志出现 `Killed`）：Dockerfile 已放宽 node 堆上限，
  再不行就加大机器内存或加 swap；
- 拉取 `oven/bun:1` / `node:22-slim` 基础镜像慢：一键脚本已自动配置 Docker Hub 加速器，并把基础镜像
  **直指可达镜像站 + 构建前预拉**（失败自动换站，见 FAQ 第 11 条三层保障）；手动部署请看 FAQ 第 11 条
  或 `USE_CN_MIRROR=1 bash install.sh`；加速器生效但构建仍卡拉镜像见 FAQ 第 13 条。

### 8. 构建期报 bun 兼容性错误（备选方案）

构建阶段显式用 bun 执行 `next build` 与 `prisma generate`（`bun node_modules/...`）。
若个别 bun 版本与 Next 16 组合报错，最稳的替代是把 Dockerfile 构建阶段的
`bun node_modules/next/dist/bin/next build` 等命令换回 `npm`/`node` 生态执行，
或反馈issue 按报错调整——镜像运行阶段始终是标准 `node:22-slim`，与 bun 无关。

### 9. 健康检查一直 starting / unhealthy

```bash
docker compose ps                   # 看状态
docker compose logs --tail 100      # 看报错
```

- 启动慢：`start_period` 已给 40 秒预热，慢机器可再调大；
- 日志出现 `[警告] 数据库结构同步失败`：见上面第 4 条。

### 10. macOS / Windows 能用吗

- macOS：装 Docker Desktop 后正常使用 `bash install.sh`；
- Windows：建议在 WSL2 (Ubuntu) 里执行，Docker Desktop 开启 WSL 集成即可。

### 11. 国内网络部署（安装 Docker / 拉镜像 / 构建依赖全链路加速）

一键脚本对国内服务器做了全链路自适应，默认零配置：

| 环节 | 脚本行为 | 可用开关 |
| --- | --- | --- |
| 安装 Docker | 官方 `get.docker.com` 探测不通（4 秒快速失败）→ 自动改用阿里云/清华/中科大镜像站安装 `docker-ce` 与 compose 插件 | `USE_CN_MIRROR=1` 强制国内 / `=0` 禁用 |
| 拉取基础镜像 | 三层保障：① 加速器——把 Docker Hub 加速器**合并**写入 `/etc/docker/daemon.json`（保留已有配置）并重启 docker，写完自检 `docker info` 是否真显示 `Registry Mirrors`（未显示=写盘未生效，有中文提示，不影响基础镜像拉取）；② 直指镜像站——`oven/bun`、`node`、`python` 基础镜像**直指探测可达的镜像站**构建（BuildKit 拉取对加速器兼容不稳，直指最稳）；③ 预拉兜底——构建前先预拉 `oven/bun` 与 `node`（python 属可选 scrapling 桥不预拉），失败自动**换站重试且换成的站即构建用站**；国内模式若未探测到任何镜像站，再用官方名 `docker pull` 预拉兜底（`docker pull` 走 daemon 加速器，与 BuildKit 拉取路径不同） | `REGISTRY_MIRRORS=地址1,地址2` 覆盖清单（自动修剪空项/空白项，全空回落默认清单）/ `SKIP_REGISTRY_MIRROR=1` 不改动 daemon.json；`BUN_IMAGE` / `NODE_IMAGE` / `PYTHON_IMAGE` 手动覆盖基础镜像（非 root + sudo 路径同样生效） |
| GitHub 克隆 | 直连失败自动尝试 ghfast.top / gh-proxy.com / ghproxy.net 加速代理（克隆后 origin 指回官方地址） | 无需配置 |
| 构建期依赖 | `bun install`→npmmirror、`pip`→阿里云 PyPI、apt→阿里云 Debian、playwright 浏览器内核→npmmirror（经 compose build args 注入，留空=海外默认） | `NPM_REGISTRY` / `PIP_INDEX_URL` / `DEBIAN_MIRROR` / `PLAYWRIGHT_DOWNLOAD_HOST` 手动覆盖 |

> - 内置镜像站候选共 **7 站**（加速器写入与镜像站直指同源）：`docker.m.daocloud.io` / `docker.1ms.run` /
>   `docker.aityp.com` / `docker.xuanyuan.me` / `hub.rat.dev` / `docker.1panel.live` / `docker.hlmirror.com`，
>   脚本按 `/v2/` 探活**依序选用首个可达站**；
> - `DEBIAN_MIRROR` 只传**主机名段**（如 `mirrors.aliyun.com`），不要带 `https://`（scrapling 镜像内 sed 拼接用）；
> - 手动配置加速器：`sudo tee /etc/docker/daemon.json <<< '{"registry-mirrors":["https://docker.m.daocloud.io"]}' && sudo systemctl restart docker`
> - 构建源加速对可选的 scrapling 镜像（`--profile stealthy`）同样生效。

### 12. 报错 `install.sh: line 480: USE_CN_MIRROR: unbound variable`（或任何 `unbound variable`）

**原因**：服务器上跑的是**旧版脚本**。旧版在 `set -u`（引用未定义变量即崩溃）严格模式下，
二次运行、检测到 Docker 已安装时引用了从未赋值的 `USE_CN_MIRROR`，直接崩溃；新版脚本已把
该变量预初始化为空串，此故障不会再出现。

**处理（三选一）**：

```bash
# ① 推荐：进项目目录更新脚本后重跑
cd novel-system && git pull && bash install.sh

# ② 删目录重新克隆（克隆代码这步自带 GitHub 加速回退，直连失败自动切代理；
#    先备份 ./db ./data 数据目录！装完放回即可）
rm -rf novel-system
curl -fsSL https://raw.githubusercontent.com/u4399com-beep/heis/main/install.sh \
  | REPO_URL=https://github.com/u4399com-beep/heis.git bash

# ③ 应急热修（一行补上变量预初始化，其余逻辑不变，改完直接重跑）：
sed -i 's/^set -euo pipefail/set -euo pipefail\nUSE_CN_MIRROR="${USE_CN_MIRROR:-}"/' install.sh
bash install.sh
```

### 13. 加速器已写入 daemon.json，但构建时仍卡在拉取镜像

Docker 的构建器 **BuildKit** 拉取基础镜像时对 `daemon.json` 的 `registry-mirrors`
加速器**兼容不稳**（可能仍直连 `docker.io` 官方源，导致超时）。一键脚本已对此做三层兜底：
基础镜像**直指可达镜像站**（BuildKit 拉取最稳路径）→ 构建前**预拉**（失败自动换站重试）→
国内模式未探测到镜像站时用官方名 `docker pull` 走 daemon 加速器预拉。正常无需任何处理。

自检加速器是否真的生效（`docker info` 有输出才算 daemon 真加载了）：

```bash
docker info | grep -A3 Mirrors
# 出现 "Registry Mirrors:" 段=已生效；无输出=daemon.json 未生效（docker 重启失败或 JSON 非法）
```

若构建仍卡在拉取，手动指定镜像站后重跑（非 root + sudo 执行同样生效）：

```bash
BUN_IMAGE=docker.m.daocloud.io/oven/bun:1 \
NODE_IMAGE=docker.m.daocloud.io/library/node:22-slim \
bash install.sh
```

### 14. 报错 `-bash: git: command not found`（服务器没装 git）

手动执行 `git pull` / `git clone` 时报 `git: command not found`，或旧版一键脚本在克隆代码阶段
因缺少 git 直接失败。**原因**：服务器上没有安装 git。新版 install.sh 已内置三层处理
（检测到缺 git 自动补装 → 补装失败自动改走压缩包下载 → 项目目录内运行根本不需要 git），
正常无需手动干预。

**处理（三选一）**：

```bash
# ① 推荐：直接重跑新版 install.sh —— 脚本检测到缺少 git 会自动经包管理器补装
bash install.sh

# ② 无需 git 的压缩包方式（脚本自动做的就是这个，手动等价命令如下）：
curl -fL https://github.com/u4399com-beep/heis/archive/refs/heads/main.tar.gz -o heis.tar.gz
tar -xzf heis.tar.gz && cd heis-main && bash install.sh
#    直连 GitHub 失败时，在下载 URL 前加加速代理前缀即可（脚本内置同款加速回退）：
curl -fL https://ghfast.top/https://github.com/u4399com-beep/heis/archive/refs/heads/main.tar.gz -o heis.tar.gz

# ③ 手动安装 git 后重跑
sudo apt install -y git        # Ubuntu / Debian
sudo yum install -y git        # CentOS / RHEL
```

> 附注：在已有项目目录内直接 `bash install.sh` 时，脚本本身**不需要 git**（只有克隆代码/
> 在线更新才需要）；已有目录但不是 git 仓库（如手动解压的压缩包）也会直接使用现有代码继续安装。

### 15. 报错 `install.sh: line NNN: gpg: command not found`（服务器没装 gpg，docker-ce 无安装候选）

在一键脚本安装 Docker 环节，日志先出现 `gpg: command not found`，随后 apt 报
`Failed to parse keyring "/etc/apt/keyrings/docker.gpg" ... is not signed` 与
`E: Package 'docker-ce' has no installation candidate`（阿里云/清华/中科大镜像站均同样失败）。
**原因**：Debian 12+ / Ubuntu 最小化系统常不预装 gpg，老版脚本写 Docker CE 源时硬依赖
`gpg --dearmor` 生成 keyring——gpg 缺失导致 `/etc/apt/keyrings/docker.gpg` 不存在，
apt 校验源签名失败，docker-ce 无安装候选。新版 install.sh 已内置三层降级
（gpg 在场走原路径 → 缺失自动补装 gnupg → 补装失败改用免 gpg 的 `.asc` 密钥），
正常无需手动干预。

**处理（三选一）**：

```bash
# ① 推荐：直接重跑新版 install.sh —— 自动补装 gnupg，补装不上自动改走免 gpg 的 .asc 密钥
bash install.sh

# ② 手动补装 gnupg 后重跑
sudo apt-get install -y gnupg
bash install.sh

# ③ 不想装 gnupg：确认 apt 版本 ≥ 2.4 即可，新版脚本会自动改走 .asc 密钥方式
apt --version
```

> 附注：Debian trixie（bookworm 同）的 apt 原生支持 `signed-by` 指向 `.asc` 盔甲密钥，
> 全程无需 gpg；报错行里出现的 `/usr/bin/sqv` 是 trixie 新引入的签名验证器，属正常现象，
> 不是故障原因。

### 16. 点「校准」提示「校准服务暂不可用」或探测全败

管理后台规则页的「校准 / 全量校准」需要先有一台**模拟源站**（校准默认对
`http://127.0.0.1:3040` 发探测请求）。提示暂不可用或探测全败时按序检查：

```bash
# ① 模拟源站未启动 → 启动它（Docker 部署在宿主机上跑）
bun scripts/ratelimit-site.ts --port 3040 --profile standard

# ② 确认可达：/stats 应返回 JSON 计数
curl http://127.0.0.1:3040/stats

# ③ Docker 部署：容器内的 127.0.0.1 指容器自身而不是宿主机 →
#    校准对话框「高级」里把源站地址改成容器可达的宿主机地址（见第六节 6.4）
```

补充：校准档位与模拟源站 `--profile` 不一致时（如源站 standard、校准选 strict），
结果消息会带 ⚠ 提醒，建议两侧保持同档；对真实站点校准属真实请求行为，务必谨慎
（见第六节 6.4 红线注意）。

---

## 四、mini-services 在 Docker 部署中的定位

**结论：5 个 bun 站点代理已随主容器共置（零配置）；仅 Python 版 scrapling-bridge 默认不启用。**

- `bqg713-proxy`(3010) / `fetch-relay`(3011) / `qimao-proxy`(3013) / `deqixs-proxy`(3014) /
  `xjp-proxy`(3015) 已打进主镜像，由容器入口脚本（docker-entrypoint.sh）自动拉起，
  自动填充规则内的 `127.0.0.1:301x` 即容器内回环，装完即用、无需任何配置；
- 核心采集能力由**内置 native HTTP 采集引擎**完整承担
  （规则四段解析、编码识别、翻页、正则清洗、并发限速等全功能），
  不依赖代理也可直连采集大部分站点，代理仅服务签名/解密类站点；
- `scrapling-bridge`(3012, Python) 是**可选增强**（个别强 JS 渲染/CF 挑战站备用路径）：
  镜像含 Python 与浏览器内核（GB 级），默认**不构建不启动**；确需时
  `docker compose --profile stealthy up -d --build`（经 network_mode 与主容器共享
  127.0.0.1 回环），并以 `AUTO_FILL_RULES=...,pili` 启用霹雳书屋自动填充；
  或在宿主机按本地开发模式跑（见 `README.md` 的「mini-services 支撑服务」表），
  Docker 容器与宿主机服务互不干扰。

---

## 五、文件清单

| 文件 | 作用 |
| --- | --- |
| `README.md` | 项目总览/快速开始/本地开发/目录结构 |
| `Dockerfile` | 多阶段构建：bun 构建 standalone → node:22-slim 运行（含 5 个共置代理与自动填充引导） |
| `docker-compose.yml` | 单服务编排：端口/数据卷/健康检查/自动重启/AUTO_FILL 注入（+ scrapling 可选 profile） |
| `docker-entrypoint.sh` | 容器入口：建目录 → 幂等 `prisma db push` → 拉起 5 代理 + 自动填充引导 → 启动 server |
| `install.sh` | 零基础一键安装：装 Docker（多源自动切换+国内加速）→ 构建 → 等健康 → 自动填充状态 → 打印地址 |
| `docker/autofill.mjs` | 自动填充引导脚本：等服务健康 → 幂等导入规则 → 建「自动填充·」任务并按状态机开跑 |
| `docker/autofill-rules.json` | 自动填充站点清单（9 站：默认 7 站，pili/xjp 需 AUTO_FILL_RULES 显式加） |
| `Dockerfile.scrapling` | 可选构建：scrapling 桥镜像（`--profile stealthy`，含浏览器内核 GB 级） |
| `.dockerignore` | 控制构建上下文：运行时数据/依赖/Python 桥/scripts 不进镜像 |
| `scripts/verify-*-docker.ts` | 结构自检脚本（`verify-kk-b-docker.ts` / `verify-ll-a-docker.ts` / `verify-ss-a-docker.ts`） |

---

## 六、采集规则极限校准（为每条规则实测安全的并发与速率）

管理后台「采集规则」页内置**极限校准**：校准引擎按规则的完整四段链路对「模拟源站」逐步加压
（并发梯 1→2→3→4→6→8→10、间隔梯 2000→150ms），实测该规则在不同封禁策略下能承受的
极限并发与最快节奏，并给出可直接落库的推荐参数。适合新规则上线前摸底、被 429/封禁困扰时重新定参。

### 6.1 入口与流程

| 入口 | 位置 | 形态 |
| --- | --- | --- |
| 单规则校准 | 规则行的「校准」按钮 | 对话框：选档位 → 开始 → 实时探测轨迹 → 结果卡；进行中可关闭对话框（后台继续，重开自动接续）或「取消校准」中止 |
| 全量校准 | 规则页工具栏「全量校准」 | 按所选档位逐条**串行**校准全部规则，进度 x/y，完成后逐条摘要 |

### 6.2 三档位（模拟源站封禁严格度）

| 档位 | 对应源站 profile | 封禁严格度 |
| --- | --- | --- |
| 宽松 | `lenient` | 封禁宽松（60s 窗 120 请求 / 2s 突发 12 请求起限），大步进探测，快速摸上限 |
| 标准（默认） | `standard` | 封禁中等（60s 窗 60 请求 / 2s 突发 6 请求），步进均衡，通用推荐 |
| 严格 | `strict` | 封禁严格（60s 窗 30 请求 / 2s 突发 3 请求），小步进保守探测，结果更稳妥；另含 UA 指纹检测 |

三档共用同一条封禁升级链：累计 429 达阈值 → 临时封禁 60 秒（403 + Retry-After）→ 解封后再犯
→ 410 永久封。校准档位应与模拟源站 `--profile` 保持一致，不一致时结果消息会带 ⚠ 提醒。

### 6.3 校准产物与「应用推荐」

结果卡五格结论：

| 结论 | 含义 |
| --- | --- |
| 极限并发 | 并发梯实测能通过的最大并发 |
| 极限间隔 | 间隔梯实测的最小安全批间隔（ms） |
| 推荐线程 | 由极限并发外推的安全区间（threadMin~threadMax），建任务时手动填写 |
| 推荐间隔 | 由极限间隔外推的安全区间（intervalMin~intervalMax），建任务时手动填写 |
| 同站并发上限 hostGateLimit | 点「应用推荐」后**唯一自动落库**的参数 |

「应用推荐」语义：把 hostGateLimit 写入该规则的 `config.fetch.hostGateLimit`
（采集引擎的同站并发闸门，hostGate 维度运行时生效）；推荐线程/推荐间隔只展示不落库，
需建任务/编辑规则时手动填入。结果同时持久化到 `Setting` 表（key=`calibration:<ruleId>`），
重开对话框自动回显最近一次结果；每档探测在「探测轨迹」折叠表可查（含 429/403 明细与备注）。
一轮完整校准约 3~6 分钟（标准档实测约 4~5 分钟；档间含冷却排空期，属正常节奏）。

### 6.4 模拟源站 scripts/ratelimit-site.ts

校准默认对本地模拟源站打，先启动它：

```bash
bun scripts/ratelimit-site.ts --port 3040 --profile standard   # profile ∈ lenient | standard | strict
```

- 页面结构与真实小说站四段同构（`/list` `/book` `/toc` `/chapter`），限流建模即 6.2 三档；
- `POST /reset`：清空全部 IP 计数与封禁状态。校准引擎对回环地址（127.0.0.1/localhost）
  默认每轮自动重置；指向非回环地址时不自动重置，重测前请手动
  `curl -X POST http://127.0.0.1:3040/reset`；
- `GET /stats`：观测计数（总请求/分状态码/窗口计数/封禁状态），本身豁免限流。

> **⚠️ 红线注意：模拟源站仅限本地/测试环境使用；对真实站点校准会真实请求源站，务必谨慎控制频率，可能触发封禁**
> （轻则 429 限流、重则 IP 被拉黑）。真实站点校准在对话框「高级」里改源站地址，
> 校准前请确认你有权对该站点做此类探测。

**Docker 部署注意**：校准引擎跑在**容器内**，容器里的 `127.0.0.1:3040` 指容器自身——
模拟源站在宿主机启动后，请在校准对话框「高级」把源站地址改成**容器可达的宿主机地址**
（宿主机内网 IP，或 compose 网络网关，`docker network inspect <项目>_default` 可查 Gateway，
形如 `http://172.18.0.1:3040`）。

规则字段与各参数的极限/推荐取值另见 `docs/rule-limits.md`（规则字段极限手册，ab 轮新增）。
