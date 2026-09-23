# R53-1B Work Record — 清理 + updatedAt 格式化修复 + DEPLOY/README 校对

**Task ID**: R53-1B
**Agent**: full-stack-developer (清理+updatedAt 格式化修复+DEPLOY 校对)
**Date**: 2026-09-23
**Scope**: go-backend/* + DEPLOY.md + README.md + 模板核实

---

## 第一步: 交接文档读后感

R52-1B 完成清理 + 模板封面核实 + DEPLOY/README 校对, 提交 commit `290af06`
"fix(R52): updatedAt 格式化+封面SVG+分类4字+admin访问", 加入 formatUpdatedAt
函数把 main.go 的 bookDetailHandler/getBooks/bookRowFromScan/apiBookDetailHandler
等路径的 updatedAt 字段从 SQLite 原始值 (可能 Unix ms / ISO 串 / SQLite TEXT)
归一化为 "2006-01-02 15:04" 格式.

但 R52-1B 仅在 main.go 的 handler 出口处归一化, 没有覆盖到 admin 端 (admin.go 的
shortTime 函数仍假设 SQLite TEXT 输入, 直接 s[5:7]+s[8:10] 切片). 实测 DB 中所有
updatedAt 都是 Prisma `@updatedAt` 写入的 Unix ms 时间戳 (13 位数字, 如
"1789516558775"), shortTime 把它当作 SQLite TEXT 切片 → "16558" 等时间戳残片
显示在 admin dashboard / tasks / rules / books 等多个页面.

→ 本轮 R53-1B 任务:
1. Go dead code (go vet + staticcheck) 复检
2. 重复逻辑整合 + 过时注释清理 + 临时文件清理
3. **核心 bug 修复**: fmtDate / fmtDateShort / shortTime 三处模板/工具函数先经
   formatUpdatedAt 归一化, 修复 Prisma `@updatedAt` 存 Unix ms 时切片错位的 bug
4. DEPLOY.md 校对: LoC 同步 (9226→10655 / fetcher 4413→4809 / smart 310→339 /
   main 1173→1330 / admin 3570→3573 / cloak-browser 859→974 / types 733→737) +
   R53-1B 校对说明 + 文档版本 R53-1B
5. README.md 校对: 同 LoC + R38-R52→R38-R53 + agent-ctx 32→36 + worklog
   ~20200→~21500 + 项目版本 R53-1B
6. 10 套 × 8 页型 = 80 模板核实 (cover 绝对路径 / updatedAt 格式 / 分类 4 字)

## 第二步: Go dead code (go vet + staticcheck)

### 2.1 go vet 0 warnings

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go vet ./... 2>&1
# (no output, exit 0)
```

主包 + 11 services + bridgeserver + crawl 全 pass.

### 2.2 staticcheck 0 issues

```bash
export PATH=$PATH:~/go/go/bin && cd /home/z/my-project/go-backend && ~/go/bin/staticcheck ./... 2>&1
# (no output, exit 0)
# crawl/ + bridgeserver/ 子包也 0 issues
```

### 2.3 临时文件清理

- `go-backend/backend.log` (3 行启动日志) — 删除 (已 gitignored via `*.log`).
- `/tmp/heis-backend-test` (本轮编译产物) — 删除.
- `upload/` (sandbox 挂载 Device busy) — 不可删, 保留.
- `tool-results/` (本 session 工具产物) — 保留供本次工作.

## 第三步: 核心 bug 修复 — updatedAt 切片错位

### 3.1 bug 发现

DB 实测 (用 Go 临时脚本查 db/custom.db):

```
Book.updatedAt: 1789516558775 (13 位 Unix ms)
Task.updatedAt: 1789403217089 (13 位 Unix ms)
Rule.updatedAt: 1789080267048 (13 位 Unix ms)
Task.createdAt: 1788873082292 (13 位 Unix ms)
Book.createdAt: 1789468025976 (13 位 Unix ms)
```

Prisma `@updatedAt` 把 DateTime 写成 Unix ms 整数 (TEXT 列存字符串 "1789516558775").
Go 端 admin.go 调用 shortTime(updatedAt) 之前不预归一化, 直接在模板层 s[5:7]+s[8:10]
切片, 导致 admin dashboard 渲染出 "16560" / "71510" / "04577" / "03217" / "1789516558"
等时间戳数字残片.

curl http://localhost:3000/admin 实测 (修复前):

```
<td><small style="color:var(--dim)">16560</small></td>
<td><small style="color:var(--dim)">71510</small></td>
<td><small style="color:var(--dim)">04577</small></td>
<td><small style="color:var(--dim)">03217</small></td>
<td><small style="color:var(--dim)">1789516558</small></td>
```

### 3.2 bug 修复方案

R52-1B 已在 main.go 加 formatUpdatedAt 函数 (lines 765-783), 三段式归一化:

```go
// R52: updatedAt 格式化 — SQLite 可能存 Unix 时间戳(秒或毫秒), 转成 2006-01-02 15:04
func formatUpdatedAt(s string) string {
    if i, err := strconv.ParseInt(s, 10, 64); err == nil {
        // 毫秒 (> 1e12) → 除以 1000 转秒
        if i > 1000000000000 {
            i = i / 1000
        }
        return time.Unix(i, 0).Format("2006-01-02 15:04")
    }
    // 尝试 ISO 字符串
    if t, err := time.Parse("2006-01-02T15:04:05", s); err == nil {
        return t.Format("2006-01-02 15:04")
    }
    // 尝试 SQLite TEXT 格式 "2006-01-02 15:04:05"
    if t, err := time.Parse("2006-01-02 15:04:05", s); err == nil {
        return t.Format("2006-01-02 15:04")
    }
    return s
}
```

**问题**: formatUpdatedAt 只在 main.go 的 4 处 book handler 出口被调用, 没有覆盖到:

1. `fmtDate` 模板 FuncMap (main.go:88) — 当前实现仅 `d[:10]` 切片, 不归一化
2. `fmtDateShort` 模板 FuncMap (main.go:97) — 当前实现仅 `d[5:7]+d[8:10]` 切片, 不归一化
3. `shortTime` Go 函数 (admin.go:1578) — 当前实现仅 s[5:7]+s[8:10]+s[11:16] 切片, 不归一化

→ 修复: 三处全部改为先调用 `formatUpdatedAt(s)` 归一化, 再切片.

### 3.3 修复实现

**main.go fmtDate** (lines 84-94):

```go
// R38-1B: ISO/SQLite datetime 字符串 → YYYY-MM-DD
// R53-1B: 先经 formatUpdatedAt 归一化 (Unix ms 时间戳 / SQLite TEXT / ISO 串
//   均转成 "2006-01-02 15:04"), 再切前 10 字; 修复 Prisma @updatedAt 存 Unix ms
//   时 fmtDate 直接 s[:10] 取出时间戳片段的 bug.
"fmtDate": func(s interface{}) string {
    d := formatUpdatedAt(fmt.Sprintf("%v", s))
    if len(d) >= 10 {
        return d[:10]
    }
    return d
},
```

**main.go fmtDateShort** (lines 95-103):

```go
// R38-1B: ISO/SQLite datetime 字符串 → MMDD (无分隔, 排行榜日期用)
// R53-1B: 同 fmtDate, 先 formatUpdatedAt 归一化, 再切 [5:7]+[8:10].
"fmtDateShort": func(s interface{}) string {
    d := formatUpdatedAt(fmt.Sprintf("%v", s))
    if len(d) >= 10 {
        return d[5:7] + d[8:10]
    }
    return d
},
```

**admin.go shortTime** (lines 1575-1588):

```go
// shortTime — SQLite datetime 字符串 → 紧凑形式 "MM-DD HH:MM".
// R53-1B: 先经 formatUpdatedAt 归一化 (Unix ms / SQLite TEXT / ISO 串 → "2006-01-02 15:04"),
//   修复 Prisma @updatedAt 存 Unix ms 时 s[5:7]+s[8:10] 切出时间戳片段的 bug.
func shortTime(s string) string {
    s = formatUpdatedAt(s)
    if len(s) >= 16 {
        // "2024-09-21 11:30" → "09-21 11:30"
        return s[5:7] + "-" + s[8:10] + " " + s[11:16]
    }
    if len(s) >= 10 {
        return s[5:10]
    }
    return s
}
```

### 3.4 修复验证 (端到端 curl)

修复后重启 heis-backend + curl 各端点:

```
=== /health ===
{"lang":"go","memMB":17,"ok":true}

=== / ===
200

=== /admin ===
200

=== /covers/nonexistent.webp ===
200 image/svg+xml

=== /admin dashboard shortTime check ===
<td><small style="color:var(--dim)">09-15 23:56</small></td>
<td><small style="color:var(--dim)">09-15 11:25</small></td>
<td><small style="color:var(--dim)">09-14 16:49</small></td>
... (无 16560/71510/04577 等时间戳残片)

=== /book detail updatedAt check ===
更新：2026-09-15</span>
... (前台 book 详情页 fmtDate 也正常显示 YYYY-MM-DD)

=== /api/public/books ===
{"data":{"books":[{"...","updatedAt":"2026-09-15 23:55","..."}],"total":1,"ok":true}
... (API 返回的 updatedAt 已被 R52-1B 加的 formatUpdatedAt 归一化)
```

修复后 admin dashboard / tasks / rules / books 全部正确显示日期.

## 第四步: 模板核实 (10 套 × 8 页型 = 80 模板)

### 4.1 80 模板存在性 (✓)

```bash
for theme in aijjxs 101kks x2552 23qb ddyueshu huangjinwu ggd66 pilishuwu trxsw shipsay; do
  for page in home book read category ranking search keyword fulltext; do
    f="go-backend/templates/$theme/$page.html"
    [ -f "$f" ] || echo "MISSING: $f"
  done
done
# (无 MISSING 输出, 80 模板全在)
```

### 4.2 updatedAt 引用 (✓)

模板对 updatedAt 的引用全部走以下形式之一:

- `{{fmtDate .Book.updatedAt}}` (book.html 详情页) — R53-1B 修复后 fmtDate 内部先 formatUpdatedAt
- `{{fmtDate .updatedAt}}` (列表页 home/category/ranking/search/keyword/fulltext) — 同上
- `{{fmtDateShort .updatedAt}}` / `{{fmtDateShort .Book.updatedAt}}` (x2552 + ggd66 排行/分类)
  — 同上, fmtDateShort 内部也 formatUpdatedAt
- `{{.updatedAtShort}}` (admin/tasks.html + admin/dashboard.html) — admin handler 调
  shortTime(updatedAt) → R53-1B 修复后 shortTime 内部也 formatUpdatedAt
- `{{.updatedAt}}` (admin/settings.html) — Setting 表无 updatedAt 列, 占位 "-"
- `{{fmtDate .createdAt}}` (admin/categories.html + downloads.html + feedback.html) — 同 fmtDate

主包 + admin 包 + 80 模板全路径 updatedAt 引用都经 formatUpdatedAt 归一化, 输出
"YYYY-MM-DD" 或 "MM-DD HH:MM" 或 "MMDD" 紧凑形式, 不再有时间戳残片.

### 4.3 cover 绝对路径 (✓)

10 套 × 8 页型 = 80 模板的 cover 引用全部用 `{{.cover}}` / `{{.Book.cover}}` /
`{{(index .Books N).cover}}` / `{{(index .HotBooks N).cover}}` /
`{{(index .Related N).cover}}` 等动态值, 由 main.go 在 handler 出口加前导 `/`
拼接为绝对路径 `/covers/foo.webp`.

main.go 第 569/665/918/936 行 `"cover": "/" + cover.String` 已为所有前台 API
返回值加前导 `/`. 模板 <img src="{{.cover}}"> 渲染输出
`<img src="/covers/foo.webp">` (绝对路径).

admin 端 (admin/books.html 等) 不显示 cover, 故 admin handler 不加 `/`, 直接传
DB 原值 (e.g. "covers/foo.webp" 相对路径), 仅作列表展示用, 不影响前台渲染.

### 4.4 分类名 4 字 (✓)

smart.go 的 `categoryKeywords` 数组定义 15 个标准 4 字分类:

```
玄幻奇幻 / 奇幻魔幻 / 武侠江湖 / 仙侠修真 / 都市生活 / 言情小说 /
历史军事 / 军事战争 / 游戏竞技 / 科幻未来 / 悬疑推理 / 灵异鬼怪 /
体育竞技 / 轻小说类 / 现实生活
```

`categoryAliases` map 把 2 字旧名 (玄幻/奇幻/武侠/仙侠/都市/言情/历史/军事/游戏/
科幻/悬疑/灵异/体育/现实) + 3 字 "轻小说" + 多种 4 字变体 (玄幻小说/都市娱乐/
玄幻魔法/...) 全部映射到对应 4 字标准名.

NormalizeCategory 三段式归一化:
1. 精确别名命中 → 4 字标准名
2. 4 字标准名直接返回
3. 模糊: 源站长名包含标准 4 字名 → 合并

R53-1A 已修复 BUG-1: 原 alias 表漏 "轻小说" (3 字) 本身, 补 `"轻小说":
"轻小说类"` 让 source 路径直接命中, method="source".

注: DB 中已存在的 2 字分类 (cmtpobg* ID 系, 早期 Prisma seed 写入) + 部分 4 字
非标准名 (cmu1* ID 系, 如 "玄幻小说"/"都市娱乐") 不被 retroactively 改名;
新采集的书籍会通过 smart.go NormalizeCategory → 4 字标准名.

## 第五步: DEPLOY.md + README.md 校对

### 5.1 DEPLOY.md 校对 (LoC 同步 + R53-1B 校对说明)

LoC 同步 (current-state 引用, 非 changelog 历史):
- 9226 行 → 10655 行 (4 处: §1.1 + §1.2 + §3 项目结构 + §10 架构图 + §13 迁移表 + §14 参考段)
- fetcher 4413 → 4809 (§3 项目结构 + §10 架构图)
- smart 310 → 339 (§3 项目结构 + §10 架构图)
- types 733 → 737 (§3 项目结构 + §10 架构图)
- main.go 1173 → 1330 (§3 项目结构 + §10 架构图 + §14 参考段)
- admin.go 3570 → 3573 (§3 项目结构 + §14 参考段)

新增 changelog 条目 (§14 参考段):
- R53-1B 清理精简 + updatedAt 格式化修复 + DEPLOY/README 校对: fmtDate/fmtDateShort/
  shortTime 三处先经 formatUpdatedAt 归一化 + admin dashboard 实测从 "16560/71510/04577"
  修复为 "09-15 23:56" + LoC/port 校对一致 + agent-ctx 32→36 + worklog ~20200→~21500

文档版本 R52-1B → R53-1B + 加 R53-1B 校对说明段 (在 §14 文档版本末尾追加 R53-1B
校对说明, 不替换 R51-1B/R52-1A/R52-1B 校对历史段, 保持完整校对链).

### 5.2 README.md 校对

LoC 同步 (current-state 引用, 非 changelog):
- 9226 → 10655 (§功能特性 + §技术栈 + §目录结构)
- fetcher 4413 → 4809 (§目录结构)
- smart 310 → 339 (§目录结构)
- types 733 → 737 (§目录结构)
- main.go 1173 → 1330 (§目录结构)
- admin.go 3570 → 3573 (§目录结构)
- cloak-browser 859 → 974 (§目录结构)

其他同步:
- 简介 "R38–R52 已完成" → "R38–R53 已完成 + updatedAt 格式化修复"
- agent-ctx "R38-R51, 32 文件" → "R38-R53, 36 文件"
- worklog "~20200 行, R3-a → R51-1B" → "~21500 行, R3-a → R53-1B"
- 项目版本号 R52-1B → R53-1B + 加 R53-1B 校对说明 (在版本末尾追加, 不替换历史)

## 第六步: 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o /tmp/heis-test . 2>&1 | tail -3
# (no output, exit 0) → BUILD OK

~/go/go/bin/go vet ./... 2>&1 | tail -3
# (no output, exit 0) → VET OK

~/go/bin/staticcheck ./... 2>&1 | head -3
# (no output, exit 0) → STATICCHECK OK
```

替换 heis-backend 二进制 + 重启:

```bash
pkill -f heis-backend; sleep 2
cp /tmp/heis-test go-backend/heis-backend
cd go-backend && setsid ./heis-backend > /tmp/heis-start.log 2>&1 &
sleep 2
curl -s http://localhost:3000/health
# {"lang":"go","memMB":17,"ok":true}
```

4 端点 curl 全 200:
- GET /health → 200 {"lang":"go","memMB":17,"ok":true} ✓
- GET / → 200 OK (SSR HTML) ✓
- GET /admin → 200 (admin HTML, 显示正常日期) ✓
- GET /covers/nonexistent-test.webp → 200 image/svg+xml (SVG 占位) ✓

binary 24,318,584 bytes (24.3MB, R52-1B 24,317,615 + R53-1B 改 fmtDate/
fmtDateShort/shortTime + 注释 + 重新构建).

## 文件改动统计

- go-backend/main.go: +6 行 (fmtDate + fmtDateShort 各加 formatUpdatedAt 归一化 +
  R53-1B 注释 4 行)
- go-backend/admin.go: +3 行 (shortTime 加 formatUpdatedAt 归一化 + R53-1B 注释
  2 行)
- DEPLOY.md: +11 行 (LoC 同步 8 处 + R53-1B changelog 条目 + 文档版本 R53-1B 校对段)
- README.md: +1 行 (LoC 同步 7 处 + agent-ctx 32→36 + worklog ~20200→~21500 + R38-R52→R38-R53 + 项目版本 R53-1B 校对段)
- go-backend/heis-backend: 二进制重编 24MB
- go-backend/backend.log: 删除 (临时文件清理)
- agent-ctx/R53-1B-full-stack-developer.md: 本条目

## 未修改 (尊重约束)

- go-backend/admin.go 主体逻辑 (仅 shortTime 函数 +2 行加归一化) ✓
- go-backend/main.go 主体逻辑 (仅 fmtDate/fmtDateShort 各 +1 行加归一化) ✓
- go-backend/crawl/*.go (无边缘 case 需修, R52-1A 功能改动保留) ✓
- go-backend/services/*/main.go (无边缘 case) ✓
- go-backend/templates/* (10 套 × 8 页型 = 80 模板 cover/updatedAt/category 引用全
  动态值, 不需改) ✓
- prisma/schema.prisma + package.json + .gitignore (0 改动) ✓

## Stage Summary

- R53-1B 清理 + updatedAt 格式化修复 + DEPLOY/README 校对:
  · **Go dead code**: go vet 0 + staticcheck 0 (主包 + 11 services + bridgeserver
    + crawl 全 pass).
  · **核心 bug 修复**: Prisma `@updatedAt` 把 DateTime 写成 Unix ms (13 位整数字符串),
    原 fmtDate/fmtDateShort/shortTime 三处模板/工具函数直接 s[:10] / s[5:7]+s[8:10] /
    s[5:7]+s[8:10]+s[11:16] 切片, 把 "1789516558775" 切成 "1789516558" / "16558" /
    "16558 78951" 等时间戳残片显示在 admin dashboard / tasks / rules / books 多页面.
    修复: 三处全部先调用 formatUpdatedAt(s) 归一化 (Unix ms → "2006-01-02 15:04")
    再切片, 端到端 curl /admin 实测从 "16560/71510/04577" 修复为 "09-15 23:56".
  · **重复逻辑整合**: 无新重复, R52-1B 已有的 formatUpdatedAt 函数复用到三处.
  · **过时注释清理**: 0 处过时注释 (R38-R52 全部历史注释是有意义的设计决策或限制说明).
  · **临时文件清理**: backend.log 删除 (gitignored); /tmp/heis-backend-test 删除;
    upload/ 不可删 (Device busy); tool-results/ 本 session 产物保留.
  · **模板封面核实**: 10 套 × 8 页型 = 80 模板全存在; cover 引用全 {{.cover}} /
    {{.Book.cover}} / {{(index .Books N).cover}} 等动态值; main.go 加前导 `/` 拼绝对路径
    /covers/foo.webp; 不存在走 SVG 占位 (渐变色块 + 书名首字 96px 白字); 0 处硬编码
    /covers/ 路径.
  · **updatedAt 格式化核实**: 模板对 updatedAt 引用全走 {{fmtDate ...}} /
    {{fmtDateShort ...}} / {{.updatedAtShort}} / {{.updatedAt}} (settings 占位 "-");
    R53-1B 修复后 fmtDate/fmtDateShort/shortTime 内部全部先 formatUpdatedAt 归一化,
    不再有 Prisma Unix ms 切片错位.
  · **分类 4 字校验**: smart.go 15 个标准 4 字分类 (玄幻奇幻/奇幻魔幻/武侠江湖/
    仙侠修真/都市生活/言情小说/历史军事/军事战争/游戏竞技/科幻未来/悬疑推理/
    灵异鬼怪/体育竞技/轻小说类/现实生活); categoryAliases 把 2 字旧名 + 3 字 "轻小说"
    + 多种 4 字变体映射到 4 字标准名; NormalizeCategory 三段式归一化 (精确别名 →
    标准 4 字 → 模糊包含); DB 中已存的 2 字分类不被 retroactive 改名, 新采集的书籍走
    NormalizeCategory → 4 字标准名.
  · **/admin 访问校验**: main.go 注册 /admin + /admin/ 路由; §8.2 后台路径表 14 行
    + §8.2 无登录鉴权警告 + §12.2 Caddy/Nginx Basic Auth 反向代理配置示例;
    端到端 curl /admin → 200 ✓.
  · **DEPLOY.md 校对**: LoC 同步 9226→10655 / fetcher 4413→4809 / smart 310→339 /
    types 733→737 / main 1173→1330 / admin 3570→3573 (6 处 + 架构图 8 行 + 迁移表 1 行
    + 参考段 2 行) + R53-1B changelog 条目 + 文档版本 R53-1B 校对段.
  · **README.md 校对**: LoC 同步 7 处 + cloak-browser 859→974 + R38-R52→R38-R53 +
    agent-ctx 32→36 + worklog ~20200→~21500 + 项目版本 R53-1B 校对段.
- 编译 0 errors, vet 0 warnings, staticcheck 0 issues, 4 端点 curl 全 200
  (/health + / + /covers/nonexistent.webp + /admin).
- 核心保留 R38-R52-1B 全部修复 (hostgate pump/Acquire drain / utls per-host 钉扎
  + attempts 偏移真正轮换 / Turnstile 8s / 2captcha 180s + per-attempt timeout /
  Cookie 持久化 + stripPort 跨端口 / BudgetExceeded 上抛 / truncate rune-based /
  Referer 一致性 / pickProxyFor sweep 完整 / trafilatura clients 单例 / jsonLdTypeRe
  预编译 / batchMu defer / discoverBooks newCount==0 break / MarkProxyFailed/OK /
  IncCaptcha / ReportRateLimited / cloak-browser page.AddScriptToEvaluateOnNewDocument
  + simulateHumanBehaviorActions / scrapling-bridge Accept-Encoding 移除 br / cleaner.go
  collapseDupPunct / DialTLSContext ctx 取消 / 13 处 []rune 安全截断 / ClearUtlsChoice
  仅 handshake 失败 / pickUtlsHello host=='' 返 pool[0] / brotli per-host / utls
  16→21→24→29→34→36 池 / TLS session cache → persistableSessionCache + flushMu 串行化
  + dirtyVersion 版本比较 + atomicWriteFileSync fsync + StartTlsSessionBackgroundFlusher
  + corruption recovery + disk cap / captcha 主备切换 → 三服务级联 + sitekey 三属性名
  + JS 变量 + iframe src fallback + query 顺序保留 / 代理 probe + latency 跟踪 +
  least-latency + weighted-latency 策略 + pickFailStreak 业务失败跟踪 + dead proxy
  quarantine + ProxyStatsSnapshot / probeTarget 轮换 / probe 头族 / ThreadsMax=0 兜底 /
  .env + .gitignore + README + DEPLOY 纯 Go 化 / cleaner.go 7 P2/P3 bug 修复 /
  R50-1A persistableSessionCache snapshot+IO + captchaSitekeyRe 扩展 +
  probeProxyWithLatency + least-latency + Gaussian 微抖 + micro wheel + Tab key /
  R51-1A BUG-1..4 修复 + utls 29→34 + dirtyVersion + atomicWriteFileSync +
  StartTlsSessionBackgroundFlusher + captchaSitekeyReIframeSrc + applyCaptchaTokenAndRefetch
  url.Parse + probeProxyWithLatency drain + pickFailStreak + weighted-latency + 反向滚动
  + Enter 键 + 双击 / R52-1A BUG-1 query 顺序保留 + utls 34→36 + TLS session corruption
  recovery + disk cap + dead proxy quarantine + native wheel + Esc 键 + Page Down 键 +
  smart.go 4 字分类 / R52-1B 清理 + 模板封面核实 + DEPLOY/README 校对 + formatUpdatedAt
  函数引入 + R52-1A 功能改动保留 8-space 缩进 / R53-1A alias 表 "轻小说" 本身 BUG-1 修复 /
  R53-1B 清理 + updatedAt 格式化 bug 修复 (fmtDate/fmtDateShort/shortTime 三处全部先
  formatUpdatedAt 归一化) + DEPLOY/README LoC 同步 + go build + go vet + staticcheck 全 0).

- 详细工作记录: 本 worklog 条目 + agent-ctx/R53-1B-full-stack-developer.md
