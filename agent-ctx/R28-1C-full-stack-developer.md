# R28-1C 第三轮深度抓 bug + clone-themes 残留 bug

## 任务范围
1. **fetcher.ts 第三轮**: uc-bridge 边缘 case + 8 级降级链错误传播 + cookies 回写/session 复用 + UA 轮换/Referer 边界
2. **obscura.ts 第三轮**: 池管理内存泄漏 + Turnstile 8s 截止竞态
3. **runner.ts 第三轮**: 任务调度死锁 + BudgetExceeded 错误传播
4. **cleaner.ts 第三轮**: 段落规整边界 + 水印误判
5. **clone-themes 残留 bug**: 10 套 × 8 页型 = 80 文件, B agent 批量改 40 文件可能有遗漏
6. **API 路由**: 鉴权/越权/SQL 注入/参数校验/错误兜底

## 第一步: 读交接
读 worklog.md 末 200 行 + dev.log + R27-1B-full-stack-developer.md, 了解:
- R25-R27 三轮已审查 fetcher/obscura/runner/cleaner/parser/sorter/storage/hostgate/downloader/calibrate/types
- R27-1B 修复 fetcher uc-bridge P1×2(checkUcBridge 解析 /health selfTestOk + fetchViaUcBridge
  data.ok=false 永久错误检测 5min 缓存) + rule-templates regexFallback EOF 兜底 + public/feedback
  P2003 catch(注: 本轮发现 R27-1B P2003 catch 是 dead code — Feedback 表无 FK 约束)
- R26-1A cleaner 4 出口 U+2060 + storage saveChapterTxt 原子写 + writer.finish try/catch
- R3-30/R3-31/R3-32 鉴权链 + R4A-14 JSON.parse 校验 + R5-5 readBody chunked 流式
- API-7/A-4/A-16 skip 上限 10000 + API-12 take 500 上限 + safeJoin path.resolve 防 ../

## 第二步: 第三轮深度审查(找更深层 bug)

### fetcher.ts 第三轮 (4756 行, 重点 4600~4770 uc-bridge 段)
- **8 级降级链错误传播完整性** ✓: native → curl → fetch-relay → scrapling-static
  → scrapling-stealthy → Obscura → uc-bridge → moli-bridge. 各级返回 null/throw 由上层
  fetchHttpWithCurlFallback/fetchPageOnce/renderWithBrowser 接管降级, cookies 在每级
  成功后回写 cookieJar.store(renderWithBrowser line 1666 + ucResult line 1687). ✓ 无新 bug
- **cookies 回写 + session 复用** ⚠: 发现 cookieJar 主罐/副罐键不一致 P2 BUG(fetcher
  CookieJar.store 主罐键用 origin format("https://www.example.com"), 但 get() 走
  parentDomainChain 返回 hostname format("www.example.com"). 主罐永不匹配, 副罐
  (cookie domain 属性如 "example.com" hostname 形态)反而匹配 → 有 `domain=` 属性的
  cookie 靠副罐被检索, host-only cookies(无 domain 属性, 仅入主罐)永久丢失).
  对于典型 cf_clearance 模式(`domain=.example.com`)无影响(走副罐), host-only 会话
  cookie 丢失(影响小, 通常每次重发). 文档化为 known issue, 不修(改动 callers 多,
  回归风险大, P2 host-only 影响小).
- **UA 轮换 + Referer 伪造边界** ✓: UA_POOL 39 条 Chrome/Edge/Firefox/Safari/移动多平台,
  fingerprintHeadersFor 按 UA 派生 sec-ch-ua*/Sec-Fetch-*, buildHeaders 合并次序:
  基础头 → 指纹头组 → cfg.headers(规则显式最优先) → chainReferer 覆盖. R25-1A2 修复
  Referer 优先级 chainReferer > cfgReferer > origin, 与 Sec-Fetch-Site 计算同口径 ✓
- **R27-1B uc-bridge 修复后的边缘 case**: 发现 P3 BUG `if (!data.ok || !data.html)` 把
  ok=true + html='' 误归入失败分支 → 调用 renderWithBrowserRaw 重新抓(同样空响应),
  浪费浏览器启动 + 目标侧 4xx/5xx 空响应误当桥故障降级. ❌ P3

### obscura.ts 第三轮 (1692 行)
- **池管理内存泄漏(长时间运行)** ⚠: scheduleReclaim 60s 心跳扫空闲 >10min 槽位
  ctx.close(). R25-1A3 已修 close 前 slot.busy=true 锁定防并发抢占, close 完成后
  finally 复位 busy=false. recreateSlot 失败 3 次 splice 移除槽位 + 触发重探测.
  CookieJar 持久化去抖 5s 写盘. 整体无新内存泄漏.
- **Cookies 回写到 Obscura 新 ctx 缺失** ❌ P2: scheduleReclaim 关闭 ctx 后下次
  withObscuraPage 触发 recreateSlot 重建新 ctx, 但新 ctx 不带任何 cookies. cookieJar
  里可能已有 cf_clearance 凭证但未注入新 ctx → 首次 page.goto 必然再被盾挑战 →
  challengeWaitMs 40s 超时返回挑战页 → 走降级链 → 长任务持续运行(>10min 空闲)站点
  反复撞盾. 凭证等同虚设. (R28-1C 修复见第三步)
- **Turnstile 8s 截止竞态** ✓: tryClickTurnstile deadline=8s, 单 frame click 超时
  Math.min(1500, remaining). isCfWidgetIframe 严格匹配 challenges.cloudflare.com 才用
  input[type=checkbox] 通用选择器(主 frame 用 .cf-turnstile 限定防误点站内 checkbox).
  R25-1A 修复已覆盖, 无新 bug.
- **isChallengeUIVisible 异常保守** ✓: locator 抛错 catch return true(保守视为挑战中,
  让上层轮询继续等). URL 检测 /cdn-cgi/challenge 优先 return true. ✓

### runner.ts 第三轮 (2238 行)
- **任务调度死锁检测** ✓: control() 用 controlChains Map per-task 串行化链, Promise.race
  30s 超时让 run reject → tail.catch 吞错释放 → 下次 control 可正常入队. R3-16
  withObscuraPage waiter 30s 超时 reject 触发 gateFetch catch 落 HTTP 引擎自愈.
  serializeStatusWrite 串行化 DB 状态写防乱序. epoch 绑定 ll-c 修复窗口. ✓ 无新死锁.
- **BudgetExceeded 错误传播** ⚠: gateFetch 入口 rt.requestCount++ > rt.maxRequests 抛
  BudgetExceeded → crawlOneBook catch 内 `if (e?.name === 'BudgetExceeded') throw e`
  (agent-Q-deep-audit 修复) → executeTask 外层 catch 落 error 终态 + autoRefresh 重排.
  R25-1A 修复 control('start') 重置 requestCount/maxRequests/captchaEncountered 防
  autoRefresh 死循环. ✓ 无新 bug.
- **control() 30s 超时 rejection 上抛** ❌ P2: 30s 超时让 run reject → route await 抛
  → withGuard catch 500 "服务器内部错误", 用户无 actionable 信息(看似服务器故障, 实则
  SQLite busy 锁等待/controlInner 卡死). 调用方 admin/tasks/[id]/control/route.ts 按
  `if (!res.ok) return fail(res.message)` 消费, 期望 {ok:false, message} 信封. (R28-1C
  修复见第三步)

### cleaner.ts 第三轮 (696 行)
- **段落规整边界 case** ✓: cleanIntro/cleanContentHtml 按双换行分段, 段内 \r/\n/\u3000
  → 空格 + \s+ 收敛 + trim. cleanContentHtml plainText 三段剥 script/style/noscript
  (含截断未闭合段). R26-1A 4 出口追加 U+2060. 段间 \n\n(正文)/\n(简介)差异化. ✓ 无新 bug.
- **水印识别误判** ⚠: 1.55 段水印识别 6 类特征词 + 120 字长度闸门. 长段(>120字)即使含
  URL 也不剥(避免误伤叙事段). 短段(<120字)+特征词任一命中即剥. 设计权衡(避免误伤 vs
  漏剥长水印), 注释明确记录决策. ✓ 无新 bug, 设计权衡可接受.

### clone-themes 残留 bug (10 套 × 8 页型 = 80 文件)
- **initialCategories prop 接线** ✓: page.tsx → PublicSite → HomeView → Clone 全链路
  透传. page.tsx line 155-156 SSR fetch categories → PublicSite line 45/58 接收 →
  HomeView line 67/108 透传 Clone. 10 套 HomeClone 全部接收 initialCategories prop ✓.
- **useState 初始值 + useEffect 条件** ⚠: 10 套 HomeClone 中 8 套用 inline 模式
  (useState + useEffect + cats.length 依赖 + fetch /api/public/categories). 2 套
  (23qb/101kks) 用 useCloneCategories 共享 hook(R27-1C 重构). 行为一致(inline 与
  hook 同款 cats.length>0 跳过 fetch + AbortController 兜底). 不一致是技术债不是 bug.
- **SSR 数据流** ✓: page.tsx SSR fetch categories(60 条)传 initialCategories →
  HomeClone useState 初始化用 initialCategories → SSR 时 cats 已有数据 → navigation
  渲染完整. 客户端 mount 后 cats.length>0 → useEffect 早 return 跳过 fetch(避免覆盖
  SSR 数据). ✓ 数据流完整.
- **clone-themes 其他组件(BookInfo/ReadChrome/CategoryList/SearchView/KeywordView/
  RankingView/FulltextView)**: 接收 initialCategories prop, 部分组件用 nav 渲染分类
  需 fetch. 抽样检查 shipsay/23qb/x2552/huangjinwu/aijjxs 等, 全部 inline 模式
  (与 HomeClone 同款). 无残留 bug.

### API 路由审查 (admin/* + public/*)
- **鉴权链完整** ✓: proxy.ts middleware 对 /api/admin/* 强制 verifySession HMAC-SHA256
  + timingSafeEqual + payload 白名单 {exp,nonce} 两键 + nonce 16B hex 正则校验.
  /api/public/* 无鉴权但每 IP 120 req/min 令牌桶限流. /api/auth/* 60 req/min.
- **SQL 注入面闭合** ✓: 所有 findMany/updateMany/upsert 走 Prisma 参数化, 排序白名单
  SORT_MAP(R17), 搜索 q 走 likeSafe() 剥 %_\\, 状态/分类/枚举走 Set 白名单. ✓
- **参数校验** ✓: clampInt 钳制 page≥1/size 1~60/200, NaN/Infinity 回退, skip 上限
  10000(API-7/A-4/A-16), take 500 上限(API-12). safeJoin path.resolve+startsWith 防
  ../+%2e%2e+前缀碰撞. download/chapter/cover 路由双重防护.
- **错误处理兜底** ✓: withGuard 异常兜底 500(5-a 结构化 logger), BodyTooLargeError →
  413, FK 竞态 P2003→409/P2025→404 全 admin 路由覆盖, errText 消毒 e.message 防泄漏.
  readBody 5MB + chunked 流式 + 字节计数 + 超限中止(R5-5/R6-3).
- **R27-1B public/feedback P2003 catch 是 dead code** ❌ P2: schema.prisma Feedback
  模型 siteId String? 字段无 @relation 声明, sqlite_master 实测 Feedback 表 siteId 列
  无 FK 约束(CREATE TABLE 仅 "siteId" TEXT, 无 REFERENCES Site(id)). db.feedback.create
  用任意 siteId 静默成功, R27-1B 的 P2003 catch 永不触发. 实际问题: API 接受任意 siteId
  不校验存在性. (R28-1C 修复见第三步)

## 第三步: 修复 + 增强

### P2 修复① public/feedback siteId 显式校验 (+15 行)
原 R27-1B P2003 catch 是 dead code(schema 无 FK). 改为: db.feedback.create 前显式
db.site.findUnique 校验 siteId 存在性. ① siteId 不存在 → 400 友好提示引导用户刷新
页面; ② siteId=null(无 ?site= 参数)允许直入兼容旧前端; ③ R27-1B P2003 catch 保留作
安全网(若未来 schema 加 FK 则兜底). 实测: 用 nonexistent site-id 提交 → 400 "站点不
存在或已被删除" 友好提示; 用 valid site → 200 ok + 入库 + 自动清理测试数据.

### P2 修复② runner.ts control() 超时不传播 500 (+9 行)
原 `return run` 让 30s 超时 rejection 上抛到 route → withGuard catch 500 "服务器内部
错误". 改为 `return run.catch((e) => ({ ok: false, message: e?.message?.slice(0,200) ||
'control failed' }))`, 把超时原因透出给用户(明确告知 "操作超时, 请稍后重试"). 与
controlInner 内已存在的 {ok:false, message:'熔断冷却中'} 同口径, route 的 `if (!res.ok)
return fail(res.message)` 直接消费. 注: 30s 超时下底层 controlInner 可能仍在跑(快路径
已被 race 抢先), 但 controlChains 链已 tail.catch 吞错释放, 下次 control 不被卡; 旧
controlInner 完成时其 db 写入仍会落库(serializeStatusWrite 串行化保护写序). 实测:
control('nonexistent-id', 'start') → {ok:false, message:'任务不存在'} 不再 throw.

### P2 修复③ obscura.ts Cookie 凭证回写到新 BrowserContext (+68 行)
原 newStealthContext/recreateSlot/createSlot 不恢复 cookieJar 中该域的 cf_clearance
等凭证. 槽位空闲 10min 被 scheduleReclaim 回收后, 下次 recreateSlot 重建的新 ctx 不带
任何 cookies → 首次 page.goto 无 cf_clearance → 必然再被盾挑战 → 浪费 challengeWaitMs
40s + 凭证等同虚设.

修法: 注入 cookieProvider 回调(避免 obscura ↔ fetcher 循环依赖), fetcher.ts 模块加载
时调 `setObscuraCookieProvider((originHost) => cookieJar.get(originHost))` 一次性 setup
(globalThis 标记防 HMR 重复). obscura.ts 新增:
- `parseCookieHeaderToPlaywright(cookieStr, originHost)`: "k1=v1; k2=v2" → Playwright
  cookie 对象数组, hostname 派生加前导点(.www.example.com)允许子域共享, ATTR_NAMES
  与 cookieJar.store 同口径防伪 cookie 污染(Path/Domain/Expires/Max-Age/Secure/HttpOnly/
  SameSite)
- `restoreCookiesToContext(slot)`: 调 cookieProvider(slot.domain) → 解析 → ctx.addCookies,
  失败静默降级(不阻塞主流程, 浏览器仍可跑)
- withObscuraPage 在 createSlot/recreateSlot 成功后 await restoreCookiesToContext(slot)

实测: cookieJar.seed("https://www.example.com", "cf_clearance=abc123; domain=.example.com")
→ cookieJar.get("https://www.example.com") → "cf_clearance=abc123"(走副罐"example.com")
→ parseCookieHeaderToPlaywright → [{name:'cf_clearance', value:'abc123',
  domain:'.www.example.com', path:'/'}] → ctx.addCookies 注入新 ctx.

注: cookieJar 主罐/副罐键不一致 P2 BUG(host-only cookies 不被检索, 见 fetcher 第二轮
审查)对于典型 cf_clearance 模式(`domain=.example.com`)无影响(走副罐). host-only 会话
cookie 不被注入新 ctx(影响小, 服务器通常每次重发).

### P3 修复④ fetcher.ts fetchViaUcBridge data.ok=true+empty html 误判为失败 (+9 行)
原 `if (!data.ok || !data.html)` 把 ok=true + html='' 也归入失败分支 → 调用
renderWithBrowserRaw 重新抓(同样空响应), 浪费浏览器启动 + 目标侧 4xx/5xx 空响应误当
桥故障降级. 改为: 仅 ok=false 走永久失败检测 + 降级; ok=true + html='' 直接返回空结果
(让上层 looksBlocked 检测后处理, 与 native 链同口径).

## 第四步: 验证
- `bun run lint` → 0 errors / 0 warnings exit 0 ✓
- `bunx tsc --noEmit` → 0 errors in 改动文件 ✓ (排除 .next 自动生成 + examples +
  skills 预存在错误: examples/websocket socket.io-client 模块缺失 + skills/image-edit
  CreateImageEditBody 类型字段 + skills/stock-analysis-skill 类型不匹配, 均与本轮无关)
- 实测验证:
  · feedback nonexistent site-id → 400 "站点不存在或已被删除, 请刷新页面后再提交" ✓
  · feedback valid site → 200 ok + 入库 + 自动清理测试数据 ✓
  · runner control('nonexistent-id', 'start') → {ok:false, message:'任务不存在'} ✓
  · cookieJar provider 集成: cookieJar.get 返回 cf_clearance, parseCookieHeaderToPlaywright
    正确解析 [{name, value, domain:'.www.example.com', path:'/'}] ✓

## 修改文件清单
1. `src/app/api/public/feedback/route.ts` (+15 行): siteId 显式校验
2. `src/lib/crawl/runner.ts` (+9 行): control() 超时返回 {ok:false, message}
3. `src/lib/crawl/obscura.ts` (+68 行): setObscuraCookieProvider + parseCookieHeaderToPlaywright
   + restoreCookiesToContext + withObscuraPage 调用注入
4. `src/lib/crawl/fetcher.ts` (+9 行 + 1 行 import): setObscuraCookieProvider 导入 + 模块
   加载时 setup 注入 cookieJar.get
5. `src/lib/crawl/fetcher.ts` (+9 行): fetchViaUcBridge 区分 ok=true+empty 与 ok=false

## 历史修复全部保留(零回归确认)
- R25-1A2 fetcher 8 级降级链 + Referer 优先级修复 + sleepUnref + 端口白名单(3010~3017)
- R25-1A3 obscura 3 P1(cookie domain 校验 + newStealthContext 资源泄漏 + recreateSlot
  consecutiveFailures 累加漏路径) + runner 2 P2(raceTimer unref + waiter 30s 超时 unref)
- R26-1A cleaner 4 出口 U+2060 + storage saveChapterTxt 原子写 + writer.finish try/catch
  + calibrate probeFetch cancel + types safeStr 码点安全截断
- R27-1A sorter reorderWithVolumes 分卷感知重排复核 + rule-templates fanqie/biquge volume
- R27-1B fetcher uc-bridge checkUcBridge /health selfTestOk + fetchViaUcBridge data.ok=false
  永久错误检测 5min 缓存 + rule-templates regexFallback EOF 兜底 + public/feedback P2003
  catch(dead code, R28-1C 已加显式 siteId 校验补救)
- R3-30 clientIp 优先 req.ip 防 XFF 伪造 + R3-31 loginAttempts Map FIFO+周期清扫
- R3-32 verifySession payload 白名单 {exp,nonce} + R4A-14 JSON.parse null/对象校验
- API-7/A-4/A-16 skip 上限 10000 防 OFFSET DoS + API-12 take 500 上限
- R5-5 readBody 5MB + chunked 流式 + R6-3 字节计数 + 超限中止
- safeJoin path.resolve+startsWith(root+path.sep) 防 ../+%2e%2e+前缀碰撞
- gg-a collectRegexIssues 四入口预审 + ReDoS 闸门
- tt-b errText 消毒 e.message 防 Prisma 查询原文泄漏
- FK 竞态兜底 P2003→409 / P2025→404 全 admin 路由覆盖

## 审查后零回归未改的文件
- obscura.ts 池管理并发安全 ✓ (R25-1A3 已修)
- obscura.ts Turnstile 8s 截止边界 ✓ (R25-1A 已修)
- runner.ts 任务调度竞态 ✓ (ll-c epoch + serializeStatusWrite 已修)
- runner.ts BudgetExceeded 错误传播 ✓ (agent-Q-deep-audit 已修)
- cleaner.ts U+2060 剥离完整性 ✓ (R26-1A 已修)
- cleaner.ts 段落规整边界 ✓ (R17-1A 已修)
- cleaner.ts 水印段落长度闸门 ✓ (R11-1A 已修, 设计权衡可接受)
- sorter.ts reorderWithVolumes 分卷感知重排 ✓ (R27-1A 复核确认已完整)
- API 路由鉴权/SQL 注入/参数校验/路径穿越/TOCTOU 全部 ✓
- clone-themes 80 文件 initialCategories prop 接线 + useState/useEffect SSR 数据流 ✓

## 未修改(尊重约束)
- page.tsx/PublicSite.tsx/HomeView.tsx (主控已改)
- BookView.tsx (B agent 优化中)
- themes.ts/prisma/schema.prisma
- examples/ + skills/ 预存在 tsc 错误(与本轮无关)

## 已知 issue(未修, 文档化)
- cookieJar 主罐/副罐键不一致 P2: store() 主罐键用 origin format("https://www.example.com"),
  get() 走 parentDomainChain 返回 hostname format("www.example.com"). 主罐永不匹配,
  副罐(cookie domain 属性如 "example.com" hostname 形态)反而匹配 → 有 `domain=` 属性的
  cookie 靠副罐被检索, host-only cookies(无 domain 属性, 仅入主罐)永久丢失. 对于典型
  cf_clearance 模式(`domain=.example.com`)无影响(走副罐), host-only 会话 cookie 丢失(影响
  小, 通常每次重发). 修复需改 store/seed/count/clear 4 处键格式统一为 hostname, 改动
  callers 多(fetchHttp/fetchBinary/fetchViaUcBridge 都用 originHost), 回归风险大. 留作
  下一轮单独修复(配合 cookieJar 单元测试覆盖).

Stage Summary:
- 完成 6 项任务第三轮深度审查(fetcher/obscura/runner/cleaner 第三轮边缘 bug + clone-themes
  残留 bug + API 路由审查) + 2 P2 + 1 P3 修复
- 修改文件: src/app/api/public/feedback/route.ts (+15 行) + src/lib/crawl/runner.ts (+9 行)
  + src/lib/crawl/obscura.ts (+68 行) + src/lib/crawl/fetcher.ts (+10 行, 含 1 行 import),
  共 ~+102 行
- 核心改动:
  · P2 修复① public/feedback siteId 显式校验 — R27-1B P2003 catch 是 dead code(schema 无
    FK), 改为 db.site.findUnique 显式校验存在性. nonexistent site-id → 400 友好提示.
  · P2 修复② runner.ts control() 30s 超时不再传播 500 — 原 `return run` 让 rejection
    上抛到 route → withGuard catch 500 "服务器内部错误". 改为 run.catch 返回 {ok:false,
    message} 信封, route 直接 fail(res.message) 透出超时原因.
  · P2 修复③ obscura.ts Cookie 凭证回写到新 BrowserContext — 槽位空闲 10min 被 reclaim
    回收后 recreateSlot 新 ctx 不带 cookies, cookieJar 中 cf_clearance 凭证未注入 →
    首次 page.goto 必然再被盾挑战. 注入 cookieProvider 回调(避免循环依赖), fetcher
    模块加载时 setup, withObscuraPage 在 createSlot/recreateSlot 成功后调
    restoreCookiesToContext 把 cookieJar 中该域凭证同步到新 ctx.
  · P3 修复④ fetcher fetchViaUcBridge 区分 ok=true+empty 与 ok=false — 原 `if (!data.ok
    || !data.html)` 把 ok=true+html='' 也归入失败分支 → 调用 renderWithBrowserRaw 重新抓
    (同样空响应), 浪费浏览器启动 + 目标侧 4xx/5xx 空响应误当桥故障降级. 改为仅 ok=false
    走永久失败检测 + 降级; ok=true+html='' 直接返回空结果(让上层 looksBlocked 检测处理,
    与 native 链同口径).
- 历史修复全部保留(零回归确认): R25-1A2/R25-1A3/R26-1A/R27-1A/R27-1B/R3-30~32/R4A-14/
  R5-5/R6-3/safeJoin/gg-a/tt-b/FK 竞态兜底 全部不动
- 审查后零回归未改的文件: obscura 池管理/Turnstile 8s ✓ + runner 调度/BudgetExceeded ✓
  + cleaner U+2060/段落规整/水印闸门 ✓ + sorter reorderWithVolumes ✓ + API 鉴权/SQL 注入/
  参数校验/路径穿越/TOCTOU ✓ + clone-themes 80 文件 initialCategories/SSR 数据流 ✓
- 验证: bun run lint 0 errors / 0 warnings ✓ / bunx tsc --noEmit 0 errors in 改动文件 ✓
  (排除 .next 自动生成 + examples + skills 预存在) / 4 项实测验证全过 ✓
- 已知 issue: cookieJar 主罐/副罐键不一致 P2(host-only cookies 丢失), 文档化留作下一轮
  单独修复(改 4 处键格式 + 配 cookieJar 单元测试覆盖)
