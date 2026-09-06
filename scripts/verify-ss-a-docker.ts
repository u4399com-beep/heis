// ============================================================
// scripts/verify-ss-a-docker.ts — Docker 全家桶+自动填充 静态断言矩阵 (ss-a)
// ============================================================
// 覆盖面(沙箱无 docker 二进制, 与 kk-b 同口径: 结构/接线层静态断言):
//   A. Dockerfile: bun 二进制 COPY + 5 代理目录 COPY + autofill 两件 COPY + logs 目录
//                  + 国内镜像源 NPM_REGISTRY 条件式接线(uu-a)
//   B. docker-entrypoint.sh: db push → 5 代理启动(PORT 显式覆盖+端口就绪等待+失败不挡主服务)
//                             → autofill 后台拉起(AUTO_FILL 门控) → exec server.js
//   C. docker-compose.yml: AUTO_FILL/AUTO_FILL_RULES 注入 + volumes + healthcheck
//                          + scrapling --profile stealthy 可选服务(network_mode 共享网络)
//   D. install.sh: AUTO_FILL 透传 + 仓库完整性检查 + 自动填充状态段
//   E. docker/autofill.mjs: 门控/幂等/状态机/DRY_RUN/健康轮询 关键结构
//   F. docker/autofill-rules.json: 9 entries(含 pili/xjp) + 默认七站 + 任务名「自动填充·」前缀 + 六段齐
//   G. .dockerignore: scrapling-bridge 排除但 5 个 bun 代理不被整目录排除
//   H. 国内镜像源接线(uu-a): compose build.args 四变量映射 → Dockerfile NPM_REGISTRY
//      ARG+条件式 --registry → Dockerfile.scrapling 三 ARG(DEBIAN_MIRROR/PIP_INDEX_URL/
//      PLAYWRIGHT_DOWNLOAD_HOST); 全部空默认 = 海外默认零回归
//   I. 基础镜像源切换(vv): BUN_IMAGE/NODE_IMAGE/PYTHON_IMAGE ARG 化 + compose 接线
//      + bun 二进制改由 builder 拷贝(消 docker.io 二次解析) + install.sh 镜像站探测注入
//      + DEBIAN_MIRROR 主机名段对齐
//   J. 国内部署链收官加固(vv 收官): USE_CN_MIRROR 顶部预初始化(set -u 二次运行崩溃修复)
//      + 镜像站候选/加速器清单 7 站(新增 aityp/hlmirror, 剔除 rainbond) + prepull_base_images
//      预拉兜底(仅 BUN/NODE 两镜像、换站 printf -v 反写、CN_MODE 门控官方名兜底)
//      + verify_mirrors_active 自检(≥2 调用) + 无 python3 JSON 逐项拼接修复 + USER_MIRRORS 过滤
//   K. git 缺失自愈(xx): ensure_git 自动补装(apt/dnf/yum, 未识别 return 1) + fetch_tarball
//      压缩包兜底(GitHub 守卫/main→master 依序/复用加速代理) + clone_repo 无 git 三分支降级
//      (.git 在无 git 跳过更新/无 git 改走压缩包/克隆全败尾部兜底) + PKG 探测前移步骤 0 之前
//   L. gpg 缺失三层降级(yy): setup_docker_repo_apt 内 keyfile 初始化 + gpg 缺门自动补装
//      gnupg(双跳容错/已就绪自检) + 补装失败改写 .asc 盔甲密钥(tee 直写免 gpg) + dearmor
//      门控双通道 + signed-by=${keyfile} 变量化统一收口 + err 清单第 4 条自愈提示
// 断言总数: 106 项(A11/B11/C6/D4/E8/F14/G2/H13/I10/J10/K9/L8)
// 用法: bun run scripts/verify-ss-a-docker.ts   (exit 0 = 全过)
// ============================================================
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export {} // module 守卫(bun 顶层代码 + tsc 惯例)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label}`)
  }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

// ---------- A. Dockerfile ----------
console.log('A. Dockerfile')
const dockerfile = read('Dockerfile')
ok(dockerfile.includes('COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun') && !dockerfile.includes('COPY --from=oven/bun:1'), 'A1 bun 单文件二进制注入 runner 阶段(builder 阶段拷贝, 无镜像名二次解析)')
for (const svc of ['bqg713-proxy', 'fetch-relay', 'qimao-proxy', 'deqixs-proxy', 'xjp-proxy']) {
  ok(dockerfile.includes(`COPY --from=builder /app/mini-services/${svc}`), `A2 代理进镜像: ${svc}`)
}
ok(dockerfile.includes('COPY docker/autofill.mjs docker/autofill-rules.json'), 'A3 autofill 脚本+清单进镜像')
ok(dockerfile.includes('/app/logs'), 'A4 logs 目录预建')
ok(!/ENV[^]*AUTO_FILL=[^1]/.test(dockerfile.split('FROM ${NODE_IMAGE}')[1] ?? ''), 'A5 runner 阶段不设 AUTO_FILL 默认(由 compose 注入)')
ok(dockerfile.includes('同容器共置 5 个 bun 采集代理') && dockerfile.includes('供 5 个采集代理运行'), 'A6 头注释代理计数 = 5(与 5×COPY/entrypoint start_proxy 实况一致, stale 4→5 修复)')
ok(!dockerfile.includes('共置 4 个') && !dockerfile.includes('供 4 个采集代理'), 'A7 无 stale「4 个代理」计数残留')

// ---------- B. docker-entrypoint.sh ----------
console.log('B. docker-entrypoint.sh')
const entry = read('docker-entrypoint.sh')
ok(entry.includes('db push'), 'B1 db push 幂等初始化在位')
for (const [name, port] of [
  ['bqg713-proxy', '3010'],
  ['fetch-relay', '3011'],
  ['qimao-proxy', '3013'],
  ['deqixs-proxy', '3014'],
  ['xjp-proxy', '3015'],
] as const) {
  ok(entry.includes(`start_proxy ${name} `) && entry.includes(` ${port}`), `B2 代理启动: ${name}:${port}`)
}
ok(entry.includes('PORT="${_sp_port}"'), 'B3 PORT 显式前缀覆盖(防 env.PORT=3000 地雷)')
ok(entry.includes('wait_port'), 'B4 端口就绪等待')
ok(entry.includes('不影响主服务继续启动'), 'B5 代理失败不挡主服务')
ok(entry.includes('node /app/docker/autofill.mjs &'), 'B6 autofill 后台拉起')
ok(entry.includes('exec node server.js'), 'B7 exec server.js 收尾')

// ---------- C. docker-compose.yml ----------
console.log('C. docker-compose.yml')
const compose = read('docker-compose.yml')
ok(compose.includes('AUTO_FILL=${AUTO_FILL:-1}'), 'C1 AUTO_FILL 默认开启(compose 注入)')
ok(compose.includes('AUTO_FILL_RULES=${AUTO_FILL_RULES:-fanqie,qimao,deqixs,80ge,jhssd,ttkan,bqg713}'), 'C2 AUTO_FILL_RULES 默认七站')
ok(compose.includes('./db:/app/db') && compose.includes('./data:/app/data'), 'C3 db/data volumes 持久化')
ok(compose.includes('fetch(') && compose.includes('127.0.0.1:3000'), 'C4 healthcheck node fetch 探活')
ok(compose.includes('profiles: ["stealthy"]'), 'C5 scrapling 桥属可选 profile')
ok(compose.includes('network_mode: "service:novel-system"'), 'C6 scrapling 桥共享主容器网络命名空间')

// ---------- D. install.sh ----------
console.log('D. install.sh')
const install = read('install.sh')
ok(install.includes('AUTO_FILL') && install.includes('export AUTO_FILL'), 'D1 AUTO_FILL 归一+export 透传')
ok(install.includes('autofill.mjs') && install.includes('autofill-rules.json'), 'D2 仓库完整性检查含 autofill 两件')
ok(install.includes('[自动填充]') || install.includes('自动填充'), 'D3 自动填充状态段在位')
ok(install.includes('up -d --build'), 'D4 compose 构建启动路径')

// ---------- E. docker/autofill.mjs ----------
console.log('E. docker/autofill.mjs')
const autofill = read('docker/autofill.mjs')
ok(autofill.includes("process.env.AUTO_FILL === '1'"), 'E1 AUTO_FILL 门控')
ok(autofill.includes("process.env.DRY_RUN === '1'"), 'E2 DRY_RUN 支持')
ok(autofill.includes('waitServerHealthy'), 'E3 健康轮询')
ok(autofill.includes("find((r) => r.name === rule.name)"), 'E4 规则按名称幂等(缺失才建)')
ok(autofill.includes("find((t) => t.name === taskName)"), 'E5 任务同名幂等')
ok(autofill.includes("['pending', 'paused', 'stopped', 'error']"), 'E6 状态机续跑面')
ok(autofill.includes("'done'"), 'E7 done 尊重(不重跑)')
ok(autofill.includes('/control'), 'E8 control start 端点')

// ---------- F. docker/autofill-rules.json ----------
console.log('F. docker/autofill-rules.json')
const jsonPath = join(ROOT, 'docker', 'autofill-rules.json')
ok(existsSync(jsonPath), 'F1 清单文件存在')
const entries = JSON.parse(readFileSync(jsonPath, 'utf8')) as Array<Record<string, unknown>>
ok(entries.length === 9, `F2 9 entries(实际 ${entries.length})`)
const keys = entries.map((e) => e.key)
for (const k of ['fanqie', 'qimao', 'deqixs', 'bqg713', '80ge', 'jhssd', 'ttkan', 'pili', 'xjp']) {
  ok(keys.includes(k), `F3 站点 key: ${k}`)
}
let shapeOk = true
let prefixOk = true
let segOk = true
for (const e of entries) {
  const rule = e.rule as Record<string, unknown> | undefined
  const task = e.task as Record<string, unknown> | undefined
  if (!e.key || !rule || typeof rule.name !== 'string' || !task || typeof task.name !== 'string') shapeOk = false
  if (typeof task?.name === 'string' && !task.name.startsWith('自动填充·')) prefixOk = false
  const cfg = rule?.config as Record<string, unknown> | undefined
  if (!cfg || !['list', 'book', 'toc', 'content', 'fetch', 'clean'].every((s) => cfg[s])) segOk = false
}
ok(shapeOk, 'F4 entry 形态(key/rule.name/task.name)齐备')
ok(prefixOk, 'F5 任务名统一「自动填充·」前缀')
ok(segOk, 'F6 全部规则 config 六段齐(list/book/toc/content/fetch/clean)')

// ---------- G. .dockerignore ----------
console.log('G. .dockerignore')
const di = read('.dockerignore')
ok(di.includes('mini-services/scrapling-bridge'), 'G1 scrapling-bridge(Python) 排除出默认镜像')
ok(!/^mini-services$/m.test(di.trim()) && !/^mini-services\/\*$/m.test(di), 'G2 5 个 bun 代理未被整目录排除')

// ---------- H. 国内镜像源接线(uu-a) ----------
console.log('H. 国内镜像源接线(build args → ARG → 工具链)')
// H1/H2: docker-compose.yml 两服务 build.args 四变量映射(compose 侧空默认 ${VAR:-})
ok(compose.includes('- NPM_REGISTRY=${NPM_REGISTRY:-}'), 'H1 compose: novel-system build.args 传 NPM_REGISTRY(空默认)')
for (const v of ['DEBIAN_MIRROR', 'PIP_INDEX_URL', 'PLAYWRIGHT_DOWNLOAD_HOST']) {
  ok(compose.includes('- ' + v + '=${' + v + ':-}'), 'H2 compose: scrapling-bridge build.args 传 ' + v + '(空默认)')
}
// H3-H6: 主 Dockerfile ARG NPM_REGISTRY + bun install 条件式 --registry
ok(dockerfile.includes('ARG NPM_REGISTRY=""'), 'H3 Dockerfile: ARG NPM_REGISTRY 空默认声明(空=官方源)')
ok(dockerfile.includes('bun install --frozen-lockfile --registry "$NPM_REGISTRY"'), 'H4 Dockerfile: 依赖安装条件式 --registry(非空分支)')
ok(dockerfile.includes('bun install --production --frozen-lockfile --registry "$NPM_REGISTRY"'), 'H5 Dockerfile: 生产重装条件式 --registry(非空分支)')
ok(/if \[ -n "\$NPM_REGISTRY" \]/.test(dockerfile), 'H6 Dockerfile: 非空判断条件分支(空时保持原样)')
// H7-H9: Dockerfile.scrapling 三 ARG + 接线
const scrapDf = read('Dockerfile.scrapling')
for (const v of ['DEBIAN_MIRROR', 'PIP_INDEX_URL', 'PLAYWRIGHT_DOWNLOAD_HOST']) {
  ok(scrapDf.includes('ARG ' + v + '=""'), 'H7 Dockerfile.scrapling: ARG ' + v + ' 空默认')
}
ok(scrapDf.includes('sed -i "s|http://deb.debian.org|http://${DEBIAN_MIRROR}|g"') && scrapDf.includes('debian.sources'), 'H8 Dockerfile.scrapling: DEBIAN_MIRROR 经 sed 替换 deb822 apt 源')
ok(scrapDf.includes('ENV PIP_INDEX_URL=${PIP_INDEX_URL:-}') && scrapDf.includes('PLAYWRIGHT_DOWNLOAD_HOST=${PLAYWRIGHT_DOWNLOAD_HOST:-}'), 'H9 Dockerfile.scrapling: pip/playwright 镜像源 ENV 接线(空默认透传)')

// ---------- I. 基础镜像源切换(vv) ----------
console.log('I. 基础镜像源切换(BuildKit 拉取直指镜像站)')
ok(dockerfile.includes('ARG BUN_IMAGE=oven/bun:1'), 'I1 Dockerfile: ARG BUN_IMAGE 官方默认')
ok(dockerfile.includes('FROM ${BUN_IMAGE} AS builder'), 'I2 Dockerfile: builder 阶段经 ${BUN_IMAGE} 引用')
ok(dockerfile.includes('ARG NODE_IMAGE=node:22-slim'), 'I3 Dockerfile: ARG NODE_IMAGE 官方默认')
ok(dockerfile.includes('FROM ${NODE_IMAGE} AS runner'), 'I4 Dockerfile: runner 阶段经 ${NODE_IMAGE} 引用')
ok(dockerfile.includes('COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun') && !dockerfile.includes('COPY --from=oven/bun:1'), 'I5 Dockerfile: bun 二进制改由 builder 拷贝(消 docker.io 二次解析)')
ok(compose.includes('BUN_IMAGE=${BUN_IMAGE:-oven/bun:1}') && compose.includes('NODE_IMAGE=${NODE_IMAGE:-node:22-slim}'), 'I6 compose: novel-system build.args 传基础镜像(compose 侧官方默认)')
ok(scrapDf.includes('ARG PYTHON_IMAGE=python:3.12-slim') && scrapDf.includes('FROM ${PYTHON_IMAGE}'), 'I7 Dockerfile.scrapling: PYTHON_IMAGE ARG+引用')
ok(compose.includes('PYTHON_IMAGE=${PYTHON_IMAGE:-python:3.12-slim}'), 'I8 compose: scrapling-bridge build.args 传 PYTHON_IMAGE')
ok(install.includes('pick_registry_host') && install.includes('BUN_IMAGE="${BUN_IMAGE:-${REG_HOST}/oven/bun:1}"') && install.includes('NODE_IMAGE="${NODE_IMAGE:-${REG_HOST}/library/node:22-slim}"'), 'I9 install.sh: 国内模式自动探测镜像站并注入基础镜像')
ok(install.includes('DEBIAN_MIRROR="${DEBIAN_MIRROR:-mirrors.aliyun.com}"') && !install.includes('DEBIAN_MIRROR:-https://mirrors.aliyun.com/debian'), 'I10 install.sh: DEBIAN_MIRROR 导出为主机名段(与 scrapling sed host 拼接对齐)')

// ---------- J. 国内部署链收官加固(vv 收官轮) ----------
console.log('J. install.sh 国内部署收官加固(预初始化/7 站/预拉兜底/自检生效/JSON 修复)')
// 工具: 提取 bash 数组字面量 block 内的引号项(仅数组块内判定, 不受块外注释影响)
const bashArrayItems = (name: string): string[] => {
  const start = install.indexOf(name + '=(')
  if (start < 0) return []
  const seg = install.slice(start, install.indexOf('\n)', start))
  return [...seg.matchAll(/"([^"]*)"/g)].map((m) => m[1])
}
// prepull_base_images 函数体(定义行起至首个顶格 '}' 止; 函数上方说明注释不含在内)
const ppStart = install.indexOf('prepull_base_images() {')
const ppBody = ppStart >= 0 ? install.slice(ppStart, install.indexOf('\n}', ppStart)) : ''
// 代码行(剔全行注释): J9 负断言用 —— 修复说明注释里保留旧写法字样属正常
const codeOnly = install.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n')

ok(install.includes('USE_CN_MIRROR="${USE_CN_MIRROR:-}"') && install.indexOf('USE_CN_MIRROR="${USE_CN_MIRROR:-}"') < install.indexOf('probe_url()'), 'J1 install.sh: USE_CN_MIRROR 顶部预初始化(set -u 下二次运行 unbound variable 实锤崩溃修复)')
const hostSites = bashArrayItems('REGISTRY_HOST_CANDIDATES')
ok(hostSites.length === 7 && hostSites.includes('docker.aityp.com') && hostSites.includes('docker.hlmirror.com') && !hostSites.includes('docker.rainbond.cc'), 'J2 install.sh: REGISTRY_HOST_CANDIDATES 恰 7 站(新增 aityp/hlmirror, 剔除真网全超时的 rainbond)')
const mirrorDefaults = bashArrayItems('REGISTRY_MIRROR_DEFAULTS')
ok(mirrorDefaults.length === 7 && mirrorDefaults.every((s) => s.startsWith('https://')) && mirrorDefaults.map((s) => s.replace('https://', '')).join('|') === hostSites.join('|'), 'J3 install.sh: REGISTRY_MIRROR_DEFAULTS 同 7 站带 https:// scheme(与 host 候选逐一同站同序)')
const prepullCallIdx = install.search(/^prepull_base_images\s*$/m)
ok(install.includes('prepull_base_images() {') && prepullCallIdx >= 0 && prepullCallIdx > install.indexOf('海外默认配置'), 'J4 install.sh: prepull_base_images 定义且在 detect_cn_network if/else fi 之后裸调用')
ok(ppBody.includes('for vn in BUN_IMAGE NODE_IMAGE; do') && !ppBody.includes('PYTHON_IMAGE'), 'J5 install.sh: 预拉仅 BUN_IMAGE/NODE_IMAGE 两镜像(PYTHON_IMAGE 属可选 scrapling 桥, 不预拉省默认流量)')
ok(ppBody.includes('printf -v "$vn"') && ppBody.includes('export "$vn"'), 'J6 install.sh: 预拉失败换站成功后 printf -v + export 反写镜像变量(经 BUILD_ENV/sudo env 透传 compose)')
ok(ppBody.includes('for canon in oven/bun:1 node:22-slim; do') && ppBody.includes('[ "$CN_MODE" = "1" ]'), 'J7 install.sh: 官方名兜底(CN_MODE=1 且两镜像变量全空 → docker pull 走 daemon 加速器, 与 BuildKit 路径不同)')
const vmaCount = install.split('verify_mirrors_active').length - 1
ok(vmaCount >= 3 && install.includes("grep -qi 'Registry Mirrors'"), 'J8 install.sh: verify_mirrors_active 定义+调用≥2 次(已配置跳过+重启成功两路径; docker info 自检 Registry Mirrors)')
ok(!/IFS='","'/.test(codeOnly) && install.includes('joint+="${joint:+\\",\\"}${m}"'), 'J9 install.sh: 无 python3 路径 JSON 拼接修复(代码不再用 IFS 假分隔拼接, 改逐项补 , 产出合法 JSON)')
ok(install.includes('"${USER_MIRRORS[@]+"${USER_MIRRORS[@]}"}"') && install.includes('回落默认加速器清单'), 'J10 install.sh: USER_MIRRORS 空项/空白项过滤(set -u 安全展开) + 全空回落默认清单 warn')

// ---------- K. git 缺失自愈(xx) ----------
console.log('K. install.sh git 缺失自愈(自动补装/压缩包兜底/无 git 降级)')
// 函数体截取(定义行起至首个顶格 '}' 止; 上方说明注释不计) — J5 ppBody 同款
const fnBody = (sig: string): string => {
  const s = install.indexOf(sig)
  return s >= 0 ? install.slice(s, install.indexOf('\n}', s)) : ''
}
const egBody = fnBody('ensure_git() {')
const ftBody = fnBody('fetch_tarball() {')
const crBody = fnBody('clone_repo() {')
ok(egBody.includes('command -v git >/dev/null 2>&1 && return 0') && egBody.includes('info "未检测到 git, 尝试自动安装..."'), 'K1 install.sh: ensure_git() 定义在场(有 git 快速 return 0) + 缺失时 info「未检测到 git, 尝试自动安装...」')
ok(egBody.includes('case "$PKG" in') && egBody.includes('export DEBIAN_FRONTEND=noninteractive') && egBody.includes('$SUDO apt-get install -y git') && egBody.includes('$SUDO dnf install -y git') && egBody.includes('$SUDO yum install -y git') && egBody.includes('*)') && egBody.includes('return 1'), 'K2 install.sh: ensure_git 经 case "$PKG" 分发 — apt 分支 DEBIAN_FRONTEND=noninteractive + apt-get/dnf/yum install -y git 三分支 + *) 未识别包管理器 return 1')
ok(ftBody.includes('case "$url" in') && ftBody.includes('https://github.com/*)') && ftBody.includes('非 GitHub 仓库地址') && ftBody.includes('return 1'), 'K3 install.sh: fetch_tarball() 定义在场 + case "$url" 守卫(https://github.com/*) 放行 / 非 GitHub 仓库地址 return 1 无压缩包通道)')
const tarUrlCount = ftBody.split('archive/refs/heads/${branch}.tar.gz').length - 1
ok(ftBody.includes('for branch in main master; do') && tarUrlCount === 2, 'K4 install.sh: fetch_tarball 函数体内 for branch in main master 依序 + 归档直链 archive/refs/heads/${branch}.tar.gz 恰 2 处(直连候选 + ${p} 代理前缀拼接)')
const proxyLoopCount = install.split('for p in "${GH_PROXY_PREFIXES[@]}"').length - 1
ok(ftBody.includes('for p in "${GH_PROXY_PREFIXES[@]}"') && proxyLoopCount === 2, 'K5 install.sh: fetch_tarball 函数体内加速代理循环在场(全文件 for p in "${GH_PROXY_PREFIXES[@]}" 恰 2 处 = fetch_tarball + clone_repo, scope 到函数体防同名循环混淆)')
// K6: 无 git 且非 git 仓库分支(自 'if ! command -v git' 起至首个 'git_probe 10' 止)
const ng0 = crBody.indexOf('if ! command -v git')
const ng1 = ng0 >= 0 ? crBody.indexOf('git_probe 10', ng0) : -1
const noGitBranch = ng0 >= 0 && ng1 > ng0 ? crBody.slice(ng0, ng1) : ''
ok(noGitBranch.includes('未检测到 git 且目录不是 git 仓库') && noGitBranch.includes('fetch_tarball "$url" "$dest"') && noGitBranch.includes('压缩包下载也失败') && noGitBranch.includes('return 1'), 'K6 install.sh: clone_repo 无 git 且目录非 git 仓库分支 → warn 改走压缩包 + fetch_tarball 兜底 + err 压缩包下载也失败(先装 git 后重跑) + return 1')
// K7: .git 存在但无 git 分支(自 '[ -d "${dest}/.git" ]' 起至无 git 分支止)
const dg0 = crBody.indexOf('[ -d "${dest}/.git" ]')
const dg1 = dg0 >= 0 ? crBody.indexOf('if ! command -v git', dg0) : -1
const destGitBranch = dg0 >= 0 && dg1 > dg0 ? crBody.slice(dg0, dg1) : ''
ok(destGitBranch.includes('目录已存在但系统未安装 git') && destGitBranch.includes('如需在线升级') && destGitBranch.includes('return 0'), 'K7 install.sh: clone_repo .git 存在但无 git 分支 → warn 跳过在线更新 + 如需在线升级先装 git 指引 + return 0 不阻塞')
// K8: 克隆全败尾部兜底(自 '最后尝试压缩包方式' 起至函数体尾)
const lt0 = crBody.indexOf('最后尝试压缩包方式')
const crTail = lt0 >= 0 ? crBody.slice(lt0) : ''
ok(crTail.includes('fetch_tarball "$url" "$dest"') && crTail.includes('仓库获取失败(克隆与压缩包均不可达)') && crTail.includes('return 1'), 'K8 install.sh: 克隆全败(直连+加速代理均不可达)尾部兜底 → warn 最后尝试压缩包方式 + fetch_tarball + err 仓库获取失败(克隆与压缩包均不可达) + return 1')
const pkgIdx = install.indexOf('PKG=""')
const step0Idx = install.indexOf('步骤 0: 定位项目目录')
const ensureGitCallIdx = install.indexOf('ensure_git ||')
const cloneCallIdx = install.indexOf('clone_repo "$REPO_URL"')
ok(pkgIdx >= 0 && pkgIdx < step0Idx && step0Idx < ensureGitCallIdx && ensureGitCallIdx < cloneCallIdx, 'K9 install.sh: PKG 探测块(PKG="" 首现)前移至步骤 0 之前(ensure_git 先知包管理器) + 步骤 0 内 ensure_git || 调用先于 clone_repo(压缩包降级预告)')

// ---------- L. gpg 缺失三层降级(yy) ----------
console.log('L. install.sh gpg 缺失三层降级(自动补装/.asc 兜底/统一收口)')
// L1-L7 scope 到 setup_docker_repo_apt 函数体(定义行起至首个顶格 '}' 止) — J5/K fnBody 同款, 上方说明注释不计
const sdraBody = fnBody('setup_docker_repo_apt() {')
ok(sdraBody.includes('gpg 依赖三层降级(yy 轮)') && sdraBody.includes('local keyfile="/etc/apt/keyrings/docker.gpg"'), 'L1 install.sh: setup_docker_repo_apt 函数体内注释锚「gpg 依赖三层降级(yy 轮)」+ keyfile 初始赋值 local .../docker.gpg')
ok(sdraBody.includes('if ! command -v gpg >/dev/null 2>&1; then') && sdraBody.includes('warn "未检测到 gpg, 尝试自动补装 gnupg..."'), 'L2 install.sh: gpg 缺失门(if ! command -v gpg) + warn「未检测到 gpg, 尝试自动补装 gnupg...」')
const gnupgCount = sdraBody.split('apt-get install -y gnupg').length - 1
ok(gnupgCount === 2 && sdraBody.includes('|| { $SUDO apt-get update -y >/dev/null 2>&1 || true; $SUDO apt-get install -y gnupg'), 'L3 install.sh: gnupg 补装双跳容错 — apt-get install -y gnupg 恰 2 次(直装 + apt-get update 后重试) + 第二跳在 || { 块内(两跳均 || true 容错)')
ok(sdraBody.includes('if command -v gpg >/dev/null 2>&1; then') && sdraBody.includes('ok "gpg 已就绪"'), 'L4 install.sh: 补装后二次 command -v gpg 检查(if 形态, 非 ! 门) + ok「gpg 已就绪」走原 dearmor 路径')
ok(sdraBody.includes('gpg 暂不可用, 改用免 gpg 的 .asc 密钥方式') && sdraBody.includes('keyfile="/etc/apt/keyrings/docker.asc"') && !sdraBody.includes('local keyfile="/etc/apt/keyrings/docker.asc"'), 'L5 install.sh: 补装失败 → warn「gpg 暂不可用, 改用免 gpg 的 .asc 密钥方式」+ keyfile 反写为 docker.asc(反写赋值, 非 local 重复声明)')
ok(sdraBody.includes('| $SUDO tee "$keyfile" >/dev/null') && sdraBody.includes('| $SUDO gpg --dearmor --yes -o "$keyfile"') && sdraBody.includes('if [ "$keyfile" = "/etc/apt/keyrings/docker.gpg" ]; then'), 'L6 install.sh: .asc 直写(curl | $SUDO tee "$keyfile")与 dearmor 路径(gpg --dearmor --yes -o "$keyfile")双通道并存 + dearmor 被 keyfile=docker.gpg 门控(.asc 路径不重复 dearmor)')
ok(sdraBody.includes('deb [signed-by=${keyfile}]') && sdraBody.includes('| $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null') && !sdraBody.includes('signed-by=/etc/apt'), 'L7 install.sh: 统一收口 deb [signed-by=${keyfile}] 变量化(不再硬编码 keyrings 路径) + tee /etc/apt/sources.list.d/docker.list 双通道共用同一行收口')
const idlBody = fnBody('install_docker_linux() {')
const efBody = fnBody('ensure_fetcher() {')
ok(idlBody.includes('4) 日志若见 gpg: command not found → 先手动 apt install -y gnupg 后重跑') && efBody.includes('gpg 缺失的完整降级链在 setup_docker_repo_apt 内'), 'L8 install.sh: install_docker_linux 全源失败 err 清单第 4 条 gpg 自愈提示(手动装 gnupg 后重跑, 新版脚本已可自愈) + ensure_fetcher 头注释指引完整降级链在 setup_docker_repo_apt 内')

// ---------- 汇总 ----------
console.log(`\n结果: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
console.log('verify-ss-a-docker: ALL PASS')
