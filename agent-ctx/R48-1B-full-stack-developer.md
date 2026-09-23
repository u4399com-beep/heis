# R48-1B — 清理精简 + DEPLOY 更新

## 任务背景

R47-1B 已完成 R10-R30 注释清理 + scripts/rule-yueyouxs.json portable 化 + dev.log/.next/next-env.d.ts
清理 + LoC/heis-backend git 跟踪确认。R48-1B 接续清理:

1. Go dead code 复检 (go vet + staticcheck + deadcode).
2. 重复逻辑整合审查 (services/ 公共 helper / templates/ partial / crawl/ 模块间).
3. 过时注释清理 (R10-R30, R47-1B 已基本清完, 本轮复检残留).
4. 临时文件清理 (scripts/ 一次性脚本 / agent-ctx/ 过时 / go-backend/*.log).
5. DEPLOY.md 更新 (确认纯 Go + auto-restart dev script + LoC/端口/模板数一致).
6. README.md 更新 (纯 Go + auto-restart + utls 21 款 + 9321 LoC).

## 工作内容

### 1. Go dead code 复检

- `cd /home/z/my-project/go-backend && ~/go/go/bin/go vet ./...` → 0 warnings (主包 + 11 services +
  bridgeserver + crawl 全 pass).
- `PATH=$HOME/go/go/bin:$PATH ~/go/bin/staticcheck ./...` → 0 issues (staticcheck 2026.2.1 / v0.8.1).
- `~/go/bin/deadcode -test=false ./...` → 38 个 exported funcs unreachable from main():
  - crawl/fetcher.go: CookieJar.{Count,Clear,SaveToDisk,LoadFromDisk} + ClearDomainUA +
    ClearHostReferer + IsJSChallenge + BrotliMissHostSnapshot + CaptchaServiceStatsSnapshot +
    boolToInt64 (private helper, 被 CaptchaServiceStatsSnapshot 调用, 但 snapshot 自身 unreachable →
    transitive unreachable)
  - crawl/runner.go: Semaphore.TryAcquire + TaskRuntime.{SetMaxRequests,CurrentURL,IsDiscovered,
    SetBookLastChapter,GetBookLastChapter}
  - crawl/smart.go: NormalizeCategory + MatchCategoryByText + SmartCategory
  - crawl/storage.go: DataRoot + NovelsDir + CoversDir + DownloadsDir + sanitizeBookId +
    sanitizeChapterSlug + SaveChapterTxt + ReadChapterTxt + DeleteBookTxt + ReadCover +
    downloadTxtTarget + OpenDownloadTxtWriter + downloadTxtWriter.{Rel,Write,Finish,Abort}
  - crawl/types.go: SafeStr + ClampInt
  - services/bridgeserver/bridgeserver.go: QueryEscape

  全部与 R47-1B 列出的清单一致 (R47-1B 列 28+, 本轮工具计 38; 部分方法类型被列入同一清单).
  **决策: 全部保留** (API 兼容 + 设计意图 + 同包内聚, 删则破坏 API 兼容 + 影响存储 API 完整性).
  R47-1B 已记录该决策, R48-1B 不动.

### 2. 重复逻辑整合审查

- bridgeserver 6 helper 整合 (R45-1C 完成, -112 行), 11 mini-services 全部 import bridgeserver.
  grep 验证 (与 R47-1B 一致): bqg713:9 / cloak-browser:20 / curl-impersonate:33 / deqixs:16 /
  fetch-relay:32 / moli:36 / qimao:27 / scrapling:27 / trafilatura:10 / uc:18 / xjp:12 调用次数.
- 94 templates 已 dedup (admin/head + admin/sidebar 2 partials 复用 14 admin 页面; 10 主题每主题
  8 页型 = 80 + 14 admin = 94, 主题间深度定制不动).
- main/runner/bridgeserver 3 处 truncate 不动 (跨包 import cycle 风险 + 不同实现各有所长).
- crawl/ 模块间: fetcher + parser + runner + cleaner + types + hostgate + storage + smart 8 个文件,
  职责清晰, 无新可抽 helper.

  **R48-1B 不再触碰上述区域**, 与 R47-1B 决策一致.

### 3. 过时注释清理 (R10-R30)

R47-1B 已清理 7 处 (cleaner.go × 5 + smart.go × 2). 本轮 grep `R1[0-9]|R2[0-9]|R30` 在
go-backend/**/*.go → 0 命中. **无残留**.

代码中保留 R31-1B / R32-1A / R34-1B / R38-1C / R39-1C / R40-1B / R41-1A / R42-1A-C / R43-1A-C /
R44-1A-C / R45-1A-C / R46-1A-C / R47-1A 等 R31+ Go 迁移设计决策注释, 全部保留.

### 4. 临时文件清理

- 删 1 类:
  `go-backend/backend.log` (183 字节, heis-backend `nohup ./heis-backend > backend.log` 后台运行
  产生的运行时日志, .gitignore 已忽略, R47-1B 漏删; 现已删, 平台 `bun run dev` 会重新生成不进 git).
- 保留:
  - `scripts/rule-yueyouxs.json` (R47-1B portable 化, 20 行 backup-restore 格式 JSON, 通过
    `/api/admin/backup/restore?dryRun=1` dry-run 校验).
  - `agent-ctx/R*-*.md` (23 文件 R38-R48, R46-1C "全保留" 决策, 是 task 历史记录非 temp).
- 项目根扫描 (R48-1B 复检):
  - `.next/` 目录: 不存在 (R47-1B 已删).
  - `next-env.d.ts`: 不存在 (R47-1B 已删).
  - `dev.log`: 不存在 (R47-1B 已删).
  - `go-backend/*.log`: 0 文件 (本轮删 backend.log).
  - `go-backend/heis-dc`: 不存在 (R47-1B 已删).

### 5. DEPLOY.md 更新

#### 5.1 §0 顶部声明

旧: `scripts.dev = ./go-backend/heis-backend` 供平台 `bun run dev` 拉起

新: `scripts.dev` 一项供平台 `bun run dev` 拉起: **auto-restart 包装** `bash -c "while true; do
./go-backend/heis-backend; sleep 2; done"`, 进程异常退出后 2s 自动重启; heis-backend 二进制已入
git (commit `29dcd99`) 可 clone 即跑.

#### 5.2 §6 架构图 fetcher.go 注释

旧: `R45-1C DialTLSContext + R46-1B utls 16 池/session cache + brotli miss + 代理 probe + captcha
成功率 + R47-1A cookie 跨子域 stripPort`

新: 追加 `+ utls 池扩 21 款 + captcha 连续失败 cooldown + probe target 轮换` (R47-1A 工作内容补登,
R47-1B 文档遗漏).

#### 5.3 §6 架构图 utls Hello 指纹池

旧: `R43-1B → R45-1A 12 款 → R46-1B 16 款, 含 PSK/PQ`

新: `R43-1B → R45-1A 12 款 → R46-1B 16 款 → R47-1A 21 款, 含 PSK/PQ` (补登 R47-1A 扩 21 款).

#### 5.4 §6 架构图 brotli miss / 代理 probe / captcha 成功率

旧: `brotli miss 计数 (R46-1B)` / `代理主动 probe (R46-1B, 5min 间隔 + 3 次失败冷却)` /
`captcha 成功率 (R46-1B, 主服务成功率统计 + 自动切换)`

新: `代理主动 probe (R46-1B 5min 间隔 + 3 次失败冷却; R47-1A probe target 轮换 5 endpoint)` /
`captcha 成功率 (R46-1B 主服务成功率统计 + 自动切换; R47-1A 连续 3 次失败 60s cooldown)` (补登
R47-1A 增强).

#### 5.5 §9 迁移表 反反爬行

旧: `utls Hello 指纹池（R46-1B 起 16 款，含 PSK/PQ）+ JA3/JA4 轮换 + TLS session cache + 2captcha +
Cookie 持久化`

新: `utls Hello 指纹池（R47-1A 起 21 款，含 PSK/PQ/老 iOS）+ JA3/JA4 轮换 + TLS session cache +
2captcha + Cookie 持久化 + CookieJar stripPort 跨端口 + captcha 连续失败 cooldown + probe target
轮换`

#### 5.6 §10 参考 + 文档版本

新增 R48-1B 参考行; worklog ~18500 行 → ~18800 行 (实际 18774).

文档版本 R47-1B → R48-1B, 补登 R47-1A utls 21 款 + captcha cooldown + probe target 轮换
(R47-1B 文档遗漏, R48-1B 同步) + R48-1B backend.log 运行时清理 + auto-restart dev script 确认.

### 6. README.md 更新

- Line 5: `R38–R47 已完成` → `R38–R48 已完成`.
- Line 19: `utls 16 款 Hello 指纹池含 PSK / PQ` → `utls 21 款 Hello 指纹池含 PSK / PQ / 老 iOS`.
- Line 23: `utls Hello 指纹池 16 款（R46-1B，含 Chrome PSK / PQ / Edge / iOS）` → `21 款
  （R47-1A，含 Chrome PSK / PQ / 老 iOS 五品牌）` + 追加 `Cookie 持久化 + stripPort 跨端口` +
  `2captcha + 连续 3 次失败 60s cooldown` + `代理池 + cooldown + 5 endpoint 轮选 probe`.
- Line 48: `8 模块 8691 行` → `8 模块 9321 行` (R47-1B README 已校但漏改本行, R48-1B 补登).
- Line 215: `R38-R47, 21 文件` → `R38-R48, 22 文件` (R48-1B agent-ctx +1).
- Line 216: `~18500 行, R3-a → R47-1B` → `~18800 行, R3-a → R48-1B` (实际 18774).
- Line 220: `仅保留 dev script = ./go-backend/heis-backend (平台 bun run dev 拉起 Go 后端; R47-1B
  确认)` → `仅保留 scripts.dev 一项: auto-restart 包装 bash -c "while true; do ./go-backend/
  heis-backend; sleep 2; done" (进程异常退出后 2s 自动重启, 供平台 bun run dev 拉起)`.
- Line 254: `utls Hello 指纹池 16 款 (R46-1B, 含 PSK/PQ/Edge)` → `21 款 (R47-1A, 含 PSK/PQ/老 iOS)`.
- Line 264-268 (降级链): 追加 R47-1A utls 池扩 21 款 + CookieJar stripPort 跨端口 + captcha
  连续 3 次失败 60s cooldown + probe target 5 endpoint 轮选.
- Line 270-275 (反反爬能力): 标题 `R38–R46` → `R38–R47`; utls 池扩 `R46-1B 16 款` →
  `R47-1A 21 款`, 列表追加 Chrome 100_PSK / 114_Padding_PSK_Shuf / 115_PQ_PSK + iOS 11_1 / 12_1.
- Line 322-323 (项目版本): `R47-1B` → `R48-1B` + `~18500 行, R3-a → R47-1B` → `~18800 行, R3-a →
  R48-1B`.

## 未修改 (尊重约束)

- go-backend/main.go (1173 行, R46-1A 验证 0 改动, 无新边缘 case) ✓
- go-backend/admin.go (3570 行, R46-1C rune-safe, 无新边缘 case) ✓
- go-backend/crawl/*.go (8 模块 9321 行, R47-1A working dir 既有改动落地, R48-1B 不动源码) ✓
- go-backend/services/*/main.go (11 个 + bridgeserver, R45-1C 已整合, 无新可抽) ✓
- go-backend/templates/* (94 文件, admin 已 dedup, 前台 80 文件主题定制深不动) ✓
- prisma/schema.prisma + public/clone-css/ + mini-services/*.sh + Caddyfile +
  .env.example + .gitignore 0 改动 ✓
- agent-ctx/R*-*.md 全保留 (23 文件 R38-R48, R46-1C 决策) ✓

## 验证

- `cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend .` → 0 errors,
  binary 24,237,791 bytes (24.2 MB, 与 R47-1B 持平).
- `~/go/go/bin/go vet ./...` → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass).
- `PATH=$HOME/go/go/bin:$PATH ~/go/bin/staticcheck ./...` → 0 issues (staticcheck 2026.2.1 / v0.8.1).
- `PATH=$HOME/go/go/bin:$PATH ~/go/bin/deadcode -test=false ./...` → 38 exported funcs unreachable
  from main() (与 R47-1B 一致, 全保留).
- heis-backend 启动: `pkill -9 -f heis-backend; setsid ./heis-backend > /tmp/hb-r48.log 2>&1 <
  /dev/null & disown` → `/tmp/hb-r48.log`:
  ```
  2026/09/22 15:24:25 数据库: /home/z/my-project/db/custom.db
  2026/09/22 15:24:25 已加载 94 个模板
  2026/09/22 15:24:25 heis-backend 启动: http://localhost:3000 (内存 16MB)
  ```
- 端到端 curl: GET / → 200 ✓, GET /health → 200 ✓, GET /admin → 200 ✓.
- `bash -n <(echo 'while true; do ./go-backend/heis-backend; sleep 2; done')` → exit 0 (dev script
  bash 语法 OK).

## 文件改动统计 (本 R48-1B 轮, 3 文件改动)

- `DEPLOY.md`: 5 处更新 (§0 顶部声明 auto-restart dev script + §6 fetcher.go 注释追加 R47-1A
  utls 21 款/captcha cooldown/probe target 轮换 + §6 utls 池扩 21 款 + §6 brotli/probe/captcha
  注释追加 R47-1A + §9 反反爬 utls 21 款 + §10 参考 +1 行 + 文档版本 R47-1B → R48-1B).
- `README.md`: 7 处更新 (Line 5 R38-R48 + Line 19/23 utls 21 款 + Line 48 9321 LoC + Line 215/216
  R38-R48/22 文件 + Line 220 auto-restart dev script + Line 254/264-268/270-275 utls 21 款 + Line 322-323
  项目版本 R48-1B).
- `go-backend/backend.log`: 删除 (183 字节, 运行时 nohup 日志, .gitignore 已忽略).

## Stage Summary

R48-1B 清理精简 + DEPLOY 更新完成. 接 R47-1B (R10-R30 注释清理 + scripts/rule-yueyouxs.json
portable + dev.log/.next/next-env.d.ts 清理) + R47-1A working dir 既有改动 (cleaner.go ~40 段
regexp 预编译 + fetcher.go stripPort cookie 跨子域 + utls 池扩 21 款 + captcha 连续失败 cooldown +
probe target 轮换 + cloak-browser CDP-native Bezier 轨迹), R48-1B 工作:

(1) Go dead code 复检: go vet 0 + staticcheck 0 + deadcode 38 个 exported funcs unreachable.
    保守不动 (与 R47-1B 决策一致, API 兼容 + 设计意图 + 同包内聚).
(2) R10-R30 过时注释清理: 0 残留 (R47-1B 已清完).
(3) 重复逻辑整合审查 R45-1C 已充分结论不动 (bridgeserver 6 helper + 94 templates dedup + 3 处
    truncate 跨包 import cycle 风险). R48-1B 不再触碰.
(4) 临时文件清理: 删 1 类 (go-backend/backend.log, 183 字节运行时日志, R47-1B 漏删本轮补).
    scripts/ + agent-ctx/ 全保留.
(5) DEPLOY.md 更新: §0 顶部确认纯 Go + auto-restart dev script
    (`bash -c "while true; do ./go-backend/heis-backend; sleep 2; done"`, 进程异常退出后 2s 自动重启)
    + §6 架构图 fetcher.go 注释追加 R47-1A utls 21 款/captcha cooldown/probe target 轮换 (R47-1B
    文档遗漏) + §6 utls 池扩 21 款 + §9 反反爬 utls 21 款 + 文档版本 R47-1B → R48-1B.
(6) README.md 更新: Line 5 R38-R48 + Line 19/23 utls 21 款 + Line 48 9321 LoC (R47-1B README 漏改
    本行, R48-1B 补登) + Line 215/216 R38-R48/22 文件 + Line 220 auto-restart dev script +
    Line 254/264-268/270-275 utls 21 款 + Line 322-323 项目版本 R48-1B.

验证: go build 0 errors (24.2MB binary) + go vet 0 warnings + staticcheck 0 issues + deadcode 38
exported funcs unreachable 全保留 + heis-backend 启动 :3000 + 3 端点 curl 全 200 (/, /health, /admin)
+ dev script bash 语法 OK.

详细工作记录: agent-ctx/R48-1B-full-stack-developer.md (本文件).
