# R29-1D 清理精简+深度抓bug第四轮

## 1. 读交接
- worklog.md 末 150 行: R28 三轮审查完成(fetcher/obscura/runner/cleaner + clone-themes 80 文件
  initialCategories 接线 + useCloneCategories hook 提取 R28-1A 净减 750 行)
- R28-1C 文档化"cookieJar 主罐/副罐键不一致 P2"未修, 本轮重点修复
- dev.log: dev server 200 OK, 无报错

## 2. 第四轮深度审查 6 模块

### 2.1 clone-themes 残留检查 (51 文件)
- 50 文件用 useCloneCategories hook ✓
- 1 文件 huangjinwu/HomeClone 残留旧 useState+useEffect+fetch 块(因"榜"后缀需求未走 hook)
- **修复**: shared.ts useCloneCategories 增加 mapFn 参数(默认 mapCat),
  huangjinwu/HomeClone 用 mapCatWithBangSuffix 模块级函数加"榜"后缀, 删除旧块
- 51/51 clone 文件全部用 hook, 0 残留

### 2.2 cookieJar 键不一致 P2 修复(核心)
R28-1C 文档化问题: store(origin format) vs get(hostname format) 主罐键不匹配
端到端模拟验证:
```
store('https://www.example.com', ['sessionid=abc'])
→ jars 键 'https://www.example.com' (origin format)
get('https://www.example.com')
→ parentDomainChain 返回 ['www.example.com','example.com'] (hostname format)
→ jars.get('www.example.com') = undefined (主罐键不匹配!)
→ get 返回 '' (BUG!)
```
修复: store/seed/count/clear/restore 5 处主罐键统一 hostname format
- store: mainKey = reqHost || domain (原: domain origin format)
- seed: mainKey = hostOf(domain) || domain
- count: key = hostOf(domain) || domain (原: domain origin format)
- clear: mainKey = targetSrc = hostOf(domain) || domain
- restore: key = hostOf(e.d) || e.d (兼容旧 origin format 持久化文件)

9 测试场景全 PASS:
1. host-only cookie ✓ (修前 get 返回 '', 修后 'sessionid=abc')
2. cf_clearance domain=.example.com ✓ (副罐命中)
3. 子域 get api.example.com ✓ (副罐命中)
4. seed 手工种 cookie ✓
5. count + clear ✓
6. 跨子域 clear 副罐 ✓
7. restore 兼容旧 origin format 键 ✓
8. serialize round-trip ✓
9. 父域 get 查副罐 ✓

### 2.3 fetcher 第四轮边缘 case
- 8 级降级链错误传播 ✓(R28-1C 已修)
- cookieJar 修复后 cookieProvider 回调链路验证:
  obscura slot.domain = originOf(url) = origin format
  → cookieJar.get(origin) → parentDomainChain 返回 hostname
  → 命中修复后的 hostname 主罐 + 副罐 ✓
- fetchViaUcBridge ok=true+empty vs ok=false 区分 ✓(R28-1C 已修)

### 2.4 obscura 第四轮 cookie 回写边界
- ctx.cookies() → Set-Cookie 字符串 → cookieJar.store(originHost(url), cookies)
- 修复后: 主罐键 hostname + 副罐键 hostname(domain attr 已去前导点)
- 整链一致, 无回归 ✓

### 2.5 dead code 清理
- types.ts trafilaturaBridgeUrl 重复定义(line 264 + line 417)
  → 删除 line 417 重复, 统一用 line 264 (TS2300 修复)
- types.ts trafilaturaBridgeUrlRaw 拼写错误(trafolatura vs trafilatura)
  → 修复, 配置的桥 URL 不再静默丢失
- cleaner.ts callTrafilaturaExtract 未被调用(lint no-unused-vars)
  → 改为 export, 标记 A/B/C agent 后续 wiring 直接复用(lint 修复, 代码保留)

### 2.6 API 路由审查
- 45/45 admin 路由全部覆盖 verifySession/withGuard 鉴权 ✓
- SQL 注入/参数校验/路径穿越/TOCTOU ✓(R28-1C 已审, 本轮复核无新漏洞)

## 3. 修复汇总 (R29-1D 共 ~+60 行)
- P2 修复① cookieJar store/seed/count/clear/restore 5 处主罐键统一 hostname
  (fetcher.ts +25 行)
- P2 修复② huangjinwu/HomeClone 残留旧块重构用 hook
  (shared.ts +6 行 mapFn 参数 + huangjinwu/HomeClone.tsx -25/+10 行)
- P3 修复③ types.ts trafilaturaBridgeUrlRaw 拼写错误(trafolatura → trafilatura)
  (types.ts +4 行注释)
- P3 修复④ types.ts trafilaturaBridgeUrl 重复定义去重 (types.ts -1 行)
- P3 修复⑤ cleaner.ts callTrafilaturaExtract export 标注 (cleaner.ts +5 行)

## 4. 验证
- bun run lint → 0 errors / 0 warnings exit 0 ✓
- bunx tsc --noEmit → 0 errors in 改动文件 ✓(排除 .next + examples + skills 预存在)
- 9 项 cookieJar 测试场景全 PASS ✓

## 5. 修改文件清单
1. src/lib/crawl/fetcher.ts (+25 行 cookieJar 5 处键统一)
2. src/components/public/clone-themes/shared.ts (+6 行 mapFn 参数)
3. src/components/public/clone-themes/huangjinwu/HomeClone.tsx (-25/+10 行重构)
4. src/lib/crawl/types.ts (+4/-2 行 typo 修复 + 重复字段去重)
5. src/lib/crawl/cleaner.ts (+5 行 export 标注)

## 6. 历史保留 + 零回归
- R25-1A2/R25-1A3/R26-1A/R27-1A/R27-1B/R28-1A/R28-1B/R28-1C 全部不动
- R3-30~32/R4A-14/R5-5/R6-3/R6-1/R6-5/safeJoin/gg-a/tt-b/FK 竞态兜底 全部不动
- 未修改(尊重约束): page.tsx/PublicSite.tsx/HomeView.tsx + BookView.tsx +
  fetcher.ts 8 级降级链核心 + examples/+skills/ 预存在 tsc 错误
