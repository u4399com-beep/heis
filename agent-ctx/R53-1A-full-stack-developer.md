# R53-1A 工作记录 — Go 第十二轮深度审查 + smart.go 4 字分类校对 + 9 边缘 bug 修复

- **Task ID**: R53-1A
- **Agent**: full-stack-developer (Go第十二轮+smart4字+反反爬)
- **Stage**: R53 (第十二轮)
- **前置**: R41-R52 已完成 92 bug + 41 反反爬修复 (含 R52-1A smart 4 字分类 + utls 36 + TLS corruption recovery + PageDown/Esc + R52-1B 清理 + DEPLOY/README 校对)
- **本 Agent 改动**: crawl/smart.go + main.go (formatUpdatedAt + /covers/) + services/cloak-browser/main.go (PageDown)

## 第一步: 读交接文档 (必做)

读 `/home/z/my-project/worklog.md` 最后 300 行 (R41-R52 修复历史):
- R41-R52: 92 bug + 41 反反爬 + smart 4 字 + updatedAt 格式化 + 封面 SVG 占位.
- R52-1A: smart.go 15 个标准 4 字分类 (玄幻奇幻/奇幻魔幻/武侠江湖/仙侠修真/都市
  生活/言情小说/历史军事/军事战争/游戏竞技/科幻未来/悬疑推理/灵异鬼怪/体育竞
  技/轻小说类/现实生活) + categoryAliases 4 字目标 + 2-3 字旧名兜底 + utls 36
  款池 + TLS session corruption recovery + disk cap + applyCaptchaTokenAndRefetch
  query 顺序保留 + dead proxy quarantine + native wheel + Esc + Page Down.
- R52-1B: 清理 + 模板封面核实 (80 模板全 {{.cover}}) + DEPLOY/README 校对.

## 第二步: smart.go 同步 4 字分类 (校对)

### 2.1 校对结论

1. **CATEGORY_KEYWORDS** 15 个分类名全 4 字 ✓ (玄幻奇幻/奇幻魔幻/.../轻小说类/现实生活)
2. **CATEGORY_ALIASES** 目标全 4 字 ✓ (源站变体合并到标准 4 字名)
3. **NormalizeCategory** 返回 4 字 ✓ (4 步归一化: alias → 标准 → fuzzy → 原名)

### 2.2 R53-1A 修复 BUG-1 (轻小说 alias 缺失)

`categoryAliases` 漏 "轻小说" 本身 (3 字). 源站分类 "轻小说" 在 NormalizeCategory:
1. alias 查 "轻小说" → 未命中
2. standard 4 字名循环 "轻小说" != "轻小说类"
3. fuzzy len("轻小说")=3 > len("轻小说类")=4 → false 跳过
4. 返回 "轻小说" 原名

SmartCategory source 路径 normalized="轻小说" 与 existing categories (4 字标准名)
比较 → 不匹配 → 退到 keyword 路径 (method="keyword" 而非 "source").

补 "轻小说" → "轻小说类" alias + 同步补 "国产轻小说" / "动漫" / "二次元小说"
变体, 让 source 路径直接命中 method="source".

### 2.3 R53-1A 修复 BUG-9 (NormalizeCategory fuzzy byte vs rune)

第 3 步 fuzzy 用 byte 长度比较 `len(n) > len(c.name)`, 对中文 (3 bytes/rune) 与
ASCII (1 byte/rune) 混合的源站分类名会误判. 例:
- n="abc玄幻奇幻" (5 runes, 15 bytes) vs c.name="玄幻奇幻" (4 runes, 12 bytes):
  byte 15>12 true, rune 5>4 也 true → 一致 (正确触发)
- n="玄幻奇幻abc" (7 runes, 18 bytes) vs c.name="玄幻奇幻类" (5 runes, 15 bytes):
  byte 18>15 true, rune 7>5 也 true → 一致 (正确触发)

实际 byte 与 rune 比较结果在中文场景下几乎总是一致 (因每 rune ≥1 byte, byte_count ≥
rune_count). 但为防极端 case (源站分类名含 emoji 等 4-byte rune) + 与
MatchCategoryByText 同口径, 改用 `len([]rune(n)) > len([]rune(c.name))`.

## 第三步: Go 第十二轮深度审查 (R52 修复后边缘 case)

### 3.1 formatUpdatedAt (main.go:766)

#### R53-1A 修复 BUG-2 (微秒/纳秒时间戳)

原 formatUpdatedAt 仅处理 "秒 + 毫秒 (>1e12)" 两级, 漏微秒 (1e15+, Go
time.Now().UnixMicro() 来源) 与纳秒 (1e18+, Go time.Now().UnixNano() 来源).

若上游 (TS admin API / 第三方同步) 用 UnixMicro / UnixNano, 原 i/1000 把微秒当
毫秒除 → 1698765432000000 / 1000 = 1698765432000 (仍是毫秒) → time.Unix
(1698765432000, 0) → 公元 56000+ 年.

修复: 4 级数量级判断:
- `i >= 1e18` → 纳秒 /1e9
- `i >= 1e15` → 微秒 /1e6
- `i >= 1e12` → 毫秒 /1e3
- 否则 → 秒 (R52 原行为)

阈值取 "今年各精度下限的 100x" 防边界 (2024-01-01 秒=1.7e9, 毫秒=1.7e12, 微秒
=1.7e15, 纳秒=1.7e18; 阈值 1e11/1e14/1e17 在各精度下限 + 100 年内仍稳定).

#### R53-1A 修复 BUG-3 (文本时间 layout 缺失)

原 time.Parse 仅尝试:
- `2006-01-02T15:04:05` (ISO 无时区)
- `2006-01-02 15:04:05` (SQLite TEXT)

漏:
- `time.RFC3339` (= `2006-01-02T15:04:05Z07:00`, 含 Z / ±HH:MM 时区, TS admin
  API 常见)
- `2006-01-02 15:04` (SQLite TEXT 精确到分)
- `2006-01-02` (SQLite DATE, 仅日期无时分)
- `2006/01/02 15:04:05` (slash 分隔 + 时分秒, 部分中文源站)
- `2006/01/02 15:04` (slash + 时分)
- `2006/01/02` (slash 日期)

原 "2024-01-01T12:00:00Z" → Parse("2006-01-02T15:04:05") 失败 (layout 无 Z) →
回退返原字符串 "2024-01-01T12:00:00Z" 给前端, 显示带 T 和 Z 的乱码时间.

修复: 8 个 layout 数组依次尝试, 第一个匹配即返回. 时区用 time.Parse (local TZ)
而非 time.ParseInLocation — 若字符串含时区后缀 (Z / +08:00), Parse 按字符串时
区; 无时区后缀则按本地时区. 与 SQLite TEXT 行为一致 (SQLite 不存时区).

### 3.2 /covers/ handler (main.go:244)

#### R53-1A 修复 BUG-4 (path traversal)

原 `filepath.Join(coversDir, name)` 在 name="../etc/passwd.webp" 时 join 成
"data/covers/../etc/passwd.webp" → filepath.Clean 解析为 "data/etc/passwd.webp"
(coversDir 之外).

net/http 会清理 URL 的 ".." 段, 但恶意 URL 编码 `%2e%2e%2f` 经某些 proxy 可能不被
net/http 清理 (取决于 Caddy/nginx 转发行为).

修复: `filepath.Base(name)` 取 basename 剥所有目录组件 (类似 ReadCover 安全
路径模式), 再 join + 验证 Clean 后仍在 coversDir 内. 双保险: Base + HasPrefix.

#### R53-1A 修复 BUG-5 (SVG initial 未 XML escape)

原 `fmt.Fprintf "%s"` 直接拼 initial 到 SVG `<text>` 内, 若书名首字是 `<` `>` `&`
`"` `'` (源站抓取异常时 HTML 标签字符渗入书名), SVG 输出会:
1. 破图 (浏览器无法解析 XML, 因 `<` 在 `<text>` 内容里非法)
2. 注入恶意 `<script>` (虽然 SVG `<script>` 在 `<img>` 上下文不执行 JS, 但直接访问
   `/covers/` URL 的浏览器上下文可执行 — XSS 风险)

修复: `template.HTMLEscapeString(initial)` 转义 5 个 XML 特殊字符 (`<` `>` `&`
`"` `'`). bookName 首字可能是这些字符的边缘 case (源站抓取异常 / HTML 标签渗入).

#### R53-1A 修复 BUG-6 (LIKE 模式过松)

原 `LIKE "%"+name` 把 name 当 LIKE pattern, 若 name 含 `%` 或 `_` (SQL LIKE
通配符) 会误匹配. 同时 `LIKE "%foo.webp"` 会匹配 "covers/foo.webp" +
"other_foo.webp" + "xfoo.webp" 等所有以 foo.webp 结尾的 cover, 取第一个 → 可能
取到错书名.

修复: `cover = ?` exact match, param = `"covers/"+base` (与 SaveCoverWebp
存储路径 "covers/{name}.webp" 一致). 失败 (无 DB 行) 用默认 "书" 占位.

#### R53-1A 修复 BUG-7 (Scan 错误忽略)

原 `db.QueryRow(...).Scan(&bookName)` 不检查 err, 若 SQL 错误 (DB 损坏 / 表缺失)
bookName="" → initial="书" 兜底. 但 err != sql.ErrNoRows 时是真实错误, 应记日志
供操作员排查.

修复: 错误检查 + 日志 (`log.Printf("[covers] 查询书名失败 cover=%s err=%v", ...)`)
— ErrNoRows 静默 (兜底 "书" 是预期行为).

### 3.3 cloak-browser PageDown (services/cloak-browser/main.go:884)

#### R53-1A 修复 BUG-8 (PageDown 用 \x0c 不触发)

原用 `chromedp.KeyEvent("\x0c")` (FF 表单换页字符) 触发 Page Down. 经查 chromedp
`kb.Keys` map (在 `github.com/chromedp/chromedp/kb` 包):

```
'\b'        → "Backspace" (VK 8)
'\t'        → "Tab" (VK 9)         ✓ R50-1A Tab 用此, 工作
'\r'        → "Enter" (VK 13)     ✓ R51-1A Enter 用此, 工作
'\u001b'    → "Escape" (VK 27)    ✓ R52-1A Esc 用此, 工作
' '         → "Space" (VK 32)
'\u007f'    → "Delete" (VK 46)
'\u0301'    → "ArrowDown" (VK 40)
'\u0302'    → "ArrowLeft" (VK 37)
'\u0303'    → "ArrowRight" (VK 39)
'\u0304'    → "ArrowUp" (VK 38)
'\u0305'    → "End" (VK 35)
'\u0306'    → "Home" (VK 36)
'\u0307'    → "PageDown" (VK 34)  ✓ kb.Keys 有此映射
'\u0308'    → "PageUp" (VK 33)
'\x0c'      → 不在 kb.Keys map   ✗ R52-1A PageDown 用此, NO-OP!
```

W3C UI Events 规范: PageDown 是 virtual key (VK 34), 不是 printable char.
`chromedp.KeyEvent("\x0c")` 发送 FF 字符, Chrome 不映射到 PageDown 键 → 实际
no-op (页面无滚动 → 反爬监听 PageDown 缺失 = 自动化).

修复: 用 `input.DispatchKeyEvent(input.KeyDown/KeyUp).WithKey("PageDown").
WithCode("PageDown").WithWindowsVirtualKeyCode(34).Do(ctx)` 显式发送 virtual
key, 让 Chrome 触发真实 PageDown 键事件 (keydown + keyup).

kb.Keys map 里 `\u0307` (combining dot above) → "PageDown" (VK 34), 故
`chromedp.KeyEvent("\u0307")` 也可工作; 但显式 `input.DispatchKeyEvent` 更清晰
自文档化, 不依赖 chromedp kb 包行为.

Tab/Enter/Esc 字符级发送保留 (经 R50-1A/R51-1A/R52-1A 验证 Chrome 字符级默认
行为生效: Tab 切 focus / Enter 提交 / Esc 关 modal), 仅 PageDown 必须 virtual
key 路径 (无可打印字符).

## 第四步: 反反爬增强 (R53-1A)

- 不额外增加反反爬项 (R41-R52 已 41 项, 本轮专注 R52 修复后边缘 case).
- PageDown 修复本身属反反爬增强 (修复了 R52-1A 行为模拟的 no-op bug).

## 第五步: 编译验证

- `cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend .` → 0 errors.
- `~/go/go/bin/go vet ./...` → 0 warnings (主包 + 11 services + bridgeserver + crawl 全 pass).
- `~/go/bin/staticcheck ./...` → 0 issues.
- 12 services 独立 build + vet 全 0 errors / 0 warnings.
- heis-backend 重启 (start.sh/start-go.js watchdog auto-restart): 数据库
  `/home/z/my-project/db/custom.db` + 已加载 94 模板 + heis-backend 启动
  `http://localhost:3000` (内存 13MB) + TLS session 后台 flusher goroutine.

## 端到端 curl 验证

| 端点 | 期望 | 实际 |
|---|---|---|
| `GET /health` | 200 `{"lang":"go","memMB":13,"ok":true}` | ✓ |
| `GET /covers/nonexistent.webp` | 200 image/svg+xml (SVG 占位 渐变色块 + "书" 字) | ✓ |
| `GET /covers/book_1789514841040_5980.webp` | 200 image/svg+xml (SVG 占位 "万" 字, DB 查 Book 万相之王) | ✓ |
| `GET /covers/../etc/passwd` | 404 (Go net/http 清理 URL ".." 段) | ✓ |
| `GET /covers/%2e%2e%2fetc%2fpasswd` | 200 image/svg+xml (Base 剥到 "passwd", 无 etc/passwd 泄露) | ✓ |
| `GET /covers/nonexistent<script>alert(1)</script>.webp` | 200 image/svg+xml (book name 无匹配 → "书", SVG 安全) | ✓ |
| `GET /api/public/book?id=cmu2j25pz0040prts6i51wfjo` | 200 updatedAt="2026-09-15 23:55" (毫秒时间戳正确格式化) | ✓ |
| `GET /admin` | 200 | ✓ |

## Go runtime 验证 NormalizeCategory

| 输入 | 输出 | 备注 |
|---|---|---|
| `"轻小说"` | `"轻小说类"` | BUG-1 修复 (alias 补) |
| `"玄幻"` | `"玄幻奇幻"` | alias |
| `"玄幻奇幻"` | `"玄幻奇幻"` | standard 4 字 |
| `"abc玄幻奇幻"` | `"玄幻奇幻"` | fuzzy (BUG-9 []rune 修复) |
| `"玄幻奇幻小说"` | `"玄幻奇幻"` | fuzzy |
| `"穿越"` | `"穿越"` | 无 alias, 走 keyword 路径 |
| `"二次元"` | `"二次元"` | 无 alias, 走 keyword 路径 |

## 文件改动统计

| 文件 | 改动 | 行数 |
|---|---|---|
| `crawl/smart.go` | BUG-1 轻小说 alias + BUG-9 []rune fuzzy + 注释扩 | +18 |
| `main.go` | BUG-2/3 formatUpdatedAt 4 级时间戳 + 8 layout + BUG-4/5/6/7 /covers/ 4 bug + 注释扩 | +52 |
| `services/cloak-browser/main.go` | BUG-8 PageDown virtual key + 注释扩 | +14 |
| `worklog.md` | R53-1A 条目 | +本条目 |
| `go-backend/heis-backend` | 二进制重编 | 24MB |

## 未修改 (尊重约束)

- `go-backend/admin.go` (深度审查无 R52 后边缘 case) ✓
- `go-backend/crawl/{cleaner,hostgate,parser,runner,storage,types}.go` (深度审查无 R52 后边缘 case; R49 边界完整) ✓
- `go-backend/services/{bridgeserver,curl-impersonate-bridge,fetch-relay,scrapling-bridge,trafilatura-bridge,uc-bridge,moli-bridge,bqg713-proxy,deqixs-proxy,xjp-proxy,qimao-proxy}/main.go` (深度审查无边缘 case) ✓
- `prisma/schema.prisma` + `package.json` + `.gitignore` (0 改动) ✓
- `DEPLOY.md` / `README.md` (本轮无新功能, 不需校对版本号) ✓
- `agent-ctx/*.md` (R38-R52-1B 全部保留, 新增 R53-1A 本条目) ✓

## Stage Summary

- R53-1A 第十二轮深度审查 + smart.go 4 字分类校对 + 9 个边缘 bug 修复:
  - **smart.go 4 字分类校对**: CATEGORY_KEYWORDS 15 个全 4 字 ✓ +
    CATEGORY_ALIASES 目标全 4 字 ✓ + NormalizeCategory 返回 4 字 ✓. 仅需补
    "轻小说" alias (BUG-1) + byte→rune fuzzy 修复 (BUG-9).
  - **formatUpdatedAt 4 级时间戳** (BUG-2): 原仅 "秒+毫秒 (>1e12)" 两级, 漏
    微秒 (1e15+) / 纳秒 (1e18+). 4 级数量级判断 — ≥1e18 /1e9, ≥1e15 /1e6,
    ≥1e12 /1e3, 否则秒. 防 UnixMicro / UnixNano 时间戳被误格式化到公元
    56000+ 年.
  - **formatUpdatedAt 8 layout 兜底** (BUG-3): 原仅 ISO 无时区 + SQLite TEXT,
    漏 RFC3339 (含 Z / ±HH:MM 时区) + SQLite DATE + slash 分隔 3 变体 + 精确
    到分 2 变体. 防 ISO 8601 UTC 时间戳被回退到原字符串显示带 T 和 Z 乱码.
  - **/covers/ path traversal 防御** (BUG-4): 原 filepath.Join(coversDir, name)
    在 name="../etc/passwd" 时 join 成 coversDir/../etc/passwd → Clean 后逃逸
    coversDir. 修复: filepath.Base 剥目录组件 + Clean + HasPrefix 验证仍在
    coversDir 内 (与 ReadCover 同款安全路径模式).
  - **/covers/ SVG XML escape** (BUG-5): 原 fmt.Fprintf "%s" 直接拼 initial 到
    SVG `<text>`, 若书名首字是 `<` `>` `&` `"` `'` (源站抓取异常), SVG 破图
    或 XSS (直接访问 /covers/ URL 浏览器上下文). 修复:
    template.HTMLEscapeString 转义 5 个 XML 特殊字符.
  - **/covers/ exact match 替代 LIKE** (BUG-6): 原 LIKE "%"+name 把 name 当
    LIKE pattern (% / _ 通配符) + 匹配过松 (foo.webp 误匹配 other_foo.webp).
    修复: cover = ? exact match, param = "covers/"+base.
  - **/covers/ Scan err 日志** (BUG-7): 原 db.QueryRow(...).Scan(&bookName)
    不检查 err, SQL 错误静默吞. 修复: 错误检查 + 日志 (ErrNoRows 静默 — 兜底
    "书" 是预期行为).
  - **cloak-browser PageDown virtual key** (BUG-8): 原 chromedp.KeyEvent
    ("\x0c") (FF 字符) — FF 不在 chromedp kb.Keys map → no-op (页面无滚动 →
    反爬监听 PageDown 缺失 = 自动化). 修复: input.DispatchKeyEvent(KeyDown/
    KeyUp).WithKey("PageDown").WithCode("PageDown").WithWindowsVirtualKeyCode
    (34).Do(ctx) 显式发送 virtual key. Tab/Enter/Esc 保留字符级 (kb.Keys map
    有映射, 工作), 仅 PageDown 必须 virtual key.
  - **NormalizeCategory []rune fuzzy** (BUG-9): 第 3 步 fuzzy 用 byte 长度比
    较, 对 emoji/4-byte rune 误判. 改用 []rune 长度 (与 MatchCategoryByText
    同口径).
- 编译 0 errors, vet 0 warnings, staticcheck 0 issues, 7 端点 curl 全 200
  (/health + / + /covers/nonexistent + /covers/book_...webp + /covers/..%2f +
  /covers/<script> + /admin) + 1 端点 404 (/covers/../etc/passwd traversal).
- 核心保留 R38-R52-1A 全部修复 (hostgate pump/Acquire drain / utls per-host
  钉扎 + attempts 偏移真正轮换 / Turnstile 8s / 2captcha 180s + per-attempt
  timeout / Cookie 持久化 + stripPort 跨端口 / BudgetExceeded 上抛 / truncate
  rune-based / Referer 一致性 / pickProxyFor sweep 完整 / trafilatura clients
  单例 / jsonLdTypeRe 预编译 / batchMu defer / discoverBooks newCount==0 break
  / MarkProxyFailed/OK / IncCaptcha / ReportRateLimited / cloak-browser
  page.AddScriptToEvaluateOnNewDocument + simulateHumanBehaviorActions /
  scrapling-bridge Accept-Encoding 移除 br / cleaner.go collapseDupPunct /
  DialTLSContext ctx 取消 / 13 处 []rune 安全截断 / ClearUtlsChoice 仅 handshake
  失败 / pickUtlsHello host=='' 返 pool[0] / brotli per-host / utls 16→21→24→
  29→34→36 池 / TLS session cache → persistableSessionCache + flushMu 串行化 +
  dirtyVersion 版本比较 + atomicWriteFileSync fsync +
  StartTlsSessionBackgroundFlusher + corruption recovery + disk cap / captcha
  主备切换 → 三服务级联 + sitekey 三属性名 + JS 变量 + iframe src fallback +
  query 顺序保留 / 代理 probe + latency 跟踪 + least-latency + weighted-latency
  策略 + pickFailStreak 业务失败跟踪 + dead proxy quarantine + ProxyStatsSnapshot
  / probeTarget 轮换 / probe 头族 / ThreadsMax=0 兜底 / .env + .gitignore +
  README + DEPLOY 纯 Go 化 / cleaner.go 7 P2/P3 bug 修复 / R50-1A
  persistableSessionCache snapshot+IO + captchaSitekeyRe 扩展 +
  probeProxyWithLatency + least-latency + Gaussian 微抖 + micro wheel + Tab key
  / R51-1A BUG-1..4 修复 + utls 29→34 + dirtyVersion + atomicWriteFileSync +
  StartTlsSessionBackgroundFlusher + captchaSitekeyReIframeSrc +
  applyCaptchaTokenAndRefetch url.Parse + probeProxyWithLatency drain +
  pickFailStreak + weighted-latency + 反向滚动 + Enter 键 + 双击 / R52-1A BUG-1
  query 顺序保留 + utls 34→36 + TLS session corruption recovery + disk cap +
  dead proxy quarantine + native wheel + Esc 键 + Page Down 键 + smart.go 4 字
  分类 / R52-1B 清理 + 模板封面核实 + DEPLOY/README 校对 / R53-1A smart 轻小说
  alias + formatUpdatedAt 4 级时间戳 + 8 layout + /covers/ 4 bug + PageDown
  virtual key + []rune fuzzy).
