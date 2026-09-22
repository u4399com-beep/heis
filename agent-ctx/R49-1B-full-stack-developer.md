# R49-1B 采集规则噪声清洗检查

## Task
- Task ID: R49-1B
- Agent: full-stack-developer
- 时间: 2026-09-22
- 范围: go-backend/crawl/cleaner.go + DB Rule 表 53 条 enabled 规则

## 接前轮工作
- R48-1A 第八轮深度审查 (utls 24 池 / TLS session ticket 持久化 / CapSolver 三服务级联 / probe 头族 / Bezier 微抖)
- 本轮专门审查 cleaner.go 噪声清洗 + Rule 表配置完整性

## cleaner.go 审查覆盖 7 维度
- 段落规整 (NormalizeParagraphs)
- 空行压缩 (twoNewlineRe)
- 缩进统一 (全角空格 U+3000 → 半角)
- 零宽字符剥离 (CcAndZwStripRe / ZWStripOnlyRe / CcStripOnlyRe)
- 水印段识别 (watermarkDomainRe / watermarkPromoRe1..5)
- 广告剥离 (EXTRA_AD_PATTERNS / EXTRA_AD_SELECTORS)
- HTML 消毒 (script/style/noscript/iframe/object/embed + 白名单属性消毒)
- trafilatura 桥调用 (CallTrafilaturaExtract + 60s 可用性缓存 + 兜底)

## DB Rule 表审查
- TOTAL=71 / ENABLED=53
- 53 条 enabled 规则全部带 clean 配置 (removeSelectors + adPatterns + whitelist + normalize + plainText)
- 仅 1 条 [知轩藏书] 因 TXT 资源站无 content.fields.content (合理跳过)
- 16 条带 content.fields.content: 11 条 plainText=false (HTML 模式 CSS), 5 条 plainText=true (JSON API)
- 37 条为 "首页最近更新" 列表规则 (无正文选择器, 合理)
- 内置 EXTRA_AD_PATTERNS 兜底覆盖所有常见水印/广告文案, 无需补 Rule 配置

## 抓出 7 P2/P3 bug (修前测试输出 vs 修后对比)
- BUG-1 (P2): NormalizeParagraphs 把 \r → 空格, 导致 \r\n\r\n 拆成 "\n \n", \n{2,} 无法识别
- BUG-2 (P2): \s+ 默认 ASCII whitespace, 漏 NBSP/Ogham/U+2000-U+200A/NNBSP/MMSP/全角空格
- BUG-3 (P2): CcAndZwStripRe 仅覆盖 C0 + U+200B-C/U+2060/U+FEFF, 漏 LRM/RLM/SHY/DEL/C1/LSP/PSP/invisible operators/Bidi isolate
- BUG-4 (P2): plainText 模式 plainTextBlockEndRe 把 </p> → \n 单换行, 导致 </p><p> 间段合并
- BUG-5 (P2): plainText 模式无 cheerio DOM 段级 Each, 短段命中水印/导航词漏剥
- BUG-6 (P3): HTML 模式未剥隐藏元素 ([hidden] / style=display:none / visibility:hidden)
- BUG-7 (P3): EXTRA_AD_PATTERNS 下载...看 锚点过紧残留 "精彩小说"; 第N章...{0,4} 过短残留 "待续..."

## 修复落地 (cleaner.go 9 处编辑, 804 → 899 行 +95)
1. EXTRA_AD_PATTERNS 扩 2 条 (下载...{0,30} + 未完待续.{0,12} + 本[书站]域名/地址兜底)
2. 新增包级预编译 unicodeWsRe (NBSP/Ogham/各种 space/NNBSP/MMSP/全角空格)
3. CcAndZwStripRe / ZWStripOnlyRe / CcStripOnlyRe 扩展 13 类不可见字符
4. NormalizeParagraphs 预规范化换行 (\r\n → \n / \r → \n / U+2028 → \n / U+2029 → \n\n) + Unicode 空格归一化
5. 新增 plainTextAnchorEndRe (let <a>text</a> 独立成段)
6. cleanContentHtmlSync plainText 分支 step 3 改双换行 + step 3.5 </a> → \n\n + step 7.5 stripPlainTextPromoSegments
7. HTML 模式新增 hidden 元素剥离 ([hidden] 属性 + style display:none/visibility:hidden)
8. CleanContentHtmlWithTrafilatura 接入 stripPlainTextPromoSegments
9. TryTrafilaturaFallback 接入 stripPlainTextPromoSegments
10. 新增 stripPlainTextPromoSegments 函数 (段级 navLinkRe/watermarkRe/chapterTailRe 整段剥)

## 验证
- go build → 0 errors, binary 24,287,512 bytes (R48-1A 24,277,730 + 9.8KB)
- go vet → 0 warnings
- staticcheck → 0 issues
- heis-backend 重启 :3000 + 3 端点 curl 全 200 (/health, /, /api/admin/health)
- 4 个测试程序 (test_cleaner.go + test2/3/4.go) 全部 7 bug 修复验证通过

## 未修改 (尊重约束)
- main.go + admin.go ✓
- templates/* ✓
- crawl/{parser,hostgate,smart,storage,types,fetcher,runner}.go ✓
- services/* 12 个 services ✓
- agent-ctx/*.md R38-R48 全部保留 ✓
- prisma/schema.prisma + package.json + .env.example + DEPLOY.md + README.md 0 改动 ✓
- DB Rule 表 53 条 enabled 规则 0 改动 (clean 配置完整, 内置兜底覆盖) ✓
