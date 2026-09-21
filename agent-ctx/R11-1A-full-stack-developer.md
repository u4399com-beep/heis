# R11-1A — fanqianxs.com + trxsw.com 采集规则 + cleaner.ts 噪声清洗强化

**Agent**: full-stack-developer
**Task ID**: R11-1A
**Date**: 2026-09-15

## 任务总览

编写 fanqianxs.com (西红柿小说, JIEQI CMS 模板) 和 trxsw.com (天人小说, 唐人小说路由)
两个站点的采集规则脚本, 同时强化 src/lib/crawl/cleaner.ts 的噪声清洗逻辑, 覆盖所有
采集数据点(书名/简介/章节目录名/章节正文等)。

## 反查依据

### fanqianxs.com
GitHub 多书源汇总(Moli-X/mumuceo/wle2015 三书源):
- 与 23qb.net 同款 JIEQI CMS 模板
- DOM: og:novel:* meta + #list dl dt/dd + #content
- 列表: /xuanhuan/{page}/ .novelslist2 li:not(:first-child)
- 书籍页: og:novel:book_name/author/category/status/latest_chapter_name 等
- 目录: #list dl dt:nth-of-type(2) ~ dd (跳过第1个dt"最新章节"区)
- 正文: #content p 段落
- 章末广告词: 推荐下.*更新快 / 广个告.*离线朗读 等

### trxsw.com
GitHub mason173/aira-browser 完整配置直译:
- 路径前缀 /tangren_ 或 /tangren/ (★关键)
- 域名已过期(cirosantilli expired-domain 列表), 规则保留待镜像恢复
- DOM 类名: .vlist/.read/.detail/.content/.pager
- chapterLinkSelector: .vlist > li:not(.now) > a
- contentSelector: .content
- chapterTitleSelector: h1.headline
- bookTitleSelector: .detail .name strong
- authorSelector: .detail .author a
- coverSelector: .detail > img
- synopsisSelector: .intro

## 交付物

### 1. scripts/seed-rule-fanqianxs.ts (新建, ~220 行)
JIEQI CMS 模板规则, 关键配置:
- list: `/xuanhuan/{page}/` `.novelslist2 li:not(:first-child)`
  - .s2>a 书名+bookUrl / .s3 最新章节 / .s4 作者 / .s5 更新时间 / .s6 状态
- book: og:novel:* meta 全套 + #intro 简介 + #fmimg img 封面
- toc: `#list dl dt:nth-of-type(2) ~ dd` (跳过第1个dt"最新章节"区)
- content: `#content` (老版本) / 备用 #htmlContent (新版本 wle2015 配置)
- fetch.engine: `scrapling-static` (★CF 防护需 TLS 指纹伪装)
- fetch.timeout: 25000 (CF 站响应慢)
- fetch.hostGateLimit: 2 (CF 防护站降低并发防 rate-limit)
- clean.adPatterns: 22 条广告正则
  - 站点水印: fanqianxs.com 域名灌水
  - 章末广告: 推荐下.*更新快 / 推荐一个.*com / 广个告.*离线朗读 / 广个告.*更新快
  - 通用推广: 本书首发于 / 请记住本书 / 一秒记住.*免费读 / 本章未完.*点击下一页 等
- 测试探针:
  - list: `https://www.fanqianxs.com/xuanhuan/1/`
  - book: `https://www.fanqianxs.com/book/1234/`
  - toc: `https://www.fanqianxs.com/book/1234/`
  - content: `https://www.fanqianxs.com/book/1234/5678.html`
- 探针失败不阻断入库(CF 防护站点结构反推, 待 scrapling 实测)

### 2. scripts/seed-rule-trxsw.ts (新建, ~210 行)
唐人小说路由规则, 关键配置:
- list: `/tangren_/sort/1/{page}.html` `.vlist li`
  - ★路径前缀 /tangren_ 是关键 (AiraBrowser 实测); /tangren/ 为备用前缀
- book: `.detail .name strong` 书名 / `.detail .author a` 作者 / `.detail>img` 封面 / `.intro` 简介
- toc: `.vlist > li:not(.now)` (★:not(.now) 排除"当前阅读位置"项, AiraBrowser 直译)
- content: `.content` (h1.headline 章节标题, AiraBrowser contentSelector 直译)
- fetch.engine: `scrapling-static` (域名过期但规则保留, 兼容 SSL/CF 防护)
- 翻页关闭: AiraBrowser nextSelector=.pager a:nth-of-type(3) 是"下一章"而非"下一页",
  开启翻页会多章并一章(kanunu8 式陷阱)
- clean.adPatterns: 17 条广告正则
  - 站点水印: trxsw.com 域名灌水 / 天人小说 / 唐人小说推广词
  - 通用推广: 本书首发于 / 请记住本书 / 一秒记住.*免费读 等
- 测试探针:
  - list: `https://www.trxsw.com/tangren_/sort/1/1.html`
  - book: `https://www.trxsw.com/tangren_/1234/`
  - toc: `https://www.trxsw.com/tangren_/1234/`
  - content: `https://www.trxsw.com/tangren_/1234/5678.html`
- 探针失败不阻断入库(域名过期站点, 待镜像恢复后实测)

### 3. src/lib/crawl/cleaner.ts (修改, 新增 7 处 + 1 个导出函数 + 2 个 helper)

#### ① cleanTextField (line 506, 书名/作者/分类/关键词等单行字段)
- **零宽字符剥离** (line 516-520): `v.replace(/[\u200B-\u200D\uFEFF]/g, '')`
  - 反爬水印常以零宽字符注入书名/作者/章节标题(可视化无变化但影响搜索/排序/去重)
  - 紧随控制字符剥离之后执行; 不影响后续 t2sText(零宽字符不在 CJK 区)
  - 范围: U+200B(ZWSP) / U+200C(ZWNJ) / U+200D(ZWJ) / U+FEFF(BOM/ZWNBSP)
- **站点水印清洗** (line 528-533): `^(本书首发于|转载请注明出处|本书来源于|本书首发自)[^，。；]*[，。；]?`
  - 在 trim 前跑; 非贪婪匹配 [^，。；]* 到首个句末标点截断, 避免误伤真实内容
  - [，。；]? 可选吞掉句末标点, 防止残留孤立标点
  - g 标志支持多次匹配(理论上单行字段只命中一次, 但 g 兜底防多水印拼接)
- **重复标点压缩** (line 535-541): `v.replace(/([!?。！？])\1+/g, '$1')`
  - !!! → !, 。。。 → 。, ??? → ?, ！！！ → ！
  - 仅压缩 3 种连续重复标点(! ? 。 及其全角形式), 不动其他标点避免误伤
    (如 `--` 是分隔符, `...` 是省略号 —— 这些不在压缩范围)
  - 反向引用 `\1+` 匹配"捕获组1的字符重复1次以上", 替换为 $1 实现压缩

#### ② cleanIntro (line 550, 多行简介)
- **零宽字符剥离** (line 557-558): 同 cleanTextField
- **简介末尾推广段剥离** (line 575-587):
  - 从末尾向前扫, 连续命中"本书首发于/正版阅读请到/敬请关注/请记住/最新章节请到/
    一秒记住/本书来源于/转载请注明/本书首发自"等推广词的段全删
  - 遇到非推广段即停, 保留中间正常简介
  - 简介末尾几段常为"本书首发于 xxx, 敬请关注" / "正版阅读请到 xxx" 等推广段
- **简介开头元数据剥离** (line 583-586):
  - 从开头向后扫, 连续命中"字数/状态/分类/作者/书名/类型/更新时间/最新章节/
    写作进度/完成进度[:：]"等元数据前缀的段全删
  - 站点模板残留的元数据行, 与简介无关
  - 走"连续命中即剥"策略(非全文搜索), 避免误伤简介中合法提及"字数"的段落

#### ③ cleanChapterTitle (line 594, 章节标题)
- **零宽字符剥离**: 继承自 cleanTextField
- **卷标题剥离** (line 600-614):
  - 正则: `^第[一二三四五六七八九十百千0-9]+卷\s+\S+?\s+(第[一二三四五六七八九十百千0-9]+(?:章|节|回|话|集))`
  - 匹配前缀"第N卷 卷名 第M章", 切片保留从"第M章"起始位置开始的剩余字符串
  - 如 "第一卷 玄黄界 第一章 大道" → 只保留 "第一章 大道"
  - 卷名本应单独存到 volume 字段(rules.toc.fields.volume), 当前章节标题不应包含
  - 非贪婪匹配 `\S+?` 卷名, 避免误伤"第一卷中" 这类正常短语(短语无后续"第N章"则不剥)
  - 卷号支持中文数字一二三...十百千万 + 阿拉伯数字
  - 不破坏现有 junk 切割: 卷剥离在 junk 切割之前跑, 剥后字符串更短, junk 切割更精准
- **新增 normalizeChapterNumber() 导出函数** (line 686-703):
  - 章节标题形态各异("第1章" / "第一章" / "第001章" / "Chapter 1" / "1." / "01 "),
    但语义上的章节序号是同一个。本函数将各种形态归一化为统一数字字符串(供 sort/dedup):
    - "第3章 大道" → "3"
    - "第三章 大道" → "3"
    - "第003章 大道" → "3"
    - "Chapter 3 Foo" → "3"
    - "3. 大道" → "3"
    - "卷一 第三章" → "3" (仅取章号, 不取卷号)
    - 无法识别序号 → null (调用方应回退到字符串排序)
  - ★不修改标题文本: cleanChapterTitle 保留原文(用户体验优先, 不强制改写)
  - 仅供排序键生成/去重指纹计算用, 不影响存储与展示
- **新增 cnNumToInt() helper** (line 662-684):
  - 中文数字→int 转换, 支持 1-9999 范围
  - 纯阿拉伯数字直接 parseInt; 中文数字解析(一/二...十/十一/二十/一百零五 等)

#### ④ cleanContentHtml (line 155, 章节正文)
- **水印段落识别** (line 223-249, cheerio DOM 1.55 步):
  - 在 removeSelectors 之后 data-id 重排之前(cheerio DOM 上跑)
  - `<p>` 整段含站点 URL 推广/公众号推广/扫码下载/加入书签引导/章末推广段等水印特征词时
    整段 `<p>` 全删(.remove() 节点不留空 `<p></p>` 壳)
  - 与 removeAdLines 的文本级正则不同: removeAdLines 跑在序列化 HTML 上只剥匹配子串,
    会留空 `<p></p>` 壳(后续 empty-p 清理才回收); 此处在 cheerio DOM 上直接 .remove()
  - ★长度闸门 120 字: 段落过长视为正文叙事(可能含 URL 但属合法内容,
    如"他打开了 https://example.com 这个网站"), 不剥
  - ★特征词集 6 类水印词任一命中即剥:
    1. 裸域名灌水(www.xxx.com / xxx.cc / xxx.top 等)
    2. 公众号推广(敬请期待/敬请关注/扫码关注/扫码下载/关注微信公众号)
    3. 阅读引导(加入书签/为了方便下次阅读/本章未完/点击下一页)
    4. 站点水印(本书首发于/请记住本书/最新章节请到/一秒记住)
    5. 推广话术(为您提供...精彩小说/本站首发/本站更新最快)
    6. 下载引导(下载APP/下载客户端/下载手机版)
- **首行/末行剥离** (line 373-411, cheerio DOM 6 步):
  - 在 normalize + rebuild 之后 final return 之前跑
  - 首段剥离: 短文本(≤80 字)且匹配"第N章/Chapter N"形态则删
    (源站把章节标题作为正文第一段输出, 与目录中已有章节标题重复)
  - 末段剥离: 短文本(≤200 字)且匹配"本章未完/点击下一页/敬请期待/加入书签"或含裸域名则删
    (源站末行常为"本章未完点击下一页"等"下一页"引导)
  - ★不破坏 normalize: 此步在 normalize + rebuild 之后跑, 输出已是 `<p>line</p>...` 形态,
    cheerio 装载零成本; .remove() 仅删节点不重排, 段落顺序保持
  - 用 cheerio 重新装载 HTML(轻量, 仅 <p> 节点), 取首段 .text() 命中模式则删;
    重新查找末段(因首段可能已被删, $paras 已失效)
- **零宽字符剥离** (line 198, 414, 与 plainText/HTML 两个分支同口径):
  - plainText 分支: `text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D\uFEFF]/g, '')`
  - HTML 分支: `out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u200B-\u200D\uFEFF]/g, '').trim()`
  - 同步剥离零宽字符(U+200B/U+200C/U+200D/U+FEFF), 与 cleanTextField/cleanIntro 同口径

## ReDoS 防护保持

新增正则全部满足 ReDoS 闸门要求:
- 全部走非贪婪 `.*?` 或字符类 `[\u200B-\u200D\uFEFF]`, 无嵌套量词
- `([!?。！？])\1+` 反向引用 + 量词, 但无嵌套量词形态(不命中 `[+*]\s*\)\s*[+*{]` 闸门)
- 卷标题正则 `^第[一二三四五六七八九十百千0-9]+卷\s+\S+?\s+(...)` 无嵌套量词
- 水印特征词 `.test()` 走简单 alternation, 无回溯空间
- 长度闸门(120字/80字/200字)限制匹配空间, 进一步降低 ReDoS 风险

## 控制字符剥离规则一致性

零宽字符剥离规则与现有 `[\x00-\x08\x0B\x0C\x0E-\x1F]` 一致:
- 零宽字符 `[\u200B-\u200D\uFEFF]` 紧随其后追加, 不改变原有行为
- `\t\n\r` 不在剥离类内(与正文出口同口径, 供按行切段用)

## 验证

- `bunx tsc --noEmit` → 0 errors ✓
- `bun run lint` → 0 errors / 0 warnings ✓
- cleaner.ts 函数签名全部保持向后兼容:
  - cleanTextField(raw, maxLength?) ✓
  - cleanIntro(raw, maxLength=2000) ✓
  - cleanChapterTitle(raw, bookName?) ✓
  - cleanContentHtml(raw, cfgOverride?) ✓
  - normalizeChapterNumber(title) 为新增导出 ✓
- 新增 helper:
  - cnNumToInt(s) → number|null (中文数字→int)
  - CN_NUM_MAP 常量 (中文数字字符映射表)

## 文件清单

| 文件 | 操作 | 行数 |
|------|------|------|
| scripts/seed-rule-fanqianxs.ts | 新建 | ~220 |
| scripts/seed-rule-trxsw.ts | 新建 | ~210 |
| src/lib/crawl/cleaner.ts | 修改 | +180 (新增 7 处清洗逻辑 + normalizeChapterNumber 函数 + cnNumToInt helper + CN_NUM_MAP 常量) |

## 完成确认

- [x] 2 个新 seed-rule 脚本创建完成 (fanqianxs + trxsw)
- [x] cleaner.ts 新增 7 处噪声清洗功能, 覆盖 4 个核心函数
- [x] 新增 normalizeChapterNumber 导出函数供排序/去重识别用
- [x] 不破坏现有 ReDoS 防护
- [x] 不破坏现有控制字符剥离规则
- [x] tsc --noEmit 通过 (0 errors)
- [x] bun run lint 通过 (0 errors / 0 warnings)
- [x] worklog.md 追加 R11-1A 记录
- [x] agent-ctx/R11-1A-full-stack-developer.md 工作记录完成
