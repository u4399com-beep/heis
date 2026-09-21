# R43-1C 工作记录 — full-stack-developer (清理精简+旧Python清理)

## 任务摘要
- Task ID: R43-1C
- 上游交接: R42-1C (删旧 src/ 350 文件) + R42-1A/1B (Go 深度抓bug) + R43-1A
  (A agent 新增 3 个 Go 服务 curl-impersonate/trafilatura/cloak-browser) + R43-1B
  (B agent utls Hello 指纹池 + MarkProxyFailed/OK + TwoCaptcha 字段).
- 范围: 6 大类清理 (mini-services 旧 Python/bun + start-all.sh 更新 + Go dead code +
  重复逻辑整合 + 过时注释 + 临时文件 + .gitignore).
- 不碰: go-backend/crawl/* (B agent) + go-backend/main.go + admin.go +
  go-backend/services/{curl-impersonate,trafilatura,cloak-browser}/main.go (A agent 新建).

## 详细工作日志

### 1. 旧 Python/bun mini-services 清理 (12 目录全删)

删除 mini-services/ 下:
- 8 个 TS 服务: bqg713-proxy / fetch-relay / qimao-proxy / deqixs-proxy / xjp-proxy /
  moli-bridge / cloak-browser / _shared (TS).
- 4 个 Python 服务: scrapling-bridge / uc-bridge / curl-impersonate-bridge /
  trafilatura-bridge.

旧服务占用端口 3010-3020; Go 版同端口绑定, 启动顺序与协议 100% 兼容.
lsof -ti :3010-3020 确认旧 bun/python 进程已 kill (PID 1038-1120 共 11 个进程),
端口清空后 Go 二进制可独占绑定.

### 2. start-all.sh 重写 (Go 二进制启动)

旧版本: 11 个服务各自 `bun run dev` 或 `python3 server.py`, 需 bun/python + package.json.
新版本: 两阶段并行.

**Phase 1: 增量构建**
- Go 工具链路径: 优先 /home/z/go/bin/go (sandbox), 回退 PATH 中的 go.
- 对每个服务: 取源码最新 mtime (`find src_dir -name '*.go' -printf '%T@\n' | sort -rn | head -1`)
  vs 二进制 mtime (`stat -c %Y bin_path`), 源码 mtime ≤ 二进制 mtime → skip.
- 并行构建 (后台 `&` + `wait`), 输出 redirect 到 `LOG_DIR/<svc>.build.log`.
- 失败不阻塞后续服务 (下一阶段会检测 `! -x bin_path` skip launch).

**Phase 2: 启动 + ≤3s /health 探针**
- 端口检查: 启动前 curl /health 200 → skip (幂等).
- nohup + disown 后台启动, PID 写 .zscripts/<svc>.pid.
- 6 次 0.5s 间隔探针, /health 200 → OK; 否则 WARN 不阻塞.

服务列表 (11 个, 端口 3010-3020):
1. bqg713-proxy|3010|./services/bqg713-proxy
2. fetch-relay|3011|./services/fetch-relay
3. scrapling-bridge|3012|./services/scrapling-bridge
4. qimao-proxy|3013|./services/qimao-proxy
5. deqixs-proxy|3014|./services/deqixs-proxy
6. xjp-proxy|3015|./services/xjp-proxy
7. uc-bridge|3016|./services/uc-bridge
8. moli-bridge|3017|./services/moli-bridge
9. curl-impersonate-bridge|3018|./services/curl-impersonate-bridge (R43-1A 新增)
10. trafilatura-bridge|3019|./services/trafilatura-bridge (R43-1A 新增)
11. cloak-browser|3020|./services/cloak-browser (R43-1A 新增)

### 3. stop-all.sh + status.sh 同步更新

**stop-all.sh**: 11 个服务 SIGTERM + 6s grace + SIGKILL 兜底 + lsof/fuser 端口查找 PID.
**status.sh**: 11 行表格 + exit_code (全 ALIVE 0 / 任一 DOWN 1) + selfTestOk 字段提取.

端到端验证:
- start → status (11/11 ALIVE 200, PID 4206-4326).
- stop → status (11/11 DEAD DOWN, exit 1).
- start → status (11/11 ALIVE 200, exit 0).

### 4. Go dead code 扫描

- `cd /home/z/my-project/go-backend && /home/z/go/bin/go vet ./...` → 0 warnings.
- 编译 0 errors (含 8 个原服务 + 3 个 A agent 新增服务 + bridgeserver 包 + heis-backend 主二进制).
- 跨服务重复 helper (ssrfCheckProxy / readBodyCapped / safeHostPath / collectHeaders /
  passFromURL / wrapDialContext) 主要在 fetch-relay (本任务范围) 与 curl-impersonate-bridge
  (A agent 范围, 不碰) 之间; R41-1C + R42-1C 已收口 truncStr/boolStr/ifEmpty/httpURLRe/
  htmlToText 到 bridgeserver, 本轮不再追加 (避免触碰 A agent 代码).

### 5. 过时注释清理 (R10-R30 标记, 保留 R37+)

**go-backend/services/bridgeserver/bridgeserver.go** 顶部 19 行注释块:
- 移除 "与 TS 端 mini-services/_shared/server.ts 同口径" 等 4 处对已删 _shared/server.ts 的引用.
- 改为 "Go mini-services 共享样板 (R40-1A 起, R43-1C 起 TS _shared/server.ts 删除后唯一来源)".
- "11 个 Go mini-services" → "Go mini-services" (避开具体计数, 未来扩展无需改注释).
- 设计约束块注释 "与 TS 端 _shared/server.ts 不同点" → "设计约束".

**bridgeserver.go:45** MaxRequestBytes 注释 "_shared 默认" → 删.
**bridgeserver.go:145** RateLimiter 注释 "与 _shared RateLimiter 同口径" → 删.
**services/xjp-proxy/main.go:306** "R7-18: 从主应用拉取..." → 删 R7-18 标记, 保留描述.

不动 crawl/* (B agent 范围) 的 R26/R29/R30 标记注释 (cleaner.go:14/313/564/573/601,
smart.go:84/123, runner.go:4/15/81/342, types.go:115 等).

### 6. 临时文件清理

**scripts/ 全删** (65 个 .ts/.mjs/.cjs/.py, 全部引用已删 src/lib/*, 死代码):
- seed-rule-*.ts (34 个单站规则入库)
- verify-*-docker.ts (5 个 Docker 验证)
- verify-zz-*.ts / verify-ab-*.ts / verify-ll-*.ts / verify-kk-*.ts / verify-ss-*.ts
- qq-rules-*.ts (8 个规则探针/审计)
- test-themes-r14.ts / test-themes-9.ts
- fix-aijjxs-*.ts / fix-dd-b-stale-task.ts
- _r27-1c-refactor-clone-themes*.py / gen-clone-themes-r19.cjs / merge-categories.cjs
- ratelimit-site.ts / mock-novel-site.ts / probe-all.ts / batch-update-clones.mjs
- export-autofill-rules.ts / seed.ts / seed-rules-v2.ts / seed-rules-batch-v2.ts /
  seed-rules-import-all.ts / seed-batch2-latest-rules.ts / seed-rule-homepage-latest-batch1.ts

**agent-ctx/ 过时清理** (4.3MB → 148KB, 102 个文件删至 10 个):
- 删 pre-R38 工作日志 47 个: R8-1B/R9-1A/R9-1B/R10-1B/R11-1A/R11-1B/R12-1/R13-1A/
  R13-1B/R14-1A/R16-1A/R16-1B/R16-1C/R19-1A/R19-1B/R24-2A~R24-2J/R24-3B/R25-1A2/
  R25-1A3/R25-1B/R25-1D2/R26-1A/R27-1A/R27-1B/R28-1A/R28-1B/R28-1C/R29-1D/R31-1A~R31-1D/
  R32-1A/R32-1B/R33-1A~R33-1C/R34-1A/R34-1C/R35-1A/R35-1B.
- 删早期 feat/fix/cleanup/theme/code-audit 44 个: 1-a-auth/1-c-mini-services-docker/
  2-a-ts-strict-eslint/2-fetcher/2-obscura/2-other-engine/2-runner/5-a-structured-logging/
  anti-anti-crawl-research/cleanup-plan*.md (4 个)/code-audit-r13~r22 (7 个)/
  feat-a-reader-enhancement/feat-b-dashboard-viz/feat-cloak-anticrawler/feat-combo-
  theme-incremental/feat-contentproxy-resume/feat-round-4~11 (8 个)/feat-rules-batch/
  fix-r4/fix-r5/fix-r7/fix-r8/fix-round3 (5 个)/root-cause-r21/site-notes/site-notes2/
  subpage-dom-notes/theme-audit/theme-audit-r12~r14 (4 个).
- 删 probe-html/ (20 个站点探针 HTML+CSS, 1.1MB) + probe-html2/ (24 个, 1.9MB).
- 保留 R38+ 工作日志 (10 个): R38-1A/R38-1B/R39-1A/R39-1B/R39-1C/R40-1B/R41-1A/R42-1A/
  R42-1B/R42-1C + 本轮新增 R43-1C.

### 7. .gitignore 更新

- 加 go-backend/bin/ (start-all.sh 构建输出, 11 个 Go 服务二进制各 ~10MB).
- 加 go-backend/curl-impersonate-bridge / go-backend/trafilatura-bridge / go-backend/cloak-browser
  (3 个 A agent 新增服务的二进制命名, 与 8 个原服务同款).
- 加 go-backend/*-browser (兜底 cloak-browser 模式, 原 *-proxy/*-bridge/*-backend 不匹配).
- 更新 mini-services/**/.venv/ 注释 (旧 scrapling/uc/curl-impersonate/trafilatura Python
  服务已 R43-1C 全删, 规则保留兜底).
- 注释补 R43-1C 段落 (旧 Python/bun mini-services 全删 + Go services 11 个 + start-all.sh
  改 bin/ 输出 + 3 个 A agent 新增服务接入).

### 8. next.config.ts 修复 (R42-1C 删 src/ 时遗留)

R42-1C 删 src/lib/pseudostatic 但 next.config.ts 仍 import 它:
```ts
import { pseudoStaticRewrites } from "./src/lib/pseudostatic";
async rewrites() { return pseudoStaticRewrites(); }
```

旧 dev.log 全是 "Failed to load next.config.ts ... Cannot find module './src/lib/pseudostatic'
... code: 'MODULE_NOT_FOUND'".

修复: 删 import + 删 rewrites() 函数 + 补注释说明 R43-1C 清理.

当前 Next.js 端仅占位首页 (src/app/page.tsx), 业务流量全走 Go 后端 heis-backend, 不再
需要伪静态 rewrite 规则. lint pass (eslint 0 errors).

## 文件改动统计

- mini-services/start-all.sh: 3.3KB → 5.6KB (+2.3KB, 84 行) — 11 个服务 + 两阶段并行构建
  + Go 工具链自动查找 + 增量 build skip + 幂等端口检查.
- mini-services/stop-all.sh: 2.5KB → 2.6KB (+0.1KB, +3 服务 + 注释清理).
- mini-services/status.sh: 3.0KB → 3.1KB (+0.1KB, +3 服务 + 注释清理).
- go-backend/services/bridgeserver/bridgeserver.go: 843 → 843 行 (注释 4 处收口, 无功能改动).
- go-backend/services/xjp-proxy/main.go: 588 → 588 行 (R7-18 标记删除, 注释微调).
- next.config.ts: 21 → 18 行 (-3 行, 删 broken import + rewrites 函数).
- .gitignore: 109 → 119 行 (+10 行, 新增 bin/ + 3 个新服务二进制 + *-browser 兜底 +
  R43-1C 注释段).

## 未修改 (尊重约束)

- go-backend/crawl/* (B agent 范围) ✓
- go-backend/main.go + admin.go ✓
- go-backend/services/{curl-impersonate,trafilatura,cloak-browser}/main.go (A agent 新建) ✓
  注: start-all.sh/stop-all.sh/status.sh 引用这 3 个服务的目录路径但不动其源码.
- go-backend/templates/* (已完成) ✓
- prisma/schema.prisma + package.json 0 改动 ✓

## 验证

- go build -o heis-backend . → 0 errors, binary 24,168,286 bytes (24.2MB, 与 R43-1B 持平).
- go vet ./... → 0 warnings (主包 + 11 个 services + bridgeserver + crawl 全 pass).
- bun run lint → 0 errors.
- start-all.sh 端到端: build 11/11 OK (8 个 up-to-date skip + 3 个 rebuild), launch 11/11
  /health 200 OK (PID 4206-4326), selfTest 8/11 true (moli/cloak/trafilatura false 是
  预期 — moli binary 未装 / cloak 无 token / trafilatura 无 Readability 配置).
- stop-all.sh 端到端: 11/11 graceful exit (SIGTERM 5s 内退出).
- status.sh 端到端: 全 ALIVE → exit 0; 全 DOWN → exit 1.
- 幂等性: 重跑 start-all.sh 11 个全 skip (already running, /health 200).

## 后续注意事项

1. **start-all.sh 启动顺序**: Phase 1 并行构建, Phase 2 串行启动 + 探针. 11 个服务
   总启动时间 ~5s (build skip 时) / ~10s (首次构建时).
2. **Go 工具链路径**: 优先 /home/z/go/bin/go (sandbox), 回退 PATH. 如未来 sandbox
   迁移, 需更新脚本顶部 GO_BIN 查找逻辑.
3. **A agent 新增 3 个服务**: curl-impersonate-bridge(3018) / trafilatura-bridge(3019) /
   cloak-browser(3020) 已在 start-all.sh 启动. selfTest false 不影响 /health 200 (探针
   返回 ok=true 但 selfTestOk=false 表示子能力缺失, 与服务可用性解耦).
4. **mini-services/ 目录**: 仅保留 start-all.sh / stop-all.sh / status.sh + .gitkeep.
   旧 Python .venv/__pycache__ 模式在 .gitignore 保留兜底.
5. **next.config.ts**: 占位首页模式, 不再有 rewrites. 如未来需要伪静态路由, 需在
   Go 后端 heis-backend 的路由层实现 (不在 Next.js 端).
6. **agent-ctx/ 保留 R38+**: 共 10 个工作日志 + 本轮新增 R43-1C. pre-R38 全删, 历史
   可在 git log 中找到 (commit hash 93dbf8b 等).
