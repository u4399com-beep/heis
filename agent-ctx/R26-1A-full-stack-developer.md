# R26-1A 剩余 crawl 模块深度审查

## 任务范围
审查 8 个 crawl 模块(剩余未审查的部分), 只改这些模块:
1. `src/lib/crawl/cleaner.ts` (687 行) — 噪声清洗
2. `src/lib/crawl/parser.ts` (1484 行) — HTML 解析
3. `src/lib/crawl/sorter.ts` (381 行) — 排序
4. `src/lib/crawl/storage.ts` (160 行) — 存储
5. `src/lib/crawl/hostgate.ts` (647 行) — host 网关
6. `src/lib/crawl/downloader.ts` (240 行) — 下载
7. `src/lib/crawl/calibrate.ts` (590 行) — 校准
8. `src/lib/crawl/types.ts` (1247 行) — 类型定义

不动: fetcher.ts(R25-1A2 已审) / obscura.ts + runner.ts(R25-1A3 已审) / themes.ts / suggest.ts / smart.ts(R25-1D2 已审) / 前端 / page.tsx / API 路由。

## 第一步: 读交接
读 worklog.md 末 200 行, 了解:
- R25-1A2 fetcher: 8 级降级链 + Referer 修复 + sleepUnref
- R25-1A3 obscura/runner: 3 P1 + 2 P2
- R25-1B 其他页型 SSR 接线
- R25-1C 主题工具栏功能
- R25-1D2 智能 TDK/SEO/搜索下拉

## 第二步: 审查范围(全量逐段读完 8 文件共 5436 行)

### cleaner.ts (687 行) — 审查结论
- **4 个零宽字符剥离出口**: cleanTextField (line 562) / cleanIntro (line 600) /
  cleanContentHtml plainText (line 208) / cleanContentHtml HTML (line 456) 全部 ✓
- **段落规整**: plainText 分支按 \n{2,} 分段, 段内 \n 压空格, U+3000→空格, \s+ 收敛, filter(Boolean) join('\n\n') ✓
- **空行压缩**: \n{2,} 分段后段间用 \n\n 重组, 段内多换行压单空格 ✓
- **缩进统一**: 段首 U+3000 + 半角空格一并 trim, 全角空格统一为半角 ✓
- **水印段落识别**: <p> 短文本(≤120 字)+ 6 类水印词任一命中才剥(裸域名/公众号/阅读引导/
  站点水印/推广话术/下载引导), 长段(>120 字)视为正文叙事不剥(防误伤含 URL 的合法内容) ✓
- **段落重排**: data-id DOM 节点移动(append 而非 parent.html 字符串重组)防吞夹带兄弟节点 ✓
- **白名单剥壳**: contents() 移动原节点(非字符串重 parse)防迭代快照失效泄漏内层标签 ✓
- **白名单属性消毒**: a[href] / img[src] / img[alt] 仅放行 http(s) 绝对地址 + alt 任意文本,
  其余属性(onerror/onload/style/data: img)一律剥除(防存储型 XSS) ✓
- **findReadableContent**: 链接密度评分 + class boost + boilerplate penalty + punct boost ✓
- **findLargestText**: 兜底最长文本容器(>200 字符) ✓

#### cleaner.ts 发现的 bug
- **P1 Bug C1**: 4 个零宽字符剥离出口的字符集仅含 `[\u200B-\u200D\uFEFF]` (4 字符:
  ZWSP/ZWNJ/ZWJ/BOM), 缺 U+2060 (Word Joiner); 但 downloader.ts ZW_CHARS 包含 \u2060
  (obfuscator 'zero-width' 模式 4 选 1), 若 obfuscate 输出后重清洗(如重采集/重新规整),
  \u2060 漏网; 且部分反爬水印确实使用 U+2060 (比 U+200B 更隐蔽), 不剥则书名/作者/简介
  可视化无变化但搜索/去重/排序被影响。修复: 4 个出口统一追加 \u2060, 与 downloader.ZW_CHARS
  同口径, 闭环对齐。

### parser.ts (1484 行) — 审查结论
- **XSS 风险**: findReadableContent 返回 $.html(el), 但下游 cleanContentHtml 在存储前会
  消毒白名单标签+剥属性(onerror/onload/style), 故存储型 XSS 面被关闭 ✓
- **selector 注入**: 用户配置的选择器走 cheerio.load().find(), cheerio 解析选择器不执行,
  无 selector 注入面 ✓
- **内存**: cssExtractAll 返回 .toArray() 对超大页面(万项)有内存压力但被应用场景限制(单页目录
  项数有界) ✓
- **ReDoS**: applyTransform 含 chunked regex 路径(>200 字符切片), 嵌套量词闸门
  (/[+*]\s*\)\s*[+*{]/ 跳过); validateRegexSafety API 入口预审 + 引擎 try/catch 兜底 ✓
- **absolutize**: 协议白名单(http(s) only) + 自引用过滤(同 origin+path+search 仅 fragment 差异返空) ✓
- **docBase**: <base href> 解析仅 http(s), 非法/相对按文档 URL 兜底 ✓
- **resolveWithBase**: 相对地址先按 base href 解析再交 absolutize 自引用过滤(两基准分离) ✓
- **JSON 模式**: jsonGet/jsonWalkCore/jsonRecursiveDescent 实现完整, 支持 union (||) /
  递归下降 (..) / JSONPath filter (?(@.field==value)) / map-collect ✓
- **parseToc**: 同 path 不同 query 的伪翻页检测(连 5 次同 path 即停), 防分页 bug 死循环 ✓
- **parseContent**: 三层兜底(规则 / readability findReadableContent / findLargestText /
  JSON-LD articleBody) ✓

#### parser.ts 未发现需修 bug (零回归)

### sorter.ts (381 行) — 审查结论
- **无 SQL 注入面**: 全量排序在内存进行(TocItem 数组), 无 orderBy 字符串拼接 → SQL 的入口 ✓
- **排序稳定性**: ES2019+ Array.sort 稳定; sortByChapterNo 同号时回退 i(原始索引)保稳定 ✓
- **reorderToc**: URL 去重(规范化: origin+path+sorted query)+ 章节名去重 ✓
- **reorderWithVolumes**: 分卷感知重排 — 字段 volume + 标题卷锚点(第N卷/Volume N/罗马数字) ✓
- **卷内排序**: 锚点条目固定最前(卷扉), 其余按章号算法; 无号卷组装配式归位(尾部番外跟最后一卷后) ✓
- **自然比较**: extractChapterNo 提序号 + 数字段自然比较 + localeCompare('zh-CN') 兜底 ✓
- **中文/罗马数字解析**: cnNumToNumber(支持十百千万亿+连写位值)+ romanToNumber(NFKC 归一罗马字符) ✓

#### sorter.ts 未发现需修 bug (零回归)

### storage.ts (160 行) — 审查结论
- **路径穿越**: readChapterTxt 已修(line 53 path.sep suffix 防同级前缀绕过) ✓;
  saveChapterTxt 的 bookId 未消毒(line 31 path.join(NOVELS_DIR, bookId)) ❌ P1
  (虽然 Prisma cuid() 是字母数字安全, 但防御性 coding 要求); saveCoverWebp 的 name
  走 [^\w-] 剥离(line 76) + basename, readCover 走 basename(line 105) 都安全 ✓;
  downloadTxtTarget 走 [/\\:*?\"<>|\s] 剥离, 防止 ../ + 路径分隔符(空名走 fallback) ✓
- **原子性**: saveChapterTxt 用 fs.writeFile 非原子(进程崩溃/磁盘满→半成品文件被公共 API
  读取到损坏内容) ❌ P1; openDownloadTxtWriter 用 fs.open('w') 非原子但有 abort() 半成品清理 ✓
- **冗余**: readCover line 107 `if (!full.startsWith(COVERS_DIR))` 是死代码(basename 已保证安全),
  但无害(永远 true) ✓

#### storage.ts 发现的 bug
- **P1 Bug S1**: saveChapterTxt bookId 未消毒 → 路径穿越理论风险(cuid() 安全但防御在源头)
- **P1 Bug S2**: saveChapterTxt 非原子写入 → 进程崩溃产半成品文件, 公共 API 读取损坏内容

### hostgate.ts (647 行) — 审查结论
- **SSRF 拒绝**: 模块不持 SSRF 责任(fetcher.assertSafeTarget 是唯一准入闸门), 本模块只导出
  IP 字面量归一化工具(normalizeIpLiteral: 十进制/八进制/十六进制 IPv4 编码 → 标准点分十进制) +
  私网判定(isPrivateIp: 私网/回环/链路本地/CGNAT/云元数据/0.0.0.0) ✓
- **DNS 重绑定**: 注释说明 verifyDnsStability 已移除(未消费), fetcher 用 resolveAllIps +
  assertSafeTarget 组合防 SSRF, 本模块不调 ✓
- **池管理**: 全局 Map + globalThis 单例防 HMR + LRU 1000 上限 + 惰性 sweep 每 100 调用 ✓
- **定时器**: gapTimer / penaltyTimer / waiter.timer 全 unref, 不阻进程退出 ✓
- **TOCTOU**: settleRateLimitExpiry 在 pump 入口跑 + acquire 入口也跑(双保险) ✓
- **barge 防护**: FIFO 队头自查余量+节流到点+非限流冷却期才准入, 不递给特定等待者 ✓
- **caller 换代**: minGapMsLastValue 检测新 caller(传入值与旧值不同)→ 重置不 MAX 合并 ✓
- **冷却到期回滚**: minGapMsBeforeCooldown 快照, settleRateLimitExpiry 回滚到 caller 实际值 ✓
- **hostGateReset**: R4-15 修复保留 — waiter.timer 显式 reject + clear 防 fire 后调已结束 awaiter ✓

#### hostgate.ts 未发现需修 bug (零回归)

### downloader.ts (240 行) — 审查结论
- **大文件下载内存**: generateBookTxt 用 openDownloadTxtWriter 流式落盘(原 parts 数组峰值消除);
  单章文本仍逐章内存处理(与原实现相同) ✓
- **断点续传**: 不支持(单文件生成, 失败 abort() 清半成品) ✓
- **超时**: 无显式超时, 走 db.book.findUniqueOrThrow + chapterPlainText(readChapterTxt 文件 IO) ✓
- **半成品清理**: try/catch 包 emit 流, 失败 writer.abort() 删半成品 ✓
- **混淆**: obfuscateText 码点安全(Array.from 迭代代理对) + density 钳 [0, 0.3] +
  homoglyph 仅替换 BMP 字符 ✓
- **adInterval 合法化**: Bug 20 修复保留 — 0=用户主动关, 正数 floor+max(1), 负数回退默认 10 ✓
- **并发同书互踩**: zz-d 修复保留 — Date.now()+random 后缀消解毫秒碰撞 ✓

#### downloader.ts 发现的 bug
- **P1 Bug D1**: writer.finish() 在 try 块外, 若 finish() 内 fh.close() 成功但 fs.stat 抛错
  (罕见: 文件被并发删 / 权限丢失 / 路径符号链接损坏)→ 半成品文件已落盘无 abort() 清理,
  后续重试同书下载 openDownloadTxtWriter 同名 fs.open('w') 截断该半成品, 但中间有读者
  /api/public/download 读到半成品损坏字节静默成功 → 用户拿到坏文件。修复: 包入 try/catch,
  失败主动 abort() 删半成品, 与 try 块 catch 路径同口径维持"失败即无文件"卫生语义。

### calibrate.ts (590 行) — 审查结论
- **SSRF 防御**: calibrateRule 入口 assertSafeTarget({allowLoopback:true}) 校验 siteBase ✓
- **取消响应**: sleepAbortable 200ms 切片 shouldAbort, throw CalibrateAbort ✓
- **deadline**: stageVerify 120s 截止(防死循环 R5-14) + chainUrls.length 早破(R5-14) ✓
- **probe 重试**: zz-a2 首档撞临时封禁期 → looksLikeBanResidue(403 占多数 + Retry-After)
  → 冷却后重探一次(每阶段至多一次) ✓
- **probe Fetch**: timeoutMs=0 走默认 10_000(R4-17), AbortController + clearTimeout 兜底 ✓
- **3xx 视为失败**: redirect:'manual' + 3xx 计 other(Bug 17 修复), 防源站主动跳转误判通过 ✓
- **0 status 视为异常**: ab-c 修复保留 — 网络错误/5xx/路径 404 计 other, 防源站宕机虚高极限梯 ✓
- **首档韧性**: banEscalated(410 永久封禁)提前终止, firstFail 提前终止, 输出最保守配置 ✓
- **回退验证**: v1 失败 → 回退一档(并发-1+间隔×1.3)再验一次 ✓
- **档位一致性**: zz-a3 resetBefore 后读 /stats.profile 与请求档位比对, 不一致提示 ✓
- **CooldownAfterFail**: Retry-After 优先(上限 90s), 否则固定 8s ✓

#### calibrate.ts 发现的 bug
- **P2 Bug CL1**: probeFetch 用 `await res.text()` 把整个响应体读进内存后丢弃; probe 仅需
  状态码 + Retry-After 头, 真实源站(非模拟 mock)返回大页面(几 MB+)时无意义占内存且拖慢
  探测节奏, 万章校准对全 size 站跑 60+ probe 时内存峰值可达数百 MB。修复: 改用
  ReadableStream.cancel() 释放流(whatwg-fetch / undici 均支持), 不把 body 拼成字符串;
  cancel 不可用(老 polyfill)时回退 res.text() 保持兼容。

### types.ts (1247 行) — 审查结论
- **类型安全**: 大量 Record<string, unknown> + 白名单枚举校验, unknown → 具体类型走 sanitize 链 ✓
- **any 使用**: 仅在 cheerio/xmldom interop 边界(node: any 类型)使用, 不可避免(第三方类型
  缺失) ✓
- **deep sanitize**: parseRuleConfig + sanitizeFieldRule/PageRule/FetchConfig/CleanConfig 全
  字段白名单重建, 未知键全丢弃 ✓
- **safeNum/safeBool/safeStr/safeSingleLine/safeHeaderKey/safeStrArr**: 类型消毒 + 长度钳制 +
  CR/LF/NUL 剥离 + HTTP smuggling 头拒绝(host/content-length/transfer-encoding 等) ✓
- **HEADER_KEY_DENYLIST**: R4-22 拒 smuggling 向量头 + R5-15 拒代理识别头(via/forwarded/
  x-forwarded-*/x-real-ip 等) ✓
- **正则安全审查**: hasNestedQuantifier + groupHasUnboundedTail + branchesHavePrefixAmbiguity
  + validateRegexSafety + collectRegexIssues 覆盖 4 入口(FieldRule.expression / replaceFrom /
  tokenPattern / adPatterns) ✓
- **regex 编译试错**: validateRegexSafety 先 new RegExp 编译试错, 非法 → 拒绝 + reason ✓

#### types.ts 发现的 bug
- **P2 Bug T1**: safeStr 用 `v.slice(0, max)` 按 UTF-16 code unit 截断, astral 字符(emoji/
  CJK 扩展)占 2 code unit 的代理对被拦腰斩半产出 lone surrogate, 存 DB 后读出显示 U+FFFD;
  规则配置中含 astral 字符的字段(如 UA 含 emoji)被截断后入库即损坏。修复: Array.from
  按码点迭代后 slice, 永不切断代理对(与 cleaner/storage 同名做法一致)。纯 ASCII / BMP
  字符零回归(每字符 1 code unit = 1 码点)。
- **P2 Bug T2**: safeStrArr 同款问题(line 596 `x.slice(0, maxLen)`), 修复同 safeStr。

## 第三步: 修复 + 增强(只改 5 个剩余 crawl 模块)

### 1. cleaner.ts (687 → 696 行, +9 行)
- **P1 修复①**: 4 个零宽字符剥离出口追加 U+2060 (Word Joiner), 与 downloader.ZW_CHARS 同口径,
  防 obfuscator 产出的 U+2060 在被重清洗时漏网(原集仅含 U+200B/C/D + U+FEFF, 缺 U+2060);
  也防部分反爬水印使用 U+2060 (比 U+200B 更隐蔽)注入书名/作者后被原样落库。
  - cleanContentHtml plainText 分支 (line 212): `[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D\u2060\uFEFF]`
  - cleanContentHtml HTML 分支 (line 461): 同款
  - cleanTextField (line 569): `[\u200B-\u200D\u2060\uFEFF]`
  - cleanIntro (line 608): 同款
  - 4 处都加 R26-1A 注释说明

### 2. storage.ts (160 → 184 行, +24 行)
- **P1 修复①**: saveChapterTxt bookId 路径穿越防御 — 新增 safeBookId 计算:
  `String(bookId || '').replace(/[\\/\x00\s.]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown_book'`,
  剥除路径分隔符(\\ /) + NUL + 空白 + 点号(.)防 `..` 父目录指针; 防御性 coding 即使
  Prisma cuid() 是字母数字安全也要求(防御在源头, 不依赖 caller 传值合规)。
- **P1 修复②**: saveChapterTxt 原子写入 — 改为先写 .tmp 临时文件再 fs.rename:
  `tmpPath = ${filePath}.${process.pid}.${Math.floor(Math.random()*1e9)}.tmp`,
  fs.rename 在 POSIX 同文件系统上是原子的(inode 替换), 中间任何时点读者看到的都是
  【旧完整文件】或【新完整文件】之一, 永远看不到半成品。临时文件名加 PID+随机段防并发同
  章节写入互踩(同一本书同章节并发采集场景)。catch 块主动 fs.unlink(tmpPath) 防泄漏。
- **P2 增强①**: saveCoverWebp fallback 加随机段 — 原 `cover_${Date.now()}` 改为
  `cover_${Date.now()}_${Math.floor(Math.random()*9999)}`, 与 caller runner.ts:1235 同款
  做法(防并发同毫秒空名碰撞)

### 3. downloader.ts (240 → 252 行, +12 行)
- **P1 修复①**: writer.finish() 包入 try/catch — 原实现把 finish() 放在 try 块外,
  finish() 内 fh.close() 已成功(文件句柄关)但 fs.stat(filePath) 抛错(罕见: 文件被并发删 /
  权限丢失 / 路径符号链接损坏)时, 半成品文件已落盘且无 abort() 清理, 后续重试/重发同书下载
  时 openDownloadTxtWriter 同名 fs.open('w') 会截断该半成品, 但若中间有读者
  /api/public/download 读到该半成品, 则成品损坏且静默成功(坏字节给到用户)。
  现失败时主动 abort() 删半成品(与 try 块 catch 路径同口径), 维持"失败即无文件"卫生语义。

### 4. calibrate.ts (590 → 600 行, +10 行)
- **P2 增强①**: probeFetch 改用 ReadableStream.cancel() 释放响应体连接 — 旧行为
  `await res.text().catch(() => '')` 把整个响应体读进内存后丢弃; 真实源站(非模拟 mock)
  返回大页面(几 MB+)时无意义占内存且拖慢探测节奏, 万章校准对全 size 站跑 60+ probe 时
  内存峰值可达数百 MB。probe 仅需状态码 + Retry-After 头, 改用 cancel() 释放流(whatwg-fetch
  / undici 均支持), 不把 body 拼成字符串; cancel 不可用(老 polyfill / body 为 null)时回退
  res.text() 保持兼容。

### 5. types.ts (1247 → 1257 行, +10 行)
- **P2 修复①**: safeStr 码点安全截断 — 原 `v.slice(0, max)` 按 UTF-16 code unit 截断,
  emoji/CJK 扩展等 astral 字符(占 2 code unit 代理对)被拦腰斩半产出 lone surrogate, 存 DB
  后读出显示 U+FFFD(乱码); 规则配置中含 astral 字符的字段(如 UA 含 emoji)被截断后入库即损坏。
  改用 `Array.from(v).slice(0, max).join('')` 按码点迭代后 slice, 永不切断代理对。
  纯 ASCII / BMP 字符零回归(每字符 1 code unit = 1 码点)。
- **P2 修复②**: safeStrArr 同款问题修复 — `x.slice(0, maxLen)` →
  `Array.from(x).slice(0, maxLen).join('')`, 与 safeStr 同口径。

## 第四步: 验证
- `cd /home/z/my-project && bun run lint` → 0 errors / 0 warnings exit 0 ✓
- `cd /home/z/my-project && bunx tsc --noEmit` → 0 errors in 改动文件 ✓
  (残留 tsc 错误均不在改动范围: .next/dev/types/app/api/public/mini-service-config/route.ts
  自动生成文件的 invalidateMiniServiceConfigCache 不兼容 index signature 问题 — 预存在,
  与本次审查的 8 个 crawl 模块无关; examples/websocket / skills/* 预存在错误也排除)
- dev server log: 全部 200 OK, fetcher 活跃采集 apibi.cc/api/chapter ✓

## 第五步: 修改文件清单
1. `src/lib/crawl/cleaner.ts` (687 → 696, +9) — 4 个零宽字符剥离出口追加 U+2060
2. `src/lib/crawl/storage.ts` (160 → 184, +24) — bookId 路径穿越防御 + 原子写入 + 封面 fallback 随机段
3. `src/lib/crawl/downloader.ts` (240 → 252, +12) — writer.finish() 包 try/catch 防半成品泄漏
4. `src/lib/crawl/calibrate.ts` (590 → 600, +10) — probeFetch 改用 ReadableStream.cancel() 释放连接
5. `src/lib/crawl/types.ts` (1247 → 1257, +10) — safeStr + safeStrArr 码点安全截断
合计 +65 行, 涉及 5 文件, 其余 3 文件 (parser.ts / sorter.ts / hostgate.ts) 审查后零回归未改。

## 不修改(尊重约束)
- src/lib/crawl/fetcher.ts / obscura.ts / runner.ts (R25-1A2/A3 已审查)
- src/lib/crawl/themes.ts / suggest.ts / smart.ts (R25-1D2 已审查)
- src/lib/crawl/rule-templates.ts (规则模板, 不在审查范围)
- src/components/public/* (前端)
- src/app/page.tsx / PublicSite.tsx (主控已改)
- src/app/api/* (API 路由)
- mini-services/* (mini 服务)
- prisma/schema.prisma (schema)
- package.json (0 新依赖)

## 历史修复保留(确认无回归)
- R11-1A cleaner 零宽字符剥离 + 水印段落识别 + 章首/章末剥离 ✓
- R17-1A cleaner 段落规整增强 + 段首缩进规整 + 段间空行压缩 ✓
- R-CRAWL-FINAL cleaner 字面 \n → 真实换行 + 实体单遍解码 ✓
- R-E5 cleaner 内置额外广告/弹窗/友链选择器 + EXTRA_AD_PATTERNS 文案 ✓
- R3-25 cleaner img[src] 白名单放行(原剥光导致正文插图全裂) ✓
- R3-26 sorter normalizeUrlKey 用 url.origin 代替 host(归一默认端口) ✓
- R3-27 storage 标题强制单行(剥 \r\n 为单空格) ✓
- Bug 21 storage 按码点截断文件名(Array.from 防 astral 代理对斩半) ✓
- Bug 16 sorter URL 去重 query 排序(防 ?a=1&b=2 vs ?b=2&a=1 漏判) ✓
- Bug 15 cleaner <br><br>→</p><p> 替换前用 <p>...</p> 包裹(防不配对) ✓
- Bug 7 calibrate Retry-After HTTP-date 形态解析(原 parseFloat 仅秒数) ✓
- Bug 17 calibrate 3xx 视为失败(redirect:'manual' 下源站主动跳转=挑战页) ✓
- R4-17 calibrate timeoutMs=0 不立即 abort(用 || 短路防 0 ?? 10_000 = 0) ✓
- R5-11 calibrate aborted 后不再回调 onProgress(防脏数据进已关闭 job) ✓
- R5-14 calibrate stageVerify 120s deadline + chainUrls.length 早破防死循环 ✓
- R4-22 types HEADER_KEY_DENYLIST 拒 smuggling 向量头 ✓
- R5-15 types 追加 via/x-forwarded-*/x-real-ip 等 Caddy/代理识别头 ✓
- gg-a types 正则安全审查 hasNestedQuantifier + branchesHavePrefixAmbiguity + validateRegexSafety ✓
- ee-d types safeSingleLine 剥 CR/LF/NUL 控制字符(防 HTTP 请求走私/断链) ✓
- R4-15 hostgate hostGateReset 显式 reject 所有 waiter + clear timer 防 fire 后调已结束 awaiter ✓
- R6-2 hostgate caller 换代时同步 minGapMsBeforeCooldown 快照(防回滚到旧 caller 值) ✓
- zz-a2 calibrate 首档撞临时封禁期重探一次(looksLikeBanResidue) ✓
- zz-a3 calibrate 档位一致性提醒(resetBefore 后读 /stats.profile 比对) ✓
- zz-b hostgate 限流冷却 + minGapMs 节流双维独立生效 ✓
- audit C-zz hostgate LRU 1000 上限 + 惰性 sweep + evictIdleHosts ✓
- agent-N parser JSON 联合 || + 递归下降 .. + JSONPath filter ?(@.field==value) + map-collect ✓
- agent-N parser defaultValue 兜底 + required 必填校验 + extractMultiple 多值提取 ✓
- cc-c parser 数组上非数字段 map-collect(展平一层) + [k=v] 过滤 + * 递归展平 ✓
- Bug 20 downloader adInterval 合法化(0=用户主动关, 正数 floor+max(1), 负数回退默认) ✓
- zz-d downloader 并发同书互踩(Date.now+random 后缀消解毫秒碰撞) ✓
- qq-e downloader 卷头判重基准改为 lastEmittedVolume(防空卷名章节重置基准) ✓

## 已知限制(如实记录, 非本次范围)
- parser.ts findReadableContent: $el.find('a').each O(n×m) 嵌套遍历, 病态大页面可能慢,
  但评分阈值≥200+linkDensity<0.5 早剪枝, 实际不构成 DoS 面
- parser.ts applyTransform chunked regex 切片 200 字符, 跨 chunk 边界匹配会漏(文档已说明);
  setTimeout 哨兵不能真正中断同步 JS, 真正防护靠长度+嵌套量词闸门 + 同步路径≤200
- hostgate.ts settleRateLimitExpiry 用 Date.now() 两次(line 466+461), 微秒级 TOCTOU 不构成
  真实问题
- hostgate.ts 报告 rateLimitedUntil 重复调用时, 仅在「未在冷却」时保存快照, 已在冷却时
  不覆盖快照(R5-3 修复) ✓
- types.ts safeStr + safeStrArr 码点安全截断后, lone surrogate 不再产生; 但 v 本身若已含
  lone surrogate(JSON.parse 可容), Array.from 会保留为单码点输出, 不修复历史脏数据
- storage.ts saveChapterTxt 原子写入依赖 fs.rename 同设备原子性; 跨设备 rename 会 fallback
  到 copy+unlink(非原子), 但本场景 filePath 与 .tmp 同目录同设备, 安全

## 验证
- bun run lint 0 errors / 0 warnings ✓
- bunx tsc --noEmit 0 errors in 改动文件 ✓ (排除 .next 自动生成 + examples + skills 预存在)
- dev server 200 OK, fetcher 活跃采集 apibi.cc/api/chapter ✓

## 总结
- 5436 行 8 文件全量逐段审查完成
- 3 个 P1 bug 修复(cleaner U+2060 / storage bookId+原子写 / downloader finish 清理)
- 4 处 P2 增强(calibrate 流释放 / types 码点安全截断×2 / storage 封面随机段)
- 历史修复全部保留(零回归确认)
- 修改文件: 5 个(cleaner/storage/downloader/calibrate/types), +65 行
- 未修改(审查后零回归): 3 个(parser/sorter/hostgate)
