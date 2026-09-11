#!/usr/bin/env bash
# ============================================================
# stop-all.sh — 停止全部 6 个 mini-services(SIGTERM 优雅关闭)
# ============================================================
# 行为:
#   - 读取 .zscripts/<svc>.pid, 发 SIGTERM(各服务 5s 优雅关闭)
#   - 5s 后仍存活则 SIGKILL
#   - 端口仍占用兜底: 用 lsof/fuser 找 PID 强杀
#
# 使用:
#   cd /home/z/my-project && bash mini-services/stop-all.sh
# ============================================================
set -u

PROJECT_ROOT="/home/z/my-project"
LOG_DIR="$PROJECT_ROOT/.zscripts"

declare -a NAMES=(
  "bqg713-proxy|3010"
  "fetch-relay|3011"
  "scrapling-bridge|3012"
  "qimao-proxy|3013"
  "deqixs-proxy|3014"
  "xjp-proxy|3015"
)

echo "[stop-all] $(date +'%Y-%m-%d %H:%M:%S') stopping 6 mini-services..."

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

  # 发 SIGTERM 优雅关闭(各服务 5s grace)
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
    # 杀子进程兜底(bun --hot 可能有子进程)
    pkill -KILL -P "$pid" 2>/dev/null || true
  fi

  rm -f "$pid_file" 2>/dev/null || true
done

echo "[stop-all] done."
