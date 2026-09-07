#!/usr/bin/env bash
# ============================================================
# 小说管理系统 — 零基础一键安装脚本 (中文提示 · 国内网络优化版)
#
# 做什么: 检测(必要时自动安装) Docker → 自动配置国内镜像加速(可关) →
#         构建镜像 → 启动容器 → 等健康检查通过 → 打印访问地址与自动填充状态。
#         重复执行安全(幂等): 已有容器会被自动重建, 数据保存在 ./db ./data 不受影响。
#
# 网络自适应(国内服务器友好):
#   - Docker 安装多源自动切换: 官方 get.docker.com → 阿里云 → 清华 → 中科大
#   - 装完自动配置 Docker Hub 镜像加速器 + 自检生效(docker info 可见 Registry Mirrors)
#   - 基础镜像(oven/bun、node)直指可达镜像站 + 构建前预拉兜底(失败自动换站重试)
#   - 未安装 git 自动补装(apt/dnf/yum); git 不可用时自动改走压缩包下载(main/master 依序, 复用加速代理)
#   - GitHub 克隆失败时自动走加速代理(ghfast.top / gh-proxy.com / ghproxy.net)
#   - 构建期依赖源自动切国内(npm/pip/apt/playwright, 经 compose build args 注入)
#
# 四种用法:
#   1) 已在项目目录内:        bash install.sh
#   2) 任意位置(默认克隆本仓库): bash install.sh
#                             (自动克隆到 $INSTALL_DIR, 默认 ./novel-system)
#   3) 指定仓库地址:          REPO_URL=<git仓库地址> bash install.sh
#   4) 远程一键(管道执行):    curl -fsSL <脚本直链>/install.sh | REPO_URL=<仓库地址> bash
#      注意: 管道模式下无法交互提问, 若缺少 Docker 会直接给出安装指引后退出。
#
# 可配置环境变量:
#   USE_CN_MIRROR          空=自动探测; 1=强制国内镜像; 0=禁用(全走海外官方源)
#   REGISTRY_MIRRORS       逗号分隔的 Docker Hub 加速器清单(覆盖默认)
#   SKIP_REGISTRY_MIRROR   1=不改动 /etc/docker/daemon.json
#   NPM_REGISTRY / PIP_INDEX_URL / DEBIAN_MIRROR / PLAYWRIGHT_DOWNLOAD_HOST
#                          构建期镜像源(自动模式会导出默认值, 也可手动覆盖)
#   BUN_IMAGE / NODE_IMAGE / PYTHON_IMAGE
#                          基础镜像直指镜像站(国内模式自动探测注入; BuildKit 拉取最稳路径)
#   AUTO_FILL / AUTO_FILL_RULES / HOST_PORT / WAIT_TIMEOUT / REPO_URL / INSTALL_DIR
#
# 退出码: 0 成功; 非 0 失败(会打印中文排查清单)
# ============================================================
set -euo pipefail

# ---------- 可配置项(均可用环境变量覆盖) ----------
REPO_URL="${REPO_URL:-}"            # 克隆仓库地址(不填则用 DEFAULT_REPO_URL)
DEFAULT_REPO_URL="https://github.com/u4399com-beep/heis.git"
INSTALL_DIR="${INSTALL_DIR:-}"      # 克隆目录(仅克隆模式生效, 默认 当前目录/novel-system)
APP_NAME="novel-system"             # 容器/服务名(与 docker-compose.yml 保持一致)
HOST_PORT="${HOST_PORT:-3000}"      # 期望的宿主机端口(用于占用检测提示)
WAIT_TIMEOUT="${WAIT_TIMEOUT:-300}" # 健康检查最长等待(秒)
GET_DOCKER_URL="https://get.docker.com"   # 官方安装脚本(多源候选之一)
USE_CN_MIRROR="${USE_CN_MIRROR:-}"  # 空=自动探测; 1=强制国内镜像; 0=禁用 —— 必须预初始化:
                                    # set -u 下引用未定义变量直接崩溃(vv 收官修复的用户实锤故障:
                                    # 二次运行检测到 Docker 已装, 该变量从未赋值 → unbound variable 崩溃)

# 国内构建源(自动模式导出默认值; 手动覆盖优先)
NPM_REGISTRY="${NPM_REGISTRY:-}"          # 例: https://registry.npmmirror.com
PIP_INDEX_URL="${PIP_INDEX_URL:-}"        # 例: https://mirrors.aliyun.com/pypi/simple/
DEBIAN_MIRROR="${DEBIAN_MIRROR:-}"        # 例: mirrors.aliyun.com (主机名段, 不带 scheme/路径)
PLAYWRIGHT_DOWNLOAD_HOST="${PLAYWRIGHT_DOWNLOAD_HOST:-}" # 例: https://npmmirror.com/mirrors/playwright
BUN_IMAGE="${BUN_IMAGE:-}"                # 例: docker.m.daocloud.io/oven/bun:1
NODE_IMAGE="${NODE_IMAGE:-}"              # 例: docker.m.daocloud.io/library/node:22-slim
PYTHON_IMAGE="${PYTHON_IMAGE:-}"          # 例: docker.m.daocloud.io/library/python:3.12-slim

# Docker 安装源候选(官方优先, 失败自动降级国内镜像)
DOCKER_CE_MIRRORS=(
  "https://mirrors.aliyun.com/docker-ce"
  "https://mirrors.tuna.tsinghua.edu.cn/docker-ce"
  "https://mirrors.ustc.edu.cn/docker-ce"
)

# Docker Hub 镜像加速 host 候选(基础镜像直指拉取用, 与 REGISTRY_MIRROR_DEFAULTS 同站去 scheme)
# 存活性实测(vv 收官轮, 真网双探 /v2/ 与 node:22-slim manifest):
#   401=标准 registry 质询(最可信) 403=有响应(可能挡 curl UA) 302=重定向型代理; 000=不可达剔除
#   剔除 docker.rainbond.cc(全超时); 新增 docker.aityp.com / docker.hlmirror.com
REGISTRY_HOST_CANDIDATES=(
  "docker.m.daocloud.io"
  "docker.1ms.run"
  "docker.aityp.com"
  "docker.xuanyuan.me"
  "hub.rat.dev"
  "docker.1panel.live"
  "docker.hlmirror.com"
)

# Docker Hub 镜像加速器默认清单(写入 /etc/docker/daemon.json, 与上同站带 scheme)
REGISTRY_MIRROR_DEFAULTS=(
  "https://docker.m.daocloud.io"
  "https://docker.1ms.run"
  "https://docker.aityp.com"
  "https://docker.xuanyuan.me"
  "https://hub.rat.dev"
  "https://docker.1panel.live"
  "https://docker.hlmirror.com"
)
REGISTRY_MIRRORS="${REGISTRY_MIRRORS:-}"        # 逗号分隔覆盖默认
SKIP_REGISTRY_MIRROR="${SKIP_REGISTRY_MIRROR:-0}" # 1=不碰 daemon.json

# GitHub 克隆加速代理前缀(直连失败时依序尝试)
GH_PROXY_PREFIXES=(
  "https://ghfast.top/"
  "https://gh-proxy.com/"
  "https://ghproxy.net/"
)

# ---------- 自动填充开关(ss-a): 透传给容器(与 docker-compose.yml environment 对应) ----------
# AUTO_FILL=1       装完即自动导入采集规则并启动「自动填充·」任务快速填满网站
# AUTO_FILL=0       只部署系统不预填内容(也可装完后在管理面板手动建规则/任务)
# AUTO_FILL_RULES   逗号分隔站点 key 清单(默认不含 pili —— 霹雳书屋依赖 scrapling 桥可选件)
AUTO_FILL="${AUTO_FILL:-1}"
AUTO_FILL_RULES="${AUTO_FILL_RULES:-fanqie,qimao,deqixs,80ge,jhssd,ttkan,bqg713}"
export AUTO_FILL AUTO_FILL_RULES

# ---------- 彩色中文输出 ----------
if [ -t 1 ]; then
  C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_B=$'\033[36m'; C_0=$'\033[0m'
else
  C_G=""; C_Y=""; C_R=""; C_B=""; C_0=""
fi
info() { printf '%s\n' "${C_B}[信息]${C_0} $*"; }
ok()   { printf '%s\n' "${C_G}[完成]${C_0} $*"; }
warn() { printf '%s\n' "${C_Y}[注意]${C_0} $*"; }
err()  { printf '%s\n' "${C_R}[错误]${C_0} $*" >&2; }

# 失败兜底: 零基础用户也能拿着清单去排查
on_error() {
  local ec=$?
  err "安装失败 (退出码 ${ec})。常见原因排查清单:"
  err "  1) Docker 守护进程未运行 → 尝试: sudo systemctl start docker (macOS 打开 Docker Desktop)"
  err "  2) 无权限操作 Docker     → 尝试: sudo bash install.sh , 或把当前用户加入 docker 组后重新登录"
  err "  3) 端口 ${HOST_PORT} 被占用 → 修改 docker-compose.yml 中 ports 左侧端口"
  err "  4) 构建内存/磁盘不足     → 首次构建约需 4GB 内存(2GB 会 OOM)、4GB 磁盘; 关闭大程序后重试"
  err "  5) 国内网络问题          → 本脚本已自动切换国内镜像源; 若仍失败请检查代理/防火墙,"
  err "     或用 USE_CN_MIRROR=1 强制国内源重试, 加速器清单可用 REGISTRY_MIRRORS=地址1,地址2 覆盖"
  err "     基础镜像拉取仍超时可手动指定: BUN_IMAGE=<镜像站>/oven/bun:1 NODE_IMAGE=<镜像站>/library/node:22-slim bash install.sh"
  err "  6) 更多见项目内 DEPLOY.md『常见问题』"
}
trap on_error ERR

# ---------- 交互检测: 管道执行(curl | bash)时无法提问 ----------
INTERACTIVE=1
if [ ! -t 0 ]; then
  INTERACTIVE=0
  warn "检测到非交互执行(管道), 全程不再询问; 如需安装 Docker 请先手动安装后重跑本脚本"
fi

ask_yes_no() { # ask_yes_no <提示>  → 0=是 1=否; 非交互一律返回 1
  local q="$1" ans=""
  [ "$INTERACTIVE" -eq 1 ] || return 1
  while true; do
    read -r -p "$(printf '%s' "${C_Y}[询问]${C_0} ${q} [Y/n]: ")" ans || return 1
    case "$ans" in
      ""|y|Y|yes|YES|是) return 0 ;;
      n|N|no|NO|否)      return 1 ;;
      *) warn "请输入 y 或 n" ;;
    esac
  done
}

# ---------- sudo 预备(非 root 时尽量借 sudo) ----------
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

# ---------- 系统信息(包管理器/发行版) ----------
# (xx 轮前移到步骤 0 之前: ensure_git 自动装 git 需先知道包管理器; Docker 源配置亦复用)
PKG=""
if command -v apt-get >/dev/null 2>&1; then PKG="apt"
elif command -v dnf >/dev/null 2>&1; then PKG="dnf"
elif command -v yum >/dev/null 2>&1; then PKG="yum"
fi
REPO_ID="" ; CODENAME=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  REPO_ID="${ID:-}"
  # LinuxMint 等衍生版: 用上游发行版代号(Ubuntu 仓库)
  CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
fi

ensure_git() { # 确保 git 存在(缺失时经系统包管理器自动装; 失败不致命, clone_repo 会走压缩包兜底)
  command -v git >/dev/null 2>&1 && return 0
  info "未检测到 git, 尝试自动安装..."
  case "$PKG" in
    apt)
      export DEBIAN_FRONTEND=noninteractive
      $SUDO apt-get update -y && $SUDO apt-get install -y git
      ;;
    dnf) $SUDO dnf install -y git ;;
    yum) $SUDO yum install -y git ;;
    *)   warn "无法识别包管理器(非 apt/dnf/yum), 跳过 git 自动安装"; return 1 ;;
  esac
}

# ============================================================
# 网络探测工具
# ============================================================
probe_url() { # probe_url <url> [connect超时秒, 默认5] → 0=可达
  local url="$1" t="${2:-5}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --connect-timeout "$t" --max-time $((t * 3)) -o /dev/null "$url" 2>/dev/null
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T "$t" -t 1 -O /dev/null "$url" 2>/dev/null
  else
    return 2
  fi
}

git_probe() { # git_probe <超时秒> <仓库url> → 0=可达
  local t="$1" url="$2"
  if command -v timeout >/dev/null 2>&1; then
    timeout "$t" git ls-remote --exit-code "$url" HEAD >/dev/null 2>&1
  else
    git ls-remote --exit-code "$url" HEAD >/dev/null 2>&1
  fi
}

fetch_tarball() { # fetch_tarball <仓库url> <目标目录> — 无 git(或克隆全败)时的压缩包兜底
  # 从 https://github.com/OWNER/REPO 推导归档直链, main → master 依序,
  # 每个分支先试直连再试 GH_PROXY_PREFIXES 加速代理, 下载后解包到目标目录。
  local url="$1" dest="$2" p branch tmp inner
  case "$url" in
    https://github.com/*) ;;
    *) warn "非 GitHub 仓库地址, 无压缩包兜底通道: ${url}"; return 1 ;;
  esac
  local repo_path="${url#https://github.com/}"
  repo_path="${repo_path%.git}"
  for branch in main master; do
    local candidates=("https://github.com/${repo_path}/archive/refs/heads/${branch}.tar.gz")
    for p in "${GH_PROXY_PREFIXES[@]}"; do
      candidates+=("${p}https://github.com/${repo_path}/archive/refs/heads/${branch}.tar.gz")
    done
    local arch
    for arch in "${candidates[@]}"; do
      info "尝试压缩包下载: ${arch}"
      tmp="$(mktemp -d)" || return 1
      if curl -fsSL --connect-timeout 10 --max-time 300 -o "${tmp}/repo.tar.gz" "$arch" 2>/dev/null \
        || wget -q -T 10 -t 1 -O "${tmp}/repo.tar.gz" "$arch" 2>/dev/null; then
        if tar -xzf "${tmp}/repo.tar.gz" -C "$tmp" 2>/dev/null; then
          inner="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 1)"
          if [ -n "$inner" ]; then
            mkdir -p "$dest"
            # cp 失败必须兜住(磁盘满/权限/dest 异常): 本函数仅在 if 条件上下文被调用,
            # set -e 不会杀脚本, 不守卫会带着假成功 ok+return 0 继续跑(xx-c 复审实证)
            cp -a "$inner"/. "$dest"/ || { rm -rf "$tmp"; return 1; }
            rm -rf "$tmp"
            ok "压缩包下载并解包完成 → ${dest}"
            return 0
          fi
          warn "压缩包内容异常(无顶层目录)"
        else
          warn "压缩包解压失败(文件可能不完整)"
        fi
      else
        warn "压缩包下载失败, 换下一个源重试..."
      fi
      rm -rf "$tmp"
    done
  done
  return 1
}

probe_registry_host() { # probe_registry_host <host> → 0=可达(任意 HTTP 响应含 401 都算; 000=连不上)
  local h="$1" code="000"
  if command -v curl >/dev/null 2>&1; then
    # 注意: curl 失败时 -w 也会输出 000(vv-a 复审实证), 不能再 `|| echo 000` 追加 ——
    # 否则 code="000000" != "000", 不可达主机被误判可达, pick 永远返回第一个候选,
    # 「全挂→daemon.json 加速器兜底」路径成死代码。改为经赋值退出码归一:
    code="$(curl -sS --connect-timeout 4 --max-time 8 -o /dev/null -w '%{http_code}' "https://${h}/v2/" 2>/dev/null)" || code="000"
  fi
  [ -n "$code" ] && [ "$code" != "000" ]
}

pick_registry_host() { # 输出首个可达的镜像加速 host; 全不可达则返回 1
  local h
  for h in "${REGISTRY_HOST_CANDIDATES[@]}"; do
    if probe_registry_host "$h"; then
      printf '%s\n' "$h"
      return 0
    fi
  done
  return 1
}

clone_repo() { # clone_repo <仓库地址> <目标目录>
  local url="$1" dest="$2"
  if [ -d "${dest}/.git" ]; then
    if command -v git >/dev/null 2>&1; then
      info "目录已存在, 更新代码: ${dest}"
      git -C "$dest" pull --ff-only || warn "git pull 失败, 使用现有代码继续"
    else
      warn "目录已存在但系统未安装 git, 跳过在线更新, 使用现有代码继续"
      warn "如需在线升级: 先安装 git (Ubuntu/Debian: apt install -y git; CentOS: yum install -y git) 后重跑"
    fi
    return 0
  fi
  if ! command -v git >/dev/null 2>&1; then
    warn "未检测到 git 且目录不是 git 仓库, 改走压缩包方式下载..."
    if fetch_tarball "$url" "$dest"; then return 0; fi
    err "压缩包下载也失败。请检查网络后重试, 或先安装 git 后重跑(脚本会自动装):"
    err "  Ubuntu/Debian: apt install -y git    CentOS/RHEL: yum install -y git"
    return 1
  fi
  if git_probe 10 "$url"; then
    info "克隆仓库 ${url} → ${dest}"
    git clone --depth 1 "$url" "$dest"
    return 0
  fi
  warn "GitHub 直连失败(国内网络常见), 尝试加速代理..."
  local p proxied
  for p in "${GH_PROXY_PREFIXES[@]}"; do
    proxied="${p}${url}"
    if git_probe 12 "$proxied"; then
      info "使用加速源 ${p} 克隆..."
      git clone --depth 1 "$proxied" "$dest" || continue
      # origin 指回官方地址, 便于后续正常 git pull/升级
      git -C "$dest" remote set-url origin "$url" 2>/dev/null || true
      return 0
    fi
  done
  warn "git 克隆全败(直连与加速代理均不可达), 最后尝试压缩包方式..."
  if fetch_tarball "$url" "$dest"; then return 0; fi
  err "仓库获取失败(克隆与压缩包均不可达)。请检查网络后重试, 或:"
  err "  A) 手动下载项目压缩包解压后, 进入目录执行 bash install.sh"
  err "  B) 换可用网络/代理后重跑"
  return 1
}

# ============================================================
# 步骤 0: 定位项目目录(当前目录 or 克隆)
# ============================================================
PROJECT_DIR=""
if [ -f "docker-compose.yml" ] && [ -f "Dockerfile" ]; then
  PROJECT_DIR="$(pwd)"
  info "在当前目录发现项目: ${PROJECT_DIR}"
else
  if [ -z "$REPO_URL" ]; then
    REPO_URL="$DEFAULT_REPO_URL"
    info "未指定 REPO_URL, 使用默认仓库: ${REPO_URL}"
  fi
  DEST="${INSTALL_DIR:-${PWD}/novel-system}"
  ensure_git || warn "git 暂不可用, 克隆阶段将自动改走压缩包方式"
  clone_repo "$REPO_URL" "$DEST"
  PROJECT_DIR="$DEST"
fi
cd "$PROJECT_DIR"
for f in docker-compose.yml Dockerfile docker-entrypoint.sh \
         docker/autofill.mjs docker/autofill-rules.json \
         mini-services/bqg713-proxy/index.ts mini-services/fetch-relay/index.ts \
         mini-services/qimao-proxy/index.ts mini-services/deqixs-proxy/index.ts; do
  if [ ! -f "$f" ]; then err "缺少文件 ${f}, 仓库不完整, 请重新克隆"; exit 1; fi
done

# ============================================================
# 步骤 1: 检测/安装 Docker (多源自动切换)
# ============================================================
OS="$(uname -s)"

# (PKG/REPO_ID/CODENAME 探测已前移到步骤 0 之前 — xx 轮, 供 ensure_git 复用)

ensure_fetcher() { # 确保 curl/wget 存在(apt 系补装 curl 时顺带 gnupg/certificates; gpg 缺失的完整降级链在 setup_docker_repo_apt 内)
  if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; then
    return 0
  fi
  if [ "$PKG" = "apt" ]; then
    info "缺少 curl/wget, 先用 apt 安装 curl..."
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get update -y && $SUDO apt-get install -y curl ca-certificates gnupg
  else
    err "系统缺少 curl/wget, 无法自动安装 Docker; 请先手动安装 curl 后重跑本脚本"
    return 1
  fi
}

setup_docker_repo_apt() { # setup_docker_repo_apt <镜像站base>  例 https://mirrors.aliyun.com/docker-ce
  local base="$1"
  info "配置 Docker CE 软件源(${base}, 发行版 ${REPO_ID} ${CODENAME})..."
  $SUDO install -m 0755 -d /etc/apt/keyrings
  # gpg 依赖三层降级(yy 轮): Debian trixie/Ubuntu 最小化系统常缺 gpg ——
  # ① gpg 在场 → 原版 dearmor 路径; ② 缺失 → 先尽力补装 gnupg(系统源通常可用);
  # ③ 补装失败 → 改写 .asc 盔甲密钥(apt ≥ 2.4 原生支持 signed-by .asc, 无需 gpg)
  local keyfile="/etc/apt/keyrings/docker.gpg"
  if ! command -v gpg >/dev/null 2>&1; then
    warn "未检测到 gpg, 尝试自动补装 gnupg..."
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get install -y gnupg >/dev/null 2>&1 \
      || { $SUDO apt-get update -y >/dev/null 2>&1 || true; $SUDO apt-get install -y gnupg >/dev/null 2>&1 || true; }
    if command -v gpg >/dev/null 2>&1; then
      ok "gpg 已就绪"
    else
      warn "gpg 暂不可用, 改用免 gpg 的 .asc 密钥方式(apt 2.4+ 支持; 若后续 apt 报 is not signed, 手动 apt install -y gnupg 后重跑)"
      keyfile="/etc/apt/keyrings/docker.asc"
      curl -fsSL --connect-timeout 10 "${base}/linux/${REPO_ID}/gpg" | $SUDO tee "$keyfile" >/dev/null
    fi
  fi
  if [ "$keyfile" = "/etc/apt/keyrings/docker.gpg" ]; then
    curl -fsSL --connect-timeout 10 "${base}/linux/${REPO_ID}/gpg" \
      | $SUDO gpg --dearmor --yes -o "$keyfile"
  fi
  echo "deb [signed-by=${keyfile}] ${base}/linux/${REPO_ID} ${CODENAME} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

setup_docker_repo_rhel() { # setup_docker_repo_rhel <镜像站base>
  local base="$1"
  info "配置 Docker CE 软件源(${base}, ${PKG})..."
  $SUDO curl -fsSL --connect-timeout 10 -o /etc/yum.repos.d/docker-ce.repo "${base}/linux/centos/docker-ce.repo"
  $SUDO sed -i "s#download.docker.com#${base#https://}#g" /etc/yum.repos.d/docker-ce.repo
  $SUDO "$PKG" makecache >/dev/null 2>&1 || true
  $SUDO "$PKG" install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_docker_linux() {
  ensure_fetcher
  # ── 候选源探测: 官方脚本 → 阿里云 → 清华 → 中科大(每个 4 秒内快速失败) ──
  info "正在探测可用的 Docker 安装源(官方与国内镜像站)..."
  if probe_url "$GET_DOCKER_URL" 4; then
    info "将使用 Docker 官方安装脚本 (${GET_DOCKER_URL}) 自动安装 Docker..."
    if [ -n "$SUDO" ]; then
      if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 10 "$GET_DOCKER_URL" | $SUDO sh
      else wget -qO- -T 15 "$GET_DOCKER_URL" | $SUDO sh; fi
    else
      if command -v curl >/dev/null 2>&1; then curl -fsSL --connect-timeout 10 "$GET_DOCKER_URL" | sh
      else wget -qO- -T 15 "$GET_DOCKER_URL" | sh; fi
    fi
  else
    warn "Docker 官方源不可达(国内网络常见), 自动切换国内镜像站安装..."
    local base installed=1
    for base in "${DOCKER_CE_MIRRORS[@]}"; do
      local probe_ok=""
      case "$PKG" in
        apt)
          [ -n "$REPO_ID" ] && [ -n "$CODENAME" ] || continue
          probe_url "${base}/linux/${REPO_ID}/dists/${CODENAME}/Release" 4 && probe_ok=1
          ;;
        dnf|yum)
          probe_url "${base}/linux/centos/docker-ce.repo" 4 && probe_ok=1
          ;;
        *)
          ;;
      esac
      if [ -n "$probe_ok" ]; then
        case "$PKG" in
          apt)      setup_docker_repo_apt "$base"  && installed=0 ;;
          dnf|yum)  setup_docker_repo_rhel "$base" && installed=0 ;;
        esac
        [ "$installed" -eq 0 ] && break
      else
        warn "镜像站不可达或不含当前发行版: ${base}"
      fi
    done
    if [ "$installed" -ne 0 ]; then
      err "所有安装源均不可达。请手动安装 Docker 后重跑本脚本:"
      err "  1) 阿里云镜像安装指引: https://developer.aliyun.com/mirror/docker-ce"
      err "  2) 或配置代理后重跑:   curl -fsSL ${GET_DOCKER_URL} | sudo sh"
      err "  3) macOS/Windows: 安装 Docker Desktop 后重跑"
      err "  4) 日志若见 gpg: command not found → 先手动 apt install -y gnupg 后重跑(新版脚本已可自愈)"
      return 1
    fi
  fi
  # 有 systemd 就顺手设开机自启
  if command -v systemctl >/dev/null 2>&1; then
    $SUDO systemctl enable --now docker >/dev/null 2>&1 || warn "未能自动启动 docker 服务, 请手动: sudo systemctl start docker"
  fi
  ok "Docker 安装完成"
}

if command -v docker >/dev/null 2>&1; then
  ok "检测到 Docker: $(docker --version)"
else
  warn "未检测到 Docker"
  case "$OS" in
    Linux)
      if ask_yes_no "是否现在自动安装 Docker (Ubuntu/Debian/CentOS 等主流发行版适用, 国内网络自动切镜像站)?"; then
        install_docker_linux
      else
        err "已跳过自动安装。请手动安装 Docker 后重跑本脚本:"
        err "  Ubuntu/Debian 一键官方脚本: curl -fsSL ${GET_DOCKER_URL} | sudo sh"
        err "  国内网络(官方源不通): 参见 https://developer.aliyun.com/mirror/docker-ce"
        exit 1
      fi
      ;;
    Darwin)
      err "macOS 请先安装 Docker Desktop 后重跑本脚本:"
      err "  1) 官网下载: https://www.docker.com/products/docker-desktop/"
      err "  2) 或 Homebrew: brew install --cask docker"
      err "  3) 安装后启动 Docker Desktop, 等右上角鲸鱼图标就绪, 再运行 bash install.sh"
      exit 1
      ;;
    *)
      err "当前系统 ${OS} 无自动安装方案, 请参考 https://docs.docker.com/get-docker/ 手动安装后重跑"
      exit 1
      ;;
  esac
fi

# Docker 守护进程可用性 + 权限自适应(非 root 且未入 docker 组 → 走 sudo)
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then
    DOCKER=($SUDO docker)
    warn "当前用户无权直接访问 Docker, 后续命令将通过 sudo 执行"
    warn "(可选) 免 sudo: sudo usermod -aG docker \"\$USER\" 然后重新登录"
  else
    err "Docker 守护进程未运行或不可用。请先启动:"
    err "  Linux:   sudo systemctl start docker   (macOS: 打开 Docker Desktop)"
    exit 1
  fi
fi

# ============================================================
# 步骤 1.5: 国内网络自适应(镜像加速器 + 构建源切换)
# ============================================================
MIRROR_INFO=""
CN_MODE=0                 # 国内模式标记(预拉兜底判定用; USE_CN_MIRROR=1 或探测判定均为 1)

# 加速器生效自检(vv 收官轮): daemon 真加载了 daemon.json 的 registry-mirrors 时
# docker info 才会输出 "Registry Mirrors:" 段; 未输出=写盘未生效(重启失败/JSON 非法等)
verify_mirrors_active() {
  if "${DOCKER[@]}" info 2>/dev/null | grep -qi 'Registry Mirrors'; then
    ok "加速器已生效(docker info 可见 Registry Mirrors)"
  else
    warn "docker info 未显示 Registry Mirrors, daemon.json 加速器可能未生效(重启失败或 JSON 非法);"
    warn "  不影响基础镜像拉取(已直指镜像站), 如需 docker pull 也走加速请手动检查 daemon.json"
  fi
}

configure_registry_mirrors() {
  if [ "$SKIP_REGISTRY_MIRROR" = "1" ]; then
    info "SKIP_REGISTRY_MIRROR=1, 跳过 Docker Hub 镜像加速器配置"
    return 0
  fi
  if [ "$OS" != "Linux" ]; then
    warn "非 Linux 环境, 跳过加速器配置(Docker Desktop 请在其设置界面添加 registry-mirrors)"
    return 0
  fi
  local -a MIRRORS=() USER_MIRRORS=()
  local m
  if [ -n "$REGISTRY_MIRRORS" ]; then
    IFS=',' read -ra USER_MIRRORS <<< "$REGISTRY_MIRRORS"
    # 修剪空白/空项(如 "a,,b" 或 "a, b"); 全空回落默认清单
    # (防 first 为空 → grep -qF "" 对任意文件恒真 → 误判已配置而跳过真实写入)
    for m in "${USER_MIRRORS[@]+"${USER_MIRRORS[@]}"}"; do
      m="$(printf '%s' "$m" | tr -d '[:space:]')"
      if [ -n "$m" ]; then MIRRORS+=("$m"); fi
    done
    if [ "${#MIRRORS[@]}" -eq 0 ]; then
      warn "REGISTRY_MIRRORS 未含有效地址, 回落默认加速器清单"
      MIRRORS=("${REGISTRY_MIRROR_DEFAULTS[@]}")
    fi
  else
    MIRRORS=("${REGISTRY_MIRROR_DEFAULTS[@]}")
  fi
  local first="${MIRRORS[0]}"
  if [ -f /etc/docker/daemon.json ] && grep -qF "$first" /etc/docker/daemon.json 2>/dev/null; then
    ok "Docker Hub 镜像加速器已配置(${first}), 跳过"
    MIRROR_INFO="$first"
    verify_mirrors_active
    return 0
  fi
  local merged=0
  if command -v python3 >/dev/null 2>&1; then
    # 合并写入(保留 daemon.json 已有配置, 不覆盖用户自定义项)
    if $SUDO python3 - "${MIRRORS[@]}" <<'PYEOF'
import json, sys
p = "/etc/docker/daemon.json"
mirrors = [m.strip() for m in sys.argv[1:] if m.strip()]
try:
    with open(p) as f:
        cfg = json.load(f)
except Exception:
    cfg = {}
old = cfg.get("registry-mirrors") or []
merged = mirrors + [m for m in old if m not in mirrors]
cfg["registry-mirrors"] = merged
with open(p, "w") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print("registry-mirrors =", merged)
PYEOF
    then merged=1; else warn "daemon.json 写入失败(权限/只读盘?), 跳过加速器配置(不影响基础镜像拉取: 已直指镜像站)"; fi
  elif [ ! -s /etc/docker/daemon.json ]; then
    # 无 python3 且无既有配置: 直接写最小 JSON
    # (vv 收官轮修复: 原 IFS='","' 拼接实际以 IFS 首字符 '"' 连接, 产出
    #  ["https://a"https://b"] 非法 JSON → daemon 可能拒启; 改为逐项补 ',' 连接)
    local joint=""
    for m in "${MIRRORS[@]}"; do joint+="${joint:+\",\"}${m}"; done
    echo "{\"registry-mirrors\":[\"${joint}\"]}" | $SUDO tee /etc/docker/daemon.json >/dev/null
    merged=1
  else
    warn "/etc/docker/daemon.json 已存在且系统无 python3, 无法安全合并, 请手动配置后重启 docker:"
    warn "  例: {\"registry-mirrors\": [\"${first}\"]}   然后: sudo systemctl restart docker"
    return 0
  fi
  if [ "$merged" -eq 1 ]; then
    MIRROR_INFO="${MIRRORS[*]}"
    ok "已写入 Docker Hub 镜像加速器(共 ${#MIRRORS[@]} 个, 首选 ${first})"
    info "重启 docker 服务使加速器生效(正在运行的容器会随之重启, 数据不受影响)..."
    if command -v systemctl >/dev/null 2>&1; then
      $SUDO systemctl daemon-reload >/dev/null 2>&1 || true
      $SUDO systemctl restart docker >/dev/null 2>&1 || $SUDO service docker restart >/dev/null 2>&1 \
        || warn "docker 重启失败, 请手动执行: sudo systemctl restart docker"
    else
      $SUDO service docker restart >/dev/null 2>&1 || warn "docker 重启失败, 请手动重启"
    fi
    if "${DOCKER[@]}" info >/dev/null 2>&1; then
      ok "docker 已带加速器重启"
      verify_mirrors_active
    else
      warn "重启后 docker 暂不可用, 请检查: sudo systemctl status docker"
    fi
  fi
}

detect_cn_network() { # 0=判定国内(或不可达走稳妥路线)
  if [ -n "$USE_CN_MIRROR" ]; then
    [ "$USE_CN_MIRROR" = "1" ]
    return
  fi
  if probe_url "$GET_DOCKER_URL" 3; then
    return 1   # 官方源可达 → 按海外处理
  fi
  return 0
}

# ---------- 基础镜像预拉兜底(vv 收官轮) ----------
# 为何预拉: ①构建期 BuildKit 拉取失败时错误深埋 build 输出, 预拉把失败提前暴露并给中文提示
#           ②/v2/ 探活通 ≠ manifest 代理真通(实测存在此形态), 预拉失败自动换站重试并反写
#             BUN_IMAGE/NODE_IMAGE(拉成功的站=构建用站, 经 BUILD_ENV/sudo env 透传 compose)
#           ③预拉成功即入本地存储, 构建期 BuildKit 对 FROM 直接命中本地缓存零网络
# 仅预拉默认构建必需的 BUN_IMAGE/NODE_IMAGE 两个; PYTHON_IMAGE 属可选 scrapling 桥
# (--profile stealthy 才构建), 保持构建参数注入即可, 不预拉省默认安装流量
prepull_base_images() {
  local vn img host rest cand alt switched
  for vn in BUN_IMAGE NODE_IMAGE; do
    img="${!vn}"
    if [ -z "$img" ]; then continue; fi
    if "${DOCKER[@]}" image inspect "$img" >/dev/null 2>&1; then
      info "基础镜像已在本地, 跳过预拉: ${img}"
      continue
    fi
    host="${img%%/*}"; rest="${img#*/}"
    if [ "$rest" = "$img" ]; then
      host=""                      # 无斜杠 = 官方短名(tag 冒号并非 host:port, 先行排除再 case,
    else                           # 否则 node:22-slim 会被 *:* 误判成镜像站前缀, 枉试换站)
      case "$host" in
        *.*|*:*) : ;;               # 含点或端口 = 镜像站 host 前缀(可换站重试)
        *) host=""; rest="$img" ;;  # 官方命名空间短名(如 oven/bun:1) → 无换站语义, 交由构建期拉取
      esac
    fi
    if [ -z "$host" ]; then
      info "基础镜像 ${img} 为官方名, 构建期直接拉取"
      continue
    fi
    info "预拉基础镜像: ${img} ..."
    if "${DOCKER[@]}" pull --quiet "$img" >/dev/null 2>&1; then
      ok "基础镜像预拉成功: ${img} (构建期直接命中本地)"
      continue
    fi
    warn "预拉失败(${img}), 自动尝试其他镜像站..."
    switched=""
    for cand in "${REGISTRY_HOST_CANDIDATES[@]}"; do
      if [ "$cand" = "$host" ]; then continue; fi
      alt="${cand}/${rest}"
      if "${DOCKER[@]}" pull --quiet "$alt" >/dev/null 2>&1; then
        printf -v "$vn" '%s' "$alt"
        export "$vn"
        switched=1
        ok "已换站预拉成功: ${alt} (构建将改用该站)"
        break
      fi
    done
    if [ -z "$switched" ]; then
      warn "各镜像站预拉均失败, 交由构建期继续(若仍卡在拉取, 请手动指定后重跑:"
      warn "  BUN_IMAGE=<镜像站>/oven/bun:1 NODE_IMAGE=<镜像站>/library/node:22-slim bash install.sh)"
    fi
  done
  # 兜底2: 国内模式但未探测到任何镜像站(镜像变量全空) → 用 docker pull 预拉官方名。
  # docker pull 走 daemon 的 registry-mirrors 加速, 与 BuildKit 拉取路径不同(daemon.json
  # 加速器对 BuildKit 兼容不稳正是本轮根因); 官方名镜像一旦进本地存储, 构建期 FROM 直接命中
  if [ "$CN_MODE" = "1" ] && [ -z "$BUN_IMAGE" ] && [ -z "$NODE_IMAGE" ]; then
    local canon
    for canon in oven/bun:1 node:22-slim; do
      if "${DOCKER[@]}" image inspect "$canon" >/dev/null 2>&1; then
        info "基础镜像已在本地, 跳过预拉: ${canon}"
        continue
      fi
      info "预拉基础镜像(经 daemon 加速器): ${canon} ..."
      if "${DOCKER[@]}" pull --quiet "$canon" >/dev/null 2>&1; then
        ok "基础镜像预拉成功: ${canon} (构建期直接命中本地)"
      else
        warn "预拉失败(${canon}), 构建期若仍卡在拉取, 请手动指定镜像站后重跑:"
        warn "  BUN_IMAGE=<镜像站>/oven/bun:1 NODE_IMAGE=<镜像站>/library/node:22-slim bash install.sh"
      fi
    done
  fi
  return 0
}

if detect_cn_network; then
  CN_MODE=1
  info "检测到国内网络环境(或 USE_CN_MIRROR=1): 启用国内镜像加速..."
  configure_registry_mirrors
  # 构建期依赖源: 经 compose build args 注入容器构建(空值在 Dockerfile 侧=海外默认)
  export NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
  export PIP_INDEX_URL="${PIP_INDEX_URL:-https://mirrors.aliyun.com/pypi/simple/}"
  # 注意: DEBIAN_MIRROR 只传主机名段(不带 scheme/路径) —— scrapling 镜像内 sed 以
  # "http://${DEBIAN_MIRROR}" 拼接 deb822 源, 带前缀会拼出非法 URL(vv 轮修正)
  export DEBIAN_MIRROR="${DEBIAN_MIRROR:-mirrors.aliyun.com}"
  export PLAYWRIGHT_DOWNLOAD_HOST="${PLAYWRIGHT_DOWNLOAD_HOST:-https://npmmirror.com/mirrors/playwright}"
  ok "国内构建源已启用: npm/pip/apt/playwright (USE_CN_MIRROR=0 可关闭)"
  # 基础镜像直指可达镜像站(vv 轮): BuildKit 拉取对 daemon.json 加速器兼容不稳,
  # 镜像名直指镜像站是最稳路径; 也可手动 export BUN_IMAGE/NODE_IMAGE/PYTHON_IMAGE 覆盖
  if REG_HOST="$(pick_registry_host)"; then
    export BUN_IMAGE="${BUN_IMAGE:-${REG_HOST}/oven/bun:1}"
    export NODE_IMAGE="${NODE_IMAGE:-${REG_HOST}/library/node:22-slim}"
    export PYTHON_IMAGE="${PYTHON_IMAGE:-${REG_HOST}/library/python:3.12-slim}"
    ok "基础镜像将直接从 ${REG_HOST} 拉取(构建不再触达 docker.io)"
  else
    warn "未探测到可达的镜像加速站, 基础镜像拉取将依赖 daemon.json 加速器; 若构建仍卡在拉取镜像,"
    warn "  可手动指定重跑, 例: BUN_IMAGE=docker.m.daocloud.io/oven/bun:1 NODE_IMAGE=docker.m.daocloud.io/library/node:22-slim bash install.sh"
  fi
else
  info "官方源可达, 使用海外默认配置 (USE_CN_MIRROR=1 可强制国内加速)"
  configure_registry_mirrors   # 海外网络下同样无副作用: 已配置则跳过
fi

# 基础镜像预拉兜底(国内模式/手动注入了镜像变量才非空 → 海外默认路径零操作)
prepull_base_images

# ============================================================
# 步骤 2: 检测 Docker Compose (优先 v2 插件, 兼容旧版独立命令)
# ============================================================
COMPOSE=()
if docker compose version >/dev/null 2>&1; then
  COMPOSE=("${DOCKER[@]}" compose)
  ok "检测到 Docker Compose v2: $(docker compose version | head -n1)"
elif docker-compose --version >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
  ok "检测到旧版 docker-compose: $(docker-compose --version)"
elif [ -n "$SUDO" ] && $SUDO docker-compose --version >/dev/null 2>&1; then
  COMPOSE=($SUDO docker-compose)
  ok "检测到旧版 docker-compose(sudo): $($SUDO docker-compose --version)"
else
  err "未检测到 Docker Compose。Docker 20.10+ 一般自带 v2 插件(docker compose), 建议:"
  err "  重新执行安装: curl -fsSL ${GET_DOCKER_URL} | sudo sh  (会补齐 compose 插件)"
  err "  国内网络: 用本脚本重跑一次即可(自动经国内镜像站安装 docker-compose-plugin)"
  exit 1
fi

# ── sudo 环境透传(vv-a 复审修复): sudo 默认 env_reset 会剥离本脚本导出(以及用户手动
# export)的构建源/基础镜像/自动填充变量 —— 当 docker 需经 sudo 访问时(非 root 且未入
# docker 组), compose 插值读不到这些变量, 国内模式注入会整体静默失效(基础镜像退回
# docker.io 官方源, 拉取再次超时)。做法: 把非空变量以 VAR=val 形式插到 sudo 与 docker
# 之间(sudo env VAR=... docker compose), 不受 sudoers 环境策略影响; root/直连路径
# (SUDO 空)export 本身已足够, 此块自动跳过。
BUILD_ENV=()
[ -n "$BUN_IMAGE" ] && BUILD_ENV+=("BUN_IMAGE=$BUN_IMAGE")
[ -n "$NODE_IMAGE" ] && BUILD_ENV+=("NODE_IMAGE=$NODE_IMAGE")
[ -n "$PYTHON_IMAGE" ] && BUILD_ENV+=("PYTHON_IMAGE=$PYTHON_IMAGE")
[ -n "$NPM_REGISTRY" ] && BUILD_ENV+=("NPM_REGISTRY=$NPM_REGISTRY")
[ -n "$PIP_INDEX_URL" ] && BUILD_ENV+=("PIP_INDEX_URL=$PIP_INDEX_URL")
[ -n "$DEBIAN_MIRROR" ] && BUILD_ENV+=("DEBIAN_MIRROR=$DEBIAN_MIRROR")
[ -n "$PLAYWRIGHT_DOWNLOAD_HOST" ] && BUILD_ENV+=("PLAYWRIGHT_DOWNLOAD_HOST=$PLAYWRIGHT_DOWNLOAD_HOST")
[ -n "$AUTO_FILL" ] && BUILD_ENV+=("AUTO_FILL=$AUTO_FILL")
[ -n "$AUTO_FILL_RULES" ] && BUILD_ENV+=("AUTO_FILL_RULES=$AUTO_FILL_RULES")
if [ "${#BUILD_ENV[@]}" -gt 0 ] && [ -n "$SUDO" ] && [ "${COMPOSE[0]}" = "$SUDO" ]; then
  COMPOSE=("$SUDO" env "${BUILD_ENV[@]}" "${COMPOSE[@]:1}")
  info "已将 ${#BUILD_ENV[@]} 个构建变量经 sudo env 透传给 compose(不受 sudo 环境重置影响)"
fi

# ============================================================
# 步骤 3: 端口占用预检(幂等: 自家旧容器在跑则照常重建)
# ============================================================
if (echo > "/dev/tcp/127.0.0.1/${HOST_PORT}") 2>/dev/null; then
  if "${DOCKER[@]}" ps --format '{{.Names}}' 2>/dev/null | grep -qx "$APP_NAME"; then
    info "检测到已有 ${APP_NAME} 容器在运行, 将自动重建(数据在 ./db ./data, 不受影响)"
  else
    err "端口 ${HOST_PORT} 已被其他程序占用。两种处理:"
    err "  A) 改端口: 编辑 docker-compose.yml, 把 ports 里 \"${HOST_PORT}:3000\" 左侧改成空闲端口(如 \"8080:3000\")"
    err "  B) 停掉占用程序后重跑本脚本 (可用: lsof -i :${HOST_PORT} 查占用)"
    exit 1
  fi
else
  info "端口 ${HOST_PORT} 空闲"
fi

# ============================================================
# 步骤 4: 构建并启动 (幂等: compose 会按需重建)
# ============================================================
info "开始构建镜像并启动(首次构建需下载依赖, 约 3~10 分钟; 重复执行会利用缓存加速)..."
"${COMPOSE[@]}" up -d --build
ok "容器已启动"

# ============================================================
# 步骤 5: 等待健康检查通过
# ============================================================
info "等待服务健康检查通过(最长 ${WAIT_TIMEOUT} 秒)..."
ELAPSED=0
STATUS="starting"
while :; do
  STATUS="$("${DOCKER[@]}" inspect -f '{{.State.Health.Status}}' "$APP_NAME" 2>/dev/null || echo "unknown")"
  if [ "$STATUS" = "healthy" ]; then
    ok "服务健康检查通过!"
    break
  fi
  if [ "$STATUS" = "unhealthy" ]; then
    err "健康检查未通过(unhealthy), 最近 50 行日志如下:"
    "${DOCKER[@]}" logs --tail 50 "$APP_NAME" 2>&1 || true
    err "也可手动查看: docker logs -f ${APP_NAME}"
    exit 1
  fi
  if [ "$ELAPSED" -ge "$WAIT_TIMEOUT" ]; then
    err "等待超时(状态: ${STATUS})。最近 50 行日志如下:"
    "${DOCKER[@]}" logs --tail 50 "$APP_NAME" 2>&1 || true
    err "若日志里是启动慢而非报错, 可稍后手动确认: docker ps  (STATUS 列出现 (healthy) 即成功)"
    exit 1
  fi
  printf '.'
  sleep 5
  ELAPSED=$((ELAPSED + 5))
done
echo ""

# ============================================================
# 步骤 5.5: 自动填充状态说明(ss-a)
# ============================================================
if [ "$AUTO_FILL" = "1" ]; then
  info "自动填充已开启(站点: ${AUTO_FILL_RULES})"
  info "服务就绪后会自动导入采集规则、创建「自动填充·」任务并开跑, 稍等其引导日志..."
  sleep 10
  AF_LOGS="$("${DOCKER[@]}" logs --since 10m "$APP_NAME" 2>&1 | grep -F '[自动填充]' || true)"
  if [ -n "$AF_LOGS" ]; then
    info "自动填充引导日志(最近 15 条):"
    printf '%s\n' "$AF_LOGS" | tail -n 15 | sed 's/^/  | /'
  else
    warn "暂未读到自动填充日志(引导可能仍在等待首次采集或构建较慢)"
    warn "可稍后手动查看: docker logs ${APP_NAME} 2>&1 | grep -F '[自动填充]'"
  fi
  info "采集进度随时可在管理面板「任务」页查看; 若要自定义站点清单, 重跑时带: AUTO_FILL_RULES=<逗号分隔key> bash install.sh"
else
  warn "自动填充未开启(AUTO_FILL=0): 只部署了系统, 未预填任何书籍"
  warn "想开启: AUTO_FILL=1 bash install.sh (或在管理面板手动建规则与任务)"
fi
echo ""

# ============================================================
# 步骤 6: 打印访问信息
# ============================================================
trap - ERR
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
ok "小说管理系统部署完成!"
echo ""
info "访问地址:"
info "  本机      → http://localhost:${HOST_PORT}          (后台管理首页)"
if [ -n "${LAN_IP:-}" ]; then
  info "  局域网    → http://${LAN_IP}:${HOST_PORT}        (同一局域网内其他设备可访问)"
fi
info "  前台站点  → http://localhost:${HOST_PORT}/?view=home"
info "  (端口如自定义, 记得同步 docker-compose.yml 的 ports)"
echo ""
if [ -n "$MIRROR_INFO" ]; then
  info "Docker Hub 镜像加速器: ${MIRROR_INFO}"
fi
info "数据都在宿主机当前目录: ./db (数据库) 与 ./data (采集产物), 备份 = 拷贝目录"
info "常用命令: docker compose logs -f | docker compose ps | docker compose down"
info "更多说明(升级/备份/改端口/常见问题)见项目内 DEPLOY.md"
