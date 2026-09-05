// kk-b 交付验证: Docker 一键安装方案 结构与语法层自检
// (交付机无 docker, 不做真实构建; 本脚本对全部交付物做结构断言 + shell 语法检查)
// 用法: bun run scripts/verify-kk-b-docker.ts
// 断言面: Dockerfile(分层/COPY顺序/EXPOSE/ENV) / docker-compose.yml(键/卷/健康检查)
//         / install.sh(bash -n + 幂等与分支) / docker-entrypoint.sh(sh -n + 幂等安全)
//         / .dockerignore(忽略清单) / 交叉一致性(服务名/入口脚本路径/DEPLOY.md)
import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

let pass = 0
const fails: string[] = []
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fails.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`) }
}
function readText(p: string): string {
  if (!existsSync(p)) { console.error(`  ❌ 文件缺失: ${p}`); fails.push(`文件缺失:${p}`); return '' }
  return readFileSync(p, 'utf8')
}
function shellSyntax(file: string, shell: 'bash' | 'sh'): boolean {
  try { execSync(`${shell} -n ${file}`, { stdio: 'pipe' }); return true }
  catch (e) { console.log(`    语法错误详情: ${(e as Error).message}`); return false }
}
// 取目标行区间内(阶段内)的片段, 避免跨阶段误判
function stage(text: string, stageName: string): string {
  const re = new RegExp(`FROM [^\\n]*AS ${stageName}\\b([\\s\\S]*?)(?=\\nFROM |$)`)
  return text.match(re)?.[1] ?? ''
}

console.log('\n== 1/6 Dockerfile (多阶段构建) ==')
const df = readText('Dockerfile')
if (df) {
  const froms = df.match(/^FROM .*$/gm) ?? []
  check('恰好两个 FROM 且均为多阶段命名', froms.length === 2 && /AS builder/.test(df) && /AS runner/.test(df), `实际 FROM: ${froms.join(' | ')}`)
  const b = stage(df, 'builder'), r = stage(df, 'runner')
  check('构建阶段基于 oven/bun (Debian glibc)',
    /^FROM oven\/bun:\S+ AS builder/m.test(df)
    || (/^ARG BUN_IMAGE=oven\/bun:\S+/m.test(df) && /^FROM \$\{BUN_IMAGE\} AS builder/m.test(df)))
  check('运行阶段基于 node:22-slim (glibc, 与构建期引擎二进制兼容)',
    /FROM node:22\S*slim/.test(df)
    || (/^ARG NODE_IMAGE=node:22\S*slim/m.test(df) && /FROM \$\{NODE_IMAGE\} AS runner/m.test(df)))
  check('builder: WORKDIR /app', /^WORKDIR \/app/m.test(b))
  check('builder: 只先拷依赖清单+schema 再安装(层缓存顺序)',
    /COPY package\.json bun\.lock \.\//.test(b) && /COPY prisma \.\/prisma/.test(b)
    && b.indexOf('COPY package.json') < b.indexOf('bun install'), 'COPY 清单必须先于 bun install')
  check('builder: bun install --frozen-lockfile (锁文件确定性)', /bun install --frozen-lockfile/.test(b))
  check('builder: prisma generate', /prisma\/build\/index\.js generate/.test(b))
  check('builder: 全量源码 COPY . . 在安装之后', b.indexOf('COPY . .') > b.indexOf('bun install'))
  check('builder: next build (standalone)', /next\/dist\/bin\/next build/.test(b) && /cp -r \.next\/static \.next\/standalone\/\.next\//.test(b) && /cp -r public \.next\/standalone\//.test(b))
  check('builder: 裁剪为纯生产依赖并重建 client', /rm -rf node_modules/.test(b) && /bun install --production/.test(b))
  check('builder: 构建内存参数 NODE_OPTIONS', /NODE_OPTIONS=--max-old-space-size=\d+/.test(b))
  check('builder: 跳过 playwright 浏览器下载(镜像不膨胀)', /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1/.test(b))
  check('runner: NODE_ENV=production', /NODE_ENV=production/.test(r))
  check('runner: HOSTNAME=0.0.0.0 (standalone 绑定必需)', /HOSTNAME=0\.0\.0\.0/.test(r))
  check('runner: PORT=3000', /PORT=3000/.test(r))
  check('runner: DATABASE_URL 指向 /app/db volume', /DATABASE_URL=file:\/app\/db\/custom\.db/.test(r))
  check('runner: 安装 openssl (Prisma 引擎运行时依赖) 且清理 apt 缓存', /apt-get install [^\n]*openssl/.test(r) && /rm -rf \/var\/lib\/apt\/lists/.test(r))
  check('runner: 拷 standalone 产物 + 完整生产 node_modules + prisma schema',
    /COPY --from=builder \/app\/\.next\/standalone \.\//.test(r)
    && /COPY --from=builder \/app\/node_modules \.\/node_modules/.test(r)
    && /COPY --from=builder \/app\/prisma \.\/prisma/.test(r))
  check('runner: 拷贝入口脚本 docker-entrypoint.sh 到 /usr/local/bin', /COPY docker-entrypoint\.sh \/usr\/local\/bin\/docker-entrypoint\.sh/.test(r))
  check('runner: 预建数据目录 (db + covers/novels/downloads)', /\/app\/db/.test(r) && /\/app\/data\/covers/.test(r) && /\/app\/data\/novels/.test(r) && /\/app\/data\/downloads/.test(r))
  check('EXPOSE 3000', /^EXPOSE 3000$/m.test(df))
  check('ENTRYPOINT 指向入口脚本 (exec form)', /^ENTRYPOINT \["\/usr\/local\/bin\/docker-entrypoint\.sh"\]/m.test(df))
}

console.log('\n== 2/6 docker-entrypoint.sh (首启幂等初始化) ==')
const ep = readText('docker-entrypoint.sh')
if (ep) {
  check('sh -n 语法通过', shellSyntax('docker-entrypoint.sh', 'sh'))
  check('POSIX shebang #!/bin/sh', ep.startsWith('#!/bin/sh'))
  check('set -e 失败即停', /^set -e$/m.test(ep))
  check('建数据目录(与 volume 一致)', /mkdir -p \/app\/db \/app\/data\/covers \/app\/data\/novels \/app\/data\/downloads/.test(ep))
  check('prisma db push 幂等初始化', /db push --schema prisma\/schema\.prisma/.test(ep))
  check('带 --skip-generate (运行镜像无需再 generate)', /--skip-generate/.test(ep))
  check('安全: db push 命令行不带 --accept-data-loss (绝不静默毁数据)', !/db push[^\n]*--accept-data-loss/.test(ep))
  check('db push 失败分支: 保留数据继续启动 + 中文指引', /数据库结构同步失败/.test(ep) && /继续启动/.test(ep))
  check('exec node server.js (前台运行, 日志直达 docker logs)', /exec node server\.js/.test(ep))
  check('打印访问入口信息(中文)', /后台管理/.test(ep) && /view=home/.test(ep))
}

console.log('\n== 3/6 docker-compose.yml ==')
const yml = readText('docker-compose.yml')
if (yml) {
  check('services.novel-system 定义', /services:/.test(yml) && /^\s{2}novel-system:$/m.test(yml))
  check('build.context = 当前目录', /context: \./.test(yml) && /dockerfile: Dockerfile/.test(yml))
  check('container_name = novel-system', /container_name: novel-system/.test(yml))
  check('端口映射 3000:3000', /"3000:3000"/.test(yml))
  check('数据卷 ./db:/app/db 与 ./data:/app/data', /\.\.?\/db:\/app\/db/.test(yml) && /\.\.?\/data:\/app\/data/.test(yml))
  check('restart: unless-stopped', /restart: unless-stopped/.test(yml))
  check('healthcheck 存在且五要素齐全', /healthcheck:/.test(yml)
    && /test:/.test(yml) && /interval:/.test(yml) && /timeout:/.test(yml) && /retries:/.test(yml) && /start_period:/.test(yml))
  check('healthcheck 用镜像内 node fetch 探活 / (镜像无 curl/wget)', /node", "-e", "fetch\('http:\/\/127\.0\.0\.1:3000\/'\)/.test(yml))
  check('NODE_ENV=production', /NODE_ENV=production/.test(yml))
  check('DATABASE_URL 与 Dockerfile/volume 一致', /DATABASE_URL=file:\/app\/db\/custom\.db/.test(yml))
  check('HOSTNAME=0.0.0.0', /HOSTNAME=0\.0\.0\.0/.test(yml))
  check('不含已废弃的顶层 version: 键', !/^version:/m.test(yml))
}

console.log('\n== 4/6 install.sh (零基础一键安装) ==')
const ins = readText('install.sh')
if (ins) {
  check('bash -n 语法通过', shellSyntax('install.sh', 'bash'))
  check('shebang #!/usr/bin/env bash', ins.startsWith('#!/usr/bin/env bash'))
  check('set -euo pipefail (严格模式)', /^set -euo pipefail$/m.test(ins))
  check('中文提示语四件套(info/ok/warn/err)', /\binfo\(\)/.test(ins) && /\bok\(\)/.test(ins) && /\bwarn\(\)/.test(ins) && /\berr\(\)/.test(ins))
  check('失败兜底 trap ERR + 排查清单', /trap on_error ERR/.test(ins) && /常见原因排查清单/.test(ins))
  check('非交互检测(管道执行不提问)', /\[ ! -t 0 \]/.test(ins))
  check('Docker 检测 (command -v docker)', /command -v docker/.test(ins))
  check('Linux 自动安装走官方 get.docker.com', ins.includes('get.docker.com'))
  check('get.docker.com 前补 curl (apt) 的兜底', /apt-get install -y curl/.test(ins))
  check('macOS 分支: Docker Desktop 指引', /Darwin\)/.test(ins) && /Docker Desktop/.test(ins))
  check('守护进程可用性检测 + sudo 降级', /docker info/.test(ins) && /\$SUDO docker/.test(ins))
  check('Compose v2 检测 (docker compose version)', /docker compose version/.test(ins))
  check('兼容旧版 docker-compose', /docker-compose/.test(ins))
  check('构建启动: compose up -d --build', /up -d --build/.test(ins))
  check('端口占用预检 (bash /dev/tcp, 零外部依赖)', /dev\/tcp\/127\.0\.0\.1/.test(ins))
  check('幂等: 自家旧容器在跑 → 照常重建并提示', /将自动重建/.test(ins) && /grep -qx "\$APP_NAME"/.test(ins))
  check('健康等待循环: inspect Health.Status + healthy', /State\.Health\.Status/.test(ins) && /healthy/.test(ins))
  check('健康等待有超时上限 + 超时打日志', /WAIT_TIMEOUT/.test(ins) && /等待超时/.test(ins) && /logs --tail 50/.test(ins))
  check('unhealthy 分支: 打印最近日志', /unhealthy/.test(ins))
  check('支持 REPO_URL 克隆模式 (git clone)', /REPO_URL/.test(ins) && /git clone/.test(ins))
  check('成功后打印访问地址(localhost + 局域网)', /localhost:\$\{HOST_PORT\}/.test(ins) && /LAN_IP/.test(ins))
  check('成功后打印数据目录与常用命令', /\.\/db/.test(ins) && /docker compose logs -f/.test(ins))
}

console.log('\n== 5/6 .dockerignore ==')
const di = readText('.dockerignore')
if (di) {
  // ss-a 注: mini-services 下 4 个 bun 代理改为共置进镜像, 仅排除 Python 桥目录(见 .dockerignore)
  const mustIgnore = ['node_modules', '.next', 'db', 'data', 'mini-services/scrapling-bridge', '.venv', 'dev.log', 'tmp', '.env', 'tool-results']
  for (const item of mustIgnore) check(`忽略 ${item}`, new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(di))
  check('关键: 不忽略 docker-entrypoint.sh (Dockerfile 要 COPY 它)', !/^docker-entrypoint\.sh\s*$/m.test(di))
  check('不忽略 bun.lock (锁定安装版本)', !/^bun\.lock\s*$/m.test(di))
  check('不忽略 package.json / prisma / src / public', !/^package\.json\s*$/m.test(di) && !/^prisma\s*$/m.test(di) && !/^src\s*$/m.test(di) && !/^public\s*$/m.test(di))
}

console.log('\n== 6/6 交叉一致性 + DEPLOY.md ==')
check('install.sh APP_NAME 与 compose 容器名一致', /APP_NAME="novel-system"/.test(ins))
check('install.sh 引用的 compose/Dockerfile/入口脚本三件齐全',
  existsSync('docker-compose.yml') && existsSync('Dockerfile') && existsSync('docker-entrypoint.sh'))
check('Dockerfile ENTRYPOINT 路径与 COPY 目标一致', /COPY docker-entrypoint\.sh \/usr\/local\/bin\/docker-entrypoint\.sh/.test(df) && /^ENTRYPOINT \["\/usr\/local\/bin\/docker-entrypoint\.sh"\]/m.test(df))
const deploy = readText('DEPLOY.md')
if (deploy) {
  check('DEPLOY.md 顶部含诚实验证状态声明(kk-b 静态验证 + ll-a 等价模拟实证)', /验证状态/.test(deploy) && /等价模拟/.test(deploy))
  check('DEPLOY.md 含两种安装方式(一键脚本 + 手动 compose)', /方式 ①/.test(deploy) && /方式 ②/.test(deploy))
  check('DEPLOY.md 含常见问题 FAQ(改端口/备份/升级/日志)', /常见问题 FAQ/.test(deploy) && /端口 3000 被占用/.test(deploy) && /怎么备份数据/.test(deploy) && /怎么升级/.test(deploy) && /怎么看日志/.test(deploy))
  check('DEPLOY.md 说明 mini-services 定位(容器不启用, 本地开发才需要)', /scrapling-bridge/.test(deploy) && /本地开发/.test(deploy) && /native HTTP/.test(deploy))
  check('DEPLOY.md 含默认入口说明', /默认入口/.test(deploy) && /view=home/.test(deploy))
}

console.log(`\n===== kk-b Docker 交付验证: ${pass}/${pass + fails.length} =====`)
if (fails.length) {
  console.error('失败项:')
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
