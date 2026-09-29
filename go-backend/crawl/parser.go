// parser.go — HTML/JSON 解析 + CSS 选择器 + 翻页 + URL 绝对化 (R38-1C).
//
// 核心功能:
//   - stripLeadingBom (剥前导 BOM / 前导空白)
//   - extractMetaTags / extractJsonLd (og:* / article:* / JSON-LD 兜底)
//   - decodeHtmlEntities (命名 + 数字实体, 单遍解码防链式二次)
//   - applyTransform (stripTags / replaceFrom (ReDoS 防护) / decode / index)
//   - parseList (容器型列表 + JSON 数组模式)
//   - parseBook (主规则 + meta/JSON-LD 兜底)
//   - parseToc (含翻页 + 乱序重排 + 去重)
//   - parseContent (含翻页合并 + cleanContentHtml)
//   - absolutize (协议过滤 + 自引用过滤)
//   - urlVars / jsonGet / jsonArrayAt / jsonToString
//
// Go 实现: goquery (CSS 选择器); regexp RE2; encoding/json;
// JSON.parse. XPath 暂不支持 (需 antchfx/xpath, 后续 wiring 引入).
package crawl

import (
        "context"
        "encoding/json"
        "fmt"
        "net/url"
        "regexp"
        "sort"
        "strconv"
        "strings"
        "sync"
        "unicode/utf8"

        "github.com/PuerkitoBio/goquery"
)

// ---------- BOM / 前导空白剥离 ----------

// StripLeadingBom — 切除响应体前导 BOM (\uFEFF / \uFFFE) + 前导空白.
// (中间 BOM 保留, 可能为正文零宽字符; 仅剥响应体最前的 BOM 才安全)
func StripLeadingBom(html string) string {
        if html == "" {
                return html
        }
        i := 0
        for i < len(html) {
                r, size := utf8.DecodeRuneInString(html[i:])
                if r == 0xFEFF || r == 0xFFFE {
                        i += size
                        continue
                }
                if r == 0x20 || r == 0x09 || r == 0x0A || r == 0x0D {
                        i += size
                        continue
                }
                break
        }
        if i > 0 {
                return html[i:]
        }
        return html
}

// ---------- 结构化数据提取 (反反爬增强) ----------

// R43-1B: 预编译 JSON-LD 类型识别正则 (避免 ExtractJsonLd 每次 call 重新编译,
// 高频路径 GC 压力. R42-1B 前 regexp.MustCompile 在循环内每次 call 都重编).
var jsonLdTypeRe = regexp.MustCompile(`(?i)Article|Book|CreativeWork|Chapter|WebPage|PublicationIssue`)

// ExtractMetaTags — 提取 og:* / article:* / book:* / twitter:* meta 标签 → 字段映射表.
func ExtractMetaTags(doc *goquery.Document) map[string]string {
        out := map[string]string{}
        if doc == nil {
                return out
        }
        doc.Find("meta[property], meta[name]").Each(func(_ int, s *goquery.Selection) {
                key, _ := s.Attr("property")
                if key == "" {
                        key, _ = s.Attr("name")
                }
                key = strings.ToLower(strings.TrimSpace(key))
                val := strings.TrimSpace(s.AttrOr("content", ""))
                if key == "" || val == "" {
                        return
                }
                // 仅收录已知结构化前缀
                if strings.HasPrefix(key, "og:") || strings.HasPrefix(key, "article:") ||
                        strings.HasPrefix(key, "book:") || strings.HasPrefix(key, "twitter:") {
                        if _, exists := out[key]; !exists {
                                out[key] = val
                        }
                }
        })
        return out
}

// ExtractJsonLd — 提取 JSON-LD (schema.org) 块 → 字段映射表.
// 仅采信 Article/Book/CreativeWork/Chapter/WebPage 类型, 防 BreadcrumbList 噪音.
func ExtractJsonLd(doc *goquery.Document) map[string]string {
        out := map[string]string{}
        if doc == nil {
                return out
        }
        doc.Find(`script[type="application/ld+json"]`).Each(func(_ int, s *goquery.Selection) {
                raw := strings.TrimSpace(s.Text())
                if raw == "" {
                        return
                }
                var doc1 any
                if err := json.Unmarshal([]byte(raw), &doc1); err != nil {
                        return
                }
                // @graph 多块容器解构
                var items []any
                switch v := doc1.(type) {
                case []any:
                        items = v
                case map[string]any:
                        if g, ok := v["@graph"].([]any); ok {
                                items = g
                        } else {
                                items = []any{v}
                        }
                default:
                        items = []any{v}
                }
                for _, it := range items {
                        m, ok := it.(map[string]any)
                        if !ok {
                                continue
                        }
                        typeStr := ""
                        if t, ok := m["@type"].(string); ok {
                                typeStr = t
                        } else if t, ok := m["type"].(string); ok {
                                typeStr = t
                        } else if arr, ok := m["@type"].([]any); ok {
                                // BUG-244 (P3): JSON-LD spec allows @type to be string OR
                                //   array of strings (e.g. {"@type": ["Article", "NewsArticle"]}).
                                //   原实现仅处理 string case, array case `m["@type"].(string)`
                                //   fails → fall through to m["type"] (non-standard, also
                                //   missing) → typeStr="" → jsonLdTypeRe.MatchString("")=false
                                //   → continue (skip entry). Multi-type JSON-LD entries
                                //   (WordPress / schema.org validator 常见) 全部静默丢失,
                                //   fallback metadata 丢失. 修复: array → 遍历找首个匹配
                                //   jsonLdTypeRe 的 element (与 string case 同口径, substring
                                //   match). 不 join (避免非内容型如 BreadcrumbList 误命中
                                //   jsonLdTypeRe — 需 element 级精确匹配). latent 自 R38
                                //   TS→Go 迁移 (47 轮未发现因 71 Rule 0 配 JSON-LD @type
                                //   array, 多用单 string @type 或 meta tag fallback 接住).
                                for _, x := range arr {
                                        if s, ok := x.(string); ok && jsonLdTypeRe.MatchString(s) {
                                                typeStr = s
                                                break
                                        }
                                }
                        }
                        // 仅采信内容性 schema 类型
                        if !jsonLdTypeRe.MatchString(typeStr) {
                                continue
                        }
                        pick := func(k string) string {
                                v, ok := m[k]
                                if !ok || v == nil {
                                        return ""
                                }
                                switch x := v.(type) {
                                case string:
                                        return x
                                case float64:
                                        return strconv.FormatFloat(x, 'f', -1, 64)
                                case int:
                                        return strconv.Itoa(x)
                                case []any:
                                        if len(x) > 0 {
                                                switch first := x[0].(type) {
                                                case string:
                                                        return first
                                                case map[string]any:
                                                        if n, ok := first["name"].(string); ok {
                                                                return n
                                                        }
                                                        if v, ok := first["@value"].(string); ok {
                                                                return v
                                                        }
                                                }
                                        }
                                case map[string]any:
                                        if n, ok := x["name"].(string); ok {
                                                return n
                                        }
                                        if v, ok := x["@value"].(string); ok {
                                                return v
                                        }
                                }
                                return ""
                        }
                        fields := []struct {
                                target  string
                                sources []string
                        }{
                                {"title", []string{"headline", "name", "title"}},
                                {"description", []string{"description", "abstract", "about"}},
                                {"author", []string{"author", "creator", "publisher"}},
                                {"content", []string{"articleBody", "text"}},
                                {"keywords", []string{"keywords"}},
                                {"category", []string{"genre", "category"}},
                                {"cover", []string{"image", "thumbnailUrl"}},
                                {"latestChapter", []string{"datePublished", "dateModified"}},
                        }
                        for _, f := range fields {
                                target, sources := f.target, f.sources
                                if _, exists := out[target]; exists {
                                        continue
                                }
                                for _, src := range sources {
                                        v := pick(src)
                                        if v != "" {
                                                out[target] = v
                                                break
                                        }
                                }
                        }
                }
        })
        return out
}

// ---------- HTML 实体解码 (单遍, 防链式二次) ----------

var entityRe = regexp.MustCompile(`(?i)&(?:nbsp|amp|lt|gt|quot|apos|#x[0-9a-f]+|#[0-9]+);`)

var entityBasic = map[string]string{
        "nbsp": " ", "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'",
}

// fromCodePointSafe — 越界 / 孤立代理区返回空.
func fromCodePointSafe(cp int) string {
        if cp < 0 || cp > 0x10FFFF {
                return ""
        }
        if cp >= 0xD800 && cp <= 0xDFFF {
                return ""
        }
        return string(rune(cp))
}

// DecodeEntitiesOnce — 单遍解码白名单实体 (不回扫替换产物防链式二次).
func DecodeEntitiesOnce(s string) string {
        if !strings.Contains(s, "&") {
                return s
        }
        return entityRe.ReplaceAllStringFunc(s, func(m string) string {
                key := strings.ToLower(m[1 : len(m)-1])
                if v, ok := entityBasic[key]; ok {
                        return v
                }
                if strings.HasPrefix(key, "#x") {
                        n, err := strconv.ParseInt(key[2:], 16, 32)
                        if err != nil {
                                return m
                        }
                        return fromCodePointSafe(int(n))
                }
                if strings.HasPrefix(key, "#") {
                        n, err := strconv.ParseInt(key[1:], 10, 32)
                        if err != nil {
                                return m
                        }
                        return fromCodePointSafe(int(n))
                }
                return m
        })
}

// ---------- 字段提取 (applyTransform) ----------

var (
        reDoSNestedQuantifier = regexp.MustCompile(`[+*]\s*\)\s*[+*{]`)
        tagStripRe            = regexp.MustCompile(`<[^>]+>`)

        // R71-C BUG-91: 预编译 cssSelect 数字开头 id 修复正则 (原每次 cssSelect call
        //   都重编译, hot path 每字段提取都跑, GC 压力大, 与 R47-1A cleaner.go /
        //   R45-1C smart.go 同款优化).
        idNumericFixRe = regexp.MustCompile(`#(\d[\w-]*)`)

        // R71-C BUG-92: 预编译 ApplyTransform base64 数据正则 (原每次 ApplyTransform
        //   call 都重编译, decode=base64-json / base64 路径 hot path).
        base64DataRe = regexp.MustCompile(`base64,([A-Za-z0-9+/=_-]+)`)

        // R71-C BUG-93: 预编译 tokenizeJsonPath JSONPath 过滤正则 (原每次
        //   tokenizeJsonPath call 都重编译, JSON 规则路径 hot path).
        jsonPathEqRe = regexp.MustCompile(`@?\.?(\w+)\s*==\s*"?(.*?)"?\s*$`)
        jsonPathNeRe = regexp.MustCompile(`@?\.?(\w+)\s*!=\s*"?(.*?)"?\s*$`)

        // R71-C BUG-94: 预编译 applyConstTemplate 占位符正则 (原每次
        //   applyConstTemplate call 都重编译, const 字段路径 hot path).
        constTemplateRe = regexp.MustCompile(`\{([a-zA-Z_][a-zA-Z0-9_.]*)\}`)

        // R72-C BUG-98 (P2): 用户 ReplaceFrom pattern 编译缓存 (sync.Map).
        //   原 ApplyTransform line ~286 `regexp.Compile("(?i)" + src)` 每次 call 都重
        //   编译, hot path 每字段提取都跑. 1000 章 × 10 字段 × N ReplaceFrom = N 万次
        //   编译 → CPU 浪费 + GC 压力. 与 cleaner.compileUserAdPattern (R65-C BUG-42)
        //   同款 sync.Map 缓存: key=pattern (含 "(?i)" 前缀) value=compiledAdPattern
        //   {re, ok}. 首次 compile 后任务级复用率 ~100% (同 Rule 多次跑), 0 compile 开销.
        //   ReDoS 闸门 + 长度上限 1000 与原实现一致, 仅把 compile 提到 cache miss 路径.
        replaceFromUserCache sync.Map
)

// compileUserReplaceFrom — 用户 ReplaceFrom pattern 编译 + 缓存 (R72-C BUG-98).
//
//      与 cleaner.compileUserAdPattern 同口径: 首次 compile 后复用; ok=false 也缓存
//      (避免重复 compile 失败 pattern). ReDoS 闸门 (reDoSNestedQuantifier, 同文件 line
//      254) + 长度 ≤1000 (与原 ApplyTransform 内联闸门一致).
func compileUserReplaceFrom(src string) (*regexp.Regexp, bool) {
        if v, ok := replaceFromUserCache.Load(src); ok {
                cp := v.(compiledAdPattern)
                return cp.re, cp.ok
        }
        re, ok := func() (*regexp.Regexp, bool) {
                if src == "" || len(src) > 1000 {
                        return nil, false
                }
                if reDoSNestedQuantifier.MatchString(src) {
                        return nil, false
                }
                re, err := regexp.Compile("(?i)" + src)
                if err != nil {
                        return nil, false
                }
                return re, true
        }()
        replaceFromUserCache.Store(src, compiledAdPattern{re: re, ok: ok})
        return re, ok
}

// anyToString — JSON any 值 → 单行字符串 (float64 走 FormatFloat 不走科学计数).
//
//      BUG-301/302 (P3): 原 filterArray (line 1190) `fmt.Sprintf("%v", val)` +
//        mapToSortedKV (line 392) `fmt.Sprintf("%s=%v", k, m[k])` 对 float64 ≥ 1e6
//        或 ≤ 1e-5 返科学计数法 (e.g. 1000000 → "1e+06", 1e-10 → "1e-10"), 与
//        JsonToString (line 1363) strconv.FormatFloat('f', -1, 64) 返 "1000000"
//        不一致. 后果:
//          - BUG-301 filterArray: JSONPath `[?(@.count==1000000)]` 在 JSON
//            {"count":1000000} 上 valStr="1e+06" ≠ fv="1000000" → 比较静默
//            miss (filter 永不命中, JsonGet 返 []);
//          - BUG-302 mapToSortedKV: base64-json decode 的 float64 值走 kv
//            string "count=1e+06", 与直连 JsonToString "count=1000000" 不等
//            → 同 JSON 输入不同输出 (与 BUG-245 确定性目标矛盾).
//        修复: 抽 anyToString helper, float64 走 FormatFloat (与 JsonToString
//        line 1363 同口径); string 直返 (无 fmt 反射开销, hot path 常见类型);
//        bool/nil/[]any/map fallback `fmt.Sprintf("%v", v)` (历史行为, 罕见
//        case 不退化 — bool %v 同 FormatBool; nil %v "<nil>" 同历史; []any/map
//        %v 单行 "[1 2 3]" / "map[k:v]" 同历史, parseKVString 不被 \n 段裂).
//        与 BUG-245 (mapToSortedKV 确定性) + JsonToString (数值路径同口径)
//        协同闭环. 71 Rule 0 用大数 filter / base64-json float64 值; 0 用户
//        受影响, 未来 admin 配置后受益. latent 自 R38 TS→Go 迁移 (47 轮未发现
//        因 71 Rule 0 用 [?(@.count==N)] 大数 filter, 多用字符串字段比较如
//        [?(@.id=="abc")] 或无 filter; 0 用 base64-json decode 配大数值).
func anyToString(v any) string {
        switch x := v.(type) {
        case string:
                return x
        case float64:
                return strconv.FormatFloat(x, 'f', -1, 64)
        default:
                return fmt.Sprintf("%v", v)
        }
}

// mapToSortedKV — map[string]any → "k=v\n..." with sorted keys.
//
//      BUG-245 (P3): 原 ApplyTransform base64-json decode + JsonToString map case
//        用 `for k, val := range j` 迭代 map, Go map 迭代序非确定 → 同 JSON 输入
//        不同输出 (DB 字段 hash 不稳 / cache miss / test flaky). 修复: sort.Strings
//        (keys) 后遍历, 输出确定序. DRY: 两处重复的 map→"k=v\n..." 逻辑合并到本
//        helper (ApplyTransform base64-json 2 处 + JsonToString map case 1 处 = 3
//        callsite). 与 R84-B BUG-200 (utf8.RuneCountInString 替 []rune len) 同款
//        "确定性 + DRY" 优化.
//      BUG-302 (P3): 原 `fmt.Sprintf("%s=%v", k, m[k])` 对 float64 ≥ 1e6 返科学
//        计数 (e.g. 1000000 → "count=1e+06"), 与 JsonToString (line 1363)
//        FormatFloat 返 "count=1000000" 不等 → 同 JSON 输入不同输出 (违反
//        BUG-245 确定性目标). 修复: 改 `k + "=" + anyToString(m[k])` — string
//        concat (无 fmt 反射开销) + anyToString (float64 走 FormatFloat, 与
//        JsonToString 同口径). 详见 anyToString 注释. latent 自 R38 (47 轮未
//        发现, 71 Rule 0 用 base64-json decode 配大数 float 值).
func mapToSortedKV(m map[string]any) string {
        keys := make([]string, 0, len(m))
        for k := range m {
                keys = append(keys, k)
        }
        sort.Strings(keys)
        parts := make([]string, 0, len(keys))
        for _, k := range keys {
                parts = append(parts, k+"="+anyToString(m[k]))
        }
        return strings.Join(parts, "\n")
}

// decodeBase64JsonMap — base64-decode + JSON unmarshal → mapToSortedKV.
//
//      返 (s, true) 成功 (含空 map → s=""); (s="", false) unmarshal 失败 (caller
//      保留原 v). 与原 ApplyTransform base64-json 内联行为一致 (unmarshal 失败 v 不动,
//      unmarshal 成功含空 map v="" 空 join).
func decodeBase64JsonMap(b []byte) (string, bool) {
        var j map[string]any
        if err := json.Unmarshal(b, &j); err != nil {
                return "", false
        }
        return mapToSortedKV(j), true
}

// ApplyTransform — 字段值后处理 (stripTags / replaceFrom / decode / index).
// ReDoS 防护: 长度上限 1000 + 嵌套量词闸门 + chunk 200 字符切片跑.
// R72-C BUG-98 (P2): ReplaceFrom pattern 编译提到 compileUserReplaceFrom sync.Map
//
//      缓存 (与 cleaner.compileUserAdPattern 同口径), 0 compile 开销 (任务级复用).
func ApplyTransform(value string, rule FieldRule) string {
        v := value
        if rule.StripTags {
                v = tagStripRe.ReplaceAllString(v, "")
        }
        if rule.ReplaceFrom != "" {
                // R72-C BUG-98 (P2): 用 sync.Map 缓存 (避免每 ApplyTransform call 重 compile)
                re, ok := compileUserReplaceFrom(rule.ReplaceFrom)
                if ok && re != nil {
                        to := rule.ReplaceTo
                        if len(v) <= 200 {
                                v = re.ReplaceAllString(v, to)
                        } else {
                                // chunk 200 字符切片跑
                                out := ""
                                chunk := 200
                                runes := []rune(v)
                                for i := 0; i < len(runes); i += chunk {
                                        end := i + chunk
                                        if end > len(runes) {
                                                end = len(runes)
                                        }
                                        sub := string(runes[i:end])
                                        out += re.ReplaceAllString(sub, to)
                                }
                                v = out
                        }
                }
        }
        // decode (在 replaceFrom 之后, index 之前)
        switch rule.Decode {
        case "base64-json":
                if m := base64DataRe.FindStringSubmatch(v); m != nil {
                        if b, err := DecodeBase64(m[1]); err == nil {
                                if s, ok := decodeBase64JsonMap(b); ok {
                                        v = s
                                }
                        }
                } else {
                        if b, err := DecodeBase64(strings.TrimSpace(v)); err == nil {
                                if s, ok := decodeBase64JsonMap(b); ok {
                                        v = s
                                }
                        }
                }
        case "base64":
                if m := base64DataRe.FindStringSubmatch(v); m != nil {
                        b, err := DecodeBase64(m[1])
                        if err == nil {
                                v = string(b)
                        }
                } else {
                        b, err := DecodeBase64(strings.TrimSpace(v))
                        if err == nil {
                                v = string(b)
                        }
                }
        case "url-decode":
                if d, err := url.QueryUnescape(v); err == nil {
                        v = d
                }
        case "html-decode":
                v = DecodeEntitiesOnce(v)
        }
        if rule.Index != nil {
                parts := strings.Split(v, ",")
                filtered := []string{}
                for _, p := range parts {
                        p = strings.TrimSpace(p)
                        if p != "" {
                                filtered = append(filtered, p)
                        }
                }
                // 中文逗号也分割
                parts2 := []string{}
                for _, p := range filtered {
                        for _, q := range strings.Split(p, "，") {
                                q = strings.TrimSpace(q)
                                if q != "" {
                                        parts2 = append(parts2, q)
                                }
                        }
                }
                // R80-C BUG-173 (P3) 修复: 原条件 `*rule.Index < len(parts2)` 漏检负数 Index.
                //   经 sanitizeFieldRule 路径 Index 被 clampInt 钳到 [0, 999] 安全, 但
                //   ApplyTransform 是 export, 外部 caller 可传 *rule.Index=-1 → -1 < 1
                //   (len(parts2)=1) 命中 → parts2[-1] panic (index out of range).
                //   修复: 加 *rule.Index >= 0 前置条件 (与 RemoveAdLines line 555
                //   `idx >= 0 && idx < len(urls)` 同口径防御).
                if *rule.Index >= 0 && *rule.Index < len(parts2) {
                        v = parts2[*rule.Index]
                } else {
                        v = ""
                }
        }
        return strings.TrimSpace(v)
}

// ---------- CSS 选择器 (goquery) ----------

// cssSelect — 选择器容错执行: 数字开头 id 等非法选择器自动降级.
func cssSelect(doc *goquery.Document, scope *goquery.Selection, expr string) *goquery.Selection {
        if expr == "." {
                // "." = 取 scope 自身 (容器有 href/src 等属性的场景)
                if scope != nil {
                        return scope
                }
                return doc.Find("body").Children().First()
        }
        run := func(e string) *goquery.Selection {
                if scope != nil {
                        return scope.Find(e)
                }
                return doc.Find(e)
        }
        sel := run(expr)
        if sel.Length() > 0 {
                return sel
        }
        // #123box → [id="123box"] (数字开头 id)
        fixed := idNumericFixRe.ReplaceAllString(expr, `[id="$1"]`)
        if fixed != expr {
                return run(fixed)
        }
        return nil
}

// cssExtract — 提取首个匹配元素的属性 (text/html/href/src/属性名).
func cssExtract(doc *goquery.Document, scope *goquery.Selection, rule FieldRule) string {
        sel := cssSelect(doc, scope, rule.Expression)
        if sel == nil || sel.Length() == 0 {
                return ""
        }
        first := sel.First()
        attr := rule.Attr
        if attr == "" {
                attr = "text"
        }
        switch attr {
        case "text":
                return first.Text()
        case "html":
                h, _ := first.Html()
                return h
        case "href":
                h, _ := first.Attr("href")
                return h
        case "src":
                s, _ := first.Attr("src")
                return s
        default:
                return first.AttrOr(attr, "")
        }
}

// cssExtractAll — 提取所有匹配元素 (列表项遍历用).
func cssExtractAll(doc *goquery.Document, scope *goquery.Selection, rule FieldRule) []*goquery.Selection {
        sel := cssSelect(doc, scope, rule.Expression)
        if sel == nil {
                return nil
        }
        out := []*goquery.Selection{}
        sel.Each(func(_ int, s *goquery.Selection) {
                out = append(out, s)
        })
        return out
}

// ---------- Regex 提取 ----------

// R73-C BUG-105 (P3) 修复: regexExtractFirst / regexExtractAll 原每次 call 调
//
//      regexp.Compile("(?flags)expression"), hot path 每字段提取都跑 (FieldRegex
//      类型规则 + 容器 regex 模式 + findNextLink 兜底). 1000 章 × N regex 字段
//      × M 提取 = N*M*1000 次 compile → CPU 浪费 + GC 压力 (与 R65-C BUG-42
//      cleaner.removeAdLinesUserCache / R72-C BUG-98 parser.replaceFromUserCache
//      同款问题). 修复: sync.Map 缓存 (key=flags+expression value=compiledAdPattern{re, ok}).
//      首次 compile 后任务级复用率 ~100% (同 Rule 多次跑), 0 compile 开销. compile 失败
//      (无效正则) 也缓存 ok=false 避免重复尝试. 复用 cleaner.compiledAdPattern 类型
//      (同包可见, 0 重复定义). 不引入 ReDoS 闸门 (regex 提取是规则配置路径, 与
//      compileUserAdPattern/compileUserReplaceFrom 同口径 — admin Rule 编辑时 sanitize
//      已限长度 ≤2000, ReDoS 风险由配置侧承担, 此处仅做 compile 缓存).
var regexExtractCache sync.Map

// compileRegexRule — 编译 FieldRegex 规则的 (flags, expression) → *regexp.Regexp + 缓存.
//
//      首次 compile 后复用; ok=false 也缓存 (避免重复 compile 失败 pattern). flags 空时
//      默认 "gis" (与原 regexExtractFirst/All 同口径).
//
//      R81-C BUG-179 (P2) 修复: 原实现无 ReDoS 闸门 (R73-C BUG-105 注释声称"同口径"实
//      不符 — compileUserAdPattern/compileUserReplaceFrom 均有 reDoSNestedQuantifier 检查,
//      本函数没有). FieldRegex 类型规则经 sanitizeFieldRule 仅限长度 2000, 无 ReDoS 检查.
//      admin 可配置灾难性 regex 如 `(a+)+b` → regexExtractFirst/All 在 1MB HTML 上灾难
//      性回溯 → fetcher goroutine 卡死 → 池池耗尽 (与 R65-C BUG-42 compileUserAdPattern
//      同款风险). 修复: 加 reDoSNestedQuantifier.MatchString(expression) 闸门 + 表达式
//      长度上限 2000 (与 sanitizeFieldRule safeStr(v, 2000) 同口径). 命中即返 (nil, false)
//      缓存 (与 compileUserReplaceFrom 同款 pattern: 首次拒绝结果入 cache, 后续调用直接
//      返缓存, 0 重复 ReDoS 扫).
func compileRegexRule(flags, expression string) (*regexp.Regexp, bool) {
        if flags == "" {
                // R81-C BUG-181 (P1) 修复: 原 "gis" 默认在 Go RE2 不支持 — `g` 是 JS
                //   RegExp global flag (find all matches), Go regexp 包不支持 `g`,
                //   `(?gis)<expr>` compile 失败 "invalid or unsupported Perl syntax:
                //   `(?g`", regexExtractFirst/All 静默返 "" (FieldRegex 规则无显式 flags
                //   配置时全部 regex 提取失败). 原 TS 实现 regexExtract 用 JS new
                //   RegExp(expr, 'gis') + re.exec (单 match) / 'gi' + 循环 exec (多
                //   match), R38 TS→Go 迁移时保留 "gis" 默认但 Go 不支持, latent 自
                //   R38 (43 轮未发现, 因 ParseBook pick 顺序 fallback 到 JSON-LD /
                //   meta tag, 部分字段被 fallback 接住未察觉; ParseList/ParseToc 同款
                //   fallback 路径). Go 用 FindStringSubmatch / FindAllStringSubmatch 隐
                //   式 global (不需 `g` flag). 修复: 默认 "is" (case-insensitive +
                //   dotall, 与 JS 'is' 等价; 全局由 FindAllString API 提供不在 flag).
                flags = "is"
        }
        // BUG-315 (P3): filter flags to Go RE2-supported set (i/m/s/U). BUG-181
        //   fixed empty-flags default ("gis"->"is") but explicit flags="gis" (admin
        //   copying JS RegExp) still compiles (?gis) -> "unsupported Perl syntax"
        //   -> regex silently disabled -> FieldRegex extraction returns "". Go uses
        //   FindAllString for global semantics (no `g`; BUG-181 line 615). Drop
        //   g/y/u/x + others; preserve i/m/s/U. 71 Rule 0 用 flags="gis" 形态
        //   (多用空 flags); 0 生产命中, 防御性修复. latent 自 R81-C BUG-181
        //   (14 轮未发现因 BUG-181 仅修默认漏修 explicit case).
        filtered := make([]byte, 0, len(flags))
        for i := 0; i < len(flags); i++ {
                c := flags[i]
                if c == 'i' || c == 'm' || c == 's' || c == 'U' {
                        filtered = append(filtered, c)
                }
        }
        flags = string(filtered)
        if flags == "" {
                flags = "is"
        }
        key := flags + "\x00" + expression
        if v, ok := regexExtractCache.Load(key); ok {
                cp := v.(compiledAdPattern)
                return cp.re, cp.ok
        }
        // R81-C BUG-179: ReDoS 闸门 + 长度上限 (与 compileUserReplaceFrom 同口径).
        re, ok := func() (*regexp.Regexp, bool) {
                if expression == "" || len(expression) > 2000 {
                        return nil, false
                }
                if reDoSNestedQuantifier.MatchString(expression) {
                        return nil, false
                }
                re, err := regexp.Compile("(?" + flags + ")" + expression)
                if err != nil {
                        return nil, false
                }
                return re, true
        }()
        regexExtractCache.Store(key, compiledAdPattern{re: re, ok: ok})
        return re, ok
}

func regexExtractFirst(html string, rule FieldRule) string {
        re, ok := compileRegexRule(rule.Flags, rule.Expression)
        if !ok || re == nil {
                return ""
        }
        m := re.FindStringSubmatch(html)
        if m == nil {
                return ""
        }
        if len(m) > 1 {
                return m[1]
        }
        return m[0]
}

func regexExtractAll(html string, rule FieldRule) []string {
        re, ok := compileRegexRule(rule.Flags, rule.Expression)
        if !ok || re == nil {
                return nil
        }
        matches := re.FindAllStringSubmatch(html, -1)
        out := []string{}
        for _, m := range matches {
                if len(m) > 1 {
                        out = append(out, m[1])
                } else {
                        out = append(out, m[0])
                }
        }
        return out
}

// ---------- JSON 提取 ----------

// ParseJsonBody — 整体 JSON.parse (失败返回 nil).
func ParseJsonBody(html string) any {
        html = strings.TrimSpace(html)
        if html == "" {
                return nil
        }
        var v any
        if err := json.Unmarshal([]byte(html), &v); err != nil {
                return nil
        }
        return v
}

// JsonGet — JSON 点路径取值.
//   - "a.b.c" → 逐层下钻
//   - "items.0.title" → 数组下标
//   - "[]" 装饰可剔
//   - "field1||field2" → 取首个非空
//   - "$..field" / "..field" → 递归下降
//   - "$.field" / "$" → JSONPath 根引用 (R85-B BUG-216)
func JsonGet(root any, path string) any {
        if root == nil || path == "" {
                return nil
        }
        // 联合 "||" 分支
        if strings.Contains(path, "||") {
                // R95-B BUG-269 (P4): splitJsonOrPaths 替代 strings.Split, 尊重双引号
                //   内 "||" (与 BUG-248 splitJsonArrayPaths 对称; 详见 line 1029 注释).
                //   关键: len(parts)>1 才进 || 分支 — 若 path 仅含 quoted "||" (e.g.
                //   `items[?(@.f=="a||b")]` 无真 fallback), splitJsonOrPaths 返单元素,
                //   跳过本分支走 dot-path 解析 (否则 JsonGet 在含 quoted "||" 的 path
                //   上递归自身 → 死循环 stack overflow).
                parts := splitJsonOrPaths(path)
                if len(parts) > 1 {
                        for _, p := range parts {
                                p = strings.TrimSpace(p)
                                v := JsonGet(root, p)
                                if v == nil {
                                        continue
                                }
                                // R88-B BUG-233 (P3) 修复: || fallback 应取首个非空 (注释 line 618
                                //   "取首个非空"), 非首个非 nil. 原 `if v != nil` 让 {"title": "",
                                //   "name": "x"} 配 path "title||name" 返 "" (empty title 不 fall
                                //   back 到 name), 与注释不符 → 字段提取返空值. 修复: 也 skip empty
                                //   string value ("" 是合法 JSON 字符串值, 但语义上属"空"应触发
                                //   fallback; 其他类型 number/array/map 不 skip, 0 / [] / {} 各
                                //   自有语义不视作空). latent 自 R38 TS→Go 迁移 (47 轮未发现因
                                //   71 Rule 0 用 "||" 形态 path, 多用单字段 path 或 fallback 由
                                //   ApplyTransform defaultValue 接管).
                                if s, ok := v.(string); ok && s == "" {
                                        continue
                                }
                                return v
                        }
                        return nil
                }
        }
        // 递归下降
        if strings.HasPrefix(path, "$..") || strings.HasPrefix(path, "..") {
                key := strings.TrimPrefix(strings.TrimPrefix(path, "$"), "..")
                // R96-B BUG-273 (P4) 修复 (R85-B BUG-216 续): 原实现把整个 key
                //   (e.g. "$..a.b" 剥前缀后 "a.b") 当 literal key 传给
                //   recursiveCollect, recursiveCollect 走 m[key] 精确匹配 → JSON
                //   标准无 "a.b" 字面 key (dot 不是合法 JSON key 字符除非 quoted)
                //   → 永远返 []. 标准 JSONPath $..a.b 语义: 递归找所有 "a" key,
                //   对每个 "a" 值 navigate "b" (a 值是 map 时取 m["b"]). 与
                //   BUG-216 ($.field 单级 root 引用) 同款 "JSONPath 标准未对齐"
                //   family. 修复: 拆首段 key + 剩余 path, recursiveCollect 首段
                //   后对每个值递归 JsonGet(remaining) (JsonGet 内部递归处理
                //   ||/$../bracket/index 全语法, multi-level 链式 a.b.c →
                //   JsonGet(v, "b.c") → jsonGetByPath 导航). 71 Rule 0 用
                //   $..a.b 形态 (多用 $..field 单级或 a.b.c 直连); 0 用户受影响,
                //   未来 admin 配置后受益. latent 自 R38 TS→Go 迁移 (47 轮未
                //   发现). 注: 首段含特殊语法 (e.g. "$..a[0]" / "$..a||b") 走
                //   原 recursiveCollect (literal key 查找, 仍返 [], 维持 defer
                //   — 多语法混合需更深 grammar 解析, 超本轮 budget).
                //   R101-B BUG-292 (P3) 修复 (R96-B BUG-273 续): 原仅 split on
                //   `.` → key 含 `[` (e.g. $..a[0] / $..a["k"]) 无 dot, fall to
                //   recursiveCollect(root, "a[0]") literal 查找, 0 命中 (JSON
                //   无 "a[0]" 字面 key). 修复: split on 首个 `.` OR `[`
                //   (strings.IndexAny; `||` 语义在 recursive descent 模糊 —
                //   $..a||b 应 "递归找 a, 每个 a 值 ||b 兜底" 还是 "递归找 a
                //   或 b"? 标准 JSONPath 无 ||, 维持 defer 走原 literal 路径).
                //   firstKey 喂 recursiveCollect, remaining (含 `[` 起, e.g.
                //   "[0]" / "[\"k\"]" / "b.c") 喂 JsonGet (内部 tokenizeJsonPath
                //   + BUG-289/290/291 全语法). 与 BUG-273 ($..a.b 多级 dot) +
                //   BUG-289 (["k"] bracket) + BUG-290/291 (\" escape) 协同闭
                //   环. 71 Rule 0 用 $..a[0] / $..a["k"] 形态; 0 用户受影响.
                //   latent 自 R96-B BUG-273 (5 轮未补). 注: $..[0] (bracket 起
                //   首, splitAt=0 不 >0) 仍走 literal, 维持 defer (需
                //   recursiveCollect-all-nodes + per-node JsonGet, 超本轮).
                splitAt := strings.IndexAny(key, ".[")
                if splitAt > 0 {
                        firstKey := key[:splitAt]
                        var remaining string
                        if key[splitAt] == '.' {
                                remaining = key[splitAt+1:]
                        } else {
                                remaining = key[splitAt:] // keep '[' for JsonGet bracket parse
                        }
                        collected := recursiveCollect(root, firstKey)
                        out := []any{}
                        for _, v := range collected {
                                if next := JsonGet(v, remaining); next != nil {
                                        out = append(out, next)
                                }
                        }
                        return out
                }
                return recursiveCollect(root, key)
        }
        // R85-B BUG-216 (P3) 修复: JsonGet 未处理 "$." JSONPath 根引用前缀.
        //   原实现跳过此处直接走 jsonGetByPath, tokenizeJsonPath 把 "$" 当
        //   普通 key 查 m["$"] → nil → 整条路径返 nil. admin 配置 JSON 规则
        //   用 "$.title" (JSONPath 标准) 时字段全空 (与 "title" 直连路径行
        //   为不一致, latent 自 R38 TS→Go 迁移, 47 轮未发现因 ParseBook pick
        //   顺序 fallback 到 JSON-LD / meta tag 部分字段被接住). 修复: "$.key"
        //   等价 "key", "$.a.b" 等价 "a.b", "$" alone 返 root. 不影响 "$..key"
        //   (recursive descent 已上面接管) 与无前缀 "a.b.c" (HasPrefix 假, 不
        //   strip, 原行为不变).
        if path == "$" {
                return root
        }
        path = strings.TrimPrefix(path, "$.")
        // 标准点路径
        // [] 装饰可剔, [n] 下标, [k=v] 过滤
        return jsonGetByPath(root, path)
}

func recursiveCollect(node any, key string) []any {
        out := []any{}
        var walk func(n any)
        walk = func(n any) {
                switch v := n.(type) {
                case map[string]any:
                        if val, ok := v[key]; ok {
                                out = append(out, val)
                        }
                        for _, sub := range v {
                                walk(sub)
                        }
                case []any:
                        for _, sub := range v {
                                walk(sub)
                        }
                }
        }
        walk(node)
        return out
}

func jsonGetByPath(root any, path string) any {
        cur := root
        // 标准化: 去 [] 装饰, 但保留 [n] 下标 / [k=v] 过滤
        // 用 token 解析
        tokens := tokenizeJsonPath(path)
        for _, tk := range tokens {
                if cur == nil {
                        return nil
                }
                switch tk.kind {
                case tokenKey:
                        m, ok := cur.(map[string]any)
                        if !ok {
                                // R87-B BUG-216 (P3) 续修: dot-notation array index
                                //   "$.items.0.name" 原返 nil (tokenKey "0" 不识别
                                //   为数组下标, 需 [0] bracket notation). R85-B 仅
                                //   修了 "$." 前缀, dot-notation array 下标仍留作
                                //   未决项 #5. 修复: cur 是 []any 且 tk.key 是纯数
                                //   字 → 走 tokenIndex 路径 (与 [0] bracket 同口径).
                                //   安全: 仅当 cur 是 array 时转 (cur 是 map 时仍走
                                //   map path, {"0":"val"} 数字字符串 key 的 map 不被
                                //   误转, 因 m, ok := cur.(map[string]any) 在上面已
                                //   返 ok=true 走 m[tk.key]). tk.key 解析失败 / 越
                                //   界 → 返 nil (与原 []any + tokenKey 行为一致).
                                //   latent 自 R38 TS→Go 迁移 (47 轮未发现因 71 Rule
                                //   0 用 "items.0.title" 直连, 多用 "items[0].title"
                                //   或 "$..title" recursive descent).
                                if arr, ok2 := cur.([]any); ok2 {
                                        if n, err := strconv.Atoi(tk.key); err == nil && n >= 0 && n < len(arr) {
                                                cur = arr[n]
                                                continue
                                        }
                                        return nil
                                }
                                return nil
                        }
                        cur = m[tk.key]
                case tokenIndex:
                        arr, ok := cur.([]any)
                        if !ok {
                                return nil
                        }
                        if tk.index < 0 || tk.index >= len(arr) {
                                return nil
                        }
                        cur = arr[tk.index]
                case tokenFilter:
                        arr, ok := cur.([]any)
                        if !ok {
                                return nil
                        }
                        cur = filterArray(arr, tk.fk, tk.fv)
                case tokenFlatten:
                        // * 数组递归展平
                        cur = flattenArray(cur)
                }
        }
        return cur
}

type jsonToken struct {
        kind  int // 1=key, 2=index, 3=filter, 4=flatten
        key   string
        index int
        fk    string
        fv    string
}

const (
        tokenKey     = 1
        tokenIndex   = 2
        tokenFilter  = 3
        tokenFlatten = 4
)

func tokenizeJsonPath(path string) []jsonToken {
        // 去 [] 装饰 (空方括号)
        path = strings.ReplaceAll(path, "[]", "")
        // 分割: . / [n] / [k=v] / *
        parts := []string{}
        cur := strings.Builder{}
        for i := 0; i < len(path); i++ {
                c := path[i]
                switch {
                case c == '.':
                        if cur.Len() > 0 {
                                parts = append(parts, cur.String())
                                cur.Reset()
                        }
                case c == '[':
                        if cur.Len() > 0 {
                                parts = append(parts, cur.String())
                                cur.Reset()
                        }
                        j := i + 1
                        // R94-B BUG-267 (P4) 修复 (R93-B 未决项 #4, 原 R92-B 未决项
                        //   #6): 原 `for j < len(path) && path[j] != ']'` 在 quoted
                        //   value 内含 ] (e.g. [?(@.field="a]b")]) 提前截断, 残留
                        //   b")] 误解析为后续 token. 修复: 加 quote state (单/双引号),
                        //   引号内 ] 不截断. 71 Rule 0 用 quoted value 含 ] 形态;
                        //   JSONPath 过滤标准 [?(@.f==v)] 无 quote 包裹 (71 Rule
                        //   多用此形态), 不受影响. latent 自 R38 TS→Go 迁移 (47
                        //   轮未发现).
                        inQuote := byte(0)
                        for j < len(path) {
                                ch := path[j]
                                // R101-B BUG-290 (P3) 修复 (R94-B BUG-267 续): 原引号
                                //   状态机不处理 \" 转义 — `\` 当普通字符写入, 紧接
                                //   的 `\"` 触发 inQuote=0 (误判引号闭合), 后续 `]` 在
                                //   引号外触发 break (提前截断), cur 残破半 + 段外 `]`
                                //   被 synth 入 parts, inner 末尾非引号 → BUG-289
                                //   quote-pair 检查跳过 → token 丢. 与 BUG-248/269
                                //   splitJsonArrayPaths/OrPaths quote-aware splitter
                                //   同款 \" 转义 defer family. 修复: inQuote!=0 &&
                                //   ch=='\\' → write `\\`+next char verbatim (跳过
                                //   next 的引号语义判定), 与 RFC 9535 JSONPath string
                                //   escape 对齐. 71 Rule 0 用 \" 形态; 0 用户受影响.
                                //   latent 自 R94-B BUG-267 (7 轮未发现, BUG-267 加引
                                //   号状态机时漏加 \\ 转义分支).
                                if inQuote != 0 && ch == '\\' {
                                        cur.WriteByte(ch)
                                        j++
                                        if j < len(path) {
                                                cur.WriteByte(path[j])
                                        }
                                        j++
                                        continue
                                }
                                if inQuote == 0 && (ch == '"' || ch == '\'') {
                                        inQuote = ch
                                } else if inQuote != 0 && ch == inQuote {
                                        inQuote = 0
                                } else if inQuote == 0 && ch == ']' {
                                        break
                                }
                                cur.WriteByte(ch)
                                j++
                        }
                        parts = append(parts, "["+cur.String()+"]")
                        cur.Reset()
                        i = j
                default:
                        cur.WriteByte(c)
                }
        }
        if cur.Len() > 0 {
                parts = append(parts, cur.String())
        }
        tokens := []jsonToken{}
        for _, p := range parts {
                if p == "" {
                        continue
                }
                if strings.HasPrefix(p, "[") && strings.HasSuffix(p, "]") {
                        inner := p[1 : len(p)-1]
                        if inner == "*" {
                                tokens = append(tokens, jsonToken{kind: tokenFlatten})
                                continue
                        }
                        if n, err := strconv.Atoi(inner); err == nil {
                                tokens = append(tokens, jsonToken{kind: tokenIndex, index: n})
                                continue
                        }
                        // R100-B BUG-289 (P3) 修复: 原 ["key"] / ['key'] (string key in
                        //   brackets, JSONPath bracket notation per RFC 9535) 未处理 —
                        //   inner = `"key"` (with quotes), strconv.Atoi fails, 无 `?(...)`
                        //   前缀, 无 `==`/`!=`/`=` → 全 fall through 到 `continue` (drop
                        //   token). 路径如 `items["title"]` tokenize 为 [tokenKey("items")]
                        //   + drop `["title"]`, jsonGetByPath 只 navigate 到 items, 返
                        //   整个数组而非 title 值. JSONPath 标准 $["key"] 等价 $.key (dot
                        //   notation), 应 tokenize 为 tokenKey. 修复: inner 两端匹配
                        //   quote (双/单) 时 strip + tokenKey. 防御性: key 非空才触发
                        //   (空 [""] 不命中, 与原 drop 行为一致). 不处理 \" 转义 (与
                        //   BUG-248/269 splitJsonArrayPaths/OrPaths 同款 defer — JSONPath
                        //   标准用 \" 转义引号, 但 71 Rule 0 用嵌套引号 + 转义, 复杂度
                        //   低优先级). 与 BUG-216 ($.field 根引用) + BUG-267 (quoted ]
                        //   in tokenize) + BUG-273 ($..a.b multi-level) 同款 "JSONPath
                        //   标准未对齐" family. 71 Rule 0 用 ["key"] 形态 (多用 .key
                        //   dot notation); 0 用户受影响, 未来 admin 配置后受益. latent
                        //   自 R38 TS→Go 迁移 (47 轮未发现).
                        if len(inner) >= 2 {
                                first, last := inner[0], inner[len(inner)-1]
                                if first == '"' && last == '"' {
                                        // R101-B BUG-291 (P3) 修复 (R100-B BUG-289 续):
                                        //   原仅 strip 两端引号, 不 unescape \" →
                                        //   key 残 `a\"b` 字面, 与 JSON key `a"b`
                                        //   (unescaped) 不匹配, tokenKey 查
                                        //   m[`a\"b`] 0 命中. 与 BUG-290 (bracket
                                        //   scan \\ 转义) 协同: BUG-290 保 inner 形
                                        //   如 `"a\\"b"` (引号配对正确), 本处
                                        //   strconv.Unquote 解 \" → " (含 \\\\ / \b
                                        //   / \f / \n / \r / \t / \uXXXX Go/JSON 共
                                        //   子集; \\/ 不支持 Go strconv, 与 BUG-248/
                                        //   269 同款 defer). Unquote 失败 → fallback
                                        //   strip 引号 (BUG-289 原行为, 不退化). 71
                                        //   Rule 0 用 \" 形态; 0 用户受影响. latent
                                        //   自 R100-B BUG-289 (1 轮未补).
                                        if unq, err := strconv.Unquote(inner); err == nil && unq != "" {
                                                tokens = append(tokens, jsonToken{kind: tokenKey, key: unq})
                                                continue
                                        }
                                        key := inner[1 : len(inner)-1]
                                        if key != "" {
                                                tokens = append(tokens, jsonToken{kind: tokenKey, key: key})
                                                continue
                                        }
                                }
                                if first == '\'' && last == '\'' {
                                        key := inner[1 : len(inner)-1]
                                        if key != "" {
                                                tokens = append(tokens, jsonToken{kind: tokenKey, key: key})
                                                continue
                                        }
                                }
                        }
                        // R83-B BUG-191 (P3) 修复: 原 [k=v] 检查在 [?(...)] JSONPath 过滤之前,
                        //   `?(@.field==value)` 含 `=` (在 `==` 处) → 命中 [k=v] 分支, fk=
                        //   "?(@.field" + fv="=value)" 被误解析为简单 k=v 过滤, JSONPath 路径
                        //   永不触发. 修复: [?(...)] 检查移到 [k=v] 之前 (JSONPath 过滤更特
                        //   殊, 应优先匹配; [k=v] 仅匹配无 `?(` 前缀的简单等值过滤).
                        // [?(@.field==value)] JSONPath 过滤
                        if strings.HasPrefix(inner, "?(") && strings.HasSuffix(inner, ")") {
                                expr := inner[2 : len(inner)-1]
                                if m := jsonPathEqRe.FindStringSubmatch(expr); m != nil {
                                        tokens = append(tokens, jsonToken{
                                                kind: tokenFilter,
                                                fk:   m[1],
                                                // R102-B BUG-296 (P3): unquoteFilterValue 解 `\"` 转义
                                                fv:   unquoteFilterValue(expr, m[2], "=="),
                                        })
                                        continue
                                }
                                if m := jsonPathNeRe.FindStringSubmatch(expr); m != nil {
                                        tokens = append(tokens, jsonToken{
                                                kind: tokenFilter,
                                                fk:   m[1],
                                                // R102-B BUG-296 (P3): unquoteFilterValue 解 `\"` 转义 (NE 前缀 __NE__ 保留)
                                                fv:   "__NE__" + unquoteFilterValue(expr, m[2], "!="),
                                        })
                                        continue
                                }
                        }
                        // BUG-247 (P3) 修复: [k==v] / [k!=v] 双字符运算符 (无 `?(` wrapper).
                        //   原实现直接 strings.Index(inner, "=") 找首个 `=`, 对 `[k==v]` 解析
                        //   为 fk="k" fv="=v" (首 `=` 后是 `=v`), 对 `[k!=v]` 解析为 fk="k!"
                        //   fv="=v" (fk 含 `!` 残留). 用户意图 `==` / `!=` 双字符运算符被
                        //   误解析为单 `=` + 残留字符 → filterArray 比较失败 → 路径静默返空.
                        //   修复: 先检 `==` / `!=` (双字符运算符优先, jsonPathEqRe/NeRe 同
                        //   语义但 `?()` wrapper 才命中), 后 fallback 单 `=` (历史兼容
                        //   [k=v] 简单等值). latent 自 R38 TS→Go 迁移 (47 轮未发现, 71 Rule
                        //   0 用 [k==v]/[k!=v] 无 `?(` wrapper 形态, 多用 [?(...)] JSONPath
                        //   标准 或 [k=v] 单等号). 与 R83-B BUG-191 ([?(...)] 优先于 [k=v])
                        //   同款 "运算符特异性优先" 修复方法论.
                        if eq2 := strings.Index(inner, "=="); eq2 > 0 {
                                tokens = append(tokens, jsonToken{
                                        kind: tokenFilter,
                                        fk:   strings.TrimSpace(inner[:eq2]),
                                        // R102-B BUG-296 (P3): unquoteFilterValue 解 `\"` 转义 (无 ?() wrapper 同款)
                                        fv:   unquoteFilterValue(inner, strings.TrimSpace(inner[eq2+2:]), "=="),
                                })
                                continue
                        }
                        if ne := strings.Index(inner, "!="); ne > 0 {
                                tokens = append(tokens, jsonToken{
                                        kind: tokenFilter,
                                        fk:   strings.TrimSpace(inner[:ne]),
                                        // R102-B BUG-296 (P3): unquoteFilterValue 解 `\"` 转义 (无 ?() wrapper 同款, NE 前缀 __NE__ 保留)
                                        fv:   "__NE__" + unquoteFilterValue(inner, strings.TrimSpace(inner[ne+2:]), "!="),
                                })
                                continue
                        }
                        // [k=v] 过滤 (无 `?(` 前缀的简单等值, JSONPath 已上面接管)
                        if eq := strings.Index(inner, "="); eq > 0 {
                                tokens = append(tokens, jsonToken{
                                        kind: tokenFilter,
                                        fk:   strings.TrimSpace(inner[:eq]),
                                        fv:   strings.TrimSpace(inner[eq+1:]),
                                })
                                continue
                        }
                        continue
                }
                if p == "*" {
                        tokens = append(tokens, jsonToken{kind: tokenFlatten})
                        continue
                }
                tokens = append(tokens, jsonToken{kind: tokenKey, key: p})
        }
        return tokens
}

// unquoteFilterValue — JSONPath filter quoted value `\"` unescape (R102-B BUG-296).
//
//      BUG-290/291 收口 tokenizeJsonPath 的 `\"` 转义 (bracket scan +
//      ["key"] Unquote), BUG-294/295 收口 splitJsonArrayPaths/OrPaths 的
//      `\"` 转义, 但 jsonPathEqRe/NeRe + [k==v]/[k!=v] 的 filter value
//      路径仍漏: regex `"?(.*?)"?` strip 引号但不 unescape `\"` — quoted
//      value `"a\"b"` 残 m[2]=`a\"b` (raw escape), 与 JSON unmarshal 后
//      的 `a"b` 不等 → filterArray 比较静默 miss (e.g. `[?(@.f=="a\"b")]`
//      永不命中 JSON `{"f":"a\"b"}`). 修复: 检测 op (`==`/`!=`) 后是 quoted
//      form (`"..."`) → strconv.Unquote 解 `\"`→`"` (含 \\\\ / \b / \f /
//      \n / \r / \t / \uXXXX Go/JSON 共子集). Unquote 失败 / unquoted
//      value (e.g. `==5`) → 返原 fv (BUG-289 原行为, 不退化). 与 BUG-291
//      (["key"] Unquote) + BUG-294/295 (splitJson `\\` 转义) + BUG-290
//      (tokenize bracket scan `\\` 转义) 同口径闭环. 71 Rule 0 用 `\"`
//      形态; 0 用户受影响. latent 自 R71-C BUG-93 (jsonPathEqRe 预编译,
//      31 轮未发现因 71 Rule 0 用 quoted value 含 `\"` 形态, 多用
//      unquoted 或无转义 quoted value).
func unquoteFilterValue(expr, fv, op string) string {
        eq := strings.Index(expr, op)
        if eq < 0 {
                return fv
        }
        rest := strings.TrimLeft(expr[eq+len(op):], " \t")
        if len(rest) < 2 || rest[0] != '"' {
                return fv // unquoted value, no unescape needed
        }
        // scan for closing quote (respecting \" escape)
        for i := 1; i < len(rest); i++ {
                if rest[i] == '\\' && i+1 < len(rest) {
                        i++ // skip escaped char (e.g. \" \\ \n etc)
                        continue
                }
                if rest[i] == '"' {
                        if unq, err := strconv.Unquote(rest[:i+1]); err == nil {
                                return unq
                        }
                        break // Unquote failed, fallback to fv
                }
        }
        return fv
}

func filterArray(arr []any, k, v string) any {
        out := []any{}
        // 支持 != (前缀 __NE__)
        neg := strings.HasPrefix(v, "__NE__")
        target := strings.TrimPrefix(v, "__NE__")
        for _, item := range arr {
                m, ok := item.(map[string]any)
                if !ok {
                        continue
                }
                val, exists := m[k]
                if !exists {
                        // BUG-311 (P3): RFC 9535 JSONPath — absent field: == filter
                        //   excludes (continue, 不可比较), != filter includes (absent
                        //   ≠ any value, == 比较为 false 则 != 为 true). 原 !exists→
                        //   continue 对 == 正确, 对 != 误排除 (admin 配
                        //   [?(@.f!=v)] 期望 "无 f 字段" 的 item 也命中, 实际被静默
                        //   跳过 → filterArray 返缺漏集). 71 Rule 0 用 != filter
                        //   (多用 ==); 0 生产命中, 防御性 + RFC 对齐修复. latent
                        //   自 R72-C BUG-247 加 != 运算符 (33 轮未发现).
                        if neg {
                                out = append(out, item)
                        }
                        continue
                }
                // BUG-301 (P3): 原 fmt.Sprintf("%v", val) 对 float64 ≥ 1e6 返科学
                //   计数 (e.g. 1000000 → "1e+06"), 与 JSONPath filter value "1000000"
                //   (用户字面) 不等 → 比较静默 miss (filter 永不命中, JsonGet 返 []).
                //   修复: anyToString (float64 走 FormatFloat, 与 JsonToString line
                //   1363 同口径). 详见 anyToString 注释 (line 334). latent 自 R38
                //   (47 轮未发现, 71 Rule 0 用 [?(@.count==N)] 大数 filter).
                valStr := anyToString(val)
                if neg {
                        if valStr != target {
                                out = append(out, item)
                        }
                } else {
                        if valStr == target {
                                out = append(out, item)
                        }
                }
        }
        return out
}

func flattenArray(cur any) any {
        arr, ok := cur.([]any)
        if !ok {
                return cur
        }
        out := []any{}
        for _, item := range arr {
                if sub, ok := item.([]any); ok {
                        out = append(out, sub...)
                } else {
                        out = append(out, item)
                }
        }
        return out
}

// splitJsonArrayPaths — split JsonArrayAt path on commas, respecting
// double-quoted strings (commas inside "..." preserved).
//
// BUG-248 (P3) 修复: 原用 strings.Split(path, ",") 在 quoted value 含逗号
//
//      时误分割 (e.g. path=`items[?(@.f=="a,b")],other` 被分割为
//      `items[?(@.f=="a` + `b")]` + `other`, 前两段路径非法 JsonGet 返 nil,
//      路径静默返空). 修复: 单遍扫描, 双引号内逗号不分割. latent 自 R38
//      TS→Go 迁移 (47 轮未发现, 71 Rule 0 用逗号 in quoted value 形态).
//      R102-B BUG-294 (P3) 续修 (BUG-248 续, R101-B 未决项 #6): 原注 "不
//      处理 \" 转义" 已收口 — inQuote toggle 不处理 `\"` → `\"` 被当作
//      close+open quote (toggle inQuote 两次), 后续逗号 split 位置误判
//      (e.g. path=`items[?(@.f=="a\"b")],other` 的 `,` 在 inQuote 错误
//      toggle 后被误判 quote 内 → 单段含两段拼接, JsonGet 返 nil, union
//      静默退化). 与 BUG-290 (tokenizeJsonPath bracket scan `\\` 转义)
//      同款 fix, callsite 不同 (本处是 JsonArrayAt 入口 splitter). 修复:
//      inQuote && c=='\\' → write `\\`+next char verbatim (跳过 next 的
//      引号语义判定), 与 RFC 9535 JSONPath string escape 对齐. 单引号 '
//      不视为 string 边界 (RFC 9535 仅双引号). 71 Rule 0 用 `\"` 形态;
//      0 用户受影响. latent 自 R38 TS→Go 迁移.
func splitJsonArrayPaths(path string) []string {
        out := []string{}
        var cur strings.Builder
        inQuote := false
        for i := 0; i < len(path); i++ {
                c := path[i]
                if inQuote && c == '\\' {
                        cur.WriteByte(c)
                        i++
                        if i < len(path) {
                                cur.WriteByte(path[i])
                        }
                        continue
                }
                if c == '"' {
                        inQuote = !inQuote
                        cur.WriteByte(c)
                        continue
                }
                if c == ',' && !inQuote {
                        out = append(out, cur.String())
                        cur.Reset()
                        continue
                }
                cur.WriteByte(c)
        }
        if cur.Len() > 0 {
                out = append(out, cur.String())
        }
        return out
}

// splitJsonOrPaths — split JsonGet "||" fallback path, respecting
// double-quoted strings ("||" inside "..." preserved).
//
// R95-B BUG-269 (P4) 修复 (BUG-248 对称): JsonGet line 671 原用
//
//      strings.Split(path, "||"), 在 quoted value 含 "||" 时误分割 (e.g.
//      path=`items[?(@.f=="a||b")] || other` 被分割为 `items[?(@.f=="a` +
//      `b")] ` + ` other`, 前两段路径非法 JsonGet 返 nil → || fallback
//      静默退化 (filter 永不命中, fallback 永远走第二段; 与 BUG-248 commas
//      in quotes for JsonArrayAt 同根因). 修复: 单遍扫描, 双引号内 "||" 不分割
//      (与 splitJsonArrayPaths 同款 quote-aware 模式). 71 Rule 0 用 "||"
//      形态 (BUG-233 line 684 注 "71 Rule 0 用 || 形态 path"), 0 用户受
//      影响; 未来 admin 配 `[?(@.title=="A||B")] || name` 后受益. latent 自
//      R38 TS→Go 迁移 (47 轮未发现). R102-B BUG-295 (P3) 续修 (BUG-269 续,
//      R101-B 未决项 #6): 原注 "与 BUG-248 同款, 不处理 \" 转义" 已收口
//      — inQuote toggle 不处理 `\"` → `\"` 被当作 close+open quote, 后续
//      `||` split 位置误判 (e.g. path=`items[?(@.f=="a\"b")] || other`
//      的 `||` 在 inQuote 错误 toggle 后被误判 quote 内 → 单段含两段拼接,
//      JsonGet 返 nil, || fallback 静默退化). 与 BUG-294 (splitJsonArrayPaths
//      `\\` 转义) + BUG-290 (tokenizeJsonPath bracket scan `\\` 转义) 同款
//      fix, callsite 不同 (本处是 JsonGet || 入口 splitter). 修复: inQuote
//      && c=='\\' → write `\\`+next char verbatim, 与 RFC 9535 对齐. 单引号
//      ' 不视为 string 边界 (RFC 9535 仅双引号). 71 Rule 0 用 `\"` 形态;
//      0 用户受影响. latent 自 R38 TS→Go 迁移.
func splitJsonOrPaths(path string) []string {
        out := []string{}
        var cur strings.Builder
        inQuote := false
        for i := 0; i < len(path); i++ {
                c := path[i]
                if inQuote && c == '\\' {
                        cur.WriteByte(c)
                        i++
                        if i < len(path) {
                                cur.WriteByte(path[i])
                        }
                        continue
                }
                if c == '"' {
                        inQuote = !inQuote
                        cur.WriteByte(c)
                        continue
                }
                if c == '|' && !inQuote && i+1 < len(path) && path[i+1] == '|' {
                        out = append(out, cur.String())
                        cur.Reset()
                        i++ // skip second '|' (for-loop i++ makes total +2)
                        continue
                }
                cur.WriteByte(c)
        }
        if cur.Len() > 0 {
                out = append(out, cur.String())
        }
        return out
}

// JsonArrayAt — 取数组路径下的所有元素 (支持逗号分隔多路径并集).
func JsonArrayAt(root any, path string) []any {
        if root == nil {
                return nil
        }
        out := []any{}
        // BUG-248: splitJsonArrayPaths 替代 strings.Split, 尊重双引号内逗号
        for _, p := range splitJsonArrayPaths(path) {
                p = strings.TrimSpace(p)
                if p == "" {
                        continue
                }
                v := JsonGet(root, p)
                switch x := v.(type) {
                case []any:
                        out = append(out, x...)
                default:
                        if v != nil {
                                out = append(out, v)
                        }
                }
        }
        return out
}

// JsonToString — JSON 值 → 字符串. 数组 → 各元素转字符串按 \n 连接.
func JsonToString(v any) string {
        if v == nil {
                return ""
        }
        switch x := v.(type) {
        case string:
                return x
        case float64:
                return strconv.FormatFloat(x, 'f', -1, 64)
        case int:
                return strconv.Itoa(x)
        case bool:
                return strconv.FormatBool(x)
        case []any:
                parts := []string{}
                for _, it := range x {
                        s := JsonToString(it)
                        if s != "" {
                                parts = append(parts, s)
                        }
                }
                return strings.Join(parts, "\n")
        case map[string]any:
                // 对象 → key=value\n 形态 (BUG-245: sorted keys via mapToSortedKV)
                return mapToSortedKV(x)
        default:
                return fmt.Sprintf("%v", v)
        }
}

// URLVars — URL 查询参数 + path 段 → map.
//   - 查询参数: vars[param]=value (首值, 多值取 [0])
//   - path 段: vars["path"]="0=seg0\n1=seg1\n..." kv string (R95-B BUG-268
//     修复, 原 docstring 声称 path 段提取但 0 实现; worklog R94-B 未决
//     项 #1 候选 #7 defer 至 R95+ 评估, 本轮实施). {path.N} 走
//     applyConstTemplate 的 dotted-key 解析 (resolveKVPath → parseKVString),
//     与 {q.param} 同款 namespace + 与 R94-B BUG-266 multi-level dotted
//     同款 helper. 跳过空段 (头尾 / 或连续 // 不计 idx). path 段 URL-
//     decoded (u.Path 已由 url.Parse 解码 %XX). 段内 \n 不可能 (RFC 3986
//     path 段不允许 \n, 必须 %0A 编码; 源站误传 → parseKVString 分割错
//     乱, 与段含 = 同款 latent, 维持 defer). 行为: 仅新增 vars["path"]
//     key (kv string), 0 旧 key 改动; 71 Rule const 模板 0 引用 {path.N},
//     0 用户受影响; 未来 admin 配 (e.g. tocLink ".../chapter/{path.3}.html"
//     提第 3 段) 后受益. latent 自 R38 TS→Go 迁移 (47 轮未发现).
func URLVars(rawURL string) map[string]string {
        out := map[string]string{}
        u, err := url.Parse(rawURL)
        if err != nil {
                return out
        }
        for k, vs := range u.Query() {
                if len(vs) > 0 {
                        out[k] = vs[0]
                }
        }
        // R95-B BUG-268: path 段塞 vars["path"] kv string, 供 {path.N} 引用.
        if u.Path != "" && u.Path != "/" {
                segs := strings.Split(u.Path, "/")
                var b strings.Builder
                idx := 0
                for _, s := range segs {
                        if s == "" {
                                continue // 头尾 / 或连续 // 跳过
                        }
                        if idx > 0 {
                                b.WriteByte('\n')
                        }
                        b.WriteString(strconv.Itoa(idx))
                        b.WriteByte('=')
                        b.WriteString(s)
                        idx++
                }
                if idx > 0 {
                        out["path"] = b.String()
                }
        }
        return out
}

// ---------- ExtractField (统一字段提取入口) ----------

// ExtractCtx — 提取上下文 (json scope + vars for const 模板).
type ExtractCtx struct {
        JSON any               // JSON scope (json/const 模式用)
        Vars map[string]string // 已提取字段 + index + q.* 参数
}

// ExtractField — 统一字段提取入口. type=css/xpath/regex/json/const.
func ExtractField(html string, doc *goquery.Document, scope *goquery.Selection, rule FieldRule, ctx *ExtractCtx) string {
        var v string
        switch rule.Type {
        case FieldCSS:
                v = cssExtract(doc, scope, rule)
        case FieldXPath:
                // XPath 暂不支持 (需 antchfx/xpath, 后续 wiring)
                v = ""
        case FieldRegex:
                v = regexExtractFirst(html, rule)
        case FieldJSON:
                if ctx != nil && ctx.JSON != nil {
                        val := JsonGet(ctx.JSON, rule.Expression)
                        v = JsonToString(val)
                }
        case FieldConst:
                if ctx != nil {
                        v = applyConstTemplate(rule.Expression, ctx.Vars)
                }
        default:
                // R83-B BUG-190 (P3) 修复: 原 `return ""` 提前 return 跳过下方 multi-check
                //   + ApplyTransform + DefaultValue 兜底. unknown Type + DefaultValue configured
                //   → 返 "" 不返 DefaultValue. sanitizeFieldRule 已过滤 unknown Type (返 fr
                //   with Type=""), ParseList/ParseToc/ParseContent 跳过 Type=="" 的 rule,
                //   但 ExtractField 是 export, 外部 caller 可传 unknown Type. 改 v="" 让下方
                //   DefaultValue 兜底生效 (与单值路径同口径, ApplyTransform 对 "" 是 no-op).
                v = ""
        }
        // R80-C BUG-174 (P2) 修复: 原实现 `v = ApplyTransform(v, rule)` 在 multi-check
        //   之前无条件跑, multi 路径下 ApplyTransform 结果被下方 `v = strings.Join
        //   (multi, sep)` 覆盖, multi 值未走 ApplyTransform → stripTags/replaceFrom/
        //   decode/index 等规则在 extractMultiple=true 时全部静默失效 (单值路径 OK,
        //   多值路径漏). 0 rule 用 extractMultiple (rg 全仓 0 命中 JSON), 0 当前用户
        //   受影响, 但属明显 bug, 本轮修. 修复: 把 ApplyTransform 移入 if/else 分支,
        //   multi 路径对每个 multi 值独立 ApplyTransform 后再 join (与单值路径同口径,
        //   transforms 对每个 multi 值生效). 行为变化: 仅 multi+transform 组合 (当前 0
        //   rule), 单值路径行为不变.
        if rule.ExtractMultiple && (rule.Type == FieldCSS || rule.Type == FieldRegex) {
                var multi []string
                switch rule.Type {
                case FieldCSS:
                        sel := cssSelect(doc, scope, rule.Expression)
                        if sel != nil {
                                attr := rule.Attr
                                if attr == "" {
                                        attr = "text"
                                }
                                sel.Each(func(_ int, s *goquery.Selection) {
                                        var sv string
                                        switch attr {
                                        case "text":
                                                sv = s.Text()
                                        case "html":
                                                sv, _ = s.Html()
                                        case "href":
                                                sv, _ = s.Attr("href")
                                        case "src":
                                                sv, _ = s.Attr("src")
                                        default:
                                                sv = s.AttrOr(attr, "")
                                        }
                                        if sv != "" {
                                                multi = append(multi, sv)
                                        }
                                })
                        }
                case FieldRegex:
                        multi = regexExtractAll(html, rule)
                }
                // R80-C BUG-174: 每个 multi 值独立 ApplyTransform (per-item stripTags/
                //   replaceFrom/decode/index), 与单值路径同口径. 原 multi 路径无此步骤.
                transformed := make([]string, 0, len(multi))
                for _, m := range multi {
                        transformed = append(transformed, ApplyTransform(m, rule))
                }
                sep := rule.MultipleSeparator
                if sep == "" {
                        sep = "\n"
                }
                v = strings.Join(transformed, sep)
        } else {
                // 单值路径: ApplyTransform on 单值 (FieldCSS/FieldRegex/FieldJSON/FieldConst/
                //   FieldXPath 全走此分支, 与原 line 920 行为一致)
                v = ApplyTransform(v, rule)
        }
        // defaultValue 兜底 (在所有 transform 之后应用)
        if v == "" && rule.DefaultValue != "" {
                v = rule.DefaultValue
        }
        return v
}

// applyConstTemplate — const 模板占位符替换. {name} → vars[name]; 未命中替换为空.
//
//      支持三种占位符语法 (constTemplateRe `\{([a-zA-Z_][a-zA-Z0-9_.]*)\}`):
//        1. {name}        — 直接查 vars[name] (URLVars 查询参数键 / rec 字段键)
//        2. {q.param}     — 查询参数命名空间前缀 (URLVars 设 vars[param], admin
//           用 {q.param} 引用; R94-B BUG-265 修复, 原 docstring 声称 0 实现)
//        3. {a.b.c}       — 多级 dotted key 递归解析 (vars[a] 是 kv string,
//           逐段解析查下一层; R94-B BUG-266 修复, 原仅 1 级)
func applyConstTemplate(tmpl string, vars map[string]string) string {
        if tmpl == "" {
                return ""
        }
        re := constTemplateRe
        return re.ReplaceAllStringFunc(tmpl, func(m string) string {
                // m = "{name}", 取中间
                key := m[1 : len(m)-1]
                // 1. 直接命中 (vars[key] 存在, e.g. rec 字段名或 URLVars 直键)
                if v, ok := vars[key]; ok {
                        return v
                }
                // 2. R94-B BUG-265 (P3) 修复: {q.param} 语法 (docstring 原 line 1189 声称,
                //   原 0 实现). URLVars 设 vars[param_name] (无 "q." 前缀), admin 用
                //   {q.param} 引用 → 原走下方 dotted key 解析 vars["q"] (miss) → 返空
                //   → const 模板破损 (e.g. yueyouxs tocLink ".../c/{q.bookId}.html" →
                //   URL 破损 ".../c/.html"). 修复: key 以 "q." 前缀时直接查 vars[key[2:]]
                //   (与 URLVars 输出键对齐). 0 用户受负面影响 (原 {q.param} 全破损, 修后
                //   正确). latent 自 R38 TS→Go 迁移 (47 轮未发现因 runner.go line 1859
                //   tocLink 调 ExtractField 传 nil ctx → FieldConst 分支跳过
                //   applyConstTemplate, 3/4 callsite (ParseList/ParseToc/ParseContent)
                //   传 ctx 已生效).
                //
                //   R96-B BUG-274 (P4) 续修 BUG-265 (原 "多级 {q.a.b} 仍返空, 与
                //   multi-level dotted 同款 defer"): q. 分支内嵌 dotted key 解析.
                //   场景: admin 配 "{q.path.3}" (引用 URL 第 3 段, URLVars path
                //   段 kv string "0=seg0\n1=seg1\n2=seg2\n3=seg3" 内 m["3"]="seg3")
                //   → 原仅查 vars["path.3"] (literal miss) → 返空 → URL 破损. 修复:
                //   rest 含 dot 时拆 prefix+suffix, vars[prefix] 命中则 resolveKVPath
                //   (递归 kv string 解析, 与下方 line ~1354 非-q. 多级 BUG-266 同款).
                //   与 BUG-266 (multi-level dotted 非-q.) + BUG-268 (URLVars path
                //   段) 协同闭环. 71 Rule 0 用多级 q. 形态 (0 配 {q.path.N}, 多用
                //   单级 {q.param}); 0 用户受影响, 未来 admin 配置后受益. latent
                //   自 R94-B BUG-265 修复时 defer (2 轮未补).
                if strings.HasPrefix(key, "q.") {
                        rest := key[2:]
                        if v, ok := vars[rest]; ok {
                                return v
                        }
                        if dot := strings.Index(rest, "."); dot > 0 {
                                prefix := rest[:dot]
                                suffix := rest[dot+1:]
                                if v, ok := vars[prefix]; ok {
                                        return resolveKVPath(v, suffix)
                                }
                        }
                        return ""
                }
                // 3. R94-B BUG-266 (P4) 修复 (R93-B 未决项 #1, 原 R92-B 未决项 #5):
                //   {a.b.c} 多级 dotted key 递归解析. 原仅 1 级 (prefix + suffix), suffix
                //   含 . 时 m[suffix] 仅匹配 literal "b.c" key (vars[a] 含 "b.c=val" 行
                //   极罕见). 修复: resolveKVPath 递归 — vars[a] kv 解析取 m[b], 若 m[b]
                //   仍是 kv string 再解析取 m[c]. 71 Rule 0 用 {a.b.c} 多级, 0 用户受
                //   影响; 未来 admin 配置后受益.
                if dot := strings.Index(key, "."); dot > 0 {
                        prefix := key[:dot]
                        suffix := key[dot+1:]
                        if v, ok := vars[prefix]; ok {
                                return resolveKVPath(v, suffix)
                        }
                }
                return ""
        })
}

// resolveKVPath — 递归解析多级 dotted key 路径 (vars[a] kv 中的 b → b 的 kv 中的 c).
//
//      BUG-266 (P4) 修复: applyConstTemplate 多级 dotted key 支持. parseKVString
//      解析 "k=val\n..." 形态; 每段路径取 kv map 查找, 命中后若值仍是 kv string
//      形态继续递归. 未命中返 "" (与原 1 级 m[suffix] miss 行为一致).
func resolveKVPath(v, path string) string {
        cur := v
        for path != "" {
                var key string
                if dot := strings.Index(path, "."); dot > 0 {
                        key = path[:dot]
                        path = path[dot+1:]
                } else {
                        key = path
                        path = ""
                }
                m := parseKVString(cur)
                next, ok := m[key]
                if !ok {
                        return ""
                }
                cur = next
        }
        return cur
}

func parseKVString(s string) map[string]string {
        out := map[string]string{}
        for _, line := range strings.Split(s, "\n") {
                if eq := strings.Index(line, "="); eq > 0 {
                        out[strings.TrimSpace(line[:eq])] = strings.TrimSpace(line[eq+1:])
                }
        }
        return out
}

// ---------- Absolutize + 页面基址 ----------

// Absolutize — 相对 URL → 绝对 URL + 协议过滤 + 自引用过滤.
//   - 非 http(s) 协议 (javascript:/data:/mailto:) 返回空
//   - 纯锚点 / 同 origin+path+search 视为自引用返回空
func Absolutize(s, base string) string {
        s = strings.TrimSpace(s)
        if s == "" {
                return ""
        }
        out := s
        // R106-B 精简-1: cache strings.ToLower(s) (was called twice), hot path
        //   (ParseList/ParseToc/ParseContent URL 字段 Absolutize 每 URL 调).
        if ls := strings.ToLower(s); !strings.HasPrefix(ls, "http://") && !strings.HasPrefix(ls, "https://") {
                b, err := url.Parse(base)
                if err == nil {
                        u, err := url.Parse(s)
                        if err == nil {
                                out = b.ResolveReference(u).String()
                        }
                }
        }
        // 协议过滤 (R106-B 精简-1: cache ToLower(out))
        if lo := strings.ToLower(out); !strings.HasPrefix(lo, "http://") && !strings.HasPrefix(lo, "https://") {
                return ""
        }
        // 自引用过滤 (同 origin + path + search)
        o, err := url.Parse(out)
        if err != nil {
                return out
        }
        if base != "" {
                if b, err := url.Parse(base); err == nil {
                        if o.Host == b.Host && o.Path == b.Path && o.RawQuery == b.RawQuery {
                                return ""
                        }
                }
        }
        return out
}

// DocBase — 页面有效文档基址: 站点可用 <base href> 改写相对链接解析基准.
func DocBase(doc *goquery.Document, docURL string) string {
        if docURL == "" {
                return docURL
        }
        if doc == nil {
                return docURL
        }
        href := strings.TrimSpace(doc.Find("base[href]").First().AttrOr("href", ""))
        if href != "" {
                // R107-B 精简-1: cache strings.ToLower(href) (was called twice), hot path
                //   (ParseToc/ParseContent 翻页每页 DocBase 调). 与 R106-B Absolutize
                //   精简-1 同款 "URL prefix check ToLower 双调缓存" precedent.
                if lh := strings.ToLower(href); strings.HasPrefix(lh, "http://") || strings.HasPrefix(lh, "https://") {
                        return href
                }
                // 相对 base href
                u, err := url.Parse(href)
                if err == nil {
                        b, err := url.Parse(docURL)
                        if err == nil {
                                abs := b.ResolveReference(u).String()
                                if strings.HasPrefix(abs, "http://") || strings.HasPrefix(abs, "https://") {
                                        return abs
                                }
                        }
                }
        }
        return docURL
}

// ResolveWithBase — 相对地址先按页面基址解析. 纯锚点/绝对地址原样返回.
func ResolveWithBase(raw, base string) string {
        u := strings.TrimSpace(raw)
        if u == "" || strings.HasPrefix(u, "#") {
                return u
        }
        // R107-B 精简-1: cache strings.ToLower(u) (was called twice), hot path
        //   (ParseToc/ParseContent 翻页每 URL 字段 ResolveWithBase 调). 与 R106-B
        //   Absolutize 精简-1 同款 "URL prefix check ToLower 双调缓存" precedent.
        if lu := strings.ToLower(u); strings.HasPrefix(lu, "http://") || strings.HasPrefix(lu, "https://") {
                return u
        }
        b, err := url.Parse(base)
        if err != nil {
                return u
        }
        pu, err := url.Parse(u)
        if err != nil {
                return u
        }
        abs := b.ResolveReference(pu).String()
        if strings.HasPrefix(abs, "http://") || strings.HasPrefix(abs, "https://") {
                return abs
        }
        return u
}

// ---------- ListResult + ParseList ----------

// ListItem — 列表项提取结果 (fields 已清洗).
type ListItem struct {
        Fields map[string]string
}

// ListResult — 列表解析结果.
type ListResult struct {
        Items []ListItem
}

// HasRequiredFailure — 任一 required 字段为空 → 整项丢弃 (早剪枝避免脏数据).
func hasRequiredFailure(fields map[string]FieldRule, rec map[string]string) bool {
        for name, rule := range fields {
                if rule.Required {
                        if v, ok := rec[name]; !ok || strings.TrimSpace(v) == "" {
                                return true
                        }
                }
        }
        return false
}

// ParseList — 列表项解析. 容器型 (css/xpath/regex) / JSON 数组模式 / 无容器 (整页提取).
// urlFields 是需要 absolutize 的链接字段名 (默认 ['url']).
func ParseList(html, baseURL string, pageRule PageRule, urlFields []string) ListResult {
        if urlFields == nil {
                urlFields = []string{"url"}
        }
        htmlClean := StripLeadingBom(html)
        out := ListResult{Items: []ListItem{}}
        fields := pageRule.Fields
        itemSelector := pageRule.ItemSelector
        // BUG-310 (P3): 仅 FieldJSON 触发 JSON 模式 (原 FieldJSON||FieldConst
        //   让 HTML 无容器 + FieldConst (无 FieldJSON) 误进 JSON 模式 →
        //   ParseJsonBody(HTML) 返 nil → 整页返空 → FieldConst 模板永不执行
        //   (itemSelector==nil + 仅 FieldConst 字段的 Rule 全返空, 与有
        //   FieldJSON 字段的 Rule 行为不一致). FieldConst 是模板字段
        //   (applyConstTemplate 用 ctx.Vars, 不需 JSON body), HTML 无容器模式
        //   下应走 line ~1868 路径 (URLVars + index ctx + ExtractField
        //   FieldConst 分支 line 1458). 修复: 仅 FieldJSON 触发 JSON 模式,
        //   FieldConst 单独 (无 FieldJSON) 走 HTML 无容器模式. 71 Rule 0 用
        //   FieldConst in HTML list fields (yueyouxs const 仅在 toc.tocLink,
        //   runner.go line ~1876 BUG-268 已修); 0 生产命中, 防御性修复. latent
        //   自 R38 TS→Go 迁移 (47 轮未发现). 行为变化: 仅 itemSelector==nil +
        //   FieldConst (无 FieldJSON) case, 从 JSON 模式 (返空) → HTML 无容器
        //   模式 (FieldConst 跑 applyConstTemplate); FieldJSON 触发 case 不变.
        hasJSONField := false
        for _, r := range fields {
                if r.Type == FieldJSON {
                        hasJSONField = true
                        break
                }
        }

        // ---- JSON 模式 ----
        if (itemSelector != nil && itemSelector.Type == FieldJSON) || (itemSelector == nil && hasJSONField) {
                root := ParseJsonBody(htmlClean)
                if root == nil {
                        return out
                }
                varsBase := URLVars(baseURL)
                var scopes []struct {
                        json  any
                        index int
                }
                if itemSelector != nil {
                        items := JsonArrayAt(root, itemSelector.Expression)
                        for i, it := range items {
                                scopes = append(scopes, struct {
                                        json  any
                                        index int
                                }{json: it, index: i + 1})
                        }
                } else {
                        scopes = []struct {
                                json  any
                                index int
                        }{{json: root, index: 1}}
                }
                for _, scope := range scopes {
                        rec := map[string]string{}
                        ctx1 := &ExtractCtx{JSON: scope.json, Vars: mergeVars(varsBase, map[string]string{"index": strconv.Itoa(scope.index)})}
                        // 两阶段: 先非 const (json 路径从当前数组项取值), 再 const (模板可引用已提取字段)
                        for name, rule := range fields {
                                if rule.Type == FieldConst {
                                        continue
                                }
                                rec[name] = ExtractField("", nil, nil, rule, ctx1)
                        }
                        ctx2 := &ExtractCtx{Vars: mergeVars(varsBase, rec, map[string]string{"index": strconv.Itoa(scope.index)})}
                        // R83-B BUG-187 (P3) 修复: JSON 模式 const 字段相互引用 (e.g. name 字段
                        //   模板含 {url}, url 也是 const) 时, Go map 迭代非确定顺序 + ctx2 在循环
                        //   前固定 → 反向迭顺序时 const B 引用 {A} 拿不到 A (A 尚未提取). 罕见 case
                        //   (admin 配置多 const 字段互引用). 修复: 2 趟 fixpoint + 立即 propagate
                        //   到 ctx2.Vars. pass 1 设值 + propagate, pass 2 让反向迭顺序的 const
                        //   也能取到上趟值 (足够覆盖 1 级引用链, 多级链式引用仍可能漏但极罕见).
                        //   +5 行. 71 Rule 罕见配置 (const→const 引用), 0 用户报告.
                        for pass := 0; pass < 2; pass++ {
                                for name, rule := range fields {
                                        if rule.Type != FieldConst {
                                                continue
                                        }
                                        v := ExtractField("", nil, nil, rule, ctx2)
                                        rec[name] = v
                                        ctx2.Vars[name] = v // propagate for chained const → const references
                                }
                        }
                        for _, uf := range urlFields {
                                if rec[uf] != "" {
                                        rec[uf] = Absolutize(rec[uf], baseURL)
                                }
                        }
                        // 链接收紧: 含 url/bookUrl 字段而全为空不入列
                        if hasURLField(urlFields) && !hasAnyURLField(urlFields, rec) {
                                continue
                        }
                        if hasRequiredFailure(fields, rec) {
                                continue
                        }
                        if hasAnyValue(rec) {
                                out.Items = append(out.Items, ListItem{Fields: rec})
                        }
                }
                return out
        }

        // ---- HTML 模式 ----
        doc, err := goquery.NewDocumentFromReader(strings.NewReader(htmlClean))
        if err != nil {
                return out
        }
        // R98-B BUG-279 (P3) 修复 (R96-B 未决项 #1+#2 续抓): HTML 模式 ParseList
        //   ExtractField 传 nil ctx → FieldConst 分支 (本文件 line ~1234 `if ctx != nil`
        //   守卫) 跳过 applyConstTemplate → const 模板占位符 0 替换 → 模板破损
        //   (e.g. admin 配 list.fields.bookUrl = const "https://x/{q.id}" → 返 ""
        //   而非 evaluated URL). 与 JSON 模式 (line ~1579 ctx1) + runner.go tocLink
        //   (line ~1876 BUG-268 修复) 同款 latent, 3/4 callsite 已传 ctx, 仅 HTML
        //   模式 ParseList 漏传. 71 Rule 0 用 FieldConst in HTML list fields
        //   (yueyouxs 用 const 仅在 toc.tocLink, runner.go 已修); 0 生产命中, 防御
        //   性修复. latent 自 R38 TS→Go 迁移 (47 轮未发现). 修复: 提供
        //   URLVars(baseURL) + index ctx 让 FieldConst 跑 applyConstTemplate. 0
        //   行为变化 (FieldCSS/FieldRegex/FieldJSON 不读 ctx.Vars, 传 ctx 无害; 仅
        //   FieldConst 受益). 与下方 ParseToc HTML (line ~1927) 同口径对称修复.
        urlVars := URLVars(baseURL)

        if itemSelector == nil {
                // 无容器: 直接对整页提取字段 (单值型, 如书籍页). index=1 (与 JSON 模式
                //   单 scope 同口径, line ~1575 {json: root, index: 1}).
                rec := map[string]string{}
                ctx := &ExtractCtx{Vars: mergeVars(urlVars, map[string]string{"index": "1"})}
                for name, rule := range fields {
                        rec[name] = ExtractField(htmlClean, doc, nil, rule, ctx)
                }
                // BUG-316 (P3): no-container HTML mode missing urlFields absolutize +
                //   hasURLField guard (container line ~1958 + JSON line ~1855 have them).
                //   Relative URL (e.g. cover="img/x.jpg" on book detail page) not
                //   absolutized -> downstream fetch fails. ParseBook re-absolutizes
                //   cover (line ~2064) compensating book path, but ParseList is export;
                //   direct caller with urlFields + ItemSelector=nil gets relative URL.
                //   Fix: match container/JSON mode (absolutize -> hasURLField -> required
                //   -> hasAnyValue). 行为变化: all-empty-fields item 不再入列 (len(rec)>0
                //   -> hasAnyValue, 与 container/JSON 同口径). 71 Rule 0 直接调 ParseList
                //   no-container + url field (ApplySmartRuleFallback fills List.Item
                //   Selector -> container); 0 生产命中, 防御性修复. latent 自 R98-B
                //   BUG-279 (HTML 模式 ctx 修复时漏补 absolutize, 7 轮未发现).
                for _, uf := range urlFields {
                        if rec[uf] != "" {
                                rec[uf] = Absolutize(rec[uf], baseURL)
                        }
                }
                if hasURLField(urlFields) && !hasAnyURLField(urlFields, rec) {
                        return out
                }
                if hasRequiredFailure(fields, rec) {
                        return out
                }
                if hasAnyValue(rec) {
                        out.Items = append(out.Items, ListItem{Fields: rec})
                }
                return out
        }

        // 容器型
        var scopes []*goquery.Selection
        switch itemSelector.Type {
        case FieldCSS:
                scopes = cssExtractAll(doc, nil, *itemSelector)
        case FieldRegex:
                // regex 容器: 分段
                htmls := regexExtractAll(htmlClean, *itemSelector)
                for _, h := range htmls {
                        if d, err := goquery.NewDocumentFromReader(strings.NewReader(h)); err == nil {
                                scopes = append(scopes, d.Find("body").Children().First())
                        }
                }
        default:
                scopes = nil
        }

        for i, scope := range scopes {
                rec := map[string]string{}
                // R98-B BUG-279: per-scope ctx with index=i+1 (与 JSON 模式 scope.index 同口径).
                ctx := &ExtractCtx{Vars: mergeVars(urlVars, map[string]string{"index": strconv.Itoa(i + 1)})}
                for name, rule := range fields {
                        rec[name] = ExtractField(htmlClean, doc, scope, rule, ctx)
                }
                for _, uf := range urlFields {
                        if rec[uf] != "" {
                                rec[uf] = Absolutize(rec[uf], baseURL)
                        }
                }
                if hasURLField(urlFields) && !hasAnyURLField(urlFields, rec) {
                        continue
                }
                if hasRequiredFailure(fields, rec) {
                        continue
                }
                if hasAnyValue(rec) {
                        out.Items = append(out.Items, ListItem{Fields: rec})
                }
        }
        return out
}

func hasURLField(urlFields []string) bool {
        for _, uf := range urlFields {
                if uf == "url" || uf == "bookUrl" {
                        return true
                }
        }
        return false
}

func hasAnyURLField(urlFields []string, rec map[string]string) bool {
        for _, uf := range urlFields {
                if rec[uf] != "" {
                        return true
                }
        }
        return false
}

func hasAnyValue(rec map[string]string) bool {
        for _, v := range rec {
                if v != "" {
                        return true
                }
        }
        return false
}

func mergeVars(parts ...map[string]string) map[string]string {
        out := map[string]string{}
        for _, p := range parts {
                for k, v := range p {
                        out[k] = v
                }
        }
        return out
}

// ---------- ParseBook ----------

// ParseBook — 书籍信息解析. 主规则 + meta/JSON-LD 兜底.
func ParseBook(html, baseURL string, pageRule PageRule) ParsedBook {
        htmlClean := StripLeadingBom(html)
        res := ParseList(htmlClean, baseURL, pageRule, []string{"cover"})
        var f map[string]string
        if len(res.Items) > 0 {
                f = res.Items[0].Fields
        } else {
                f = map[string]string{}
        }
        doc, _ := goquery.NewDocumentFromReader(strings.NewReader(htmlClean))
        meta := ExtractMetaTags(doc)
        ld := ExtractJsonLd(doc)
        og := func(k string) string {
                if v, ok := meta[k]; ok {
                        return v
                }
                if v, ok := meta["og:"+k]; ok {
                        return v
                }
                if v, ok := meta["article:"+k]; ok {
                        return v
                }
                if v, ok := meta["book:"+k]; ok {
                        return v
                }
                return ""
        }
        pick := func(primary, meta1, meta2 string) string {
                if primary != "" {
                        return primary
                }
                if meta1 != "" {
                        return meta1
                }
                return meta2
        }
        out := ParsedBook{
                Name:          pick(f["name"], ld["title"], og("title")),
                Author:        pick(f["author"], ld["author"], og("author")),
                Intro:         pick(f["intro"], ld["description"], og("description")),
                Keywords:      pick(f["keywords"], ld["keywords"], og("keywords")),
                Category:      pick(f["category"], ld["category"], ""),
                LatestChapter: pick(f["latestChapter"], ld["latestChapter"], ""),
                Status:        f["status"],
                WordCount:     f["wordCount"],
        }
        cover := pick(f["cover"], ld["cover"], og("image"))
        if cover != "" {
                out.Cover = Absolutize(cover, baseURL)
        }
        return out
}

// ---------- ParseToc (含翻页 + 乱序重排 + 去重) ----------

// PageFetcher — 翻页请求注入回调 (runner 过闸路径注入, 与章节抓取同享 hostGate).
type PageFetcher func(ctx context.Context, u, refererURL string) (string, error)

// ParseToc — 目录解析. 含翻页 + 乱序重排 + 去重.
// pageFetcher 可为 nil (直连 FetchPage, rules/test 测试路由保持直连语义).
func ParseToc(ctx context.Context, firstURL, html string, pageRule PageRule, pageFetcher PageFetcher, onProgress func(page, found int)) (TocResult, error) {
        all := []TocItem{}
        html0 := StripLeadingBom(html)

        // ---- JSON 目录模式 ----
        if pageRule.ItemSelector != nil && pageRule.ItemSelector.Type == FieldJSON {
                root := ParseJsonBody(html0)
                if root != nil {
                        varsBase := URLVars(firstURL)
                        seen := map[string]bool{}
                        items := JsonArrayAt(root, pageRule.ItemSelector.Expression)
                        for i, it := range items {
                                index := i + 1
                                phase1Vars := mergeVars(varsBase, map[string]string{"index": strconv.Itoa(index)})
                                rec := map[string]string{}
                                // 两阶段: 先非 const
                                for name, rule := range pageRule.Fields {
                                        if rule.Type == FieldConst {
                                                continue
                                        }
                                        rec[name] = ExtractField("", nil, nil, rule, &ExtractCtx{JSON: it, Vars: phase1Vars})
                                }
                                // const 后置提取 (title/url/volume)
                                titleRule := pageRule.Fields["title"]
                                urlRule := pageRule.Fields["url"]
                                volRule := pageRule.Fields["volume"]
                                title := rec["title"]
                                if titleRule.Type == FieldConst {
                                        title = ExtractField("", nil, nil, titleRule, &ExtractCtx{Vars: mergeVars(varsBase, rec, map[string]string{"index": strconv.Itoa(index)})})
                                }
                                href := ""
                                if urlRule.Type == FieldConst {
                                        href = ExtractField("", nil, nil, urlRule, &ExtractCtx{Vars: mergeVars(varsBase, rec, map[string]string{"index": strconv.Itoa(index), "title": title})})
                                } else {
                                        href = rec["url"]
                                }
                                // R83-B BUG-192 (P3) 修复: const url 未 propagate 到 rec → 后续 const 字段
                                //   (e.g. vol 模板含 {url}) 的 Vars (mergeVars(varsBase, rec, ...)) 取
                                //   rec["url"] 为空 (first loop 跳过 const). 修复: 显式 rec["url"]=href
                                //   让 vol 等后续 const 字段引用 {url} 时拿到 const-extracted 值 (非 const
                                //   url 已由 first loop 设值, 此行 no-op). +1 行. 罕见 case (vol 是 const
                                //   + 模板含 {url} + url 也是 const), 0 用户报告.
                                rec["url"] = href
                                vol := rec["volume"]
                                if vol == "" && volRule.Type == FieldConst {
                                        vol = ExtractField("", nil, nil, volRule, &ExtractCtx{Vars: mergeVars(varsBase, rec, map[string]string{"index": strconv.Itoa(index), "title": title})})
                                }
                                if title == "" && href == "" {
                                        continue
                                }
                                href = Absolutize(href, firstURL)
                                if href == "" {
                                        continue
                                }
                                if titleRule.Required && title == "" {
                                        continue
                                }
                                if urlRule.Required && href == "" {
                                        continue
                                }
                                if volRule.Required && vol == "" {
                                        continue
                                }
                                if seen[href] {
                                        continue
                                }
                                seen[href] = true
                                all = append(all, TocItem{Title: orStr(title, href), URL: href, Volume: vol})
                        }
                        if onProgress != nil {
                                onProgress(1, len(all))
                        }
                }
                return TocResult{Items: all, Pages: 1}, nil
        }

        // ---- HTML 模式 ----
        curURL := firstURL
        current := html0
        maxPages := 1
        if pageRule.Pagination != nil && pageRule.Pagination.Enabled {
                maxPages = pageRule.Pagination.MaxPages
                if maxPages <= 0 {
                        maxPages = 20
                }
        }
        seen := map[string]bool{}
        samePathStreak := 0
        lastPath := ""
        pagesUsed := 0
        // R72-C BUG-99 (P2): 翻页循环 seen map 初始化时加 firstURL, 防回到首页死循环.
        //   原: seen["__page__"+next] 仅在翻页前更新 next, firstURL 从未入 seen.
        //   若第 N 页的 "下一页" 链接指回 firstURL (源站循环导航 e.g. 第3页→第1页),
        //   seen["__page__"+firstURL]=false → 不 break → 重新抓第1页 → 提取同内容 →
        //   再次翻页 → 同样循环 → 直到 maxPages (10/20) 才停 → 浪费 N×firstURL 请求预算 +
        //   N 重复内容入 toc (ParseToc) 或 content (ParseContent). 修复: 启动时把
        //   firstURL 标已访问, 翻页 next=firstURL 时 seen 命中 break.
        seen["__page__"+firstURL] = true

        for p := 1; p <= maxPages && curURL != ""; p++ {
                pagesUsed = p
                // 同 path 不同 query 计数 (防伪翻页)
                curPath := ""
                if u, err := url.Parse(curURL); err == nil {
                        curPath = strings.ToLower(u.Path)
                }
                if curPath != "" && curPath == lastPath {
                        samePathStreak++
                        if samePathStreak >= 5 {
                                break
                        }
                } else {
                        samePathStreak = 0
                }
                lastPath = curPath

                doc, err := goquery.NewDocumentFromReader(strings.NewReader(current))
                if err != nil {
                        break
                }
                base := DocBase(doc, curURL)
                titleRule := pageRule.Fields["title"]
                urlRule := pageRule.Fields["url"]
                volRule := pageRule.Fields["volume"]
                var scopes []*goquery.Selection
                if pageRule.ItemSelector != nil {
                        switch pageRule.ItemSelector.Type {
                        case FieldCSS:
                                scopes = cssExtractAll(doc, nil, *pageRule.ItemSelector)
                        case FieldRegex:
                                htmls := regexExtractAll(current, *pageRule.ItemSelector)
                                for _, h := range htmls {
                                        if d, err := goquery.NewDocumentFromReader(strings.NewReader(h)); err == nil {
                                                scopes = append(scopes, d.Find("body").Children().First())
                                        }
                                }
                        }
                } else {
                        // 无容器: scope = body
                        scopes = []*goquery.Selection{doc.Find("body")}
                }

                // R98-B BUG-279 (P3) 续修 (与 ParseList HTML line ~1641 同口径对称):
                //   原 ExtractField 传 nil ctx → FieldConst 分支跳过 applyConstTemplate
                //   → toc.fields.title/url/volume = const 时返 "" 而非 evaluated value.
                //   71 Rule 0 用 FieldConst in toc.fields (yueyouxs 用 const 仅在
                //   toc.tocLink, runner.go line ~1876 BUG-268 已修); 0 生产命中, 防御
                //   性修复. 修复: urlVars (per-page, curURL 随翻页变) + per-scope
                //   index=i+1 ctx. 同时 propagate title/href 到 vars 让后续 const
                //   (e.g. vol 模板含 {url}) 引用前值 (与 JSON 模式 BUG-192 line ~1827
                //   rec["url"]=href 同款 propagate, HTML 模式顺序固定 title→url→vol
                //   无需 2-pass fixpoint). 0 行为变化 (FieldCSS/FieldRegex/FieldJSON
                //   不读 ctx.Vars).
                urlVars := URLVars(curURL)
                for i, scope := range scopes {
                        vars := mergeVars(urlVars, map[string]string{"index": strconv.Itoa(i + 1)})
                        var title, href, vol string
                        if titleRule.Type != "" {
                                title = ExtractField(current, doc, scope, titleRule, &ExtractCtx{Vars: vars})
                                vars["title"] = title
                        }
                        if urlRule.Type != "" {
                                href = ExtractField(current, doc, scope, urlRule, &ExtractCtx{Vars: vars})
                                vars["url"] = href
                        }
                        if volRule.Type != "" {
                                vol = ExtractField(current, doc, scope, volRule, &ExtractCtx{Vars: vars})
                        }
                        if title == "" && href == "" {
                                continue
                        }
                        href = Absolutize(ResolveWithBase(href, base), orStr(curURL, firstURL))
                        if href == "" {
                                continue
                        }
                        if titleRule.Required && title == "" {
                                continue
                        }
                        if urlRule.Required && href == "" {
                                continue
                        }
                        if volRule.Required && vol == "" {
                                continue
                        }
                        if seen[href] {
                                continue
                        }
                        seen[href] = true
                        all = append(all, TocItem{Title: orStr(title, href), URL: href, Volume: vol})
                }
                if onProgress != nil {
                        onProgress(p, len(all))
                }

                // 翻页
                if p < maxPages && pageRule.Pagination != nil && pageRule.Pagination.Enabled {
                        var next string
                        nextRule := pageRule.Pagination.NextLink
                        if nextRule != nil && nextRule.Type != "" {
                                next = ExtractField(current, doc, nil, *nextRule, nil)
                        } else {
                                // 兜底: 常见"下一页"链接 + HTML5 rel=next + 英文 Next/More
                                next = findNextLink(doc)
                        }
                        next = Absolutize(ResolveWithBase(next, base), curURL)
                        if next == "" || next == curURL || seen["__page__"+next] {
                                break
                        }
                        seen["__page__"+next] = true
                        // 翻页请求: 注入 pageFetcher 则走 runner 过闸路径, 否则直连 FetchPage
                        var nextPageHTML string
                        var err error
                        if pageFetcher != nil {
                                nextPageHTML, err = pageFetcher(ctx, next, curURL)
                        } else {
                                var res *FetchResult
                                res, err = FetchPage(ctx, next, DefaultFetchConfig)
                                if err == nil {
                                        nextPageHTML = res.HTML
                                }
                        }
                        if err != nil || nextPageHTML == "" {
                                break
                        }
                        curURL = next
                        current = nextPageHTML
                } else {
                        break
                }
        }
        return TocResult{Items: all, Pages: pagesUsed}, nil
}

// TocResult — 目录解析结果.
type TocResult struct {
        Items []TocItem
        Pages int
}

// nextLinkEnRe — 英文 "Next" / "Next Page" / "Next Chapter" / "More" 链接文本精确匹配
// (R81-C BUG-175 修复).
//
//      R80-C BUG-175 诚实留痕: 原 "Next"/"More" 用 strings.Contains 子串匹配, 误命中
//      "More details" / "Next chapter info" 等含 Next/More 子串的链接. R81-C 修复:
//        - 中文关键词 ("下一页"/"下页"/"下一章") 保留 strings.Contains (中文站短文本
//          子串匹配风险低, 与 cleaner.go navLinkRe 同口径).
//        - 英文关键词 ("Next"/"More") 改用本正则精确匹配:
//            ^\s*(next(?:\s+(?:page|chapter))?|more)\b[\s\W]*$
//          语义: trim 后文本以 next 或 more 开头, next 可选跟 \s+ page/chapter
//          (允许 "Next Page"/"Next Chapter" 整体匹配, 与 "Next" 同义); 后跟词边界
//          (\b 防 "nextpage" 连写); 后续仅允非字母字符 (空白 + 标点如 > / . / … /
//          › / » / 空格) 至末尾.
//        - 命中: "Next" / "Next>" / "Next..." / "Next Page" / "Next Chapter" /
//          "More" / "More..." / "  Next  " 等.
//        - 不命中: "Next chapter info" (后续有字母 chapter 后再接 "info" 不终止) /
//          "More details" / "Nextpage" (无词边界) / "Next steps" 等.
//        - 不删 "More" 关键词 (R80-C 备选 c): "More" 在英文源站作 "加载更多" 链接
//          常见 (与中文 "加载更多" button 同款语义), 保留 + 正则精确匹配防误命中.
//      caller (ParseToc/ParseContent) 仍保留四层防御: Absolutize 非 http(s) 过滤 +
//      seen map 防重 + samePathStreak (≥5 同 path 不同 query) break + maxPages 上限.
//      行为变化: 71 Rule 翻页链路若依赖 "Next chapter info" 等非纯导航文本作下一页
//      链接, 修复后不命中 (改由 nextRule.Type 配置或 rel=next 或加载更多 button 兜底).
//      findNextLink 仅在 nextRule 缺失时兜底 (rg 全仓 findNextLink 仅 ParseToc/
//      ParseContent 两处 caller), 多数 71 Rule 有 nextRule 配置或无翻页 (e.g.
//      yueyouxs toc/content pagination.enabled=false → findNextLink 不触发),
//      0 用户受影响.
var nextLinkEnRe = regexp.MustCompile(`(?i)^\s*(next(?:\s+(?:page|chapter))?|more)\b[\s\W]*$`)

// findNextLink — 兜底找"下一页"链接 (常见中文站点 + HTML5 rel=next + 英文 Next/More).
//
//      R81-C BUG-175 (P3) 修复: 见 nextLinkEnRe 注释. 中文 strings.Contains + 英文
//      正则精确匹配 (防 "More details" 等子串误命中).
func findNextLink(doc *goquery.Document) string {
        // 1. 中文关键词: strings.Contains (子串匹配, 中文站短文本风险低).
        cnKeywords := []string{"下一页", "下页", "下一章"}
        anchors := doc.Find("a")
        for _, kw := range cnKeywords {
                for i := range anchors.Nodes {
                        s := anchors.Eq(i)
                        if strings.Contains(s.Text(), kw) {
                                if href, _ := s.Attr("href"); href != "" {
                                        return href
                                }
                        }
                }
        }
        // 2. 英文关键词: 正则精确匹配 (防 "More details" / "Next chapter info" 子串误命中).
        for i := range anchors.Nodes {
                s := anchors.Eq(i)
                if nextLinkEnRe.MatchString(strings.TrimSpace(s.Text())) {
                        if href, _ := s.Attr("href"); href != "" {
                                return href
                        }
                }
        }
        // 3. HTML5 rel=next
        if href, _ := doc.Find(`a[rel="next"]`).Attr("href"); href != "" {
                return href
        }
        // 4. "加载更多" 按钮 data-url
        moreSel := doc.Find(`[data-load-more], [data-loadmore], button:contains("加载更多"), a:contains("加载更多")`)
        if moreSel.Length() > 0 {
                if dataURL := moreSel.First().AttrOr("data-url", moreSel.First().AttrOr("data-href", "")); dataURL != "" {
                        return dataURL
                }
        }
        return ""
}

func orStr(a, b string) string {
        if a != "" {
                return a
        }
        return b
}

// ---------- ParseContent (含翻页合并) ----------

// ParseContent — 章节正文解析. 含翻页合并 + cleanContentHtml.
func ParseContent(ctx context.Context, firstURL, html string, pageRule PageRule, cfg FetchConfig, pageFetcher PageFetcher) (ParsedContent, error) {
        html0 := StripLeadingBom(html)
        maxPages := 1
        joinWith := ""
        if pageRule.Pagination != nil && pageRule.Pagination.Enabled {
                maxPages = pageRule.Pagination.MaxPages
                if maxPages <= 0 {
                        maxPages = 10
                }
                joinWith = pageRule.Pagination.JoinWith
        }
        if joinWith == "" {
                joinWith = "<br/>"
        }

        curURL := firstURL
        current := html0
        var parts []string
        seen := map[string]bool{}
        pagesUsed := 0
        // R72-C BUG-99 (P2): 同 ParseToc, 翻页循环 seen 初始化时加 firstURL, 防回到首页死循环.
        //   详见 ParseToc line 1413 注释. ParseContent 影响更大: 翻页死循环 → 同内容
        //   N 次拼接进 parts → 章节正文 N 倍冗余 (e.g. maxPages=10 → 单章 10 倍长度).
        seen["__page__"+firstURL] = true

        for p := 1; p <= maxPages && curURL != ""; p++ {
                pagesUsed = p
                // 提取 content 字段
                content := ""
                if rule, ok := pageRule.Fields["content"]; ok && rule.Type != "" {
                        if rule.Type == FieldConst {
                                // R93-B BUG-262 (P3) 修复: 原直接调 applyConstTemplate 跳过
                                //   ApplyTransform, FieldConst content 规则的 stripTags/replaceFrom/
                                //   decode/index 静默失效 (FieldJSON 分支 line 1929 显式 ApplyTransform,
                                //   FieldCSS 分支 line 1933 走 ExtractField 内部 ApplyTransform, 唯独
                                //   FieldConst 漏). 修复: 走 ExtractField 统一入口 (与 ParseList JSON
                                //   line 1390 / ParseToc JSON line 1405 同款), ApplyTransform 在 else
                                //   分支 line 1175 一并生效. 行为变化: FieldConst content 规则若配
                                //   stripTags 等现在生效 (71 Rule 0 用 FieldConst content, 0 当前用户
                                //   受影响; 未来 admin 配置后受益).
                                content = ExtractField("", nil, nil, rule, &ExtractCtx{Vars: URLVars(curURL)})
                        } else if rule.Type == FieldJSON {
                                root := ParseJsonBody(current)
                                content = JsonToString(JsonGet(root, rule.Expression))
                                content = ApplyTransform(content, rule)
                        } else {
                                doc, err := goquery.NewDocumentFromReader(strings.NewReader(current))
                                if err == nil {
                                        content = ExtractField(current, doc, nil, rule, nil)
                                }
                        }
                        // BUG-251 (P3): FieldCSS content 规则选择器 miss (源站结构无
                        //   #content/.content/... 等通用容器, ApplySmartRuleFallback 的
                        //   通用选择器全 miss) → 显式 fallback 到 body (与无 content 字段
                        //   路径同款). 防 fallback 路径下章节内容为空. FieldConst/
                        //   FieldJSON 返空是 admin 配置意图 (模板/JSON 路径显式选空), 不
                        //   兜底 (兜底会污染 admin 显式 "无内容" 语义). 行为变化: 仅
                        //   FieldCSS miss 路径, 从空 → body cleaned (非空更优).
                        if content == "" && rule.Type == FieldCSS {
                                doc, err := goquery.NewDocumentFromReader(strings.NewReader(current))
                                if err == nil {
                                        content, _ = doc.Find("body").Html()
                                }
                        }
                } else {
                        // 无 content 字段规则: 整页正文 (取 body)
                        doc, err := goquery.NewDocumentFromReader(strings.NewReader(current))
                        if err == nil {
                                content, _ = doc.Find("body").Html()
                        }
                }
                parts = append(parts, content)

                // 翻页
                if p < maxPages && pageRule.Pagination != nil && pageRule.Pagination.Enabled {
                        next := ""
                        doc, _ := goquery.NewDocumentFromReader(strings.NewReader(current))
                        if doc != nil {
                                nextRule := pageRule.Pagination.NextLink
                                if nextRule != nil && nextRule.Type != "" {
                                        next = ExtractField(current, doc, nil, *nextRule, nil)
                                } else {
                                        next = findNextLink(doc)
                                }
                        }
                        base := ""
                        if doc != nil {
                                base = DocBase(doc, curURL)
                        }
                        next = Absolutize(ResolveWithBase(next, base), curURL)
                        if next == "" || next == curURL || seen["__page__"+next] {
                                break
                        }
                        seen["__page__"+next] = true
                        var nextPageHTML string
                        var err error
                        if pageFetcher != nil {
                                nextPageHTML, err = pageFetcher(ctx, next, curURL)
                        } else {
                                var res *FetchResult
                                res, err = FetchPage(ctx, next, cfg)
                                if err == nil {
                                        nextPageHTML = res.HTML
                                }
                        }
                        if err != nil || nextPageHTML == "" {
                                break
                        }
                        curURL = next
                        current = nextPageHTML
                } else {
                        break
                }
        }
        merged := strings.Join(parts, joinWith)
        return ParsedContent{Content: merged, Pages: pagesUsed}, nil
}
