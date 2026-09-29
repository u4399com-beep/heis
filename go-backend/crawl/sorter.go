// sorter.go — 目录项排序 + 镜像反转还原 + 相邻 URL 去重 (R70-B 目标C).
//
// 核心功能:
//   - NormalizeTocOrder: 整表镜像反转还原 (源站整表反转生成时镜像还原)
//   - dedupAdjacentSameURL: 相邻同 URL 项去重 (源站翻页边界重复提取)
//   - extractChapterNumber: 章节标题编号提取 (支持 第N章 / Chapter N / N. / N 形式)
//
// 设计背景 (用户需求 #6 乱序重排):
//
//      部分源站 TOC 是按"最新在前"生成 (latest first), 即整表位置反转. 直接落库
//      会让用户翻书时第 1 章其实是源站第 N 章, 顺序错乱. NormalizeTocOrder 检测
//      整表反转 (递减对占比 ≥ 80%) 并整表位置镜像还原 (新表 [i] = 旧表 [n-1-i],
//      而非 sort.SliceStable 按编号重排, 避免同编号并列项内部顺序丢失).
//
// 触发条件 (保守, 避免误触发):
//  1. items 长度 >= 4 (小于 4 时数据点太少, 不做判断)
//  2. 相邻同 URL 去重后仍 >= 4 项
//  3. 相邻对 (i, i+1) 中, 两项均能提取到章节编号的对子 (comparable pairs)
//     里, 递减对 (num[i] > num[i+1]) 占比 >= 80%
//     满足以上 → 整表镜像反转; 否则原样返回.
//
// 同编号并列项处理:
//   - 相邻对 num[i] == num[i+1] 视为 neutral (既非 dec 也非 inc), 不计入
//     comparable pairs (避免误判 "3 3 3 3" 为 0 dec → 不反转, 但实际无信号)
//   - 镜像反转后, 同编号项内部顺序也镜像 (新表 [n-1-i] = 旧表 [i]), 保
//     确定性 (同输入同输出), 不依赖 Go map 迭代
//
// 无编号项 (番外/楔子/序章/尾声) 处理:
//   - extractChapterNumber 返 (0, false); 在 pair counting 中跳过 (不计入
//     comparable pairs), 避免误判
//   - 镜像反转时位置也镜像 (新表 [n-1-i] = 旧表 [i]), 与有编号项一致
//   - 特殊章节 (楔子/番外/序章/尾声/后记/前言/引子) 不在编号提取范围, 全部
//     返 (0, false), 与无编号项同口径
//
// 空数组/小数组处理:
//   - len == 0 → 返 nil (与用户测试用例 "空 → nil" 一致)
//   - len < 4 → 返 dedupAdjacentSameURL(items) (去重后原样返, 不做镜像判断)
//
// 性能:
//   - 时间复杂度 O(n) (单遍扫描 + 必要时一遍镜像反转)
//   - 空间复杂度 O(n) (镜像反转需 new slice; 原样返则 share 原 slice header)
//   - 不依赖 sort.SliceStable (避免 O(n log n) + 同编号并列内部顺序丢失)
package crawl

import (
        "regexp"
        "strconv"
        "strings"
)

// ---------- 预编译正则 (R70-B 目标C, 包级 init 一次编译) ----------

// chapterNumCNRe — 中文 "第N章/节/回/话/集" 编号提取 (N 为阿拉伯数字).
//
//      不支持中文数字 (一二三...), 因中文数字转换复杂 (十/百/千/万组合),
//      而源站章节编号绝大多数用阿拉伯数字 (e.g. "第123章"). 中文数字章节会
//      返 (0, false) 不计入 comparable pairs, 不影响 dec/inc 判断 (保守不误判).
//      注: chapterHeadCNRe (cleaner.go line 361) 用相同 pattern 但仅做 MatchString
//      (剥首段章节号), 此处用 FindStringSubmatch 提取数字子串做 int 转换.
var chapterNumCNRe = regexp.MustCompile(`第\s*(\d+)\s*(?:章|节|回|话|集)`)

// chapterNumENRe — 英文 "Chapter N" / "CHAPTER N" 编号提取 (N 为阿拉伯数字).
//   注: "Ch.N" / "Chap N" 短前缀由 chapterNumENShortRe 处理 (本 regex 仅匹配
//   "chapter" 全词, 不匹配 "Ch."/"Chap." 缩写 — 原注释头误标 Ch.N/Chap N 属
//   ENShort 域, 本轮一并纠正).
//
//      BUG-330 (P3) 修复: 原 `(?i)chapter\s*(\d+)` 无词边界锚 — "chapter" 作
//      子串匹配 "subchapter"/"prechapter"/"endchapter" 等以 "chapter" 结尾
//      的合成词 → 误提取编号 (e.g. 标题 "Subchapter 5 — Intro" 命中 "chapter 5"
//      → 返 5, 但 "subchapter" 非 "chapter", NormalizeTocOrder dec/inc 对计数
//      被歪曲, 可能误触发整表镜像反转或漏反转). 与 cleaner.go chapterHeadENRe
//      `(?i)^Chapter\s+\d+` (行首 ^ 锚 + \s+ 防 "subchapter" 误命中) 不一致 —
//      sorter 无 ^ 锚 (需匹配 "Volume 2 Chapter N" 非 Chapter 起首的标题), 故
//      漏. 修复: 加 `\b` 前缀 (词边界). "subchapter" 中 "b→c" 均词字符无边界
//      → 不匹配; "Chapter N" / "Volume 2 Chapter N" 前为起始/空格/标点 → 边界
//      → 匹配. `\b` 不影响 "Chapter5" 无空格形态 (\b 在串首, \s* 允零空白, 与原
//      \s* 同). 同步修注释: 原行 "\s+ 至少一个空白" 与 regex `\s*` (零或多) 不
//      符 (R108-B 注 sorter 用 \s* 允 "Chapter5" 无空格, cleaner 用 \s+ 严格),
//      改 "\s* 零或多空白". 71 Rule 0 用 "Subchapter N" 形态 (中文站用 第N章,
//      英文站用 Chapter N 标准形态); 0 用户受影响, 防御性 + 一致性修复. latent
//      自 R38 TS→Go 迁移 (47 轮未发现因 71 Rule 0 触 sorter 路径含 "subchapter"
//      标题, 多用 第N章 / Chapter N 标准形态).
//      (?i) 大小写不敏感; \b 词边界 (防 "subchapter" 子串误命中); \s* 零或多
//      空白 (允 "Chapter5" 无空格, 与原 \s* 同); \d+ 数字子串提取.
var chapterNumENRe = regexp.MustCompile(`(?i)\bchapter\s*(\d+)`)

// chapterNumENShortRe — "Ch. 5" / "Chap.5" 短前缀英文编号提取.
var chapterNumENShortRe = regexp.MustCompile(`(?i)^ch(?:ap)?\.?\s*(\d+)`)

// chapterNumLeadingRe — 行首 "N. 标题" 或 "N 标题" 编号提取 (N 为阿拉伯数字).
//
//      ^ 锚定行首; \d+ 数字子串; (?:\.\s*|\s+) 后跟点+空白 或 纯空白.
var chapterNumLeadingRe = regexp.MustCompile(`^(\d+)(?:\.\s*|\s+)`)

// chapterNumPureLeadingRe — 行首纯数字 (无后续标点/空白要求, e.g. "123" 单独成段).
//
//      仅当标题就是纯数字时匹配 (e.g. "123" 作为标题). 比 chapterNumLeadingRe 更宽松,
//      兜底覆盖源站标题 = 章节号无前缀的 case.
var chapterNumPureLeadingRe = regexp.MustCompile(`^(\d+)$`)

// extractChapterNumber — 从章节标题提取章节编号 (int).
//
//      支持: 第N章/节/回/话/集 (阿拉伯数字), Chapter N, Ch.N, N. 标题, 纯 N.
//      不支持: 中文数字 (一二三...), 番外/楔子/序章/尾声/后记/前言/引子 (特殊章节).
//      返 (n, true) 成功提取; (0, false) 无法提取 (无编号或特殊章节).
//      注: 多个 pattern 命中时, 优先级 CN > EN > ENShort > Leading > PureLeading.
//        罕见 case "第5章 Chapter 10" 两种编号都存在, 取 CN (5) 优先 (源站通常章节号
//        唯一, 双编号是装饰性的, 主编号是 第N章).
//
//      R116-B 精简-1: 删除 `if title == "" { return 0, false }` dead-branch.
//        strings.TrimSpace("") 返 "" → 紧接 `if t == ""` 已 cover 空 title +
//        纯空白 title ("  "/"\t" 等) 两 case. 首 `if title == ""` 是冗余 fast-
//        path (TrimSpace("") 即时返, 0 0 perf 损失), 与 R104-B SmartResumeSort
//        started sort `if != ... return ...; return false` 同款 "checked-then-
//        fall-through 冗余分支" precedent. 行为 0 变化 ("" → t="" → return; "  "
//        → t="" → return; "第5章" → t="第5章" → 走 regex). -3 行.
func extractChapterNumber(title string) (int, bool) {
        t := strings.TrimSpace(title)
        if t == "" {
                return 0, false
        }
        // 1. 第N章 / 第N节 / 第N回 / 第N话 / 第N集
        if m := chapterNumCNRe.FindStringSubmatch(t); len(m) >= 2 {
                if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
                        return n, true
                }
        }
        // 2. Chapter N
        if m := chapterNumENRe.FindStringSubmatch(t); len(m) >= 2 {
                if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
                        return n, true
                }
        }
        // 3. Ch.N / Chap.N (短前缀)
        if m := chapterNumENShortRe.FindStringSubmatch(t); len(m) >= 2 {
                if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
                        return n, true
                }
        }
        // 4. 行首 "N. 标题" / "N 标题"
        if m := chapterNumLeadingRe.FindStringSubmatch(t); len(m) >= 2 {
                if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
                        return n, true
                }
        }
        // 5. 纯数字标题 (e.g. "123")
        if m := chapterNumPureLeadingRe.FindStringSubmatch(t); len(m) >= 2 {
                if n, err := strconv.Atoi(m[1]); err == nil && n > 0 {
                        return n, true
                }
        }
        return 0, false
}

// dedupAdjacentSameURL — 相邻同 URL 项去重 (源站翻页边界重复提取兜底).
//
//      语义: 仅去重相邻 (i, i+1) 同 URL; 不相邻的同 URL 视为合法不同章节 (源站
//        分页占位/翻页链路中可能出现非相邻同 URL 但内容不同的 case).
//      空 URL 项: 不参与去重 (URL="" 视为无链接, 不算重复, 保留).
//      始终返新 slice (R70-B BUG-83 修复): caller NormalizeTocOrder 后续判断
//        len<4 时返 dedup 结果, 若 dedup 返原 slice header, caller 后续 mutate
//        会污染上游 TocResult.Items. 故 len==0 返 nil, len>=1 走 main path
//        (make + append) 返独立 slice; 1000 章 alloc 一次 8KB 可忽略.
//      R103-B 精简: 原 `if len(items) <= 1` + 内嵌 `if len(items) == 0` +
//        `return append([]TocItem(nil), items...)` (len==1 早返) 与 main path
//        行为等价 (main path len==1 走 make(0,1)+append(items[0])+空 loop =
//        新 1-元素 slice), 早返冗余. 合并为单 `if len(items) == 0 { return nil }`
//        守卫, len==1 fall through main path. 行为 0 变化 (alloc 次数 0 变化).
func dedupAdjacentSameURL(items []TocItem) []TocItem {
        if len(items) == 0 {
                return nil
        }
        out := make([]TocItem, 0, len(items))
        out = append(out, items[0])
        for i := 1; i < len(items); i++ {
                // R70-B BUG-84 (P2) 修复: 原设想 `items[i].URL == items[i-1].URL` 直接比较,
                //   但若两项 URL 均为空 (URL=""), 会被误判为重复去重 → 丢合法项.
                //   修复: 加 `items[i].URL != ""` 前置条件, 空 URL 不参与去重.
                if items[i].URL != "" && items[i].URL == items[i-1].URL {
                        continue
                }
                out = append(out, items[i])
        }
        return out
}

// NormalizeTocOrder — 整表镜像反转还原 + 相邻同 URL 去重 (R70-B 目标C 用户需求 #6).
//  1. 空 items → 返 nil (测试用例 "空 → nil")
//  2. 相邻同 URL 去重 (dedupAdjacentSameURL)
//  3. dedup 后 len < 4 → 返 dedup 结果 (测试用例 "<4 → 不动")
//  4. 提取每项章节编号; 统计 comparable pairs (相邻对, 两项均有编号) 中
//     dec (num[i] > num[i+1]) / (dec + inc) 占比
//  5. 占比 >= 0.8 → 整表位置镜像反转 (新表 [i] = 旧表 [n-1-i])
//  6. 否则返 dedup 结果 (测试用例 "升序 → 不动" + "80% 阈值不足不反转")
//     确定性: 单遍扫描 + 镜像反转, 不依赖 Go map 迭代 (避免同输入不同输出).
//     性能: O(n) 时间 + O(n) 空间 (镜像反转需 new slice).
//     注: caller 应在 ParseToc 返回后立即调本函数, 再存入 BookMetaContext.TocItems
//     (供 FinalizeBook latestChapter 取末项 + main.go getBookViewData 渲染).
func NormalizeTocOrder(items []TocItem) []TocItem {
        if len(items) == 0 {
                return nil
        }
        // 1. 相邻同 URL 去重
        deduped := dedupAdjacentSameURL(items)
        // 2. 小数组 (<4) 不做镜像判断
        if len(deduped) < 4 {
                return deduped
        }
        // 3. 提取每项章节编号
        n := len(deduped)
        nums := make([]int, n)
        hasNum := make([]bool, n)
        for i, it := range deduped {
                num, ok := extractChapterNumber(it.Title)
                nums[i] = num
                hasNum[i] = ok
        }
        // 4. 统计 comparable pairs (相邻对, 两项均有编号)
        decPairs := 0
        incPairs := 0
        for i := 0; i < n-1; i++ {
                if !hasNum[i] || !hasNum[i+1] {
                        continue // 至少一项无编号, 跳过 (neutral pair)
                }
                if nums[i] > nums[i+1] {
                        decPairs++
                } else if nums[i] < nums[i+1] {
                        incPairs++
                }
                // num[i] == num[i+1]: 同编号并列项, neutral, 不计入 (不触发反转)
        }
        // 5. 镜像反转触发: decPairs / (decPairs + incPairs) >= 0.8
        comparable := decPairs + incPairs
        if comparable == 0 {
                // 全部相邻对均无编号 (e.g. 番外/楔子/序章 等无编号章节), 无信号, 不反转
                return deduped
        }
        ratio := float64(decPairs) / float64(comparable)
        if ratio < 0.8 {
                // 递减占比不足 80%, 不反转 (测试用例 "80% 阈值不足不反转")
                return deduped
        }
        // 6. 整表位置镜像反转: 新表 [i] = 旧表 [n-1-i]
        //   R70-B BUG-85 (P2) 修复: 原设想 `for i, j := 0, n-1; i < j; i, j = i+1, j-1
        //   { deduped[i], deduped[j] = deduped[j], deduped[i] }` 原地交换, 但 deduped
        //   是 caller 传入 items 的复制 (dedupAdjacentSameURL 返新 slice), 原地交换
        //   会污染 caller 的 deduped 返回值. 改为 new slice 镜像写入, 保留 deduped
        //   原值 (caller 不受影响; 1000 章 alloc 一次 8KB 可忽略).
        out := make([]TocItem, n)
        for i := 0; i < n; i++ {
                out[i] = deduped[n-1-i]
        }
        return out
}
