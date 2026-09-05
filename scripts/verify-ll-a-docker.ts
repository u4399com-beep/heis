// ============================================================
// verify-ll-a-docker.ts — Docker 交付物等价模拟生产验证断言
//
// 背景: 交付机无 Docker daemon(无 root), kk-b 仅做静态结构验证。
//       ll-a 按 Dockerfile 逐命令在隔离目录真实执行了等价构建+运行全流程(过程记录见 worklog ll轮):
//         阶段1(builder): bun install --frozen-lockfile → prisma generate → next build(standalone)
//                         → cp static/public → rm node_modules → bun install --production → re-generate
//         阶段2(runner) : standalone + 生产 node_modules(合并语义) + prisma + entrypoint
//         运行          : 容器 ENV 下 entrypoint(db push 首建/幂等复跑/容错分支) → node server.js
//                         → compose 同款 healthcheck → 首页/公开API/管理API/sitemap 端到端全 200
//
// 本脚本固化两层断言(可在无 Docker 环境复跑):
//   A. 交付物静态结构(Dockerfile 指令链/compose 键/entrypoint 幂等语义/install.sh 零基础路径)
//   B. 模拟实测沉淀的确定性结论(内存要求文案/standalone 布局防御/COPY 合并语义注释/健康检查命令)
//
// 运行: bun scripts/verify-ll-a-docker.ts
// ============================================================
import { readFileSync, existsSync } from 'node:fs'

export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}

const df = readFileSync('Dockerfile', 'utf8')
const compose = readFileSync('docker-compose.yml', 'utf8')
const ep = readFileSync('docker-entrypoint.sh', 'utf8')
const inst = readFileSync('install.sh', 'utf8')
const dignore = readFileSync('.dockerignore', 'utf8')
const deploy = readFileSync('DEPLOY.md', 'utf8')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

console.log('\n== A1. Dockerfile 构建链完整性(与真实构建实测对齐) ==')
const buildCmdIdx = df.indexOf('bun node_modules/next/dist/bin/next build')
ok('阶段1 全量安装(含 dev — @tailwindcss/postcss 等 build 期必需)', df.includes('bun install --frozen-lockfile') && df.indexOf('bun install --frozen-lockfile') < buildCmdIdx)
ok('prisma generate 显式 bun 执行(镜像无 node, .bin shebang 不可用)', df.includes('bun node_modules/prisma/build/index.js generate'))
ok('next build 经 bun 直执行 + standalone 静态资源两连拷', df.includes('bun node_modules/next/dist/bin/next build') && df.includes('cp -r .next/static .next/standalone/.next/') && df.includes('cp -r public .next/standalone/'))
const dfOneline = df.replace(/\\\n/g, ' ').replace(/\s+/g, ' ')
ok('裁剪生产依赖后再 generate(runner 期 prisma CLI+引擎在位)', /rm -rf node_modules && bun install --production --frozen-lockfile && bun node_modules\/prisma\/build\/index\.js generate/.test(dfOneline))
ok('runner 拷 standalone+完整 node_modules(覆盖追踪子集)+prisma+entrypoint', df.includes('COPY --from=builder /app/.next/standalone ./') && df.includes('COPY --from=builder /app/node_modules ./node_modules') && df.includes('COPY --from=builder /app/prisma ./prisma') && df.includes('COPY docker-entrypoint.sh'))
ok('standalone 绑定 HOSTNAME=0.0.0.0 + openssl/ca-certificates(slim 运行期依赖)', df.includes('HOSTNAME=0.0.0.0') && df.includes('openssl ca-certificates'))

console.log('\n== A2. compose 键与健康检查(compose 同款命令已实测探活 200) ==')
ok('服务/端口/volume/restart 齐全', compose.includes('"3000:3000"') && compose.includes('./db:/app/db') && compose.includes('./data:/app/data') && compose.includes('restart: unless-stopped'))
ok('healthcheck 用镜像内 node fetch(无 curl/wget 依赖)', compose.includes('"CMD", "node", "-e"') && compose.includes("fetch('http://127.0.0.1:3000/')"))
ok('start_period 40s(首启含 db push+启动预热)', compose.includes('start_period: 40s'))

console.log('\n== A3. entrypoint 幂等/容错语义(实测: 首建建表/二次 already in sync/CLI缺失时警告续跑) ==')
const pushCmd = ep.split('\n').find((l) => l.includes('--skip-generate')) || '' // 取实际命令行(首个含 db push 的是头注释)
ok('db push 不带 --accept-data-loss(绝不静默毁数据)', pushCmd.includes('db push --schema prisma/schema.prisma --skip-generate') && !pushCmd.includes('--accept-data-loss'))
ok('push 失败分支: 警告中文指引+继续启动(实测容错路径生效)', ep.includes('[警告] 数据库结构同步失败') && ep.includes('exec node server.js'))
ok('exec 替换 PID 1(docker stop 优雅退出)', ep.trimEnd().endsWith('exec node server.js'))
ok('数据目录预建与 volume 挂载点一致', ep.includes('mkdir -p /app/db /app/data/covers /app/data/novels /app/data/downloads'))

console.log('\n== A4. install.sh 零基础路径 ==')
ok('docker 缺失指引 + 管道模式提示', inst.includes('GET_DOCKER_URL') || inst.includes('get.docker.com'))
ok('失败兜底中文排查清单(退出码非0)', inst.includes('on_error') && inst.includes('安装失败'))
ok('幂等重建(重复执行安全)', /幂等/.test(inst))
ok('健康等待(300s 上限+轮询)', inst.includes('WAIT_TIMEOUT'))

console.log('\n== B1. 模拟实测沉淀结论 ==')
ok('内存要求已按实测更新为 4GB(Turbopack 构建峰值超 2GB)', deploy.includes('4GB 内存') && deploy.includes('峰值超 2GB'))
ok('.dockerignore 排除运行时数据与网关配置', dignore.includes('db') && dignore.includes('data') && dignore.includes('Caddyfile'))
ok('prisma 在 dependencies(bun install --production 后 runner 仍有 CLI — 实测前提)', (pkg.dependencies as Record<string, string>).prisma !== undefined)
ok('@tailwindcss/postcss 在 devDependencies(build 期专用, runner 不需要)', (pkg.devDependencies as Record<string, string>)['@tailwindcss/postcss'] !== undefined)
ok('build 脚本与 Dockerfile 构建段同构(static/public 进 standalone)', pkg.scripts.build.includes('cp -r .next/static .next/standalone/.next/'))
ok('Next config output=standalone(standalone 产物前提)', readFileSync('next.config.ts', 'utf8').includes('output: "standalone"'))
ok('交付物四件套在场', existsSync('Dockerfile') && existsSync('docker-compose.yml') && existsSync('docker-entrypoint.sh') && existsSync('install.sh'))

console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`)
if (fail > 0) process.exit(1)
process.exit(0)
