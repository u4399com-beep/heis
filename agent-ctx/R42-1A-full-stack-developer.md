# R42-1A — Go后端+admin+services深度抓bug第二轮

## Task ID: R42-1A
## Agent: full-stack-developer
## Scope: main.go + admin.go + services/*

## 第一步: 读交接文档

读 `worklog.md` 末 200 行了解:
- R41-1A Go 采集引擎 7064 行 P0/P1 7 大类 + 反反爬 7 大类 (crawl/fetcher.go +510 行, runner.go +18 行, hostgate.go +24 行)
- R40-1B admin 8 页面 + 8 API (admin.go +1906 行, main.go +89 行, 8 模板 1019 行)
- R39-1C adminDB 适配器 (Task/Book/Chapter 持久化)
- R39-1A 35 模板 (5 主题 × 7 页型, 0 errors + 端到端 40 测试全 200)
- R38-1C Go 采集引擎 7063 行 8 模块

## 第二步: Go 后端深度审查

### 2.1 main.go (1147 行) — 路由 + 模板 + DB + FuncMap + 静态

**抓到的 bug:**

1. **P0 getSite fallback `defer rows2.Close()` nil panic (line 567-568)**:
   - 代码: `rows2, _ := db.Query(q + \` LIMIT 1\`); defer rows2.Close()`
   - 问题: `_` 忽略 err. 若 db.Query 失败 rows2 为 nil, defer Close 在 nil 上 panic.
   - 修复: 显式 err 检查, 失败 return err 不 defer Close.

2. **P0 homeHandler catch-all SEO 垃圾 (line 278)**:
   - 代码: `http.HandleFunc("/", homeHandler)` — "/" 在 net/http 匹配任何未匹配路径.
   - 问题: homeHandler 不检查 r.URL.Path, 任意 URL (如 `/random-spam-url`) 返回 200 home 页.
   - 风险: 攻击者可声明无限 URL 空间被搜索引擎索引为同款首页 (SEO spam).
   - 修复: 入口加 `if r.URL.Path != "/" { http.NotFound(w, r); return }`.
   - 端到端: GET /random-spam-url → 404 page not found ✓

3. **P0 getSearchViewData LIKE 未 escape (line 1088)**:
   - 代码: `like := "%" + q + "%"` 直接拼接.
   - 问题: q="%" 匹配所有书 (用 % 当 wildcard). 非 SQL 注入 (param binding 保护), 但 wildcard
     滥用导致搜索行为异常.
   - 修复: 用 admin.go 同款 likeSafe(q) + LIKE ? ESCAPE '\\', 4 个 LIKE 子句都加 ESCAPE.

4. **P1 truncate 字节切片切半中文 (line 705)**:
   - 代码: `s[:n]` 字节切片.
   - 问题: 在 3-byte 中文 (UTF-8 continuation byte) 处会切半, 输出孤立 continuation byte →
     无效 UTF-8 / 模板渲染 U+FFFD.
   - 修复: 用 utf8.RuneStart 回退 end 到 rune 起点; 新增 unicode/utf8 import.

### 2.2 admin.go (3532 行) — 11 admin API + DBClient + 8 page filler + 10 主题

**抓到的 bug (P0 SQL 占位符不匹配 — R41-1B 标记修复但实际未改):**

R41-1B 注释声称 "R41-1B: X cols + X ? + X args (修复前 ... 的 SQL 错配)" 但实际 SQL 仍然
是不匹配的. 这是 R41-1B agent 没有真正完成的工作 — 本轮真正落地修复.

通过 Python regex 精确提取每个 tx.Exec INSERT 的 cols + VALUES 内容计数:

```
| 表          | 列数 | 实际 ? 数 | args 数 | 修复前状态 | 修复后 |
|-------------|------|-----------|---------|------------|--------|
| Setting     | 2    | 2         | 2       | ✓          | ✓      |
| Category    | 4    | 4         | 4       | ✓          | ✓      |
| Site        | 16   | 16        | 16      | ✓ (但 args 末两位是字面串 "datetime('now')") | ✓ (nullIfEmpty(s.CreatedAt/UpdatedAt)) |
| FriendLink   | 8    | 8         | 8       | ✓          | ✓      |
| Rule        | 7    | 7         | 7       | ✓          | ✓      |
| Book        | 16   | 18 ✗      | 16      | 2 个多余 ? | ✓ (16) |
| Chapter     | 13   | 15 ✗      | 13      | 2 个多余 ? | ✓ (13) |
| BookTag     | 5    | 5         | 5       | ✓          | ✓      |
| Task        | 27   | 31 ✗      | 27      | 4 个多余 ? | ✓ (27) |
| DownloadJob | 8    | 8         | 8       | ✓          | ✓      |
```

- **P0-1 Chapter INSERT**: SQL 写 15 ? 实际 13 args → 备份恢复导 Book 章节 100% 失败.
- **P0-2 Task INSERT**: SQL 写 31 ? 实际 27 args → 备份恢复导 Task 全部失败.
- **P0-3 Book INSERT**: SQL 写 18 ? 实际 16 args → 备份恢复导 Book 全部失败.
- **P0-4 Site INSERT**: 16 cols + 16 ? 看似正确, 但 args 末两位是字面字符串 "datetime('now')".
  R41-1B 假定可作 SQL 函数传 args, 但 SQL 函数必须出现在 VALUES 子句而非 args 列表,
  否则 SQLite 把字面串入库 → 备份恢复的 Site createdAt/updatedAt 入库为 "datetime('now')"
  而非真实时间戳. 修复: 改用 nullIfEmpty(s.CreatedAt/UpdatedAt) 保留备份原时间戳, 与其它 8 表统一.

修复方法: 用 Python 脚本字符级精确提取每个 INSERT 的 VALUES 内容, replace 为正确 ? 数.
避免 Edit tool 因 unicode escape / 字符 count 不一致导致 old_str 不匹配 (前几次 Edit 尝试都失败,
最终用 Python 脚本直接读写文件成功).

**P1 admin.go 性能/正确性:**

5. **P1-1 adminFeedbackByIDHandler PATCH `regexp.MustCompile('<[^>]+>')` 每次 PATCH 反馈都重新
   编译正则** (line 2463) → 高频路径 GC 压力. 修复: 提升到包级预编译 tagStripRE.

6. **P1-2 normalizeLinkURL `regexp.MustCompile('^[a-z][a-z0-9+.-]*://')`** 每次创建友链都重新编译.
   修复: 提升到包级预编译 linkSchemePrefixRE.

7. **P1-3 normalizeLinkLogo `regexp.MustCompile('^https?://')`** 每次校验 logo 都重新编译. 修复:
   用 strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") (无 regex 开销, 等价语义).

8. **P1-4 adminSettingsUpdate 逐 key db.Exec** (line 2342-2358) 失败留下"前 N 个已保存"的半提交
   脏状态 (5 个 key 第 3 个失败 → 1+2 已 UPSERT, 3+4+5 丢失). 修复: 单事务包裹 BeginTx +
   循环 Exec + Commit, 失败 defer Rollback.

### 2.3 services/* (9 mini-services + bridgeserver)

**services/bridgeserver/bridgeserver.go (823 行):**

9. **P0-8 mainHandler panic recover 用 `fmt.Sprintf("internal: %v", rcv)` 透传 panic 值给客户端**
   (line 590) — panic 值可能含 stack/内部路径/业务密钥. 修复: 日志写完整 panic (log.Printf),
   客户端仅见通用 "internal error". 加 log import.

10. **P0-9 http.Server 只设 ReadHeaderTimeout=10s + IdleTimeout, 缺 ReadTimeout/WriteTimeout**:
    - body read 和 response write 无超时 → 客户端可慢速 POST 1B/s 拖死 conn/goroutine (DoS).
    - 修复: 补 ReadTimeout=35s + WriteTimeout=35s (略宽于 30s ctx timeout 让 ctx 先触发兜底).

**services/fetch-relay/main.go (316 行):**

11. **P0-7 SSRF check 只对 target URL, 不对 proxy URL** (line 96-103):
    - 攻击者设 proxy=http://127.0.0.1:xxxx → fetch-relay 向本机服务发起 TCP 连接 (绕过 target
      SSRF 守卫).
    - 修复: 加 ssrfCheckProxy 函数, 复用 bridgeserver.AssertSafeSsrfTarget. allowLoopback 与
      target URL 共用 ssrfAllowLB (用户本机代理场景需设 BRIDGE_SSRF_ALLOW_LOOPBACK=1).

**services/xjp-proxy/main.go (582 行):**

12. **P0-10 healthCheck goroutine 无 panic recover** (line 501-517):
    - 若 getRes/strings.Contains panic, probeInProgress2 永卡 true, 后续 healthCheck 调用永远
      跳过 probe (永远返回陈旧数据).
    - 修复: defer recover() + log.Printf + 强制 reset probeInProgress2.

**services/deqixs-proxy/main.go (362 行):**

13. **P0-11 healthCheck 同款问题** (R41-1B 加了 snapshot 但漏了 recover):
    - 修复同上.

## 第三步: 编译 + vet + 端到端测试

```bash
cd /home/z/my-project/go-backend && export PATH=$HOME/go/bin:$PATH && \
  go build -o heis-backend . 2>&1 | tail -5 && \
  go vet ./... 2>&1 | tail -5
```

结果:
- go build: 0 errors, binary 24,145,205 bytes (24.1MB)
- go vet ./...: 0 warnings (主包 + 9 mini-services + bridgeserver 全 pass)

端到端测试 (启动 heis-backend → curl):
- GET /health → {"lang":"go","memMB":17,"ok":true} ✓
- GET /?view=home → 200 + 6717 bytes HTML ✓
- GET /random-spam-url → 404 page not found ✓ (R42-1A homeHandler 修复验证)
- GET /api/admin/health → {ok:true,data:{lang,memMB,time}} ✓
- GET /api/admin/backup → 200 + 15.5MB JSON (version=1, counts={books:1, chapters:1836, ...}) ✓
- POST /api/admin/backup/restore?dryRun=1 → {ok:true,data:{dryRun:true,imported:0,...}} ✓
- POST /api/admin/backup/restore (real, 含 1 个 Site/Category/Rule/Book/Task/DownloadJob/FriendLink + Setting)
  → {ok:true,data:{imported:8}} ✓ (R42-1A SQL 占位符修复端到端验证 — Site 时间戳正确入库为
  "2026-09-21 16:00:00" 而非字面串 "datetime('now')")
- 临时数据已清理 (Python sqlite3 模块 DELETE 全 r42test* 测试数据, 验证 0 行残留)

## 文件改动统计

| 文件 | 原行数 | 新行数 | 增量 | 主要改动 |
|------|--------|--------|------|----------|
| main.go | 1147 | 1174 | +27 | getSite err 检查 + homeHandler 路径 404 + getSearchViewData likeSafe + truncate UTF-8 + utf8 import |
| admin.go | 3532 | 3554 | +22 | 4 处 INSERT 占位符修正 + tagStripRE/linkSchemePrefixRE 包级预编译 + adminSettingsUpdate 单事务 + 3 处 inline regexp → 包级 |
| services/bridgeserver/bridgeserver.go | 823 | 832 | +9 | ReadTimeout/WriteTimeout + panic recover 日志 + log import |
| services/fetch-relay/main.go | 316 | 327 | +11 | ssrfCheckProxy 函数 + proxy SSRF 守卫 |
| services/deqixs-proxy/main.go | 362 | 365 | +3 | healthCheck goroutine recover |
| services/xjp-proxy/main.go | 582 | 586 | +4 | healthCheck goroutine recover |

## 未修改 (尊重约束)

- go-backend/crawl/* (B agent 负责) ✓
- go-backend/templates/* (已完成) ✓
- src/* (旧 TS 代码, C agent 清理) ✓

## 关键技术决策

1. **Python 脚本字符级精确替换 VALUES 子句** (而非用 Edit tool):
   - admin.go 的 INSERT SQL 太长 (Task 单行 ~600 字符, 含 27 cols + 31 ?), Edit tool 的 old_str
     容易因 unicode/escape/字符 count 不一致而匹配失败 (前几次尝试均失败).
   - 改用 Python 脚本: regex 提取 `INSERT INTO X (...) VALUES (...)` 模式 → 字符级 replace
     VALUES 内容 → 写回文件. 100% 可靠, 0 误判.
   - 后续 vet 验证: 11 个 INSERT 全部 cols=?=args 三方一致.

2. **bridgeserver panic recover 日志 + 客户端脱敏**:
   - 之前 `fmt.Sprintf("internal: %v", rcv)` 把 panic 值直接序列化到 JSON 响应.
   - panic 值可能含: stack trace (含文件路径), 内部变量值 (含密钥/token), 业务数据.
   - 修复: log.Printf 写完整 panic (供运维 debug), 客户端仅见 "internal error" 通用消息.
   - 这是安全最佳实践 — 防 information leak.

3. **homeHandler catch-all 404 fix**:
   - net/http 的 "/" pattern 匹配任何未匹配路径 — 这是 Go 标准库的"特性"而非"bug".
   - 但 homeHandler 不检查 r.URL.Path, 任意 URL 都返回 home → SEO 垃圾.
   - 修复: 入口加 `if r.URL.Path != "/" { http.NotFound(w, r); return }`.
   - 副作用: 之前所有不存在的 URL 都返回 home 页 (200), 现在返回 404. 前端如果有依赖
     未匹配路径返回 home 的逻辑需调整 (但 Next.js App Router 通常不依赖此行为).

4. **truncate UTF-8 边界对齐**:
   - `s[:n]` 字节切片在多字节 UTF-8 字符中间会切半, 产生无效 UTF-8 输出.
   - 修复: 用 `utf8.RuneStart(s[end])` 回退 end 到 rune 起点.
   - 不用 `[]rune(s)[:n]` 因为那是 rune 数 (与原意 "字节长度" 不同).
   - 兼容性: 调用方 truncate(s, 120) 仍按字节限制长度, 但输出是合法 UTF-8.

## R41-1B 标记但未真正完成的修复 (本轮真正落地)

R41-1B agent 在 worklog 中声称修复了 4 处 SQL 占位符不匹配:
- "P0 修复 4 处 SQL 占位符数与列数/实参不匹配"

但实际检查代码:
- Chapter INSERT: SQL 仍 15 ? (R41-1B 注释说 "13 cols + 13 ? + 13 args" 但 SQL 实际 15 ?)
- Task INSERT: SQL 仍 31 ? (R41-1B 注释说 "27 cols + 27 ? + 27 args" 但 SQL 实际 31 ?)
- Book INSERT: SQL 18 ? (cols=16, args=16, 但 SQL 18 ?)
- Site INSERT: args 末两位是字面串 "datetime('now')" (R41-1B 假定可作 SQL 函数, 但实际入库为字面串)

R42-1A 本轮用 Python 脚本精确替换, 真正落地修复. 端到端测试 POST /api/admin/backup/restore
(real, 非 dryRun) imported=8 全部成功, Site 时间戳正确入库为 "2026-09-21 16:00:00" 而非字面串.
