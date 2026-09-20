# R35-1B 采集第九轮深度抓bug 工作记录

## 1. 读交接(worklog.md 最后 200 行)

- R34-1B P1×1+P2×2 全保留: runner TXT 段落粘连(</p>→\n\n) + trafilatura plainText 分流 + 空白文本边缘(segments.length===0 保留原 cleaned)
- R34-1A 内存优化 + R34-1C 清理精简均与本轮正交
- 八轮深度审查后无 P0, R25-R33 历史修复全保留

## 2. 第九轮深度审查(11 模块 + API 路由)

### 2.1 fetcher.ts 第九轮(5209 行)
- 8 级降级链 native→curl→curl-impersonate-bridge→fetch-relay→scrapling-static→scrapling-stealthy→Obscura→uc-bridge→moli-bridge + cloak-browser opt-in 全保留 ✓
- R33-1B setCookies 透传(fetchViaCurlImpersonateFallback try/catch + cookieJar.store 在 rethrow 前)全保留 ✓
- CookieJar 主罐键 hostname format(R31-1D)+ 父域链合并 + 副罐安全校验 + ATTR_NAMES 过滤 + src 字段精确 clear 全保留 ✓
- SSRF 守卫(assertSafeTarget + 8 端口白名单 3010~3019 + loopbackBypassAllowed tokenUrl/contentProxyUrl/relay/bridge 同口径豁免)全保留 ✓
- 代理池(markProxyFailed 指数退避 + markProxySucceeded EWMA + cascadeState 10s 窗口 3 失败熔断 + weighted-rr + geo 同地域 tie-breaker)全保留 ✓
- 会话人格(derivesersonality viewport/timezone/language 三维钉扎 + maybeRotateFingerprint 每 N 请求清空钉扎表)全保留 ✓
- 响应缓存 + In-flight 去重 + globalRateLimitPerMin + thinkTimeMs + adaptiveRateLimit + perHostConcurrency 全保留 ✓
- hostDispatcher per-host undici Agent(keep-alive 30s + 100 origin FIFO + 5min 空闲回收)全保留 ✓
- 审查结论: fetcher 无 P0/P1, R33-1B 后无回归

### 2.2 obscura.ts 第九轮(1767 行)
- 页面池(默认 2 并发, OBSCURA_CONCURRENCY env 钳 [1,8])+ 同域复用 + 跨域销毁重建 ✓
- E5 心跳回收(60s 扫描 + 10min 未用 close ctx 保留 slot) + R25-1A3 竞态修复(busy=true 锁定 + finally 恢复)全保留 ✓
- R3-17 consecutiveFailures 3 次移除槽位 + 触发重探测全保留 ✓
- R28-1C cookie 回写(cookieProvider 注入 + restoreCookiesToContext + parseCookieHeaderToPlaywright ATTR_NAMES 过滤)全保留 ✓
- hh-d2 CDP Network.setUserAgentOverride + userAgentMetadata + buildIdentityInitScript 按 UA 参数化(chromium 家族 brands/mobile/platform/WebGL GPU 全自洽)全保留 ✓
- 15 个 stealth 静态脚本(webdriver/window.chrome/plugins/languages/WebGL/canvas/permissions/battery/screenPos/audio/speech/mediaDevices)+ per-context 动态脚本(locale/screen/hardware/screenX)+ 3-tier stealth(lite/standard/maximum)+ maximum 加 OfflineAudioContext 噪声全保留 ✓
- E2 挑战等待循环(looksLikeChallenge + isChallengeUIVisible + tryClickTurnstile 跨域 iframe + challengeWaitMs 40s 上限 + 超时不抛错返回当前态由 looksBlocked 降级)全保留 ✓
- 审查结论: obscura 无 P0/P1

### 2.3 runner.ts 第九轮(2721 行, R34-1B 修复后边界)
- R31-1B 三阶段并发架构(Semaphore + crawlBookMeta + crawlChapterContent + finalizeBook)全保留 ✓
- R32-1A failedBookUrls 三路径对称(add: isFetchTimeout/HostGateTimeout/other 三分支; delete: skip-completed/crawlBookMeta ok 跳过/finalizeBook)全保留 ✓
- R33-1B bridgeUrl 透传(useTrafilatura=true 走 cleanContentHtmlAsync 透传 + trafilaturaFallback=true 兜底透传 tryTrafilaturaExtract)全保留 ✓
- **R34-1B P1 ① runner TXT 段落保真(line 2296-2301)全保留**: </p>/<div|h[1-6]|li|tr> → \n\n + <br> → \n + <[^>]+> 剥剩余 inline + \n{3,}→\n\n. 实测 cheerio HTML `<p>seg1</p><p>seg2</p><p>seg3</p>` → TXT `seg1\n\nseg2\n\nseg3\n\n` → 公开 read API split /\n{2,}/ → 3 个 <p> ✓
- **R34-1B P2 ② trafilatura 兜底分流 cfg.plainText(line 2261-2278)全保留**: plainText 模式 → segments.join('\n\n') + 控制字符剥离; HTML 模式 → <p>seg</p> + <>& escape. 与 cleanContentHtmlAsync(line 1017-1053)同款分流 ✓
- **R34-1B P2 ③ trafilatura 兜底空白文本边缘(line 2264-2266)全保留**: segments.length===0 → 不采纳, 保留原 cleaned, warn 日志提示 ✓
- **发现 P2 bug**: trafilatura 兜底 "生效" 日志位于 if/else if/else 链之后无条件打出, segments.length===0 分支已显式不采纳却仍打 "生效" 误导运维(详见修复③)
- 审查结论: runner R34-1B 修复后无 P0/P1, 1 个 P2 日志位置 bug

### 2.4 cleaner.ts 第九轮(1096 行, trafilatura 三层降级)
- cleanContentHtml(同步 cheerio 链): script/style/noscript/iframe/object/embed 剥壳 + removeSelectors + EXTRA_AD_SELECTORS + 白名单剥壳 + 属性消毒 + 1.8 乱序段落重排 + normalize + 5.5 段首缩进规整 + 6 首末段水印剥离 + 控制字符/零宽字符剥离全保留 ✓
- callTrafilaturaExtract(桥调用): 60s 可用性缓存 + 10MB 上限 + R33-1B bridgeUrl 自定义 URL 跳过缓存直接尝试 + 默认 URL 复用缓存 ✓
- tryTrafilaturaExtract(兜底入口): R33-1B bridgeUrl 透传 + 自定义 URL 不走缓存 ✓
- cleanContentHtmlAsync(useTrafilatura=true 先模式): trafilatura 提取 → t2sHtml + decodeEntitiesOnce + removeAdLines + 段落规整(\n+ split) → plainText(\n\n) 或 HTML(<p>seg</p>) + 首末段水印剥离 + 控制字符剥离 ✓
- **发现 P1 bug**: cleanContentHtmlAsync plainText 分支(line 1017-1034 修前)漏 segments.length===0 守卫 —— HTML 分支(line 1046)有此守卫降级回 cheerio, plainText 分支直接 split.map.filter.join 产空串 return '' 致 caller runner.ts line 2223 cleaned='' 章节内容静默丢失(详见修复②)
- contentPlainTextLength(html.replace(/<[^>]+>/g, '').trim().length)与 runner line 2276 同口径 ✓
- 审查结论: cleaner 有 1 个 P1 bug(plainText 空段降级缺失)

### 2.5 types.ts 第九轮(1363 行)
- FetchConfig.concurrency 钳 [1,10](line 308)+ sanitize safeNum [1,10](line 978)✓
- trafilaturaBridgeUrl 字段定义(line 264)+ sanitize http(s) URL + ≤300 + 单行化(line 930-934)✓
- useTrafilatura/trafilaturaPruneXPath/trafilaturaFallback CleanConfig 三字段定义齐全 ✓
- 审查结论: types.ts 无 P0/P1

### 2.6 sorter.ts 第九轮(385 行)
- reorderToc 去重 + 分卷上下文检测 + 重排 + reorderWithVolumes 分卷感知全保留 ✓
- extractChapterNo 多模式(中文/阿拉伯/罗马/混合)+ extractVolumeAnchor 卷锚点识别 + normalizeUrlKey 用 url.origin + 排序 query 参数全保留 ✓
- 审查结论: sorter 无 P0/P1

### 2.7 storage.ts 第九轮(196 行)
- saveChapterTxt: R26-1A P1 bookId 清洗 + 原子写入(.tmp+rename, PID+random)+ 标题强制单行(R3-27)全保留 ✓
- readChapterTxt: startsWith(DATA_ROOT + path.sep) sibling-prefix 加固 ✓
- deleteBookTxt: R33-1B P1④ bookId 清洗(与 saveChapterTxt 同款)✓
- readCover: R33-1B P2⑤ startsWith(COVERS_DIR + path.sep)加固 ✓
- openDownloadTxtWriter: 流式写入 + abort 卫生 ✓
- 审查结论: storage 无 P0/P1

### 2.8 hostgate.ts 第九轮(647 行)
- 计账式闸门 + FIFO 无 barge(pump 队头自查 limit-inFlight>0)✓
- 降额/回升(3 连败降一档 + 10 连胜回一档 + 60s 冷却 penaltyUntil)✓
- 速率节流(zz-b minGapMs 跟随最近 acquire + R4-14 minGapMsLastValue caller 换代重置 + R5-3 minGapMsBeforeCooldown 冷却到期回滚)✓
- 限流冷却(zz-b rateLimitedUntil + Retry-After 缺省 30s 上限 120s + ab-b 抛错路径透传 retryAfterMs)✓
- LRU 治理(HOSTS_CAP=1000 + sweepIdleHosts + evictOneIdleHost + SWEEP_EVERY=100)✓
- hostGateReset(R4-15 waiter.timer 清 + reject)✓
- 审查结论: hostgate 无 P0/P1

### 2.9 downloader.ts 第九轮(252 行)
- generateBookTxt 流式写入(openDownloadTxtWriter 逐段 append)✓
- 中途失败 abort()(删半成品)✓
- finish() 失败也 abort()(R26-1A P1)✓
- adInterval=0 显式关广告(Bug 20)✓
- 卷头判重 lastEmittedVolume(qq-e 空卷名不重置基准)✓
- ZW_CHARS 含 U+2060(line 50)✓
- stripHtmlToText 用 decodeEntitiesOnce(qq-e2 单遍解码防链式二次解码)✓
- 审查结论: downloader 无 P0/P1

### 2.10 calibrate.ts 第九轮(598 行)
- 三阶段探测(并发梯 1→10 + 间隔梯 2000→150ms + 验证档)✓
- SSRF 守卫(R4-16 引擎侧也校验 siteBase, allowLoopback=true 放行模拟源站)✓
- 韧性重试(zz-a2 首档撞封禁期冷却后重探, looksLikeBanResidue 403 多 + Retry-After)✓
- 死循环防护(R5-14 stageVerify 120s 截止 + chainUrls 取尽 break)✓
- probeFetch 响应体 cancel()(R26-1A P2)✓
- 3xx 视为失败(Bug 17, 与 probeLevel/stageVerify 同口径)✓
- 审查结论: calibrate 无 P0/P1

### 2.11 fetcher-curl-impersonate.ts 第九轮(389 行)
- checkCurlImpersonateBridge 60s 缓存 + 5min 永久失败窗口(curlCffiAvailable=false)✓
- 流式读 + 计数 CURL_IMPERSONATE_MAX_JSON_BYTES=20MB ✓
- 桥响应形态校验 ok:true/false/非 200 三路径 ✓
- bodyB64 解码 + 上限校验 ✓
- WAF 头透传 server/cf-ray/cf-mitigated/retry-after ✓
- R33-1B setCookies 透传(throw 前赋值 err.setCookies)✓
- 审查结论: 无 P0/P1, R33-1B 后无回归

### 2.12 API 路由深度审查(admin + public 鉴权/参数校验)
- admin/books POST/GET: name 非空 + categoryId 存在性 + status 白名单 + sourceUrl httpUrl 校验 + storageMode strict/lenient 区分 + P2003 外键竞态 → 409 ✓
- admin/books/[id] GET/PUT/DELETE: 全字段校验 + storageMode strict(非 db/txt → 400) + sourceUrl httpUrl + FK 竞态 P2003→409/P2025→404 ✓
- admin/chapters/[id] GET/PUT/DELETE: 内容 500K 上限 + cleanContentHtml 消毒 + txt 原子写入(.tmp+rename)+ path.sep 边界 + P2025→404 ✓
  **发现 P1 bug**: PUT 行 75 `</p>` → `\n` 单换行, 公开 read API split /\n{2,}/ 期望 \n\n, admin 编辑后 TXT 章节整章压成单个 <p>(详见修复①)
- public/chapter GET: id str(64) + page clampInt + site 配置分页(byWords/byPages/off) + txt 内容 splitParagraphs(/\n{2,}/ 分段)+ 实体转义 + withCache 60/120 ✓
- public/books/book/cover/search/sitemap/keyword/sites/tags/categories/links/related/download/feedback/mini-service-config: 全部经 withGuard + str/clampInt/likeSafe 参数消毒 + LIKE 通配符过滤 ✓
- admin/rules POST/PUT/test/batch/calibrate/calibrate-all: 规则 JSON 经 parseRuleConfig + sanitize 全白名单重建 + validateRegexSafety 防 ReDoS ✓
- admin/tasks control/start/pause/stop + snapshot/logs/failed-books: serializeStatusWrite 串行化 + epoch 漂移 + control 30s 超时 + unref timer ✓
- admin/downloads/backup/restore/stats/seo-audit/settings/themes/sites/categories: withGuard + 文件路径 safeJoin(path.sep 边界)✓
- auth/login/logout/check: NextAuth + cookie httpOnly + CSRF token ✓
- 审查结论: API 路由有 1 个 P1 bug(admin chapters PUT 段落粘连)

## 3. 特别关注项验证(R34-1B 修复后的边缘)

### 3.1 R34-1B P1 ① runner TXT 段落保真
- cheerio HTML `<p>seg1</p><p>seg2</p><p>seg3</p>` → TXT `seg1\n\nseg2\n\nseg3\n\n`
- 公开 read API split /\n{2,}/ → [seg1, seg2, seg3] → 3 个 <p> ✓
- 嵌套 inline 标签 `<p><em>seg1</em></p><p>seg2</p>` → `seg1\n\nseg2\n\n` ✓
- 段内 <br> `<p>line1<br>line2</p><p>next</p>` → `line1\nline2\n\nnext` (段内 \n + 段间 \n\n) ✓
- **下游 bug 发现**: admin/chapters/[id]/route.ts PUT 行 75 用 `</p>` → `\n` 单换行(与 runner R34-1B \n\n 不一致) → admin 编辑后 TXT 章节经公开 read API 整章压成单个 <p>(详见修复①)

### 3.2 R34-1B P2 ② trafilatura plainText 不分流
- runner.ts line 2261-2278 分流 plainText(\n\n)/HTML(<p>seg</p>)全保留 ✓
- **下游 bug 发现**: cleanContentHtmlAsync plainText 分支(line 1017-1034 修前)漏 segments.length===0 守卫 —— trafilatura 返回全空白时 plainText 分支产空串 return '' 致章节内容丢失(详见修复②)

### 3.3 R34-1B P2 ③ trafilatura 空白文本边缘
- runner.ts line 2264-2266 segments.length===0 不采纳保留原 cleaned ✓
- **下游 bug 发现**: "兜底生效" 日志在 if/else if/else 链后无条件打出, 空段分支已不采纳却仍打 "生效" 误导运维(详见修复③)

## 4. 修复(P1×2 + P2×1, 共 ~+35 行净增)

### 4.1 P1 ① admin/chapters/[id]/route.ts PUT 块级闭合标签 \n → \n\n(line 75-83)
修前: `</p>/<div|h[1-6]|li|tr>` → `\n` 单换行. 与 runner.ts R34-1B `</p>` → `\n\n` 双换行不一致. 公开 read API(public/chapter/route.ts line 103 split /\n{2,}/)期望段间 \n\n, 单 \n 致 admin 编辑后 TXT 章节整章压成单个 <p>(段落结构丢失, 前台阅读体验破坏).

修后: 对齐 runner.ts R34-1B 用 `\n\n`(段落分隔), <br> 仍用 \n(段内换行, 不变). 零回归: admin GET 仅 split('\n').slice(1).join('\n') 不在乎 \n vs \n\n, \n\n 在 admin 编辑器 textarea 显示为空行可读性更佳. 实测:
- HTML `<p>seg1</p><p>seg2</p><p>seg3</p>` → `seg1\n\nseg2\n\nseg3` → 公开 read 3 个 <p> ✓
- HTML with <br> `<p>line1<br>line2</p><p>next</p>` → `line1\nline2\n\nnext` → 公开 read 2 个 <p>(<br> 段内 \n 保留)✓
- plainText `seg1\n\nseg2\n\nseg3`(无标签)→ 幂等, 仍 3 段 ✓
- 嵌套 inline `<p><em>seg1</em></p><p>seg2</p>` → `seg1\n\nseg2` → 2 个 <p> ✓

### 4.2 P1 ② cleaner.ts cleanContentHtmlAsync plainText 分支补空段降级守卫(line 1014-1047)
修前: plainText 分支(line 1017-1034 修前)直接 split.map.filter.join, 未先验 segments.length===0. HTML 分支(line 1046)有此守卫降级回 cheerio, plainText 分支漏同款守卫. 桥返回全空白(段落分类全 reject 后输出 ' \n ' 等)时 split+filter 产空数组, join('') 产空串, 函数 return '' 致 caller runner.ts line 2223 `cleaned = await cleanContentHtmlAsync(...)` cleaned='' 章节内容静默丢失.

修后: 两分支共用 segments 计算, 统一走 segments.length===0 降级回 cheerio(cleanContentHtml(raw, cfgOverride)). 零回归: 空白桥输出本就无内容可采, 降级 cheerio 链拿原始 parseContent 结果, 与 HTML 模式同口径不丢章节内容. 实测:
- trafilatura ' \n ' (空白)→ 降级 cheerio `<cheerio>原始内容</cheerio>` ✓
- trafilatura '段落一\n段落二' (正常)→ `段落一\n\n段落二` ✓
- trafilatura '' (空串)→ 降级 cheerio ✓

### 4.3 P2 ③ runner.ts trafilatura 兜底生效日志位置(line 2258-2282)
修前: "兜底生效" 日志位于 if/else if/else 链之后无条件打出. segments.length===0 分支已显式不采纳(保留原 cleaned)却仍打 "生效" 误导运维.

修后: 用 trafilaturaAdopted 标志, 仅在真正采纳(else if/else 分支)时打 "生效", 空段分支只打 "不采纳". 口径与 cleanContentHtmlAsync line 1046 "降级回 cheerio" 同向(runner 兜底路径保留原 cleaned 而非降级 cheerio, 但 "不采纳" 语义一致). 零回归: 正常路径(非空段)日志不变, 仅空段路径少打一条误导日志.

## 5. 验证

- bun run lint → 0 errors ✓
- bunx tsc --noEmit → 0 errors in src/ ✓ (排除 examples/skills/.next 预存在)
- dev.log → Next.js 16.1.3 ready, 无报错, GET / 200 in ~30ms ✓
- R35-1B 段落保真回归测试(node 实证):
  - admin PUT HTML `<p>seg1</p><p>seg2</p><p>seg3</p>` → `seg1\n\nseg2\n\nseg3` → 公开 read 3 个 <p> ✓
  - admin PUT HTML with <br> `<p>line1<br>line2</p><p>next</p>` → `line1\nline2\n\nnext` → 公开 read 2 个 <p>(<br> 段内 \n 保留)✓
  - admin PUT plainText `seg1\n\nseg2\n\nseg3` → 幂等 → 3 段 ✓
  - admin PUT 嵌套 inline `<p><em>seg1</em></p><p>seg2</p>` → `seg1\n\nseg2` → 2 段 ✓
  - admin PUT 散乱 <br><br> `<p>段一</p><br><br><p>段二</p>` → `段一\n\n段二` → 2 段 ✓
  - cleaner plainText 空白 ' \n ' → 降级 cheerio(内容保留)✓
  - cleaner plainText 正常 '段落一\n段落二' → `段落一\n\n段落二` ✓
  - cleaner plainText 空串 '' → 降级 cheerio ✓

## 6. 修改文件清单

3 个文件, ~+35 行净增:
- src/app/api/admin/chapters/[id]/route.ts (+7 行净增): PUT bodyText 块级闭合标签 \n→\n\n(P1 ①)
- src/lib/crawl/cleaner.ts (+12 行净增): cleanContentHtmlAsync plainText 分支补空段降级守卫(P1 ②)
- src/lib/crawl/runner.ts (+16 行净增): trafilatura 兜底生效日志改用 trafilaturaAdopted 标志(P2 ③)

## 7. 历史保留 + 零回归 + 审查结论

- **无 P0 bug**: 第九轮深度审查 11 模块 + API 路由在 R25-R34 八轮修复后无 P0 问题. R34-1B P1×1+P2×2 修复全保留, R34-1A 内存优化 + R34-1C 清理精简均与本轮正交
- fetcher 8 级降级链 + R33-1B setCookies 透传 + CookieJar 父域链 + SSRF 8 端口白名单 + 代理池指数退避 + 会话人格三维钉扎 + 响应缓存/In-flight 去重 全保留 ✓
- obscura 页面池 + 心跳回收 + R3-17 consecutiveFailures + R28-1C cookie 回写 + hh-d2 CDP UA override + 15 stealth 脚本 + 3-tier 隐身 + E2 挑战等待 全保留 ✓
- cleaner trafilatura 三层降级 + 60s 缓存 + 10MB 上限 + bridgeUrl 透传 + plainText/HTML 分流 + 首末段水印剥离 ✓
- runner R31-1B 并发架构 + R32-1A failedBookUrls 三路径对称 + R33-1B bridgeUrl 透传 + R34-1B 段落保真 \n\n + split /\n+/ 全保留 ✓
- 历史修复全部保留(零回归): R25-1A2/R25-1A3/R26-1A/R27-1A/R27-1B/R28-1A/R28-1B/R28-1C/R29-1D/R30-1A/R31-1B/R31-1D/R32-1A/R33-1A/R33-1B/R33-1C/R34-1A/R34-1B/R34-1C 全部不动
- 未修改(尊重约束):
  - BookView/RankingView/FulltextView/SearchView/KeywordView (A agent 内存优化, 不动)✓
  - HomeView.tsx/page.tsx (R34-1A 已优化, 不动)✓
  - src/components/public/clone-themes/* (C agent R34-1C 清理, 不动)✓
  - prisma/schema.prisma + package.json(0 新依赖)✓
  - rule-templates/seed-rules (C agent 校准, 不动)✓
- 验证: bun run lint 0 errors ✓ / bunx tsc --noEmit 0 errors in src/ ✓ / dev.log Next.js 16.1.3 ready 无报错 ✓ / 段落保真回归测试 node 实证通过 ✓
