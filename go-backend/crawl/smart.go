// smart.go — 智能分类 / 智能完结判断 (R38-1C).
//
// 核心功能:
//   - CATEGORY_KEYWORDS (标准 15 分类 4 字名 + 关键词权重, R52-1A 改 4 字)
//   - CATEGORY_ALIASES (源站分类名变体合并到标准 15 分类)
//   - NormalizeCategory (归一化: 精确别名命中 → 标准分类 → 模糊包含 → 原名)
//   - MatchCategoryByText (关键词评分 + 已有分类优先匹配)
//   - DetectCompleteFromText (连载态优先, 已完/连载/未知三态)
//   - SmartCompleteDetect (源站状态字段 → 简介 → 末章标题 → 书名标注 四级启发式)
//
// R52-1A: 标准分类名改为 4 字名 (与 DB schema 一致):
//   玄幻奇幻 / 奇幻魔幻 / 武侠江湖 / 仙侠修真 / 都市生活 / 言情小说 /
//   历史军事 / 军事战争 / 游戏竞技 / 科幻未来 / 悬疑推理 / 灵异鬼怪 /
//   体育竞技 / 轻小说类 / 现实生活
//   原 2 字名 (玄幻/奇幻/...) 通过 categoryAliases 兜底转 4 字, 兼容旧源站分类.
//
// 已知差异 (Go 端简化):
//   - SmartCategory LLM 兜底未实现 (z-ai-web-dev-sdk 仅 Node 可用), Go 端走 source +
//     keyword 两层, LLM 兜底返回 method="none"
//   - wordMatches (英文单词 \b 词边界) 用 Go regexp 包 `\b...\b` 实现, 中文走 Contains
package crawl

import (
        "regexp"
        "sort"
        "strings"
        "sync"
)

// 标准分类 + 关键词权重 (R52-1A: 改 4 字名, 15 分类).
//   原 2 字名 (玄幻/奇幻/...) 通过 categoryAliases 兜底转 4 字 (e.g. "玄幻" → "玄幻奇幻").
//   关键词保持不变 (玄幻/修罗/斗气 仍然匹配 "玄幻奇幻" 分类), 评分逻辑同 R44-1C.
var categoryKeywords = []struct {
        name string
        kws  []string
}{
        {"玄幻奇幻", []string{"玄幻", "修罗", "斗气", "魔法学院", "异界", "大陆", "废材", "逆天", "神帝", "武魂"}},
        {"奇幻魔幻", []string{"奇幻", "史诗", "骑士", "法师", "精灵", "龙族", "矮人", "魔兽"}},
        {"武侠江湖", []string{"武侠", "江湖", "剑客", "侠", "武林", "门派", "轻功", "内力", "镖局"}},
        {"仙侠修真", []string{"仙侠", "修真", "修仙", "筑基", "金丹", "元婴", "渡劫", "灵气", "仙人", "道法"}},
        {"都市生活", []string{"都市", "重生", "赘婿", "神豪", "总裁", "兵王", "神医", " urb ", "打工", "逆袭", "求婚", "离婚"}},
        {"言情小说", []string{"言情", "甜宠", "恋爱", "霸总", "婚恋", "公主", "新娘", "嫁", "爱恋", "心动"}},
        {"历史军事", []string{"历史", "穿越", "朝代", "大唐", "大明", "大清", "三国", "水浒", "宋朝", "始皇", "皇帝", "王朝"}},
        {"军事战争", []string{"军事", "抗战", " war ", "士兵", "特种兵", "战场", "部队", "军官"}},
        {"游戏竞技", []string{"游戏", "网游", "电竞", "副本", "升级", "系统", "玩家", "战队", "开黑"}},
        {"科幻未来", []string{"科幻", "星际", "末世", "丧尸", "机甲", "飞船", "外星", "末日", "AI", "人工智能", "虫族"}},
        {"悬疑推理", []string{"悬疑", "推理", "侦探", "凶案", "犯罪", "谜团", "刑警", "法医", "命案"}},
        {"灵异鬼怪", []string{"灵异", "鬼", "阴阳", "风水", "盗墓", "僵尸", "驱魔", "诡异"}},
        {"体育竞技", []string{"体育", "足球", "篮球", "奥运", "冠军", "教练", "联赛"}},
        {"轻小说类", []string{"轻小说", "萌妹", "校园", "社团", "二次元", "青梅", "学妹", "学姐"}},
        {"现实生活", []string{"现实", "职场", "创业", "商战", "生活", "家庭", "医生", "教师"}},
}

// 源站分类名变体合并到标准 15 分类 4 字名 (R52-1A 改 4 字目标).
//   原 2 字名 (玄幻/武侠/...) 通过本表转 4 字, 兼容旧源站分类 (source 端未升级到 4 字
//   名, NormalizeCategory 走 alias 兜底). 4 字名本身 (玄幻奇幻/武侠江湖/...) 不在
//   本表 (它们是标准名, NormalizeCategory 第 2 步直接返回).
var categoryAliases = map[string]string{
        // 2 字旧名 → 4 字新名 (兼容旧源站分类)
        "玄幻": "玄幻奇幻", "奇幻": "奇幻魔幻", "武侠": "武侠江湖", "仙侠": "仙侠修真",
        "都市": "都市生活", "言情": "言情小说", "历史": "历史军事", "军事": "军事战争",
        "游戏": "游戏竞技", "科幻": "科幻未来", "悬疑": "悬疑推理", "灵异": "灵异鬼怪",
        "体育": "体育竞技", "现实": "现实生活",

        // 玄幻奇幻
        "玄幻小说": "玄幻奇幻", "玄幻魔法": "玄幻奇幻", "魔幻": "玄幻奇幻", "魔幻玄幻": "玄幻奇幻",
        "异界大陆": "玄幻奇幻", "异世大陆": "玄幻奇幻", "东方玄幻": "玄幻奇幻", "异界幻想": "玄幻奇幻",
        // 奇幻魔幻
        "奇幻小说": "奇幻魔幻", "西方奇幻": "奇幻魔幻", "史诗奇幻": "奇幻魔幻", "奇幻魔法": "奇幻魔幻",
        // 武侠江湖
        "武侠小说": "武侠江湖", "传统武侠": "武侠江湖", "新武侠": "武侠江湖", "武侠仙侠": "武侠江湖",
        // 仙侠修真
        "仙侠小说": "仙侠修真", "修真": "仙侠修真", "修仙": "仙侠修真", "古典仙侠": "仙侠修真",
        "现代仙侠": "仙侠修真", "幻想仙侠": "仙侠修真",
        // 都市生活
        "都市娱乐": "都市生活", "都市异能": "都市生活", "都市言情": "都市生活",
        "现代都市": "都市生活", "都市职业": "都市生活", "青春都市": "都市生活", "都市青春": "都市生活",
        // 言情小说
        "现代言情": "言情小说", "古代言情": "言情小说", "总裁豪门": "言情小说",
        "甜宠": "言情小说", "豪门": "言情小说", "婚恋": "言情小说", "青春言情": "言情小说",
        // 历史军事
        "历史小说": "历史军事", "穿越历史": "历史军事", "古代": "历史军事",
        "架空历史": "历史军事", "历史架空": "历史军事", "两宋元明": "历史军事", "历朝历代": "历史军事",
        // 军事战争
        "军事小说": "军事战争", "战争": "军事战争", "抗战": "军事战争", "军旅": "军事战争",
        // 游戏竞技
        "游戏小说": "游戏竞技", "网游": "游戏竞技", "电竞": "游戏竞技", "虚拟网游": "游戏竞技",
        // 科幻未来
        "科幻小说": "科幻未来", "末世危机": "科幻未来", "星际科幻": "科幻未来", "机甲": "科幻未来",
        "未来科技": "科幻未来", "科幻末世": "科幻未来",
        // 悬疑推理
        "推理": "悬疑推理", "侦探": "悬疑推理", "恐怖悬疑": "悬疑推理", "刑侦": "悬疑推理",
        // 灵异鬼怪
        "鬼怪": "灵异鬼怪", "盗墓": "灵异鬼怪", "恐怖": "灵异鬼怪", "诡异": "灵异鬼怪",
        // 体育竞技
        "竞技": "体育竞技", "足球": "体育竞技", "篮球": "体育竞技", "体育运动": "体育竞技",
        // 轻小说类
        //   R53-1A 修复 BUG-1: 原 alias 表漏 "轻小说" 本身 (3 字). 源站分类 "轻小说" 在
        //     NormalizeCategory: 1. alias 查 "轻小说" → 未命中; 2. standard 4 字名循环
        //     "轻小说" != "轻小说类"; 3. fuzzy len("轻小说")=3 > len("轻小说类")=4 → false
        //     跳过; 4. 返回 "轻小说" 原名. SmartCategory 第 1 步 source 路径用
        //     normalized="轻小说" 与 existing categories (4 字标准名) 比较 → 不匹配 → 退
        //     到 keyword 路径 (命中关键词 "轻小说" → "轻小说类"), 但 method="keyword"
        //     而非 "source" → 上层若按 method 路由 (source 优先级高) 会误降级. 补
        //     "轻小说" → "轻小说类" alias 让 source 路径直接命中, method="source".
        "轻小说": "轻小说类", "轻文": "轻小说类", "日本轻小说": "轻小说类", "国产轻小说": "轻小说类",
        "动漫": "轻小说类", "二次元小说": "轻小说类",
        // 现实生活
        "职场": "现实生活", "商战": "现实生活", "社会": "现实生活", "现实主义": "现实生活",
}

// NormalizeCategory — 归一化分类名 → 标准 15 分类 4 字名.
//  1. 精确别名命中 → 返回标准分类 (4 字名)
//  2. 标准 15 分类 4 字名直接返回
//  3. 模糊: 源站分类名包含标准分类名 → 合并 ("玄幻魔法小说" includes "玄幻奇幻" → "玄幻奇幻")
//  4. 无法合并 → 返回原名 (让上层关键词/LLM 兜底)
//  R52-1A: 分类名从 2 字 → 4 字. 第 3 步模糊匹配 len(n) > len(c.name) 仍生效, 但 4 字
//    名本身已是 4 字长, 包含关系要求源站分类名 ≥5 字才触发模糊匹配 (e.g. "玄幻奇幻小说"
//    → "玄幻奇幻"). 4 字源站分类名 (如 "东方玄幻") 通过 categoryAliases 兜底转 4 字.
//  R53-1A 修复 BUG-9: 第 3 步模糊匹配 len() 是 byte 长度, 对中文 (3 bytes/rune)
//    与 ASCII (1 byte/rune) 混合的源站分类名会误判. 例: n="abc玄幻奇幻" (5 runes,
//    15 bytes) vs c.name="玄幻奇幻" (4 runes, 12 bytes). byte 长度 15>12 true →
//    触发模糊匹配. 但若 n="玄幻奇幻" (4 runes, 12 bytes) vs c.name="玄幻奇幻类"
//    (5 runes, 15 bytes), byte 12>15 false → 不触发 (正确, 因 n 不该合并到自己).
//    混合 case 如 n="玄幻奇幻x" (5 runes, 13 bytes) vs c.name="玄幻奇幻" (4 runes,
//    12 bytes): byte 13>12 true (与 rune 5>4 一致, 正确触发). 但 n="a玄幻奇幻" (5
//    runes, 13 bytes) vs c.name="玄幻奇幻" (4 runes, 12 bytes): byte 13>12 true,
//    rune 5>4 也 true → 一致. 极端 case n="玄幻奇幻abc" (7 runes, 18 bytes) vs
//    c.name="玄幻奇幻类" (5 runes, 15 bytes): byte 18>15 true, 但 rune 7>5 也 true
//    → 一致. 实际 byte 与 rune 比较结果在中文场景下几乎总是一致 (因每 rune ≥1
//    byte, byte_count ≥ rune_count). 但为防极端 case (源站分类名含 emoji 等 4-
//    byte rune), 改用 []rune 长度比较更准确 + 与 MatchCategoryByText 同口径.
func NormalizeCategory(name string) string {
        n := strings.TrimSpace(name)
        if n == "" {
                return ""
        }
        // 1. 精确别名命中
        if v, ok := categoryAliases[n]; ok {
                return v
        }
        // 2. 标准 15 分类 4 字名直接返回
        for _, c := range categoryKeywords {
                if c.name == n {
                        return n
                }
        }
        // 3. 模糊: 包含标准分类名 (长名合并到短标准)
        //   R53-1A BUG-9: 用 []rune 长度比较替代 byte 长度, 防 emoji/4-byte rune
        //   误判 (与 MatchCategoryByText 同口径).
        nRunes := []rune(n)
        for _, c := range categoryKeywords {
                if len(nRunes) > len([]rune(c.name)) && strings.Contains(n, c.name) {
                        return c.name
                }
        }
        return n
}

// MatchCategoryByText — 关键词评分匹配.
//  1. 直接命中已有分类名 (归一化后, 优先标准分类)
//  2. 关键词评分 (只返回标准 15 分类 4 字名, 长度 >=2 权重 2, 长度 1 权重 1)
// R44-1C 修复: 原 text[:3000] 按字节切片, 中文 (3-byte UTF-8) 在边界处会切出孤立
//   continuation byte, 可能导致后续 strings.Contains 误命中 (代理对部分字节凑成另一词).
//   改用 []rune 安全截断.
func MatchCategoryByText(text string, existingCategories []string) string {
        if len([]rune(text)) > 3000 {
                text = string([]rune(text)[:3000])
        }
        if text == "" {
                return ""
        }
        // 1. 直接命中已有分类名 (归一化后匹配)
        if len(existingCategories) > 0 {
                normalized := []string{}
                for _, c := range existingCategories {
                        normalized = append(normalized, NormalizeCategory(c))
                }
                for _, c := range normalized {
                        if strings.Contains(text, c) {
                                return c
                        }
                }
        }
        // 2. 关键词评分
        bestName := ""
        bestScore := 0
        for _, c := range categoryKeywords {
                score := 0
                for _, kw := range c.kws {
                        kt := strings.TrimSpace(kw)
                        if wordMatches(text, kt) {
                                if len([]rune(kt)) >= 2 {
                                        score += 2
                                } else {
                                        score += 1
                                }
                        }
                }
                if score > 0 && score > bestScore {
                        bestScore = score
                        bestName = c.name
                }
        }
        return bestName
}

// SmartCategoryResult — 智能分类结果.
type SmartCategoryResult struct {
        Category string
        Method   string // source | keyword | llm | none
}

// SmartCategory — 智能分类 (Go 端: source + keyword 两层, LLM 兜底返回 none).
// 与 smartCategory 同口径, 仅 LLM 兜底路径未实现 (z-ai-web-dev-sdk 不可用).
func SmartCategory(bookName, intro, sourceCategory string, existingCategories []string) SmartCategoryResult {
        // 1. 来源站点自带分类 (归一化合并)
        if sourceCategory != "" {
                normalized := NormalizeCategory(strings.TrimSpace(sourceCategory))
                for _, c := range existingCategories {
                        if c == normalized {
                                return SmartCategoryResult{Category: c, Method: "source"}
                        }
                }
        }
        // 2. 关键词规则
        kw := MatchCategoryByText(bookName+"\n"+intro, existingCategories)
        if kw != "" {
                return SmartCategoryResult{Category: kw, Method: "keyword"}
        }
        // 3. LLM 兜底 (Go 端未实现, 返回 none)
        return SmartCategoryResult{Category: "", Method: "none"}
}

// ---------- 智能完结判断 ----------

var completeWords = []string{
        "已完结", "已完本", "完结", "完本", "全本", "大结局", "全书完", "正文完",
        "无弹窗全本", "final", "completed", "complete", "finished",
}

var ongoingWords = []string{
        "连载中", "连载", "未完结", "未完待续", "新书", "更新中",
        "ongoing", "on going", "on-going", "serial", "serializing", "updating",
        "unfinished", "incomplete", "hiatus", "paused",
}

var englishWordRe = regexp.MustCompile(`^[a-z]+$`)

// R45-1A: wordMatchesReCache 缓存英文关键词预编译的正则, 避免每次 MatchString
// 都 regexp.Compile. MatchCategoryByText 会遍历 15 个分类 × ~11 关键词 = 165 次,
// 若每次重编译 100+ 正则 GC 压力大. sync.Map 高并发读路径几乎无锁.
var wordMatchesReCache sync.Map

// wordMatches — 英文单词 \b 词边界匹配, 中文走 Contains.
//  - 'final' 不再命中 'finally'; 'complete' 不再命中 'completely' (Bug 28)
//  - 含连字符/空格的英文短语走 Contains (短语形态本身隔离良好)
// R45-1A: 缓存预编译正则, 避免每次 regexp.Compile.
func wordMatches(t, w string) bool {
        if englishWordRe.MatchString(w) {
                var re *regexp.Regexp
                if v, ok := wordMatchesReCache.Load(w); ok {
                        re = v.(*regexp.Regexp)
                } else {
                        r, err := regexp.Compile(`\b` + regexp.QuoteMeta(w) + `\b`)
                        if err != nil {
                                return strings.Contains(t, w)
                        }
                        re = r
                        wordMatchesReCache.Store(w, re)
                }
                return re.MatchString(strings.ToLower(t))
        }
        return strings.Contains(t, w)
}

// DetectCompleteFromText — 文本完结判断.
//  - 小写化匹配 (中英文词表统一大小写不敏感)
//  - 未完优先 (避免"未完结"被"完结"误判)
// R44-1C 修复: 原 text[:2000] 按字节切片不安全, 改用 []rune 防多字节字符斩半.
func DetectCompleteFromText(text string) string {
        if len([]rune(text)) > 2000 {
                text = string([]rune(text)[:2000])
        }
        t := strings.ToLower(text)
        if t == "" {
                return "unknown"
        }
        // 未完优先
        for _, w := range ongoingWords {
                if wordMatches(t, w) {
                        return "ongoing"
                }
        }
        for _, w := range completeWords {
                if wordMatches(t, w) {
                        return "completed"
                }
        }
        return "unknown"
}

// SmartCompleteDetectInput — 智能完结判断输入.
type SmartCompleteDetectInput struct {
        StatusField        string
        Intro              string
        LatestChapterTitle string
        BookName           string
        LastChapterTitle   string
}

// SmartCompleteDetectResult — 智能完结判断结果.
type SmartCompleteDetectResult struct {
        Status string // completed | ongoing | unknown
        Reason string
}

// SmartCompleteDetect — 智能判断完结 (源站状态 → 简介 → 末章标题 → 书名标注).
func SmartCompleteDetect(in SmartCompleteDetectInput) SmartCompleteDetectResult {
        if in.StatusField != "" {
                r := DetectCompleteFromText(in.StatusField)
                if r != "unknown" {
                        s := in.StatusField
                        // R44-1C 修复: 原 s[:30] 按字节切片不安全, 改用 []rune 防多字节字符斩半.
                        if len([]rune(s)) > 30 {
                                s = string([]rune(s)[:30])
                        }
                        return SmartCompleteDetectResult{Status: r, Reason: "源站状态: " + s}
                }
        }
        if in.Intro != "" {
                r := DetectCompleteFromText(in.Intro)
                if r != "unknown" {
                        return SmartCompleteDetectResult{Status: r, Reason: "简介关键词"}
                }
        }
        if in.LatestChapterTitle != "" {
                r := DetectCompleteFromText(in.LatestChapterTitle)
                if r != "unknown" {
                        return SmartCompleteDetectResult{Status: r, Reason: "最新章节标题"}
                }
        }
        if in.LastChapterTitle != "" {
                r := DetectCompleteFromText(in.LastChapterTitle)
                if r != "unknown" {
                        return SmartCompleteDetectResult{Status: r, Reason: "目录末章标题"}
                }
        }
        if in.BookName != "" {
                r := DetectCompleteFromText(in.BookName)
                if r != "unknown" {
                        return SmartCompleteDetectResult{Status: r, Reason: "书名标注"}
                }
        }
        return SmartCompleteDetectResult{Status: "unknown", Reason: "无法判断"}
}

// ---------- R64-B 采集增强 B5: 智能续采优先级排序 ----------
//
// 断点恢复 (任务重启 / 进程 crash 后 resumeTasks) 时, 优先采未完成的书/章,
// 而非从头. 本函数对 pending 列表按优先级排序:
//   优先级 1: 已开始且接近完成的书 (ChaptersDone > 0 且 完成率 > 0.5).
//             按完成率降序 (越接近完成的越优先采, 早点入库让用户可读).
//   优先级 2: 已开始但完成率低的书 (ChaptersDone > 0 且 完成率 ≤ 0.5).
//             按 LastFetchAt 升序 (最久未采的先采, 避免长期挂起).
//   优先级 3: 未开始的书 (ChaptersDone == 0).
//             按 LastFetchAt 升序 (最久未采的先采, 但都为 0 时按原顺序).
// 价值: 断点恢复时优先完成接近完成的书 (避免半本就停), 提升采集完成率 +
//   用户感知 (能读到完整书). 现有 runner.go 的 resumeTasks 是按 Task 创建
//   顺序恢复, 不考虑书级进度. 本函数让 caller (runner) 在 resume 前先排序
//   pending 列表, 再按排序后顺序采集.

// SmartResumeItem — 续采优先级排序输入 (单本书的进度快照).
type SmartResumeItem struct {
        BookID        string
        ChaptersDone  int    // 已采集章节数 (来自 DB COUNT)
        ChaptersTotal int    // 目录总章节数 (来自 DB Toc 表 / ParsedBook)
        LastFetchAt   int64  // 上次采集时间 (UnixMilli, 0 = 从未采过)
}

// SmartResumeSort — 续采优先级排序. 稳定排序 (不改变同优先级内原顺序).
//   返回新 slice, 不修改入参. 空 / 单元素直接返副本.
func SmartResumeSort(items []SmartResumeItem) []SmartResumeItem {
        if len(items) <= 1 {
                out := make([]SmartResumeItem, len(items))
                copy(out, items)
                return out
        }
        // 分三组
        var nearDone, started, fresh []SmartResumeItem
        for _, it := range items {
                if it.ChaptersDone == 0 {
                        fresh = append(fresh, it)
                        continue
                }
                r := resumeRatio(it)
                if r > 0.5 {
                        nearDone = append(nearDone, it)
                } else {
                        started = append(started, it)
                }
        }
        // nearDone: 完成率降序 (越接近完成越优先)
        //   使用稳定 sort (sort.SliceStable) 保持同 ratio 的原顺序
        sort.SliceStable(nearDone, func(i, j int) bool {
                ri := resumeRatio(nearDone[i])
                rj := resumeRatio(nearDone[j])
                if ri != rj {
                        return ri > rj // 降序
                }
                // 同 ratio: LastFetchAt 升序 (最久未采先)
                return nearDone[i].LastFetchAt < nearDone[j].LastFetchAt
        })
        // started: LastFetchAt 升序 (最久未采先)
        sort.SliceStable(started, func(i, j int) bool {
                if started[i].LastFetchAt != started[j].LastFetchAt {
                        return started[i].LastFetchAt < started[j].LastFetchAt
                }
                return false // 同时间保持原顺序
        })
        // fresh: LastFetchAt 升序 (最久未采先, 0 视为最久)
        sort.SliceStable(fresh, func(i, j int) bool {
                if fresh[i].LastFetchAt != fresh[j].LastFetchAt {
                        return fresh[i].LastFetchAt < fresh[j].LastFetchAt
                }
                return false
        })
        // 拼接: nearDone (优先) → started (次) → fresh (最后)
        out := make([]SmartResumeItem, 0, len(items))
        out = append(out, nearDone...)
        out = append(out, started...)
        out = append(out, fresh...)
        return out
}

// resumeRatio — 计算单本书的完成率 (0.0 ~ 1.0). ChaptersTotal=0 时返 0.
func resumeRatio(it SmartResumeItem) float64 {
        if it.ChaptersTotal <= 0 {
                return 0.0
        }
        return float64(it.ChaptersDone) / float64(it.ChaptersTotal)
}
