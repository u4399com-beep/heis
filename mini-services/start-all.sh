#!/usr/bin/env bash
# ============================================================
# start-all.sh — 拉起全部 6 个 mini-services(bun + python)
# ============================================================
# 行为:
#   - 后台启动每个服务, 输出重定向到 .zscripts/<svc>.log
#   - PID 写入 .zscripts/<svc>.pid(供 stop-all.sh 用)
#   - 启动前若端口已被占用则跳过(避免重复拉起)
#   - 等待 ≤3s 确认 /health 200, 否则报 FAIL 但不阻塞后续
#
# 使用:
#   cd /home/z/my-project && bash mini-services/start-all.sh
# ============================================================
set -u

PROJECT_ROOT="/home/z/my-project"
MINI_ROOT="$PROJECT_ROOT/mini-services"
LOG_DIR="$PROJECT_ROOT/.zscripts"

mkdir -p "$LOG_DIR"

# 服务名 → (端口, 启动目录, 启动命令) — 顺序与端口 3010-3015 一致
declare -a SERVICES=(
  "bqg713-proxy|3010|$MINI_ROOT/bqg713-proxy|bun run dev"
  "fetch-relay|3011|$MINI_ROOT/fetch-relay|bun run dev"
  "scrapling-bridge|3012|$MINI_ROOT/scrapling-bridge|bun run dev"
  "qimao-proxy|3013|$MINI_ROOT/qimao-proxy|bun run dev"
  "deqixs-proxy|3014|$MINI_ROOT/deqixs-proxy|bun run dev"
  "xjp-proxy|3015|$MINI_ROOT/xjp-proxy|bun run dev"
)

echo "[start-all] $(date +'%Y-%m-%d %H:%M:%S') starting 6 mini-services..."

for entry in "${SERVICES[@]}"; do
  IFS='|' read -r name port dir cmd <<< "$entry"
  log_file="$LOG_DIR/$name.log"
  pid_file="$LOG_DIR/$name.pid"

  # 端口检查 — 已占用则跳过
  if curl -s -o /dev/null -w '' --max-time 1 "http://127.0.0.1:$port/health" 2>/dev/null; then
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:$port/health" 2>/dev/null)" = "200" ]; then
      echo "[start-all] $name (port $port): already running, skip"
      continue
    fi
  fi

  # 拉起进程
  echo "[start-all] $name (port $port): starting → $log_file"
  cd "$dir"
  # nohup + & 后台; disown 防止 shell 退出时 SIGHUP 杀子进程
  nohup bash -c "$cmd" > "$log_file" 2>&1 &
  pid=$!
  echo "$pid" > "$pid_file"
  disown "$pid" 2>/dev/null || true
  cd - > /dev/null

  # 等待 ≤3s 确认 /health 200
  sleep 0.3
  ok=0
  for i in 1 2 3 4 5 6; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:$port/health" 2>/dev/null || echo 000)
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
