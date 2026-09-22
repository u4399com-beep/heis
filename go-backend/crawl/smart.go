// smart.go — 智能分类 / 智能完结判断 (R38-1C).
//
// 与 TS 端 src/lib/crawl/smart.ts 同口径核心功能:
//   - CATEGORY_KEYWORDS (标准 14 分类 + 关键词权重)
//   - CATEGORY_ALIASES (源站分类名变体合并到标准 14 分类)
//   - NormalizeCategory (归一化: 精确别名命中 → 标准分类 → 模糊包含 → 原名)
//   - MatchCategoryByText (关键词评分 + 已有分类优先匹配)
//   - DetectCompleteFromText (连载态优先, 已完/连载/未知三态)
//   - SmartCompleteDetect (源站状态字段 → 简介 → 末章标题 → 书名标注 四级启发式)
//
// 已知差异 (Go 端简化):
//   - SmartCategory LLM 兜底未实现 (z-ai-web-dev-sdk 仅 Node 可用), Go 端走 source +
//     keyword 两层, LLM 兜底返回 method="none"
//   - wordMatches (英文单词 \b 词边界) 用 Go regexp 包 `\b...\b` 实现, 中文走 Contains
package crawl

import (
        "regexp"
        "strings"
        "sync"
)

// 标准分类 + 关键词权重 (与 TS 端 CATEGORY_KEYWORDS 同款)
var categoryKeywords = []struct {
        name string
        kws  []string
}{
        {"玄幻", []string{"玄幻", "修罗", "斗气", "魔法学院", "异界", "大陆", "废材", "逆天", "神帝", "武魂"}},
        {"奇幻", []string{"奇幻", "史诗", "骑士", "法师", "精灵", "龙族", "矮人", "魔兽"}},
        {"武侠", []string{"武侠", "江湖", "剑客", "侠", "武林", "门派", "轻功", "内力", "镖局"}},
        {"仙侠", []string{"仙侠", "修真", "修仙", "筑基", "金丹", "元婴", "渡劫", "灵气", "仙人", "道法"}},
        {"都市", []string{"都市", "重生", "赘婿", "神豪", "总裁", "兵王", "神医", " urb ", "打工", "逆袭", "求婚", "离婚"}},
        {"言情", []string{"言情", "甜宠", "恋爱", "霸总", "婚恋", "公主", "新娘", "嫁", "爱恋", "心动"}},
        {"历史", []string{"历史", "穿越", "朝代", "大唐", "大明", "大清", "三国", "水浒", "宋朝", "始皇", "皇帝", "王朝"}},
        {"军事", []string{"军事", "抗战", " war ", "士兵", "特种兵", "战场", "部队", "军官"}},
        {"游戏", []string{"游戏", "网游", "电竞", "副本", "升级", "系统", "玩家", "战队", "开黑"}},
        {"科幻", []string{"科幻", "星际", "末世", "丧尸", "机甲", "飞船", "外星", "末日", "AI", "人工智能", "虫族"}},
        {"悬疑", []string{"悬疑", "推理", "侦探", "凶案", "犯罪", "谜团", "刑警", "法医", "命案"}},
        {"灵异", []string{"灵异", "鬼", "阴阳", "风水", "盗墓", "僵尸", "驱魔", "诡异"}},
        {"体育", []string{"体育", "足球", "篮球", "奥运", "冠军", "教练", "联赛"}},
        {"轻小说", []string{"轻小说", "萌妹", "校园", "社团", "二次元", "青梅", "学妹", "学姐"}},
        {"现实", []string{"现实", "职场", "创业", "商战", "生活", "家庭", "医生", "教师"}},
}

// 源站分类名变体合并到标准 14 分类 (与 TS 端 CATEGORY_ALIASES 同款)
var categoryAliases = map[string]string{
        // 玄幻
        "玄幻小说": "玄幻", "玄幻魔法": "玄幻", "魔幻": "玄幻", "魔幻玄幻": "玄幻",
        "异界大陆": "玄幻", "异世大陆": "玄幻", "东方玄幻": "玄幻", "异界幻想": "玄幻",
        // 奇幻
        "奇幻小说": "奇幻", "西方奇幻": "奇幻", "史诗奇幻": "奇幻", "奇幻魔法": "奇幻",
        // 武侠
        "武侠小说": "武侠", "传统武侠": "武侠", "新武侠": "武侠", "武侠仙侠": "武侠",
        // 仙侠
        "仙侠小说": "仙侠", "修真": "仙侠", "修仙": "仙侠", "古典仙侠": "仙侠", "现代仙侠": "仙侠",
        "幻想仙侠": "仙侠",
        // 都市
        "都市娱乐": "都市", "都市异能": "都市", "都市生活": "都市", "都市言情": "都市",
        "现代都市": "都市", "都市职业": "都市", "青春都市": "都市", "都市青春": "都市",
        // 言情
        "言情小说": "言情", "现代言情": "言情", "古代言情": "言情", "总裁豪门": "言情",
        "甜宠": "言情", "豪门": "言情", "婚恋": "言情", "青春言情": "言情",
        // 历史
        "历史军事": "历史", "历史小说": "历史", "穿越历史": "历史", "古代": "历史",
        "架空历史": "历史", "历史架空": "历史", "两宋元明": "历史", "历朝历代": "历史",
        // 军事
        "军事小说": "军事", "战争": "军事", "抗战": "军事", "军旅": "军事", "军事战争": "军事",
        // 游戏
        "游戏小说": "游戏", "网游": "游戏", "电竞": "游戏", "虚拟网游": "游戏", "游戏竞技": "游戏",
        // 科幻
        "科幻小说": "科幻", "末世危机": "科幻", "星际科幻": "科幻", "机甲": "科幻",
        "未来科技": "科幻", "科幻末世": "科幻",
        // 悬疑
        "悬疑推理": "悬疑", "推理": "悬疑", "侦探": "悬疑", "恐怖悬疑": "悬疑", "刑侦": "悬疑",
        // 灵异
        "灵异鬼怪": "灵异", "鬼怪": "灵异", "盗墓": "灵异", "恐怖": "灵异", "诡异": "灵异",
        // 体育
        "体育竞技": "体育", "竞技": "体育", "足球": "体育", "篮球": "体育", "体育运动": "体育",
        // 轻小说
        "轻文": "轻小说", "日本轻小说": "轻小说",
        // 现实
        "现实生活": "现实", "职场": "现实", "商战": "现实", "社会": "现实", "现实主义": "现实",
}

// NormalizeCategory — 归一化分类名 → 标准分类.
//  1. 精确别名命中 → 返回标准分类
//  2. 标准 14 分类直接返回
//  3. 模糊: 源站分类名包含标准分类名 → 合并 ("玄幻魔法" includes "玄幻" → "玄幻")
//  4. 无法合并 → 返回原名 (让上层关键词/LLM 兜底)
func NormalizeCategory(name string) string {
        n := strings.TrimSpace(name)
        if n == "" {
                return ""
        }
        // 1. 精确别名命中
        if v, ok := categoryAliases[n]; ok {
                return v
        }
        // 2. 标准 14 分类直接返回
        for _, c := range categoryKeywords {
                if c.name == n {
                        return n
                }
        }
        // 3. 模糊: 包含标准分类名 (长名合并到短标准)
        for _, c := range categoryKeywords {
                if len(n) > len(c.name) && strings.Contains(n, c.name) {
                        return c.name
                }
        }
        return n
}

// MatchCategoryByText — 关键词评分匹配.
//  1. 直接命中已有分类名 (归一化后, 优先标准分类)
//  2. 关键词评分 (只返回标准 14 分类, 长度 >=2 权重 2, 长度 1 权重 1)
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
// 与 TS 端 smartCategory 同口径, 仅 LLM 兜底路径未实现 (z-ai-web-dev-sdk 不可用).
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
