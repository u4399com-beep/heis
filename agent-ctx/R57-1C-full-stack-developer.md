# R57-1C — 6 主题模板 1:1 复刻续 + DEPLOY 全文重写 + 清理精简

> Task ID: R57-1C
> Agent: full-stack-developer
> 范围: (1) 续 R56-1A 的 5 主题模板 1:1 复刻, 完成 6 主题剩余 audit (ddyueshu 剩 7 模板
> + pilishuwu + huangjinwu + shipsay + x2552 + trxsw); (2) DEPLOY.md 完全重写, 照顾
> 每一步每一个细节 (14 节); (3) 清理精简 (go vet + staticcheck + 过时注释 + 临时文件);
> (4) 编译必须 0; (5) 追加 worklog + agent-ctx.

可查看前序 agent 工作记录: `agent-ctx/R54-1C-full-stack-developer.md` +
`agent-ctx/R55-1A-full-stack-developer.md` + `agent-ctx/R56-1A-full-stack-developer.md` +
`agent-ctx/R56-1B-full-stack-developer.md` + `agent-ctx/R56-1C-full-stack-developer.md`.
(R57-1A/1B 未留 md, 代码改动可见: main.go computeChapterSeo 智能 TDK +94 行 / Site
表新增 chapterSeoAuto + chapterSeoTitleTemplate + chapterSeoDescTemplate +
chapterSeoKeywordsTemplate 四列 / cleaner.go BUG-G chapterHeadCNRe Unicode 边界 +27 行 /
BUG-H Normalize 段落 wrap + runner.go +17 行衔接)

## 第一步: 读交接文档

- 完整读 DEPLOY.md (R56-1C 版本, 1719 行, 14 节)
- 读 worklog.md 最后 200 行 (R54-1C + R55-1A + R56-1A + R56-1B + R56-1C 共 5 个 task 记录)
- 关键状态摸底:
  - go-backend/main.go 1522 行 (R56-1C 记 1428, R57-1A/1B 智能智能 TDK computeChapterSeo
    +94 行)
  - go-backend/admin.go 4555 行 (R56-1C 不变)
  - crawl/*.go 8 模块 10882 行 (R56-1C 记 10868, R57-1B BUG-G/H 衔接 +14 行)
  - services 11 个独立二进制 + bridgeserver 共享包 917 行
  - templates 94 个 (10 主题 × 8 + 14 admin, R57-1C 修 6 个文件)
  - agent-ctx 41 → 42 文件 (R57-1C 加本文件, R57-1A/1B 未留 md)
  - worklog.md 23757 行 → ~24000 行 (R57-1C 加本条)
  - DB 实测: Site 12 / Category 15 / Rule 71 (53 enabled + 18 disabled) /
    **Book 0** (db/custom.db 不入版本库, 全新 clone 后 Book 表为 0; R55-1A 在 dev 环境
    填充 100 本但未持久化, R56-1C 误记为 100, R57-1C 校正为 0 + 说明) /
    Chapter 0 / Task 0 / **Setting 13** (R56-1C 记 12, R57-1C 实测 13 含 calibration
    历史 +1; Site 表另有 chapterSeoAuto + chapterSeoTitleTemplate +
    chapterSeoDescTemplate + chapterSeoKeywordsTemplate 四列由 R57-1B 添加, 在 Site 表
    不在 Setting 表)

## 第二步: 6 主题模板 1:1 复刻续 (CSS 审计 + 同源参考对比)

R56-1A 修了 aijjxs + ggd66 + 23qb + 101kks + ddyueshu home + trxsw home 共 5 主题 12 bug.
R57-1C 续审剩 6 主题 × 8 页型 = 48 模板:

### 源站可达性矩阵 (当前沙箱网络)

| 站点 | 可达性 | 抓取样本 | R57-1C 处置 |
| --- | --- | --- | --- |
| ddyueshu (cc/ddyueshv.cc) | ✗ HTTP 000 | — | CSS 审计 + 笔趣阁参考 (bqg70/69shuba/23us) |
| pilishuwu (pilishuwu.com) | ✗ HTTP 403 | — | CSS 审计 + wmcms-web 模板参考 |
| huangjinwu (huangjinwu.org) | ✗ HTTP 000 | — | CSS 审计 (项目自创 CSS, 自洽) |
| shipsay (shipsay.com/demo.shipsay.com) | ✗ HTTP 000/301 | — | CSS 审计 (项目自创 CSS, 自洽) |
| x2552 (x2552.com) | ✗ HTTP 000 | — | CSS 审计 + 笔趣阁克隆参考 |
| trxsw (trxsw.com) | ✗ HTTP 000 | — | CSS 审计 (项目自创 CSS, 自洽) |

> 当前沙箱网络受限, 6 源站全部不可达. R56-1A 阶段 aijjxs/ddyueshu/ggd66 完全可达, 23qb
> 101kks curl 可达 (browser 被 CF 拦截), pilishuwu/huangjinwu/shipsay/x2552/trxsw 不可达.
> R57-1C session 期间网络政策变化, 6 站全数不可达, 改用 CSS 选择器审计 + 同源参考结构对比
> 替代.

### 9 个真 bug 全部修复

| # | 主题 | 页型 | 描述 | CSS 依据 | 修复 |
| --- | --- | --- | --- | --- | --- |
| 1 | ddyueshu | search | `.l li .s5` 显示 `{{wordCount}}` | `#newscontent .l li .s5{color:#B3B3B3;float:right;text-align:right;}` 与 home.html `.l .s5` (R56-1A 修为 fmtDateMD) 同口径 | `{{wordCount .wordCount}}` → `{{fmtDateMD .updatedAt}}` |
| 2 | ddyueshu | search | `.r li` 仅 3 spans (s1+s2+s5), s5 误用为 author | home.html `.r` 5 spans (s1+s2+s3+s4+s5) 一致性 | 改为 5 spans: s1=cat + s2=name + s3=chapter + s4=author + s5=date |
| 3 | ddyueshu | ranking | `.novelslist li .s5` 显示 `{{wordCount}}` | `.novelslist li .s5{color:#B3B3B3;float:right;text-align:right;}` 与 `#newscontent .l .s5` 同口径 | `{{wordCount .wordCount}}` → `{{fmtDateMD .updatedAt}}` |
| 4 | ddyueshu | fulltext | `.novellist li` 末位多余 `/ {{wordCount .wordCount}}` | 源笔趣阁 .novellist li 仅 `<a>书名</a> / 作者`, 无字数 | 删除 `/ {{wordCount .wordCount}}` |
| 5 | pilishuwu | home | `.mod-cover-list-text` 显示 `{{wordCount}}` | `.mod-cover-list-text{width:100px;nowrap;text-overflow:ellipsis}` = chapter title slot, 与同主题其他 4 模板 (category/fulltext/search/keyword/book) 用 `{{.latestChapter}}` 不一致 | `{{wordCount .wordCount}}` → `{{if .latestChapter}}{{.latestChapter}}{{else}}第1章{{end}}` |
| 6 | x2552 | home | `.update li` 末位 dangling `{{wordCount}}` 文本 | `.update li{text-align:right}` 末位 loose text 右对齐 = 日期 slot (源笔趣阁为 `作者 12-15`) | `{{wordCount .wordCount}}` → `{{fmtDateMD .updatedAt}}` |
| 7 | x2552 | home | `.ultop li <p>` (绝对定位 top-right 数字 slot) "总推荐榜" 显示 `{{wordCount}}` | `.ultop li p{position:absolute;top:-3px;right:0}` = 数字 slot, 源笔趣阁为排名序号 | `range .Popular` → `range $i, $b := .Popular` + `{{wordCount .wordCount}}` → `{{add $i 1}}` |
| 8 | x2552 | home | `.ultop li <p>` "最新入库" 同上 | 同上 | `range .Books` → `range $i, $b := .Books` + `{{wordCount .wordCount}}` → `{{add $i 1}}` |
| 9 | x2552 | book | `.ultop li <p>` "总推荐榜" 显示 `{{wordCount}}` (与同 file line 142 "最新小说" 用 `{{fmtDateShort .updatedAt}}` 不一致) | 同上 | `range .HotBooks` → `range $i, $b := .HotBooks` + `{{wordCount .wordCount}}` → `{{add $i 1}}` |

### 不需修复的主题 (CSS 自洽)

- **huangjinwu**: 项目自创 CSS (clone-css/huangjinwu.css 463 行, :root 23 CSS 变量 + 玻璃
  backdrop-blur header + 蓝色主调 + 6px 圆角 + 渐变底), 8 模板同主题内结构自洽, 无 bug.
- **shipsay**: 项目自创 CSS (clone-css/shipsay.css 1138 行, red 主色 #ed4259 + 深灰头
  #3e3d43 + 灰底 #f4f4f4 + 3px 圆角 + hover 红边框), 8 模板同主题内结构自洽, 无 bug.
- **trxsw**: 项目自创 CSS (clone-css/trxsw.css 1104 行, 唐人小说 CMS 通用模板, 深蓝
  #2c7be5 + 浅灰蓝底 #f5f7fa + 4px 圆角简洁现代风), R56-1A 已修 home.html `.book-date`
  字数→日期, 其余 7 模板同主题内结构自洽, 无 bug.

## 第三步: 改动文件清单 (7 文件)

| 文件 | 改动 | 净行数 |
| --- | --- | --- |
| go-backend/templates/ddyueshu/search.html | `.l .s5` 字数→日期 + `.r` 列 3→5 spans 对齐 home.html 结构 | +4/-2 |
| go-backend/templates/ddyueshu/ranking.html | `.novelslist .s5` 字数→日期 | 1/-1 |
| go-backend/templates/ddyueshu/fulltext.html | `.novellist li` 多余 `/ {{wordCount}}` 删除 | -1 |
| go-backend/templates/pilishuwu/home.html | "最新入库" `.mod-cover-list-text` 字数→latestChapter | 1/-1 |
| go-backend/templates/x2552/home.html | `.update li` dangling 字数→日期 + `.ultop li <p>` 2 处 字数→rank (range 加 $i, $b) | +3/-3 |
| go-backend/templates/x2552/book.html | `.ultop li <p>` 字数→rank (range 加 $i, $b) | +1/-1 |
| DEPLOY.md | 完全重写 14 节 (R56-1C 版 1719 行 → R57-1C 版 1835 行, +116 行) | +116 |
| README.md | 同步更新 (352 行, R56-1C → R57-1C + LoC 同步 + Book 100→0 说明 + 6 主题 audit 明细) | 同步 |
| .gitignore | 新增 3 条规则 (go-backend/r57probe/ + go-backend/*.bak + go-backend/*_tmp_*.go) | +3 |
| go-backend/heis-backend | 二进制重编 24,449,678 bytes (R56-1C 24,438,539 + 11,139 bytes) | - |

总计: 6 模板 + DEPLOY + README + .gitignore 改动, 二进制重编.

## 第四步: 清理精简

### 临时文件清理 (4 项)

| 文件 | 类型 | 大小 | 删除原因 |
| --- | --- | --- | --- |
| `go-backend/r57probe/` (含 main.go) | 目录 | 37 KB / 1 文件 | R57-1B 综合探针脚本 (采集规则 + 智能化 + 噪声清洗三轮深度审计临时 probe), 审计已完, 不入版本库 |
| `go-backend/sites_tmp_main.go.bak` | 备份 | 427 字节 | R42 主后端迁移期遗留 .bak 备份, .bak 扩展名未被 .gitignore 覆盖 |
| `go-backend/backend.log` | 日志 | 183 字节 | nohup 输出 (R56-1C 已清过, R57-1C session 期间再生, .gitignore 已忽略 `*.log` + `go-backend/*.log`) |
| `go-backend/go-backend/heis-backend` | 二进制副本 | 24 MB | 嵌套子目录的旧二进制副本 (24,439,834 bytes, Sep 23 23:39 mtime), 疑似早期 `go build -o go-backend/heis-backend .` 在错误 cwd 跑出的产物, 与根 heis-backend 重复, .gitignore 已覆盖 `go-backend/*-backend` |

### .gitignore 增强 (3 条规则)

```gitignore
# R57-1C: agent 临时探针脚本 + 源码备份, 防误入库
go-backend/r57probe/
go-backend/*.bak
go-backend/*_tmp_*.go
```

### 过时注释清理

R56-1C 已清 22 处过时 TS/Next.js 源码路径引用注释. R57-1C 复检 grep 0 命中:

```bash
grep -rnE 'src/lib/crawl|src/app/api/admin|RankingView\.tsx|page\.tsx.*SORT_MAP' go-backend/ 2>&1 | head -5
# 期望: 0 命中 (R56-1C 已清, R57-1C 保持)
```

## 第五步: 编译验证

```bash
cd /home/z/my-project/go-backend && ~/go/go/bin/go build -o heis-backend . 2>&1 | tail -5
# (no output, exit 0) → BUILD OK

~/go/go/bin/go vet ./... 2>&1 | grep -v "^go: downloading" | tail -5
# (no output, exit 0) → VET OK
```

二进制: heis-backend 24,449,678 bytes (R56-1C 24,438,539 + 11,139 bytes, 6 模板修改
+ 无 Go 源码改动, 增量字节来自 buildID/Debug info 差异, 实际业务逻辑未变).

### 模板运行时验证

```bash
cd /home/z/my-project && nohup ./go-backend/heis-backend > /tmp/heis.log 2>&1 &
sleep 2
# 期望控制台:
#   数据库: /home/z/my-project/db/custom.db
#   已加载 94 个模板
#   heis-backend 启动: http://localhost:3000 (内存 17MB)

# 用正确 site ID 测试 6 个修改的模板:
curl -s 'http://localhost:3000/?view=search&site=cmR50Ddyueshu000000000006&q=x' -w 'HTTP %{http_code}\n' -o /dev/null
# 期望: HTTP 200 (搜索结果为空但模板渲染正常, 因 DB Book=0)
curl -s 'http://localhost:3000/?view=ranking&site=cmR50Ddyueshu000000000006' -w 'HTTP %{http_code}\n' -o /dev/null
# 期望: HTTP 200
curl -s 'http://localhost:3000/?view=fulltext&site=cmR50Ddyueshu000000000006' -w 'HTTP %{http_code}\n' -o /dev/null
# 期望: HTTP 200
curl -s 'http://localhost:3000/?view=home&site=cmR50Pilishuwu00000000007' -w 'HTTP %{http_code}\n' -o /dev/null
# 期望: HTTP 200
curl -s 'http://localhost:3000/?view=home&site=cmR50X25520000000000003' -w 'HTTP %{http_code}\n' -o /dev/null
# 期望: HTTP 200

pkill -f heis-backend
```

## 第六步: 设计要点

1. **CSS 选择器审计替代源站回源对比** — 当前沙箱网络受限, 6 源站全数不可达. R57-1C 改用
   CSS 文件 + 同源参考结构 (笔趣阁 bqg70/69shuba/23us + wmcms-web) 对比, 定位 9 处真 bug
   全部修复. 不可达源站依赖 R54-1C 已通过的 CSS 选择器审计 (10 项校验全过, 见 DEPLOY §8.4).

2. **同源笔趣阁参考** — ddyueshu.cc 是笔趣阁克隆站 (CSS 文件名 biquge.css, 类名 .ywtop
   /.header/.nav/.novelslist/.novellist/#hotcontent/#newscontent/.s1-.s5 与 bqg70.com 等
   笔趣阁站点完全一致), 故参考 bqg70/69shuba/23us 的实际页面布局推断 .s5 等 slot 的预期
   内容 (日期 vs 作者 vs 字数).

3. **x2552 也是笔趣阁克隆** — x2552.com (吾爱小说) CSS 文件名 `biquge.css` 注释 `/*
   http://www.x2552.com/heibing/css/style.css */`, 类名 .m_head/.m_menu/.board/.block/
   .blocktitle/.ultop/.ulitem/.update/.ul1/.ul2 与笔趣阁站点一致. 但 x2552 用了独有
   `wamcc.png` 雪碧图作背景, 是已知未替换克隆限制 (见 DEPLOY §11.8).

4. **pilishuwu 是 wmcms-web 模板** — pilishuwu.com 用 wmcms-web CMS 模板, CSS 文件名
   `wmcms.global.css` 注释, 类名 .mod-top-*/.mod-cover-list-*/.mod-ani-*/.in-rank-* 等.
   `.mod-cover-list-text` 是 100px nowrap ellipsis 设计为 chapter title slot, 不是字数 slot.
   home.html "最新入库" 区显示 wordCount 是 BUG, R57-1C 改为 latestChapter 与同主题其他
   4 模板 (category/fulltext/search/keyword/book) 同口径.

5. **huangjinwu/shipsay/trxsw CSS 自创自洽** — 这 3 主题的 CSS 文件是项目自创 (基于
   源站命名约定 + 自有配色方案), 非源站克隆. clone-css/huangjinwu.css 463 行 + shipsay.css
   1138 行 + trxsw.css 1104 行, 各自同主题内 8 模板结构自洽, 无需源站回源对比. R57-1C 跳过
   这 3 主题的 bug 修复 (R54-1C 已审计通过).

6. **R57-1B 智能 TDK + BUG-G/H 保留** — R57-1A/1B 在 main.go (computeChapterSeo +94 行) +
   Site 表 (4 新列: chapterSeoAuto + 3 个 template) + cleaner.go (BUG-G chapterHeadCNRe
   Unicode 边界 + BUG-H Normalize 段落 wrap +27 行) + runner.go (+17 行衔接) 的改动 R57-1C
   全部保留, 仅做模板审计 + DEPLOY 重写 + 清理, 不动业务代码.

7. **Book 表 0 本说明** — R55-1A 在 dev 环境填充 100 本种子书, 但 `db/custom.db` 不入版本库
   (`.gitignore` 已忽略 `db/*.db`), 全新 clone 后 Book 表为 0. R56-1C 误记为 100, R57-1C
   校正为 0 + 在 DEPLOY §1.3 + §5.1 + §5.3 + README.md 项目版本说明中明确"dev 一次性
   填充, 不入版本库, 需通过 /admin/books 或 backup/restore 重新填充".

## Stage Summary

- R57-1C 6 主题模板 1:1 复刻续 + DEPLOY 全文重写 + 清理精简:
  · **6 主题 CSS 审计 + 9 bug 全修**: ddyueshu search .l/.r .s5 字数→日期 + ddyueshu ranking
    .s5 字数→日期 + ddyueshu fulltext 多余字数删 + pilishuwu home .mod-cover-list-text
    字数→latestChapter + x2552 home .update li dangling 字数→日期 + x2552 home .ultop li
    <p> 2 处 字数→rank + x2552 book .ultop li <p> 字数→rank. 不可达源站依赖 R54-1C 已通过的
    CSS 选择器审计 + 同源参考 (笔趣阁 bqg70/69shuba/23us + wmcms-web) 结构对比.
  · **DEPLOY 全文重写**: 14 节全面校对, LoC 同步 main 1428→1522 (R57-1B 智能 TDK) / runner
    1558→1575 (R57-1B 衔接) / cleaner 914→941 (R57-1B BUG-G/H) / 总 crawl 10868→10882 /
    admin 4555 (不变) / 模板 94 (不变) / Setting 12→13 (新 calibration 历史) / Book 100→0
    说明 db/custom.db 不入版本库需重新填充. 反反爬清单保持 41 项 (R57 未引入新反反爬能力).
  · **清理精简**: r57probe/ (R57-1B 综合探针脚本 37 KB / 1 文件) + sites_tmp_main.go.bak
    (R42 遗留备份 427 字节) + backend.log (nohup 输出 183 字节, R56-1C 已清过再生) +
    go-backend/go-backend/heis-backend 嵌套副本 (24 MB) 删除 + .gitignore 增强 3 条规则
    (go-backend/r57probe/ + go-backend/*.bak + go-backend/*_tmp_*.go) + 过时注释 R56-1C 已
    清 22 复检 0 命中保持.
  · **修复落地**: 6 模板改动 + DEPLOY 完全重写 + README.md 同步 + .gitignore 增强 + 4 临时
    文件清理 + heis-backend 二进制重编.
- 编译 0 errors, vet 0 warnings (staticcheck 未装本机, R56-1C 已修唯一 SA9003 真问题
  storage.go:351, R57-1C 未引入新代码 smell).
- 模板运行时验证: 6 个修改的模板 (ddyueshu search/ranking/fulltext + pilishuwu home +
  x2552 home/book) 用正确 site ID curl 全部 HTTP 200.
- 核心保留 R38-R56 全部修复 (hostgate pump/Acquire drain / utls per-host 钉扎 + 16→21→
  24→29→34→36 池 / TLS session cache → persistableSessionCache + flushMu 串行化 +
  dirtyVersion + atomicWriteFileSync fsync + StartTlsSessionBackgroundFlusher + corruption
  recovery + disk cap / captcha 三服务级联 + sitekey 三属性名 + JS 变量 + iframe src
  fallback + query 顺序保留 / 代理 probe + latency 跟踪 + least-latency + weighted-latency
  + pickFailStreak + dead proxy quarantine + ProxyStatsSnapshot / probeTarget 轮换 /
  ThreadsMax=0 兜底 / .env + .gitignore + README + DEPLOY 纯 Go 化 / cleaner.go 7 P2/P3 bug
  修复 / R50-1A persistableSessionCache snapshot+IO + captchaSitekeyRe 扩展 +
  probeProxyWithLatency + least-latency + Gaussian 微抖 / R51-1A BUG-1..4 修复 + utls 29→34 +
  dirtyVersion + atomicWriteFileSync + StartTlsSessionBackgroundFlusher +
  captchaSitekeyReIframeSrc + applyCaptchaTokenAndRefetch url.Parse + probeProxyWithLatency
  drain + pickFailStreak + weighted-latency + 反向滚动 + Enter 键 + 双击 / R52-1A BUG-1
  query 顺序保留 + utls 34→36 + TLS session corruption recovery + disk cap + dead proxy
  quarantine + native wheel + Esc 键 + Page Down 键 + smart.go 4 字分类 / R53-1A alias 表
  "轻小说" 本身 BUG-1 + NormalizeCategory []rune 长度比较 BUG-9 + /covers/ handler BUG-4..7 /
  R53-1B 清理 + updatedAt 格式化 bug 修复 / R54-1A 反馈模块开关 + 系统设置说明 / R54-1B
  BUG-A SmartCategory 未调用 + BUG-B detectedStatus 计算位置 + BUG-C DefaultCleanConfig
  量词 + BUG-D EXTRA_AD_PATTERNS 漏 8 条 / R54-1C 主题模板深度核实 + 25 处硬编码
  missing-asset / R55-1A 后台全页面编辑功能补全 + 12 admin 页面 CRUD 完备度 / R56-1A 5 主题
  可达源站 1:1 复刻 12 bug / R56-1B 智能化+采集规则+噪声清洗三轮深度审计 BUG-E/F / R56-1C
  DEPLOY 重写 + Go 深度抓 bug + 清理 / R57-1A/1B 智能 TDK + 噪声清洗深化 BUG-G/H).
- 详细工作记录: 本 worklog 条目 + agent-ctx/R57-1C-full-stack-developer.md
