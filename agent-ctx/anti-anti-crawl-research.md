# 反反爬工具选型分析 (R13-0)

## 1. 工具盘点与对比

| 工具 | 类型 | 反反爬原理 | 优缺点 | 性价比 | 决策 |
|---|---|---|---|---|---|
| **scrapling** | Python 框架 | curl_cffi TLS 指纹伪装 + patchright 反检测浏览器 + playwright 三合一 | 已集成(scrapling-bridge:3012), 三模式 static/stealthy/playwright 一站式覆盖 | ★★★★★ | **保留, 升级到 0.4+** |
| **Obscura** | 自研 TS | Playwright chromium --stealth 隐身 + 指纹抖动 + cookie 回传 + 挑战等待 | 已集成(单例常驻, 页面池并发2), 与 scrapling 互补 | ★★★★★ | **保留** |
| **fetch-relay** | 自研 Bun | bun 运行时代理 RequestInit.proxy 原生支持 | 已集成(3011), 解决 node fetch 不支持代理的问题 | ★★★★ | **保留** |
| **cloakBrowser** | 第三方 | 基于 playwright + 自定义 stealth 脚本 | 与 Obscura 功能重叠, 已有 Obscura | ★★ | **不集成** |
| **BrowserAct** | 第三方 | AI 浏览器自动化 | API 闭源, 需付费, 不稳定 | ★ | **不集成** |
| **invisible_playwright** | playwright 扩展 | 隐身模式补丁 | 与 Obscura 重叠 | ★★ | **不集成** |
| **MediaCrawler** | Python | 番茄/七猫等 APP API 抓取 | 已有 qimao-proxy(3013) 直接对接 | ★★ | **不集成** |
| **curl-impersonate** | C/Rust | 编译版 curl 替换 OpenSSL TLS 指纹 | scrapling 的 curl_cffi 已封装此能力 | ★★★★ | **已通过 scrapling 间接使用** |
| **aiohttp** | Python | 异步 HTTP 客户端 | 无 TLS 指纹伪装能力, 不解决反爬 | ★ | **不集成** |
| **Dokobot** | 第三方 SaaS | 商业反检测浏览器 | 收费, 闭源, 不透明 | ★ | **不集成** |
| **Trafilatura** | Python | HTML 正文提取(去导航/广告) | 与 cleaner.ts 功能重叠, 已有 cleaner | ★★ | **不集成** |
| **moli-bridge** | 自研 Rust | Rust AI 浏览器 | 已集成(3017), 实验性 | ★★★ | **保留** |
| **uc-bridge** | 自研 Python | undetected-chromedriver | 已集成(3016), 5级降级链第4级 | ★★★ | **保留** |

## 2. 集成决策

**最终保留 5 个反反爬通道, 形成 5 级降级链**:
1. native fetch (bun/node 原生 HTTP)
2. curl (OpenSSL, 兜底)
3. fetch-relay:3011 (bun+代理)
4. scrapling-bridge:3012 static (curl_cffi TLS 指纹伪装)
5. scrapling-bridge:3012 stealthy (patchright 反检测浏览器 + CF 挑战求解)
6. Obscura (playwright --stealth 隐身, 自研, 页面池常驻)
7. uc-bridge:3016 (undetected-chromedriver, 5级)
8. moli-bridge:3017 (Rust AI 浏览器, 实验性)

**不集成**: cloakBrowser/BrowserAct/invisible_playwright/MediaCrawler/curl-impersonate/aiohttp/Dokobot/Trafilatura
- 理由: 功能重叠 / 闭源付费 / 已通过其他工具间接覆盖

## 3. 优化方向

- scrapling-bridge 升级 0.4+ (DynamicFetcher 替代 PlayWrightFetcher)
- fetcher.ts 5 级降级链日志清晰化
- Obscura 页面池扩容(默认 2 → 4, 应对高并发)
- 给采集规则添加 fetchRelayProxy 字段, 让用户在 UI 里填代理
