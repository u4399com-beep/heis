#!/usr/bin/env bash
# ============================================================
# start-all.sh — 拉起全部 Go mini-services (Go 重写, R43-1C)
# ============================================================
# 旧 Python/bun mini-services 已在 R43-1C 删除 (Go 等价实现):
#   - mini-services/{bqg713-proxy,fetch-relay,scrapling-bridge,qimao-proxy,
#      deqixs-proxy,xjp-proxy,uc-bridge,moli-bridge} (TS) → 删
#   - mini-services/{scrapling-bridge,uc-bridge,curl-impersonate-bridge,
#      trafilatura-bridge} (Python) → 删
#   - mini-services/{cloak-browser} (TS) → 删
#   - mini-services/_shared/server.ts → 删 (Go 用 services/bridgeserver)
#
# 行为:
#   - 并行构建每个 Go 服务 (基于源码 mtime 增量, 跳过 up-to-date)
#   - 后台启动每个二进制, 输出重定向到 .zscripts/<svc>.log
#   - PID 写入 .zscripts/<svc>.pid (供 stop-all.sh 用)
#   - 启动前若端口已被占用且 /health 200 则跳过
#   - 等待 ≤3s 确认 /health 200, 否则报 WARN 但不阻塞后续
#
# 端口映射 (与旧 TS/Python 版本兼容):
#   3010 bqg713-proxy
#   3011 fetch-relay
#   3012 scrapling-bridge
#   3013 qimao-proxy
#   3014 deqixs-proxy
#   3015 xjp-proxy
#   3016 uc-bridge
#   3017 moli-bridge
#   3018 curl-impersonate-bridge  (R43-1A 新增)
#   3019 trafilatura-bridge      (R43-1A 新增)
#   3020 cloak-browser           (R43-1A 新增)
#
# 使用:
#   cd /home/z/my-project && bash mini-services/start-all.sh
# ============================================================
set -u

PROJECT_ROOT="/home/z/my-project"
GO_BACKEND="$PROJECT_ROOT/go-backend"
BIN_DIR="$GO_BACKEND/bin"
LOG_DIR="$PROJECT_ROOT/.zscripts"

# Go 工具链路径: 优先用 sandbox 内置 /home/z/go/bin/go, 回退到 PATH 中的 go
if [ -x "/home/z/go/bin/go" ]; then
  GO_BIN="/home/z/go/bin/go"
elif command -v go > /dev/null 2>&1; then
  GO_BIN="$(command -v go)"
else
  echo "[start-all] ERROR: go toolchain not found (looked for /home/z/go/bin/go and PATH)"
  exit 1
fi

mkdir -p "$LOG_DIR" "$BIN_DIR"

# 服务名 → (端口, Go 包路径相对 go-backend/) — 11 个, 端口 3010-3020
declare -a SERVICES=(
  "bqg713-proxy|3010|./services/bqg713-proxy"
  "fetch-relay|3011|./services/fetch-relay"
  "scrapling-bridge|3012|./services/scrapling-bridge"
  "qimao-proxy|3013|./services/qimao-proxy"
  "deqixs-proxy|3014|./services/deqixs-proxy"
  "xjp-proxy|3015|./services/xjp-proxy"
  "uc-bridge|3016|./services/uc-bridge"
  "moli-bridge|3017|./services/moli-bridge"
  "curl-impersonate-bridge|3018|./services/curl-impersonate-bridge"
  "trafilatura-bridge|3019|./services/trafilatura-bridge"
  "cloak-browser|3020|./services/cloak-browser"
)

echo "[start-all] $(date +'%Y-%m-%d %H:%M:%S') starting ${#SERVICES[@]} Go mini-services..."

# ---------- Step 1: 并行构建 (增量, 源码 mtime > 二进制 mtime 时才重建) ----------
echo "[start-all] phase 1: build (incremental)"
build_pids=()
build_names=()
for entry in "${SERVICES[@]}"; do
  IFS='|' read -r name port pkg <<< "$entry"
  bin_path="$BIN_DIR/$name"
  src_dir="$GO_BACKEND/services/$name"

  # 取源码最新 mtime
  src_mtime=0
  if [ -d "$src_dir" ]; then
    src_mtime=$(find "$src_dir" -name '*.go' -printf '%T@\n' 2>/dev/null \
      | sort -rn | head -n 1 | cut -d. -f1)
    [ -z "$src_mtime" ] && src_mtime=0
  fi

  # 二进制 mtime
  bin_mtime=0
  if [ -x "$bin_path" ]; then
    bin_mtime=$(stat -c %Y "$bin_path" 2>/dev/null || echo 0)
  fi

  if [ "$src_mtime" -le "$bin_mtime" ] && [ "$bin_mtime" -gt 0 ]; then
    echo "[start-all]   $name: binary up-to-date, skip"
    continue
  fi

  if [ ! -d "$src_dir" ]; then
    echo "[start-all]   $name: source dir missing ($src_dir), skip"
    continue
  fi

  echo "[start-all]   $name: building $pkg → $bin_path"
  ( cd "$GO_BACKEND" && "$GO_BIN" build -o "$bin_path" "$pkg" ) \
    >"$LOG_DIR/$name.build.log" 2>&1 &
  build_pids+=($!)
  build_names+=("$name")
done

# 等待所有构建完成
for i in "${!build_pids[@]}"; do
  pid="${build_pids[$i]}"
  name="${build_names[$i]}"
  if ! wait "$pid" 2>/dev/null; then
    echo "[start-all]   $name: BUILD FAILED (see $LOG_DIR/$name.build.log)"
  fi
done

# ---------- Step 2: 启动 + 健康探针 ----------
echo "[start-all] phase 2: launch + probe"
for entry in "${SERVICES[@]}"; do
  IFS='|' read -r name port pkg <<< "$entry"
  bin_path="$BIN_DIR/$name"
  log_file="$LOG_DIR/$name.log"
  pid_file="$LOG_DIR/$name.pid"

  if [ ! -x "$bin_path" ]; then
    echo "[start-all] $name (port $port): SKIP — binary not built (see $LOG_DIR/$name.build.log)"
    continue
  fi

  # 端口检查 — 已 200 则跳过
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 \
    "http://127.0.0.1:$port/health" 2>/dev/null || echo 000)
  if [ "$code" = "200" ]; then
    echo "[start-all] $name (port $port): already running, skip"
    continue
  fi

  echo "[start-all] $name (port $port): starting → $log_file"
  nohup "$bin_path" > "$log_file" 2>&1 &
  pid=$!
  echo "$pid" > "$pid_file"
  disown "$pid" 2>/dev/null || true

  # 等待 ≤3s 确认 /health 200
  sleep 0.3
  ok=0
  for i in 1 2 3 4 5 6; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 \
      "http://127.0.0.1:$port/health" 2>/dev/null || echo 000)
    if [ "$code" = "200" ]; then
      ok=1
      break
    fi
    sleep 0.5
  done
  if [ "$ok" = "1" ]; then
    echo "[start-all] $name (port $port): OK (pid $pid)"
  else
    echo "[start-all] $name (port $port): WARN — /health not 200 within 3s; check $log_file (pid $pid)"
  fi
done

echo "[start-all] done. See $LOG_DIR/*.log for details."
echo "[start-all] Run 'bash mini-services/status.sh' for current state."
