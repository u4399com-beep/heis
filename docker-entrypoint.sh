#!/bin/sh
# ============================================================
# 小说管理系统 — 容器入口脚本 (POSIX sh)
# 职责: 1) 准备数据目录(与 volume 挂载点一致, 重复执行安全)
#       2) 幂等初始化 SQLite: prisma db push (已存在且一致的表不做任何改动)
#       3) 同容器启动 5 个本地采集代理(ss-a 共置, 规则写死 127.0.0.1:<port>)
#       4) 后台拉起自动填充引导(AUTO_FILL=1 时; 脚本内部轮询等 server 健康)
#       5) 前台启动 standalone server (1-c: 不再 exec 替换进程 —— 保留 shell
#          以便把 SIGTERM/SIGINT 转发给子进程代理/引导脚本)
#
# 1-c 改进:
#   - 子进程信号转发: spawn() 记录 PID, trap SIGTERM/SIGINT → kill -TERM
#     全部子进程 → wait; 修复历史 entrypoint exec 替换 shell 后 mini-services
#     被孤儿化、PID 1(node) 不转发 SIGTERM 的痛点
#   - /app/db 可写性检查: 非 root(uid 1001) 启动时若 host volume 属主不匹配,
#     提前给出 chown 指引(继续启动让 prisma 失败时给出更清晰错误)
#   - 末尾 kill 0 兜底: 任何路径都保证整组进程被回收
# ============================================================
set -e

cd /app

# 0) 可写性预检(1-c): 容器以非 root(uid 1001) 启动时, bind mount 的 /app/db 与
#    /app/data 可能仍属 host root 所有 → 写入失败让 prisma 给出更清晰错误。
#    此处仅 echo 警告, 不中断主流程(prisma 自身会失败并打印 SQLITE_READONLY)。
if [ ! -w /app/db ]; then
  echo "[初始化] [警告] /app/db 不可写 —— 当前 uid=$(id -u 2>/dev/null || echo '?')"
  echo "[初始化] [警告] 若使用 docker-compose volume, 请在宿主机执行:"
  echo "[初始化] [警告]   sudo chown -R 1001:1001 ./db ./data"
  echo "[初始化] [警告] (继续启动; prisma 将给出更具体错误)"
fi

# 1) 数据目录: db 为 SQLite 库文件; data/{covers,novels,downloads} 为采集产物;
#    logs 为代理/引导脚本的本地日志目录
#    (应用运行时也会按需创建, 这里提前建好保证 volume 挂载属主一致)
mkdir -p /app/db /app/data/covers /app/data/novels /app/data/downloads /app/logs 2>/dev/null || {
  echo "[初始化] [警告] mkdir 失败 —— /app 或子目录无写权限(见上一条警告)"
}

# 2) 数据库结构同步 — 幂等:
#    - 首次启动: db/custom.db 不存在 → 自动创建并建全部表
#    - 重复启动: 库已与 schema 一致 → 空操作, 直接通过
#    注意: 不使用 --accept-data-loss —— 若升级后 schema 变更需要删数据,
#    prisma 会报错退出, 这里选择"保留数据继续启动"并在日志中给出中文指引,
#    绝不静默销毁用户数据 (强制重整方法见 DEPLOY.md『数据库结构变更』)
echo "[初始化] 同步数据库结构 (prisma db push, 幂等)..."
if node node_modules/prisma/build/index.js db push --schema prisma/schema.prisma --skip-generate; then
  echo "[初始化] 数据库就绪: ${DATABASE_URL:-file:/app/db/custom.db}"
else
  echo ""
  echo "[警告] 数据库结构同步失败 —— 通常是镜像升级后数据结构变更、且变更会波及旧数据,"
  echo "[警告] 或宿主机 ./db 目录属主不是 uid 1001(非 root 容器无写权限)。"
  echo "[警告] 已保留现有数据库并继续启动服务; 若页面报错, 请按以下顺序处理:"
  echo "[警告]   1) 先备份: 停服后整体拷贝宿主机 ./db 目录"
  echo "[警告]   2) 检查权限: sudo chown -R 1001:1001 ./db ./data"
  echo "[警告]   3) 再参见 DEPLOY.md『常见问题 → 数据库结构变更』"
  echo ""
fi

# 3) 同容器共置采集代理(ss-a):
#    规则 config 内写死 127.0.0.1:<port>(笔趣阁3010 token签发/七猫3013 双签+AES/
#    得奇3014 三参数签名/新键盘3015 var c 解密), 与开发模式同 localhost 语义, 引擎降级链兜底;
#    fetch-relay(3011) 为引擎 bun TLS 指纹中继出路。
#    scrapling-bridge(3012) 是 Python 可选增强, 不在默认镜像(见 DEPLOY.md 第五节)。
#    每个代理: 后台启动(日志进 /app/logs) → 最多等 20s 端口就绪;
#    失败仅 [警告] 不中断 —— 代理挂了绝不能挡主服务启动。
#    ★ 端口必须逐个显式覆盖: 代理源码读 env.PORT, 继承全局 PORT=3000 会撞主服务。
#    1-c: spawn() 记录子进程 PID 进 CHILDREN, SIGTERM/SIGINT trap 时一并转发
LOG_DIR=/app/logs
mkdir -p "$LOG_DIR" 2>/dev/null || echo "[代理] [警告] /app/logs 不可写, 代理日志将丢失"

port_ready() { # port_ready <port> — node 探测 TCP 端口(镜像内必有 node, 不依赖 curl/wget)
  node -e 'const s=require("net").connect({port:+process.argv[1],host:"127.0.0.1"},()=>{s.end();process.exit(0)});s.on("error",()=>process.exit(1));setTimeout(()=>process.exit(1),1500)' "$1" 2>/dev/null
}

wait_port() { # wait_port <port> <max_seconds>
  _wp_port=$1; _wp_max=$2; _wp_i=0
  while [ "$_wp_i" -lt "$_wp_max" ]; do
    if port_ready "$_wp_port"; then return 0; fi
    _wp_i=$((_wp_i + 1))
    sleep 1
  done
  return 1
}

# 1-c: 子进程管理 —— trap SIGTERM/SIGINT 并转发, 兜底 kill 0
CHILDREN=""
spawn() { # spawn <cmd...> — 后台启动, 把 PID 加入 CHILDREN
  "$@" &
  CHILDREN="$CHILDREN $!"
}

start_proxy() { # start_proxy <名称> <目录> <端口>
  _sp_name=$1; _sp_dir=$2; _sp_port=$3
  if ! command -v bun >/dev/null 2>&1; then
    echo "[代理] [警告] 容器内缺少 bun, 跳过 ${_sp_name} —— 相关规则将走引擎降级链"
    return 0
  fi
  if port_ready "$_sp_port"; then
    echo "[代理] ${_sp_name} 端口 ${_sp_port} 已在监听, 跳过启动"
    return 0
  fi
  echo "[代理] 启动 ${_sp_name} (端口 ${_sp_port})..."
  spawn sh -c "cd /app/mini-services/${_sp_dir} && PORT=${_sp_port} bun run start >> ${LOG_DIR}/${_sp_name}.log 2>&1"
  if wait_port "$_sp_port" 20; then
    echo "[代理] ${_sp_name} 就绪: http://127.0.0.1:${_sp_port} (日志: ${LOG_DIR}/${_sp_name}.log)"
  else
    echo "[代理] [警告] ${_sp_name} 20 秒内未就绪, 不影响主服务继续启动 (日志: ${LOG_DIR}/${_sp_name}.log)"
  fi
}

start_proxy bqg713-proxy bqg713-proxy 3010
start_proxy fetch-relay  fetch-relay  3011
start_proxy qimao-proxy  qimao-proxy  3013
start_proxy deqixs-proxy deqixs-proxy 3014
start_proxy xjp-proxy    xjp-proxy    3015

# 4) 自动填充引导(ss-a): 后台拉起, 脚本自身轮询等 server 健康(最多 180s)后
#    经管理 API 幂等导入规则/建「自动填充·」任务/按状态机续跑 —— 绝不清空已有数据。
#    门控: AUTO_FILL=1 才执行(compose 默认开启; 置 0 或不设则脚本自退, 裸 docker run 不受影响);
#    AUTO_FILL_RULES 可逗号分隔挑选站点(默认 fanqie,qimao,deqixs,80ge,jhssd,ttkan,bqg713)。
#    日志直达 docker logs(带 [自动填充] 前缀)。
if [ -f /app/docker/autofill.mjs ]; then
  echo "[自动填充] 引导脚本已就位 (AUTO_FILL=${AUTO_FILL:-未设置}, AUTO_FILL_RULES=${AUTO_FILL_RULES:-默认清单})"
  spawn node /app/docker/autofill.mjs
else
  echo "[自动填充] [警告] 镜像内缺少 docker/autofill.mjs, 跳过自动填充"
fi

# 1-c: SIGTERM/SIGINT trap —— 转发给主进程 node 与所有 spawn 子进程, 然后等回收
#      不用 exec 替换 shell: exec 后 PID 1 变成 node, 子进程被孤儿化由 node 接管,
#      而 node 不会转发 SIGTERM 给子进程 → 历史 docker stop 优雅退出失败痛点。
#      改为前台启动 node, shell 保留 PID 1, trap 内统一 kill 全家 + wait。
echo "[启动] 监听 http://0.0.0.0:${PORT:-3000} —— 后台管理: / , 前台站点: /?view=home"
node server.js &
MAIN=$!

# trap SIGTERM/SIGINT: 转发给主进程与子进程, wait 回收, 兜底 kill 0 整组
trap '
  echo "[关闭] 收到终止信号, 转发给子进程 (main='"$MAIN"' children='"$CHILDREN"')..."
  kill -TERM '"$MAIN"' '"$CHILDREN"' 2>/dev/null || true
  # wait 主进程退出(子进程随之收尾); 兜底 kill 0 杀整组防漏网
  wait '"$MAIN"' 2>/dev/null || true
  kill -TERM '"$CHILDREN"' 2>/dev/null || true
  wait 2>/dev/null || true
  kill 0 2>/dev/null || true
  exit 0
' TERM INT

wait $MAIN
EXIT_CODE=$?
# 主进程退出: 同样把子进程一并带走
kill -TERM $CHILDREN 2>/dev/null || true
wait 2>/dev/null || true
exit $EXIT_CODE
