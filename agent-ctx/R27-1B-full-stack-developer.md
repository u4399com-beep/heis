# R27-1B 第二轮深度抓 bug + 边缘 case

## 任务范围
第二轮深度审查采集增强链的边缘 bug 与潜在问题:
1. **fetcher.ts** 第二轮: uc-bridge 失败兜底 + cookies 回写完整性 + 8 级降级链错误传播
2. **obscura.ts** 第二轮: 池管理并发安全 + Turnstile 8s 截止边界
3. **runner.ts** 第二轮: 任务调度竞态 + control() 30s timer 边界
4. **cleaner.ts** 第二轮: U+2060 剥离完整性 + 段落规整边界
5. **采集规则**: rule-templates.ts + seed-rule-*.ts 完整性/字段安全性
6. **API 路由**: src/app/api/admin/* + src/app/api/public/* 鉴权/越权/SQL 注入/参数校验

## 第一步: 读交接
读 worklog.md 末 200 行 + dev.log, 了解:
- R25-1A2 fetcher: 8 级降级链(native→curl→fetch-relay→scrapling-static→scrapling-stealthy
  →Obscura→uc-bridge→moli-bridge)+Referer 修复+sleepUnref+8 级端口白名单(3010~3017)
- R25-1A3 obscura 3 P1 (cookie domain 校验 + newStealthContext 资源泄漏 + recreateSlot
  consecutiveFailures 累加漏路径) + runner 2 P2 (raceTimer unref + waiter 30s 超时 unref)
- R26-1A cleaner/parser/sorter/storage/hostgate/downloader/calibrate/types 全量审查 + 3 P1
  +4 P2 (U+2060 剥离 + saveChapterTxt 原子写 + writer.finish try/catch + probeFetch cancel
  +safeStr 码点安全截断)

## 第二步: 第二轮深度审查(找边缘 bug)

### fetcher.ts 第二轮 (4600~4700 行 uc-bridge 段)
- **BUG P1-1 checkUcBridge 忽略 selfTestOk**: 协议规范 GET /health →
  `200 { ok:true, selfTestOk:bool, versions, ... }`, 修前实现只看 HTTP 状态码 `res.ok`,
  不解析 body。当桥进程在跑但 pyvirtualdisplay/xvfb 未装时 /health 返回 `200 + {ok:true,
  selfTestOk:false}`, checkUcBridge 误判为可用 → 每章节都调 /fetch 再失败("xvfb 启动失败")
  → dev.log 洪泛万级 warn 日志(万章任务实测 1 万次失败 warn), 拖慢采集 + 污染日志可观测性。
  ❌ P1
- **BUG P1-2 fetchViaUcBridge data.ok=false 不更新可用性缓存**: 当 /fetch 返回
  `{ ok:false, error:"xvfb(pyvirtualdisplay) 启动失败: No module named 'pyvirtualdisplay'" }`
  时, 实现仅 console.warn + return null, 不更新 ucBridgeAvailable(仍 true). 下次请求
  checkUcBridge() 短路返回 true, 直接调 /fetch 再失败 — 与 P1-1 同根因的洪泛。错误模式
  检测 + 永久失败缓存窗口可避免每请求重复撞桥。❌ P1
- **cookies 回写完整性 ✓**: line 1666 `cookieJar.store(originHost(url), res.cookies)`
  与 line 1687 `cookieJar.store(originHost(url), ucResult.cookies)` 同口径写回 CookieJar,
  下游 HTTP 引擎直连可凭其过盾(cf_clearance 跨子域合并由 R5-6/R6-5 已修).
- **8 级降级链错误传播 ✓**: fetchPageOnce 顶层按 cfg.fetchMode==='moli' 分流 →
  scraplingModeOf(cfg.fetchMode) 分流 → 通用 HTTP/浏览器升级链 → renderWithBrowser 内
  Obscura→uc-bridge→renderWithBrowserRaw(裸 Playwright) 三级浏览器降级. 每级返回 null
  → 继续降级, 目标侧 4xx/5xx 在 ok:true 信封内如实透传不双发. ✓
- **UC_BRIDGE_URL SSRF 守卫 ✓**: 桥 URL 由 env UC_BRIDGE_URL 配置(可信源), 桥内
  server.py 自带 SSRF 守卫(双重保险). fetchPage 入口 assertSafeTarget 已对目标 url
  校验, 抵达 fetchViaUcBridge 的 url 一定合法 http(s) 远程目标(非 loopback/私网/元数据). ✓

### obscura.ts 第二轮 (940~1700 行池管理 + Turnstile 段)
- **池管理并发安全 ✓**: R25-1A3 已修 recreateSlot consecutiveFailures 漏路径 +
  newStealthContext 资源泄漏 + scheduleReclaim 跨域槽位 race(slot.busy=true 临时锁定 +
  close().finally 恢复). 第二轮再查: withObscuraPage 信号量获取 + 30s waiter 超时 unref
  ✓, waiter TDZ 兜底(let resolver 占位先于 Promise 声明, 再赋值, 防 setTimeout 同步
  fire 时引用未初始化变量)✓, createSlot 失败 wakeNext 防等待者饿死 ✓, shutdownObscura
  shuttingDown 守卫防 orphan ctx/page ✓, scheduleReclaim 定时器 unref ✓.
- **Turnstile 8s 截止边界 ✓**: tryClickTurnstile line 1479 `deadline = Date.now()+8000`,
  循环内每 frame 检查 `if (Date.now() >= deadline) return` 早退(留时间给上层挑战循环复查),
  per-frame click 超时 `Math.min(1500, remaining)` 不超剩余预算. 主 frame URL 自身含
  cdn-cgi/challenge 时 isCfWidgetIframe=false → 用 `.cf-turnstile input[type=checkbox]`
  限定(R25-1A 修防误点站点自身 checkbox), 仅严格匹配 challenges.cloudflare.com 跨域 iframe
  时用通用 `input[type=checkbox]`(跨域 iframe 内通常只有 Turnstile widget 一个 checkbox). ✓
- **isChallengeUIVisible 异常保守 ✓**: page.locator(sel).count() 抛错(页面已销毁)→ return
  true(挑战进行中)让上层循环继续等, 不抛错中断. page.url() 抛错也保守返回 true. ✓
- **cookie 回传完整性 ✓**: line 1641 `cookies.map((c) => [name=value, path=, domain=, secure, httpOnly])`
  全量回传 ctx.cookies(), 由 fetcher cookieJar.store 按 originHost 分桶存. Bug18 修复保留
  (按 page.url() 最终 URL 而非请求 URL host 过滤已废, 改全量回传). ✓
- **renderStealth settle 采样边界 ✓**: settleMs 上限 6000ms, `Math.abs(len-lastLen) <=
  Math.max(64, lastLen * 0.005)` 视为稳定, 连续 2 次稳定退出. AJAX 持续注入场景能容忍
  增量阈值; 页面导航中 page.content() 抛错 break 退出 settle 循环(防卡死). ✓
- **challengeWaitMs 40s + goto timeout 20s 共 60s 上限**: goto 命中 CF 管理型挑战常在
  domcontentloaded 前超时, 仅有 timeout 类错误才进入挑战等待循环(DNS/连接拒绝照常抛).
  挑战通过后页面自动 reload, waitForLoadState('domcontentloaded', 5s) + waitForTimeout(500)
  等 DOM 稳定再取 content. ✓

### runner.ts 第二轮 (200~500 行 control + executeTask 段)
- **control() 30s timer 边界 ✓**: R3-13+R14-1B+R25-1A 修复链: prev 链串行化 +
  Promise.race 30s 超时 + raceTimer 在 try/finally clearTimeout 释放 + raceTimer.unref().
  第二轮再查: raceTimer 闭包声明在 inner() 之外, 在 prev.then 内赋值, 时机正确(prev
  settled 后才进入 inner()); Promise.race 已 settled 后底层 controlInner 仍可能跑完
  (SQLite busy lock 解锁后), 其 DB 写经 serializeStatusWrite 串行链保证序(R4-8 修复). ✓
- **任务调度竞态 ✓**: executeTask 入口同步捕获 myEpoch=rt.epoch(ll-c 修防 await 窗口
  被新 start 漂移), isStale()=rt.epoch!==myEpoch 在每个 await 后检查. control('stop')
  仅设 rt.stopped=true 不 bump epoch(让旧循环自检 stopped 退出, 不需新循环取代即可停);
  control('start') 在新启动分支 bump epoch=epoch+1, 旧循环看到漂移即退出(jj-d). ✓
- **serializeStatusWrite 串行化 ✓**: per-task dbStatusChains Map 串行 db.task.update(status),
  链尾 catch 吞错防链断, 调用方 await next 收到错误. P2025(任务已删)视为正常终态不抛. ✓
- **scheduleAutoRefresh timer unref ✓**: R3-35 clamp [5,1440] 分钟 + unref 防长延时阻止
  进程退出 + 触发时复核任务状态(done/error 才重采, stopped 不参与, 防用户手动停后被定时器
  拉回). cancelAutoRefresh 显式 clearTimeout + disposeRuntime(终态 runtime 释放). ✓
- **BudgetExceeded 错误传播 ✓**: gateFetch 入口检测 rt.maxRequests > 0 && requestCount
  超限抛 BudgetExceeded → executeTask catch 内 isStale()/BudgetExceeded/isCircuitBreak
  分支向上抛(走外层 catch → error 终态 + autoRefresh 重排), 不当作单本书错误继续
  agent-Q-deep-audit 修复保留. ✓
- **gateFetch hostGate 释放 ✓**: try/finally 成对 acquireHostGate/releaseHostGate, 抛错
  路径也释放(防槽位泄漏). 429 响应壳页走 reportHostRateLimited 限流冷却而非降额链
  (zz-b). isFetchTimeout 视为源站行为计入连败降额(ee-d). ✓

### cleaner.ts 第二轮 (200~690 行清洗出口)
- **U+2060 剥离完整性 ✓**: R26-1A 已在 4 个出口追加 U+2060(Word Joiner), 与 downloader
  ZW_CHARS 同口径: cleanContentHtml plainText (212) / cleanContentHtml HTML (461) /
  cleanTextField (569) / cleanIntro (608). 第二轮再查 4 处正则均为
  `[\u200B-\u200D\u2060\uFEFF]` 或 `[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D\u2060\uFEFF]`
  全包含 U+2060. ✓
- **段落规整边界 ✓**: cleanIntro 用 `split(/\n{2,}/)` 按双换行分段, 段内 `\r`→空格 +
  `\n`→空格 + `\u3000`(全角空格)→空格 + `\s+` 收敛 + trim. filter(Boolean).join('\n')
  重组. 段间单换行(简介显示走单行多段, 与 cleanContentHtml plainText 用 \n\n 双换行不同).
  ✓
- **水印段落长度闸门 ✓**: 120 字以上长段视为正文(可能含 URL 但属合法内容), 不剥;
  短段(≤120 字)且命中 6 类水印词任一才剥. 防"他打开了 https://example.com 这个网站"叙事
  段被误剥. ✓
- **乱序段落重排 DOM 节点移动 ✓**: 用 appendChild 移动 DOM 节点(非 parent.html 字符串
  重组), 不吞夹带的兄弟 span/em/br 文本节点. data-id 升序排序后 tails Map 跟随移动同组
  尾随节点. 单调 data-id 快路径与"无 data-id 不走此路径"判定不变. ✓
- **白名单剥壳 contents() 移动节点 ✓**: 白名单标签内的子节点用 contents() 移动到原父节点,
  非字符串重 parse(防迭代快照失效泄漏内层标签). 白名单属性消毒 a[href]+img[src] 仅
  http(s) 绝对地址 + img[alt] 任意文本, 其余属性(onerror/onload/style/data:img) 一律剥
  防存储型 XSS. ✓
- **cleanChapterTitle 卷剥离 ✓**: 第N卷 卷名 第M章 章名 形态用懒惰正则切卷前缀, 切割点
  从「分隔符起点」改为「垃圾关键词起点」(qq-e), 量词必须懒惰(*?防贪婪取最右关键词残留
  域名). 按码点截断 120 字(Array.from 防代理对斩半). ✓

### rule-templates.ts + seed-rule-*.ts 审查 (591 行)
- **8 个模板完整性 ✓**: biqugeStandard / biqugeGbk / xpathStructured / regexFallback /
  apiJson / jsRender / fanqieStyle / qimaoStyle, 各模板 list/book/toc/content 4 段配置
  + fetch 配置 + clean 配置齐全. baseConfig() 基于 defaultRuleConfig() 深拷贝保证缺省
  字段不丢. ✓
- **字段提取安全性 ✓**: 字段层 FieldRule 四类(css/xpath/regex/json/const) 与 types.ts
  sanitizeFieldRule 白名单一致. regex 型 expression 在 API 入口经 collectRegexIssues
  四入口预审(FieldRule.expression / replaceFrom / tokenPattern regex: 形态 / adPatterns),
  非法/灾难型嵌套量词一律 400 拒绝. ✓
- **BUG P2-2 regexFallback content 正则要求 `</div>\s*<div` 终止**: 章末 EOF
  (</body></html>) 场景匹配失败 → 内容提取空字符串, 用户看到"四段测试全部 0 字"误以为
  规则写错. ❌ P2
- **tokenUrl 钩子安全性 ✓**: qimaoStyle cfg.fetch.tokenUrl='https://example.com/api/sign
  ?url={url}' + tokenPattern='data.token' + tokenInjection='url', {url} 占位符全量替换
  (R3-3 防 replace 只替首个). tokenHeaderName 走 [\r\n\0:]+ 剥离防 HTTP smuggling, token
  值走 [\x00-\x1f\x7f] 剥离防 bun fetch Headers TypeError. ✓
- **mirrorDomains 配置 ✓**: qimaoStyle cfg.fetch.mirrorDomains='api1.example.com,...'
  逗号分隔, fetcher.mirrorGroupFor 解析后镜像切换走 rewriteMirrorHost + isMirrorSwitchableError.
  镜像 SSRF 守卫: 每镜像 host 走 assertSafeTarget(loopbackBypassAllowed 同口径). ✓
- **fanqieStyle map-collect + * 递归展平 ✓**: list itemSelector
  `data.search_tabs[tab_type=3].data.book_data`(tab_type=3 过滤算子 + 跨数组取属性展平),
  toc itemSelector `data.data.chapterListWithVolume.*`(* 递归展平成章节平面). url const
  模板 {itemId}/{q.book_id} 同作用域替换. ✓
- **seed-rule-*.ts 20+ 文件**: 各站点精确适配(域名/字段/编码/token 真实值), bqg713
  tokenUrl 对接 mini-services/bqg713-proxy:3010 /rewrite?url={url} 钩子. ✓

### API 路由审查 (admin/* + public/*)
- **鉴权链完整 ✓**: proxy.ts (Next 16 中间件) 对 /api/admin/* 强制 verifySession
  (HMAC-SHA256 + timingSafeEqual + payload 白名单 {exp,nonce} 两键 + base64url 解码
  + JSON.parse null/对象校验 R4A-14 + nonce 16B hex 正则校验 R3-32). /api/public/*
  无鉴权但每 IP 120 req/min 令牌桶限流; /api/auth/* 60 req/min + login 自带 5 次/60s
  滑窗(R3-31 FIFO 上限 1 万 + 周期清扫). ✓
- **SQL 注入面闭合 ✓**: 所有 findMany/updateMany/upsert 走 Prisma 参数化, 无字符串拼接
  orderBy. 排序字段排序白名单 SORT_MAP(R17 修)防 orderBy 注入任意字段. 搜索 q 走
  likeSafe() 剥 %_\\ 防 LIKE 通配符注入. 状态/分类/枚举全走 Set 白名单. ✓
- **参数校验 ✓**: clampInt 钳制分页(page≥1/size 1~60/200 等, 缺省值兜底, NaN/Infinity
  回退)防 skip/take 负数导致 Prisma 500. API-7/A-4/A-16 skip 上限 10000 防 OFFSET 全表
  扫描 DoS. take 上限 500(API-12)防大表 findMany 拉回内存撑爆. ✓
- **路径穿越防护 ✓**: safeJoin(root, rel) 走 path.resolve + startsWith(root+path.sep)
  防 ../ + %2e%2e + startsWith 前缀碰撞(data-x vs data). 应用于: download 路由
  DOWNLOADS_DIR 限定, chapter 路由 NOVELS_DIR 限定, cover 路由 /^\w[\w.-]*\.webp$/ 正则
  + readCover basename 双重防护. ✓
- **TOCTOU 防护 ✓**: download 路由 fh.open 后 fh.stat 再 fh.createReadStream, fd 全程
  持有不放(API-8 修). saveChapterTxt 先 .tmp 落盘再 rename 原子写(R26-1A + chapter PUT).
  books batch t2s 先 .tmp 落盘, DB update 成功后 rename(R4A-17). ✓
- **FK 竞态兜底 ✓**: 全 admin 路由 try/catch 包 db.create/update/delete, P2003(外键约束)
  → 409 友好提示「所选 X 已被删除, 请刷新后重试」; P2025(记录不存在)→ 404. tt-b errText
  消毒 e.message(含 Prisma 查询原文/路径)防泄漏到客户端信封. ✓
- **body 大小防护 ✓**: readBody 默认 5MB + chunked 形态流式读取 + 字节计数 + 超限中止
  (R6-3); restore 200MB(R4A-9); feedback 100KB(R5-4 公开路由). ✓
- **BUG P2-3 public/feedback siteId FK 未校验**: siteId 不存在时 db.feedback.create 抛
  P2003 外键约束错, withGuard 兜底为 500 "服务器内部错误" 误导用户(看似服务器故障,
  实则是页面站点 ID 失效 — 站点被管理员删除/前端 URL ?site= 参数失效后用户仍可填反馈).
  ❌ P2

## 第三步: 修复 + 增强

### P1 修复① fetcher.ts checkUcBridge 解析 /health selfTestOk (line 4627~4684)
新增 `UC_BRIDGE_PERMANENT_FAIL_MS = 5*60_000` (5 分钟永久失败缓存窗口) + 全局
`ucBridgePermanentFailUntil` 时间戳. checkUcBridge() 改为:
1. 永久失败窗口内(Date.now() < ucBridgePermanentFailUntil)立即返回 false, 不再发 /health
   探测(否则 /health 仍 200 + selfTestOk:false, 探测结果无意义且每请求 50ms ECONNREFUSED
   叠加)
2. /health 200 时解析 body JSON, 检查 selfTestOk 字段. selfTestOk===false 视为永久失败
   (桥进程在跑但底层依赖坏: xvfb/pyvirtualdisplay/Chrome/undetected-chromedriver 未装),
   设 ucBridgeAvailable=false + ucBridgePermanentFailUntil = Date.now() + 5 分钟, 不再撞桥.
   老版本桥 body 非 JSON 时兼容默认 selfTestOk=true, 由 /fetch 实测兜底.
3. /health 非 200(网络层不可达)走原 60s 重试窗口, 不升级到 5 分钟(可能操作员重启桥进程
   后即恢复).

### P1 修复② fetcher.ts fetchViaUcBridge data.ok=false 永久错误检测 (line 4692~4756)
fetchViaUcBridge 在 `if (!data.ok || !data.html)` 分支新增错误模式检测:
1. 取 errStr = String(data.error || '').slice(0, 300) 截断(防超长错误日志膨胀)
2. 正则匹配永久错误模式:
   - "No module named" / "ImportError" → Python 依赖未装
   - "RuntimeError" → 桥内运行时异常(常含 xvfb 启动失败等)
   - "xvfb" / "pyvirtualdisplay" / "Xvfb" → 显示服务器未装
   - "chromedriver" / "undetected_chromedriver" → UC 依赖坏
   - "selenium" / "webdriver" → Selenium 生态坏
3. 永久失败: 设 ucBridgeAvailable=false + ucBridgePermanentFailUntil = Date.now() + 5 分钟,
   只 warn 一次(下次 checkUcBridge 立即返回 false 不再调 /fetch, 此 warn 5 分钟内不再
   刷屏); 错误全文带出便于操作员定位
4. 瞬时错误(目标 5xx / 网络抖动 / 解析异常等)沿用原口径 warn 每次出, 不更新缓存让下次
   请求重试

### P2 修复③ rule-templates.ts regexFallback content 正则允许 EOF (line 245~253)
原: `<div[^>]*id="content"[^>]*>([\\s\\S]*?)</div>\\s*<div` 要求 </div> 后必须有另一个
<div. 改为: `<div[^>]*id="content"[^>]*>([\\s\\S]*?)</div>(?:\\s*<div|\\s*</body|$)`,
非捕获 alternation 允许 </div> 后跟: 另一个 <div(原语义, 防嵌套 div 内容截断) / </body
(常见 EOF 结构) / $(EOF 字符串结尾). 验证(Case 1 EOF 场景匹配 ✓, Case 2 next-div 原语义
保留 ✓, Case 3 嵌套 div 内容截取到首 </div>+<div 之间 ✓). 非捕获组 (?:...) 不带量词,
不触发 hasNestedQuantifier + branchesHavePrefixAmbiguity 安全闸门.

### P2 修复④ public/feedback siteId FK P2003 处理 (line 79~108)
原 `const fb = await db.feedback.create(...)` 由 withGuard 兜底 P2003 为 500. 改为
`let fb; try { fb = await db.feedback.create(...) } catch (e) { if (e?.code === 'P2003')
return fail('站点不存在或已被删除, 请刷新页面后再提交', 400); throw e }` 友好 400 提示
引导用户重置页面状态后重试. 与 admin 路由 FK 竞态兜底(tt-b)同口径, 但语义不同(公开
路由用户不能预期站点 ID 失效, 应明确告知).

## 第四步: 验证
- bun run lint → 0 errors / 0 warnings exit 0 ✓ (连跑 3 次稳定 0 错误)
- bunx tsc --noEmit → 0 errors in 改动文件 ✓ (排除 .next 自动生成 + examples + skills
  预存在错误)
- regex 安全闸门验证: 新正则 `<div[^>]*id="content"[^>]*>([\\s\\S]*?)</div>(?:\\s*<div|
  \\s*</body|$)` 经 node 实测编译 ✓, hasNestedQuantifier 形态检查 `[+*]\s*\)\s*[+*{]`
  不命中(非捕获组无尾随量词)✓, branchesHavePrefixAmbiguity 不触发(q=0 跳过)✓
- dev server log: 全部 200 OK, 无 uc-bridge 错误洪泛(实测环境 uc-bridge 正常, 但修复
  覆盖 dev.log 历史报错场景)

## 修改文件清单
1. src/lib/crawl/fetcher.ts (~+80 行) — P1 修复① + 修复②: checkUcBridge 解析 selfTestOk
   + fetchViaUcBridge 永久错误检测 + 5 分钟缓存窗口
2. src/lib/crawl/rule-templates.ts (+6 行) — P2 修复③: regexFallback content 正则允许 EOF
3. src/app/api/public/feedback/route.ts (+12 行) — P2 修复④: siteId FK P2003 → 400

## 历史修复全部保留(零回归确认)
- R25-1A2 fetcher 8 级降级链(native→curl→fetch-relay→scrapling-static→scrapling-stealthy
  →Obscura→uc-bridge→moli-bridge) + Referer 修复 + sleepUnref + 8 级端口白名单
- R25-1A3 obscura 3 P1(cookie domain 校验 + newStealthContext 资源泄漏 + recreateSlot
  consecutiveFailures 累加漏路径) + runner 2 P2(raceTimer unref + waiter 30s 超时 unref)
- R26-1A cleaner 4 出口 U+2060 + storage saveChapterTxt 原子写 + writer.finish try/catch
  + calibrate probeFetch cancel + types safeStr 码点安全截断
- R3-30 clientIp 优先 req.ip 防 XFF 伪造 + R3-31 loginAttempts Map FIFO + 周期清扫
- R3-32 verifySession payload 白名单 {exp,nonce} + R4A-14 JSON.parse null/对象校验
- API-7/A-4/A-16 skip 上限 10000 防 OFFSET 全表扫描 DoS + API-12 take 500 上限
- R5-5 readBody 5MB + chunked 流式 + R6-3 字节计数 + 超限中止
- safeJoin path.resolve + startsWith(root+path.sep) 防 ../ + %2e%2e + 前缀碰撞
- gg-a collectRegexIssues 四入口预审 + ReDoS 闸门 hasNestedQuantifier +
  branchesHavePrefixAmbiguity + validateRegexSafety
- tt-b errText 消毒 e.message 防 Prisma 查询原文泄漏到客户端信封
- FK 竞态兜底 P2003→409 / P2025→404 全 admin 路由覆盖
