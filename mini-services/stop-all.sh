#!/usr/bin/env bash
# ============================================================
# stop-all.sh — 停止全部 Go mini-services (Go 重写, R43-1C)
# ============================================================
# 旧 Python/bun 进程已不存在; 本脚本与 start-all.sh 同步停止 Go 二进制.
#
# 行为:
#   - 读取 .zscripts/<svc>.pid, 发 SIGTERM (Go 服务 5s 优雅关闭)
#   - 6s 后仍存活则 SIGKILL
#   - PID 文件丢失兜底: lsof/fuser 按端口找 PID
#
# 使用:
#   cd /home/z/my-project && bash mini-services/stop-all.sh
# ============================================================
set -u

PROJECT_ROOT="/home/z/my-project"
LOG_DIR="$PROJECT_ROOT/.zscripts"

# 服务名 → 端口 (与 start-all.sh 同步)
declare -a NAMES=(
  "bqg713-proxy|3010"
  "fetch-relay|3011"
  "scrapling-bridge|3012"
  "qimao-proxy|3013"
  "deqixs-proxy|3014"
  "xjp-proxy|3015"
  "uc-bridge|3016"
  "moli-bridge|3017"
  "curl-impersonate-bridge|3018"
  "trafilatura-bridge|3019"
  "cloak-browser|3020"
)

echo "[stop-all] $(date +'%Y-%m-%d %H:%M:%S') stopping ${#NAMES[@]} Go mini-services..."

for entry in "${NAMES[@]}"; do
  IFS='|' read -r name port <<< "$entry"
  pid_file="$LOG_DIR/$name.pid"

  pid=""
  if [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file" 2>/dev/null || echo "")
  fi

  # 兜底: 若 PID 文件丢失, 用 lsof 找占用端口的进程
  if [ -z "$pid" ] && command -v lsof > /dev/null 2>&1; then
    pid=$(lsof -ti :"$port" 2>/dev/null | head -n 1 || echo "")
  fi
  if [ -z "$pid" ] && command -v fuser > /dev/null 2>&1; then
    pid=$(fuser "$port/tcp" 2>/dev/null | awk '{print $1}' | head -n 1 || echo "")
  fi

  if [ -z "$pid" ]; then
    echo "[stop-all] $name (port $port): no PID found, skip"
    rm -f "$pid_file" 2>/dev/null || true
    continue
  fi

  # 检查进程是否存活
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "[stop-all] $name (port $port): PID $pid already dead, cleanup pid file"
    rm -f "$pid_file" 2>/dev/null || true
    continue
  fi

  # 发 SIGTERM 优雅关闭 (Go 服务 SIGTERM/SIGINT 5s grace)
  echo "[stop-all] $name (port $port): sending SIGTERM to PID $pid"
  kill -TERM "$pid" 2>/dev/null || true

  # 等待 ≤6s 优雅退出
  dead=0
  for i in 1 2 3 4 5 6; do
    if ! kill -0 "$pid" 2>/dev/null; then
      dead=1
      break
    fi
    sleep 1
  done

  if [ "$dead" = "1" ]; then
    echo "[stop-all] $name (port $port): OK (PID $pid exited gracefully)"
  else
    echo "[stop-all] $name (port $port): SIGKILL after 6s timeout (PID $pid)"
    kill -KILL "$pid" 2>/dev/null || true
  fi

  rm -f "$pid_file" 2>/dev/null || true
done

echo "[stop-all] done."
