# R47-1B — 清理精简 + DEPLOY 更新

**Task ID**: R47-1B
**Agent**: full-stack-developer (清理精简+DEPLOY更新)
**Date**: 2026-09-22

## 范围

接 R46-1C (静态文档/纯 Go 化已就位) + R47-1A (working dir 内未提交: cleaner.go 25 段
regexp 预编译 + fetcher.go stripPort cookie 跨子域修复 + runner.go `_ = i` dead code
删除 + cloak-browser CDP-native input.DispatchMouseEvent Bezier 轨迹). R47-1B 继续清理
精简 + 校对 DEPLOY/README.

## 1. 读交接

- `worklog.md` 末 200 行: R45/R46 全部修复记录 + R46-1C staticcheck 0 + R46-1B utls 16
  池/session cache/captcha stats + R46-1C 删 Docker/docs/tests/tool-results/重写 README.
- `DEPLOY.md` 599 行: 11 mini-services 端口表 + 94 模板 + 8 级降级链 + LoC 表.
- `README.md` 317 行: 纯 Go 项目总览 + 11 mini-services + 8 模块 LoC + 反反爬能力.

## 2. Go dead code 扫描

### 2.1 工具链

- `~/go/go/bin/go vet ./...` → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass).
- `~/go/bin/staticcheck ./...` → 0 issues (staticcheck 2026.2.1 / v0.8.1, go1.26.8 toolchain).
  注意: U1000 仅检查未使用 PRIVATE 符号 (小写开头); 公开 API (大写开头) 即使无 caller 也不报,
  因 staticcheck 假设外部包可能在用.
- `~/go/bin/deadcode -test=false ./...` → 28+ exported funcs 标 unreachable (从 main()
  call graph 不可达). 详查后 6 类:
  - **API 完整性未用**: crawl.{ClearDomainUA/ClearHostReferer/IsJSChallenge/
    BrotliMissHostSnapshot/CaptchaServiceStatsSnapshot/SmartCategory/NormalizeCategory/
    MatchCategoryByText} + bridgeserver.QueryEscape + crawl.{SafeStr/ClampInt} +
    crawl.{DataRoot/NovelsDir/CoversDir/DownloadsDir} + crawl.{SaveChapterTxt/
    ReadChapterTxt/DeleteBookTxt/ReadCover/OpenDownloadTxtWriter/downloadTxtTarget/
    downloadTxtWriter.Rel/Write/Finish/Abort/sanitizeBookId/sanitizeChapterSlug}.
  - **runtime method 未用**: Semaphore.TryAcquire + TaskRuntime.{SetMaxRequests/
    CurrentURL/IsDiscovered/SetBookLastChapter/GetBookLastChapter}.
  - **CookieJar API 未用**: CookieJar.{Count/Clear/SaveToDisk/LoadFromDisk}.

### 2.2 决策 (保守不动)

按 R46-1C 已确立原则 ("不破坏现有功能" + "保留 R37+ Go 迁移设计决策") + R45-1C 已结论
"templates + R10-R30 注释 + crawl 模块间 helper 全部不动", 上述 28+ 公开 API 函数:
- 部分是未来扩展 API (runtime method 缺 caller 是 TaskRuntime 早期 API 草案, 留作外部
  接口扩展点, 删则破坏 API 兼容).
- 部分是设计意图但未接通 (BrotliMissHostSnapshot/CaptchaServiceStatsSnapshot R46-1B 注释
  "admin/metrics 查询用" 但 admin.go 未调; SmartCategory R38-1C TS 端 LLM 兜底未实现).
- 部分是同包内部使用 (storage.go SaveChapterTxt→sanitizeBookId→sanitizeChapterSlug 调用链
  内聚, 外部无 caller 但同包互调; 删则需连带删 4 函数, 改动面大且影响存储 API 完整性).

**决定: 全部保留**, 避免破坏 API 兼容 + 设计意图. 在 worklog 记录 deadcode 候选清单
供未来轮次评估.

## 3. 过时注释清理 (R10-R30)

仅 7 处 R10-R30 引用 (cleaner.go × 5 + smart.go × 2), 全部是历史版本标记 (R26-1A 追加
U+2060 / R29-1A→R29-1C trafilatura 兜底 / R30 归一化分类). 按任务 "删 R10-R30 过时注释
保留 R37+ Go 迁移设计决策" 清洗:

| 文件:行 | 原文 (节选) | 改后 |
|---|---|---|
| cleaner.go:14 | "与 R29-1C 兼容" | "同口径" |
| cleaner.go:313 | "R26-1A: 同口径追加 U+2060 ..." | "含 U+2060 ..." |
| cleaner.go:565 | "(R29-1C useTrafilatura=true 走 caller-side 分流)" | "(useTrafilatura=true 走 caller-side 分流)" |
| cleaner.go:574 | "(R29-1C useTrafilatura=true)" | "(useTrafilatura=true)" |
| cleaner.go:602 | "(R29-1A → R29-1C)" | "(trafilatura 兜底模式)" (留功能描述去版本号) |
| smart.go:85 | "R30: 归一化分类名 → 标准分类" | "归一化分类名 → 标准分类" |
| smart.go:127 | "(R30: 归一化后匹配)" | "(归一化后匹配)" |

保留 R39-1C / R44-1C / R45-1A / R46-1B 等 R37+ 标记 (Go 迁移设计决策).

## 4. 重复逻辑整合审查

R45-1C 已充分结论:
- bridgeserver 6 helper 整合 (-112 行), 当前 11 mini-services 全部 import bridgeserver
  (bqg713:9 / cloak-browser:20 / curl-impersonate:33 / deqixs:16 / fetch-relay:32 /
  moli:36 / qimao:27 / scrapling:27 / trafilatura:10 / uc:18 / xjp:12 — grep 验证).
- main/runner/bridgeserver 3 处 truncate 不动 (跨包 import cycle 风险 + 不同实现各有所长).
- 94 templates 已 dedup (admin/head + admin/sidebar 2 partials 复用 14 admin 页面;
  10 主题每主题 8 页型 = 80 + 14 admin = 94, 主题间深度定制不动).

R47-1B 不再触碰上述区域.

## 5. 临时文件清理

### 5.1 删除 (gitignored 运行时数据 + stale Next.js 残留)

| 文件 | 类型 | 删除原因 |
|---|---|---|
| `go-backend/backend.log` | gitignored | heis-backend 后台运行 nohup 输出, 运行时数据, 不入版本库. 重启自动重建. |
| `dev.log` (项目根) | gitignored | 内容为 stale Next.js 启动日志 (R46-1A 迁移前的旧日志), 与纯 Go 后端启动信息不符, 误导诊断. 平台 `bun run dev` 重新拉起时会重建. |
| `go-backend/heis-dc` | stray binary | 本轮 deadcode 工具分析时 `go build -o heis-dc .` 产出的临时二进制, 不入版本库. |
| `.next/` 目录 | gitignored | stale Next.js 16 build cache (含 cache/server/static/dev/logs 等子目录), R46-1A 起项目无 Next.js 源码, cache 无意义. |
| `next-env.d.ts` | gitignored | Next.js TypeScript 类型 reference 文件, R46-1A 起 src/app/* 已删, 此文件无源码可 type-check. |

### 5.2 转换 (TS → portable JSON)

| 旧文件 | 新文件 | 转换原因 |
|---|---|---|
| `scripts/seed-rule-yueyouxs.ts` (250 行 TS) | `scripts/rule-yueyouxs.json` (20 行 JSON) | 旧 .ts 是 R44-1A 创建的 one-off 种子脚本, 依赖 `bun run scripts/seed-rule-yueyouxs.ts` + Prisma Client; 纯 Go 项目下 bun 不可用, .ts 无法运行. 转为 backup-restore 格式 JSON (version/exportedAt/counts/warnings/data.rules), 可通过 `/api/admin/backup/restore?dryRun=1` dry-run 校验, 去掉 `?dryRun=1` 实际入库. 已 curl 实测 dry-run 200 `{"counts":{"rules":1},"dryRun":true,"imported":0,"ok":true}`. |

### 5.3 保留 (尊重 R46-1C 决策)

- `agent-ctx/R*-*.md` (21 文件, R38-R46): R46-1C "agent-ctx/{R38-R45}*.md + R46-1A*.md
  全保留" 决策, 是 task 历史记录, 不是 temp 文件. R47-1B 不删.

## 6. DEPLOY.md 更新

### 6.1 LoC 校准 (R46-1C 文档遗漏 R46-1B + R47-1A delta)

| 文件 | R46-1C 文档 | 实际 | delta 来源 |
|---|---|---|---|
| crawl 总 | 9031 | 9303 | +272 (fetcher +231 R46-1B + cleaner +42 R47-1A - 1 行 my R10-R30 清洗不影响行数) |
| fetcher.go | 3384 | 3615 | +231 (R46-1B utls 16 池 + TLS session cache + brotli per-host + captcha stats + proxy probe + R47-1A stripPort cookie 跨子域) |
| cleaner.go | 744 | 786 | +42 (R47-1A 25 段 regexp 预编译为包级 var) |
| runner.go | 1481 | 1481 | 0 (R47-1A 删 `_ = i` dead code + 加 1 行注释, 净 0) |
| 其他 | 同 | 同 | 无改动 |

DEPLOY.md §6 架构图 (fetcher 3615 + cleaner 786 + crawl 9303) + §9 迁移表 (Go 9303) +
§10 参考 (8 模块 9303) 共 3 处校准.

### 6.2 纯 Go 项目声明

- DEPLOY.md §0 顶部 + §2.1 编译段: 加 "heis-backend 二进制已入 git (commit 29dcd99)"
  + "平台 `bun run dev` 拉起 `./go-backend/heis-backend` (根 package.json scripts.dev)".
- DEPLOY.md §8.4 升级: 改 `git pull → cd go-backend && go build -o heis-backend .` →
  说明二进制已入 git, 仅源码变更时才需重建, 平台 clone 即跑.

### 6.3 scripts/rule-yueyouxs.json 导入说明

DEPLOY.md §4.2 参考规则: 加 2 条入库路径
1. 后台手动 `/admin/rules` 新建
2. curl 一键导入 `/api/admin/backup/restore?dryRun=1` (先 dry-run 再实际入库)

### 6.4 文档版本号

R46-1C → R47-1B (含 R47-1A 的工作内容补登: cleaner.go 25 段 regexp 预编译 +
fetcher.go stripPort cookie 跨子域修复).

## 7. README.md 更新

### 7.1 顶部声明

加 "R38–R47 已完成 Next.js → Go 全面迁移" + "heis-backend 二进制已入 git (commit
29dcd99), 平台 `git clone` 后零编译直接运行 `./go-backend/heis-backend`".

### 7.2 LoC 校准

3 处同步 DEPLOY.md: crawl 9303 + fetcher 3615 + cleaner 786.

### 7.3 项目根文件清单

- `heis-backend` 行: 改 "(24 MB, .gitignore, 不入版本库)" → "(24 MB, 已入 git 平台
  clone 即跑; .gitignore 仅兜底防误覆盖)".
- `agent-ctx/R*-*.md`: R38-R46 → R38-R47 (21 文件).
- `worklog.md`: ~18000 → ~18500 行 (实际 18435).
- 新增 `scripts/rule-yueyouxs.json` 行 (portable JSON, /api/admin/backup/restore 可导入).
- 新增 `package.json` 行 (仅保留 dev script = ./go-backend/heis-backend).
- `.gitignore` 行补注 "heis-backend 二进制以 git add -f 强制入 git, .gitignore 仅兜底".

### 7.4 项目版本号

R46-1C → R47-1B.

## 8. 验证

```
cd /home/z/my-project/go-backend
~/go/go/bin/go build -o heis-backend . 2>&1 | tail -3     # 0 errors, binary 24,237,791 bytes
~/go/go/bin/go vet ./... 2>&1 | tail -3                   # 0 warnings (主包 + 11 services + bridgeserver + crawl)
~/go/bin/staticcheck ./... 2>&1 | tail -3                 # 0 issues

setsid ./heis-backend > /tmp/hb.log 2>&1 < /dev/null & disown
tail -5 /tmp/hb.log
# 2026/09/22 13:47:27 数据库: /home/z/my-project/db/custom.db
# 2026/09/22 13:47:27 已加载 94 个模板
# 2026/09/22 13:47:27 heis-backend 启动: http://localhost:3000 (内存 17MB)

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/        # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health  # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin    # 200
curl -s http://localhost:3000/health                                    # {"lang":"go","memMB":17,"ok":true}

# Dry-run restore 校验 rule-yueyouxs.json
curl -s -X POST -H "Content-Type: application/json" \
  --data-binary @scripts/rule-yueyouxs.json \
  "http://localhost:3000/api/admin/backup/restore?dryRun=1"
# {"data":{"counts":{"rules":1},"dryRun":true,"exportedAt":"2026-09-22","imported":0,"version":1,"warnings":[]},"ok":true}
```

## 9. 未修改 (尊重约束)

- `go-backend/main.go` (1173 行, R46-1A 验证 0 改动, 无新边缘 case) ✓
- `go-backend/admin.go` (3570 行, R46-1C rune-safe, 无新边缘 case) ✓
- `go-backend/crawl/{parser,hostgate,smart,storage,types}.go` (除 smart.go 2 处 R30 注释
  清洗外, 无其他改动) ✓
- `go-backend/services/*/main.go` (R45-1C 已整合, 无新可抽; cloak-browser/main.go 的
  R47-1A 改动是 working dir 内既有, 不是 R47-1B 改动) ✓
- `go-backend/templates/*` (94 文件, admin 已 dedup, 前台 80 文件主题定制深不动) ✓
- `prisma/schema.prisma` + `public/clone-css/` + `mini-services/*.sh` + `Caddyfile` +
  `.env.example` + `.gitignore` 0 改动 ✓
- `agent-ctx/{R38-R46}*.md` 全保留 (R46-1C 决策) ✓

## Stage Summary

R47-1B 清理精简 + DEPLOY 更新完成. 接 R46-1C (静态文档/纯 Go 化已就位) + R47-1A working
dir 既有改动 (cleaner.go 25 段 regexp 预编译 + fetcher.go stripPort cookie 跨子域修复 +
runner.go `_ = i` dead code 删除 + cloak-browser CDP-native input.DispatchMouseEvent
Bezier 轨迹), R47-1B 工作:

1. **Go dead code 扫描**: go vet 0 + staticcheck 0 (U1000 仅查 private) + deadcode 工具
   发现 28+ exported funcs unreachable from main(). 保守不动 (API 兼容 + 设计意图 + 同包
   内聚), 候选清单记 worklog 供未来评估.

2. **R10-R30 过时注释清理**: 7 处 (cleaner.go × 5 + smart.go × 2) 历史版本标记清洗,
   保留 R37+ Go 迁移设计决策 (R39-1C / R44-1C / R45-1A / R46-1B 等).

3. **重复逻辑整合审查**: R45-1C 已充分结论不动 (bridgeserver 6 helper + 94 templates
   dedup + 3 处 truncate 跨包 import cycle 风险). R47-1B 不再触碰.

4. **临时文件清理**: 删 5 类 (go-backend/backend.log + dev.log + go-backend/heis-dc +
   .next/ 目录 + next-env.d.ts, 全 gitignored) + 转 1 类 (scripts/seed-rule-yueyouxs.ts
   → scripts/rule-yueyouxs.json, portable backup-restore 格式, curl 实测 dry-run 200).

5. **DEPLOY.md 更新**: LoC 校准 (crawl 9031→9303 + fetcher 3384→3615 + cleaner 744→786)
   + 纯 Go 项目声明 (heis-backend 二进制入 git commit 29dcd99 + 平台 bun run dev 拉起
   Go 后端) + §8.4 升级路径改 (二进制已入 git, 仅源码变更才需重建) + §4.2 参考规则加
   curl 一键导入 + 文档版本 R46-1C → R47-1B.

6. **README.md 更新**: 顶部声明加 heis-backend 入 git + 平台 clone 即跑 + LoC 校准 3 处
   同步 + 项目根文件清单加 scripts/rule-yueyouxs.json + package.json 行 + .gitignore
   注释加 "heis-backend 以 git add -f 强制入 git, .gitignore 仅兜底" + 项目版本
   R46-1C → R47-1B.

验证: go build 0 errors (24.2MB binary) + go vet 0 warnings + staticcheck 0 issues +
heis-backend 启动 :3000 + 3 端点 curl 全 200 (/, /health, /admin) + rule-yueyouxs.json
dry-run restore 200.

详细工作记录: agent-ctx/R47-1B-full-stack-developer.md
