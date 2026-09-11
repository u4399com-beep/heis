#!/usr/bin/env bash
# ============================================================
# status.sh — 报告全部 6 个 mini-services 的运行状态
# ============================================================
# 行为:
#   - 读 PID 文件 + 检查进程存活 + 探测 /health 200
#   - 输出表格: service | port | pid | process | /health | uptime | selfTest
#   - 退出码: 全部 OK=0, 任一异常=1(供 CI / 监控使用)
#
# 使用:
#   cd /home/z/my-project && bash mini-services/status.sh
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

# 表头
printf '%-20s %-7s %-7s %-9s %-10s %-9s\n' SERVICE PORT PID PROCESS HEALTH SELFTEST
printf '%s\n' '-----------------------------------------------------------------------------------'

exit_code=0

for entry in "${NAMES[@]}"; do
  IFS='|' read -r name port <<< "$entry"
  pid_file="$LOG_DIR/$name.pid"
  pid="-"
  process_state="-"
  health_code="000"
  selftest="-"

  if [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file" 2>/dev/null || echo "")
  fi

  # 兜底: 若 PID 文件丢失, 用 lsof 找
  if [ -z "$pid" ] && command -v lsof > /dev/null 2>&1; then
    pid=$(lsof -ti :"$port" 2>/dev/null | head -n 1 || echo "")
  fi

  # 检查进程存活
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    process_state="ALIVE"
  elif [ -n "$pid" ]; then
    process_state="DEAD"
  else
    pid="-"
    process_state="-"
  fi

  # 探测 /health
  health_resp=$(curl -s --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null || echo "")
  if [ -n "$health_resp" ]; then
    health_code=200
    # 提取 selfTestOk 字段(简单 grep + sed, 避免依赖 jq)
    selftest=$(echo "$health_resp" | grep -oE '"selfTestOk":[^,}]+' | head -n 1 | sed 's/"selfTestOk"://')
    [ -z "$selftest" ] && selftest="n/a"
  else
    health_code="DOWN"
    selftest="-"
    exit_code=1
  fi

  # 染色(终端环境)
  health_colored="$health_code"
  proc_colored="$process_state"
  if [ -t 1 ]; then
    if [ "$health_code" = "200" ]; then
      health_colored="\033[32m$health_code\033[0m"
    else
      health_colored="\033[31m$health_code\033[0m"
    fi
    if [ "$process_state" = "ALIVE" ]; then
      proc_colored="\033[32m$process_state\033[0m"
    elif [ "$process_state" = "DEAD" ]; then
      proc_colored="\033[31m$process_state\033[0m"
    fi
  fi

  printf '%-20s %-7s %-7s %-9s %-10s %-9s\n' \
    "$name" "$port" "$pid" "$proc_colored" "$health_colored" "$selftest"
done

echo ""
if [ "$exit_code" = "0" ]; then
  echo "[status] All 6 services healthy."
else
  echo "[status] Some services unhealthy — check logs at $LOG_DIR/*.log"
fi
exit $exit_code
