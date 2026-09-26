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
//	与 cleaner.compileUserAdPattern 同口径: 首次 compile 后复用; ok=false 也缓存
//	(避免重复 compile 失败 pattern). ReDoS 闸门 (reDoSNestedQuantifier, 同文件 line
//	254) + 长度 ≤1000 (与原 ApplyTransform 内联闸门一致).
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

// ApplyTransform — 字段值后处理 (stripTags / replaceFrom / decode / index).
// ReDoS 防护: 长度上限 1000 + 嵌套量词闸门 + chunk 200 字符切片跑.
// R72-C BUG-98 (P2): ReplaceFrom pattern 编译提到 compileUserReplaceFrom sync.Map
//
//	缓存 (与 cleaner.compileUserAdPattern 同口径), 0 compile 开销 (任务级复用).
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
			b, err := DecodeBase64(m[1])
			if err == nil {
				var j map[string]any
				if err := json.Unmarshal(b, &j); err == nil {
					parts := []string{}
					for k, val := range j {
						parts = append(parts, fmt.Sprintf("%s=%v", k, val))
					}
					v = strings.Join(parts, "\n")
				}
			}
		} else {
			b, err := DecodeBase64(strings.TrimSpace(v))
			if err == nil {
				var j map[string]any
				if err := json.Unmarshal(b, &j); err == nil {
					parts := []string{}
					for k, val := range j {
						parts = append(parts, fmt.Sprintf("%s=%v", k, val))
					}
					v = strings.Join(parts, "\n")
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
		if *rule.Index < len(parts2) {
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

func regexExtractFirst(html string, rule FieldRule) string {
	flags := rule.Flags
	if flags == "" {
		flags = "gis"
	}
	re, err := regexp.Compile("(?" + flags + ")" + rule.Expression)
	if err != nil {
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
	flags := rule.Flags
	if flags == "" {
		flags = "gis"
	}
	re, err := regexp.Compile("(?" + flags + ")" + rule.Expression)
	if err != nil {
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
func JsonGet(root any, path string) any {
	if root == nil || path == "" {
		return nil
	}
	// 联合 "||" 分支
	if strings.Contains(path, "||") {
		for _, p := range strings.Split(path, "||") {
			p = strings.TrimSpace(p)
			if v := JsonGet(root, p); v != nil {
				return v
			}
		}
		return nil
	}
	// 递归下降
	if strings.HasPrefix(path, "$..") || strings.HasPrefix(path, "..") {
		key := strings.TrimPrefix(strings.TrimPrefix(path, "$"), "..")
		return recursiveCollect(root, key)
	}
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
			for j < len(path) && path[j] != ']' {
				cur.WriteByte(path[j])
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
			// [k=v] 过滤
			if eq := strings.Index(inner, "="); eq > 0 {
				tokens = append(tokens, jsonToken{
					kind: tokenFilter,
					fk:   strings.TrimSpace(inner[:eq]),
					fv:   strings.TrimSpace(inner[eq+1:]),
				})
				continue
			}
			// [?(@.field==value)] JSONPath 过滤
			if strings.HasPrefix(inner, "?(") && strings.HasSuffix(inner, ")") {
				expr := inner[2 : len(inner)-1]
				if m := jsonPathEqRe.FindStringSubmatch(expr); m != nil {
					tokens = append(tokens, jsonToken{
						kind: tokenFilter,
						fk:   m[1],
						fv:   m[2],
					})
					continue
				}
				if m := jsonPathNeRe.FindStringSubmatch(expr); m != nil {
					tokens = append(tokens, jsonToken{kind: tokenFilter, fk: m[1], fv: "__NE__" + m[2]})
					continue
				}
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
			continue
		}
		valStr := fmt.Sprintf("%v", val)
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

// JsonArrayAt — 取数组路径下的所有元素 (支持逗号分隔多路径并集).
func JsonArrayAt(root any, path string) []any {
	if root == nil {
		return nil
	}
	out := []any{}
	for _, p := range strings.Split(path, ",") {
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
		// 对象 → key=value\n 形态
		parts := []string{}
		for k, val := range x {
			parts = append(parts, fmt.Sprintf("%s=%v", k, val))
		}
		return strings.Join(parts, "\n")
	default:
		return fmt.Sprintf("%v", v)
	}
}

// URLVars — URL 查询参数 + path 段 → map.
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
		return ""
	}
	v = ApplyTransform(v, rule)
	// extractMultiple
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
		sep := rule.MultipleSeparator
		if sep == "" {
			sep = "\n"
		}
		v = strings.Join(multi, sep)
	}
	// defaultValue 兜底 (在所有 transform 之后应用)
	if v == "" && rule.DefaultValue != "" {
		v = rule.DefaultValue
	}
	return v
}

// applyConstTemplate — const 模板占位符替换. {name} → vars[name]; 未命中替换为空.
func applyConstTemplate(tmpl string, vars map[string]string) string {
	if tmpl == "" {
		return ""
	}
	// 简单实现: 正则替换 {field.subfield} / {field} / {q.param}
	re := constTemplateRe
	return re.ReplaceAllStringFunc(tmpl, func(m string) string {
		// m = "{name}", 取中间
		key := m[1 : len(m)-1]
		// 支持嵌套对象访问 (vars[field] 为对象/数组时按点路径逐层取值)
		if v, ok := vars[key]; ok {
			return v
		}
		// 支持 field.subfield
		if dot := strings.Index(key, "."); dot > 0 {
			prefix := key[:dot]
			suffix := key[dot+1:]
			if v, ok := vars[prefix]; ok {
				// v 是 "k=val\n..." 形态, 解析为 map
				m := parseKVString(v)
				if mv, ok := m[suffix]; ok {
					return mv
				}
			}
		}
		return ""
	})
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
	if !strings.HasPrefix(strings.ToLower(s), "http://") && !strings.HasPrefix(strings.ToLower(s), "https://") {
		b, err := url.Parse(base)
		if err == nil {
			u, err := url.Parse(s)
			if err == nil {
				out = b.ResolveReference(u).String()
			}
		}
	}
	// 协议过滤
	if !strings.HasPrefix(strings.ToLower(out), "http://") && !strings.HasPrefix(strings.ToLower(out), "https://") {
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
		if strings.HasPrefix(strings.ToLower(href), "http://") || strings.HasPrefix(strings.ToLower(href), "https://") {
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
	if strings.HasPrefix(strings.ToLower(u), "http://") || strings.HasPrefix(strings.ToLower(u), "https://") {
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
	hasJsonConstFields := false
	for _, r := range fields {
		if r.Type == FieldJSON || r.Type == FieldConst {
			hasJsonConstFields = true
			break
		}
	}

	// ---- JSON 模式 ----
	if (itemSelector != nil && itemSelector.Type == FieldJSON) || (itemSelector == nil && hasJsonConstFields) {
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
			for name, rule := range fields {
				if rule.Type != FieldConst {
					continue
				}
				rec[name] = ExtractField("", nil, nil, rule, ctx2)
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

	if itemSelector == nil {
		// 无容器: 直接对整页提取字段 (单值型, 如书籍页)
		rec := map[string]string{}
		for name, rule := range fields {
			rec[name] = ExtractField(htmlClean, doc, nil, rule, nil)
		}
		if hasRequiredFailure(fields, rec) {
			return out
		}
		if len(rec) > 0 {
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

	for _, scope := range scopes {
		rec := map[string]string{}
		for name, rule := range fields {
			rec[name] = ExtractField(htmlClean, doc, scope, rule, nil)
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

		for _, scope := range scopes {
			var title, href, vol string
			if titleRule.Type != "" {
				title = ExtractField(current, doc, scope, titleRule, nil)
			}
			if urlRule.Type != "" {
				href = ExtractField(current, doc, scope, urlRule, nil)
			}
			if volRule.Type != "" {
				vol = ExtractField(current, doc, scope, volRule, nil)
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

// findNextLink — 兜底找"下一页"链接 (常见中文站点 + HTML5 rel=next + 英文 Next/More).
func findNextLink(doc *goquery.Document) string {
	keywords := []string{"下一页", "下页", "下一章", "Next", "More"}
	for _, kw := range keywords {
		sel := doc.Find("a")
		for i := range sel.Nodes {
			s := sel.Eq(i)
			if strings.Contains(s.Text(), kw) {
				if href, _ := s.Attr("href"); href != "" {
					return href
				}
			}
		}
	}
	// HTML5 rel=next
	if href, _ := doc.Find(`a[rel="next"]`).Attr("href"); href != "" {
		return href
	}
	// "加载更多" 按钮 data-url
	sel := doc.Find(`[data-load-more], [data-loadmore], button:contains("加载更多"), a:contains("加载更多")`)
	if sel.Length() > 0 {
		if dataURL := sel.First().AttrOr("data-url", sel.First().AttrOr("data-href", "")); dataURL != "" {
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
				content = applyConstTemplate(rule.Expression, URLVars(curURL))
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
