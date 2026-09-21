// qimao-proxy — 七猫官方API(wtzw.com) 签名+AES 外置转换代理 (Go 重写, R40-1A).
//
// 与 TS 端 mini-services/qimao-proxy/index.ts 同口径:
//   - 官方 API 双域名: api-bc.wtzw.com(search/detail/leader-board) + api-ks.wtzw.com(toc/content)
//   - 双签名: params.sign(MD5 k=v 拼接 + key) + headers.sign(MD5 k=v 拼接 + key)
//   - 正文 AES-128-CBC 解密(IV=base64前16字节, KEY='242ccb8230d709e1')
//   - 现网 qimao API 文档显示 v2 路径(/api/v2/book/detail, /api/v2/chapter/content)
//   - book/toc/content = /detail?bid= / /toc?bid= / /content?bid=&cid=
//
// 接口:
//   GET /health                → {ok,service,selfTestOk,apiReachable,upstream}
//   GET /search?wd=&page=      → {ok,total,page,books,apiVersion}
//   GET /rank?rank_type=&tab_type= → {ok,total,books,apiVersion}
//   GET /detail?bid=&api=v2?   → {ok,book,apiVersion}
//   GET /toc?bid=              → {ok,total,chapters,apiVersion}
//   GET /content?bid=&cid=&api=v2? → {ok,cid,content}  (content=解密后纯文本 \n 分段)
//
// 启动: cd go-backend/services/qimao-proxy && go run . (端口固定 3013)
package main

import (
        "crypto/aes"
        "crypto/cipher"
        "crypto/md5"
        "encoding/base64"
        "encoding/json"
        "fmt"
        "io"
        "net/http"
        "net/url"
        "regexp"
        "sort"
        "strconv"
        "strings"
        "sync"
        "time"

        "heis-backend/services/bridgeserver"
)

const PORT = 3013

// 签名 + AES 密钥(站点公开常量)
const (
        signKey           = "d3dGiJc651gSQ8w1"
        aesKeyHex         = "242ccb8230d709e1" // 16 字节 ASCII = AES-128
        apiBC             = "https://api-bc.wtzw.com"
        apiKS             = "https://api-ks.wtzw.com"
        imeiIP            = "2937357107"
        upstreamUA        = "okhttp/3.12.0"
        upstreamTimeoutMs = 15000
)

var aesKey = []byte(aesKeyHex)

var subWordsRe = regexp.MustCompile(`([\d.]+万?字)`)

// API 路径表(v4/v1 现网默认; v2 实验性)
var apiPathsV4V1 = map[string]string{
        "search":  "/search/v1/words",
        "rank":    "/api/v1/leader-board",
        "detail":  "/api/v4/book/detail",
        "toc":     "/api/v1/chapter/chapter-list",
        "content": "/api/v1/chapter/content",
}
var apiPathsV2 = map[string]string{
        "search":  "/search/v2/words",
        "rank":    "/api/v2/leader-board",
        "detail":  "/api/v2/book/detail",
        "toc":     "/api/v2/chapter/chapter-list",
        "content": "/api/v2/chapter/content",
}

// 头组(书源 searchUrl/ruleBookInfo.tocUrl 原文语义)
var headersUNK = map[string]string{
        "app-version":     "80400",
        "platform":         "android",
        "reg":              "0",
        "AUTHORIZATION":    "",
        "application-id":  "com.kmxs.reader",
        "net-env":          "1",
        "channel":          "unknown",
        "qm-params":        "",
}

// headersSearch — search 用 channel=qm-xiaomi_If(书源原文)。
func headersSearchMap() map[string]string {
        h := map[string]string{}
        for k, v := range headersUNK {
                h[k] = v
        }
        h["channel"] = "qm-xiaomi_If"
        return h
}

// ---------- 签名 ----------
func md5Hex(s string) string {
        sum := md5.Sum([]byte(s))
        return fmt.Sprintf("%x", sum)
}

// signHeaders — 头组签名: 按键名排序 k=v 拼接 + key。
// Go sort.Strings 是字典序(大写在前), 与 TS Object.keys().sort() 语义一致。
func signHeaders(h map[string]string) map[string]string {
        keys := make([]string, 0, len(h))
        for k := range h {
                keys = append(keys, k)
        }
        sort.Strings(keys)
        var sb strings.Builder
        for _, k := range keys {
                sb.WriteString(k)
                sb.WriteString("=")
                sb.WriteString(h[k])
        }
        sb.WriteString(signKey)
        signed := map[string]string{}
        for k, v := range h {
                signed[k] = v
        }
        signed["sign"] = md5Hex(sb.String())
        return signed
}

// signParams — 参数签名: 按键名排序 k=v 拼接 + key。
func signParams(p map[string]string) string {
        keys := make([]string, 0, len(p))
        for k := range p {
                keys = append(keys, k)
        }
        sort.Strings(keys)
        var sb strings.Builder
        for _, k := range keys {
                sb.WriteString(k)
                sb.WriteString("=")
                sb.WriteString(p[k])
        }
        sb.WriteString(signKey)
        return md5Hex(sb.String())
}

// qs — query string 编码(k=v 用 url.QueryEscape, & 分隔)。
func qs(p map[string]string) string {
        parts := make([]string, 0, len(p))
        for k, v := range p {
                parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
        }
        return strings.Join(parts, "&")
}

// ---------- AES-128-CBC 解密 ----------
// aesDecrypt — base64 密文 → UTF-8 明文(IV=blob 前 16 字节, KEY=AES-128)。
func aesDecrypt(b64 string) (string, error) {
        blob, err := base64.StdEncoding.DecodeString(b64)
        if err != nil {
                return "", fmt.Errorf("base64 解码失败: %v", err)
        }
        if len(blob) <= 16 {
                return "", fmt.Errorf("密文过短(无IV)")
        }
        iv := blob[:16]
        ct := blob[16:]
        block, err := aes.NewCipher(aesKey)
        if err != nil {
                return "", err
        }
        if len(ct)%block.BlockSize() != 0 {
                return "", fmt.Errorf("密文长度非块对齐")
        }
        pt := make([]byte, len(ct))
        cipher.NewCBCDecrypter(block, iv).CryptBlocks(pt, ct)
        // 去除 PKCS7 padding
        if len(pt) > 0 {
                pad := int(pt[len(pt)-1])
                if pad > 0 && pad <= block.BlockSize() && pad <= len(pt) {
                        pt = pt[:len(pt)-pad]
                }
        }
        return string(pt), nil
}

// aesRoundtripSelfTest — 离线确定性 AES 加解密回环。
func aesRoundtripSelfTest() bool {
        iv := []byte("1234567890abcdef")
        plain := []byte("七猫代理自检-七猫代理自检")
        block, err := aes.NewCipher(aesKey)
        if err != nil {
                return false
        }
        pad := block.BlockSize() - len(plain)%block.BlockSize()
        padded := make([]byte, len(plain)+pad)
        copy(padded, plain)
        for i := len(plain); i < len(padded); i++ {
                padded[i] = byte(pad)
        }
        ct := make([]byte, len(padded))
        cipher.NewCBCEncrypter(block, iv).CryptBlocks(ct, padded)
        blob := append(iv, ct...)
        b64 := base64.StdEncoding.EncodeToString(blob)
        dec, err := aesDecrypt(b64)
        if err != nil {
                return false
        }
        return dec == string(plain)
}

// ---------- 上游请求 ----------
type upstreamResult struct {
        OK     bool
        Status int
        JSON   map[string]any
        Error  string
}

// upstreamJSON — 带 15s 超时 + 瞬态重试1次的 GET(全态返回)。
// 5xx/429 属瞬态重试, 4xx 确定性失败不重试。
func upstreamJSON(targetURL string, headers map[string]string) upstreamResult {
        finalHeaders := map[string]string{}
        for k, v := range headers {
                finalHeaders[k] = v
        }
        finalHeaders["User-Agent"] = upstreamUA
        for attempt := 1; attempt <= 2; attempt++ {
                req, err := http.NewRequest(http.MethodGet, targetURL, nil)
                if err != nil {
                        return upstreamResult{OK: false, Status: -1, Error: "url 解析失败: " + err.Error()}
                }
                for k, v := range finalHeaders {
                        req.Header.Set(k, v)
                }
                client := &http.Client{Timeout: upstreamTimeoutMs * time.Millisecond}
                resp, err := client.Do(req)
                if err != nil {
                        if attempt == 2 {
                                return upstreamResult{OK: false, Status: -1, Error: "上游网络错误: " + bridgeserver.TruncStr(err.Error(), 120)}
                        }
                        time.Sleep(600 * time.Millisecond)
                        continue
                }
                if (resp.StatusCode >= 500 || resp.StatusCode == 429) && attempt == 1 {
                        io.Copy(io.Discard, resp.Body)
                        resp.Body.Close()
                        time.Sleep(600 * time.Millisecond)
                        continue
                }
                body, _ := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
                resp.Body.Close()
                var j map[string]any
                if err := json.Unmarshal(body, &j); err != nil {
                        return upstreamResult{OK: false, Status: resp.StatusCode, Error: fmt.Sprintf("非JSON响应(%dB): %s", len(body), bridgeserver.TruncStr(string(body), 80))}
                }
                if resp.StatusCode < 200 || resp.StatusCode >= 300 {
                        errStr := ""
                        if e, ok := j["errors"]; ok {
                                b, _ := json.Marshal(e)
                                errStr = string(b)
                        } else if s, ok := j["Status"]; ok {
                                b, _ := json.Marshal(s)
                                errStr = string(b)
                        }
                        return upstreamResult{OK: false, Status: resp.StatusCode, JSON: j, Error: fmt.Sprintf("上游 %d: %s", resp.StatusCode, bridgeserver.TruncStr(errStr, 120))}
                }
                return upstreamResult{OK: true, Status: resp.StatusCode, JSON: j}
        }
        return upstreamResult{OK: false, Status: -1, Error: "unreachable"}
}

// ---------- 响应归一化 ----------
type normBookT struct {
        ID       string `json:"id"`
        Name      string `json:"name"`
        Author   string `json:"author"`
        Intro    string `json:"intro"`
        Cover    string `json:"cover"`
        Category string `json:"category"`
        Words    string `json:"words"`
        Status   string `json:"status"`
        Heat     string `json:"heat"`
}

// normBook — 上游 books 数组项归一化(search / rank)。
func normBook(b map[string]any) *normBookT {
        if b == nil {
                return nil
        }
        idStr := fmt.Sprintf("%v", b["id"])
        id := strings.TrimSpace(idStr)
        if id == "" {
                return nil
        }
        for _, c := range id {
                if c < '0' || c > '9' {
                        return nil
                }
        }
        // tags
        var tags, rankTags string
        if pt, ok := b["ptags"].([]any); ok {
                var ts []string
                for _, t := range pt {
                        if s, ok := t.(string); ok {
                                ts = append(ts, s)
                        }
                }
                tags = strings.Join(ts, ",")
        }
        if bt, ok := b["book_tag_list"].([]any); ok {
                var ts []string
                for _, t := range bt {
                        if s, ok := t.(string); ok {
                                ts = append(ts, s)
                        }
                }
                rankTags = strings.Join(ts, ",")
        }
        sub := fmt.Sprintf("%v", b["sub_title"])
        wordsFromSub := subWordsMatch(sub)
        statusFromSub := ""
        if strings.Contains(sub, "完结") {
                statusFromSub = "完结"
        } else if strings.Contains(sub, "连载") {
                statusFromSub = "连载中"
        }
        category := ""
        if c, ok := b["category_over_words"]; ok {
                category = strings.TrimSpace(fmt.Sprintf("%v", c))
        }
        if category == "" {
                category = strings.TrimSpace(tags)
        }
        if category == "" {
                category = strings.TrimSpace(rankTags)
        }
        words := strings.TrimSpace(fmt.Sprintf("%v", getAny(b, "words_num", "words")))
        if words == "" {
                words = wordsFromSub
        }
        status := ""
        if io, ok := b["is_over"]; ok {
                switch v := io.(type) {
                case float64:
                        if v == 1 {
                                status = "完结"
                        } else if v == 0 {
                                status = "连载中"
                        }
                case string:
                        if v == "1" {
                                status = "完结"
                        } else if v == "0" {
                                status = "连载中"
                        }
                }
        }
        if status == "" {
                status = statusFromSub
        }
        return &normBookT{
                ID:       id,
                Name:     strings.TrimSpace(fmt.Sprintf("%v", getAny(b, "original_title", "title"))),
                Author:   strings.TrimSpace(fmt.Sprintf("%v", getAny(b, "original_author", "author"))),
                Intro:    strings.TrimSpace(fmt.Sprintf("%v", b["intro"])),
                Cover:    fmt.Sprintf("%v", b["image_link"]),
                Category: category,
                Words:    words,
                Status:   status,
                Heat:     fmt.Sprintf("%v", b["heat_number"]),
        }
}

func normBooks(list []any) []*normBookT {
        out := []*normBookT{}
        for _, item := range list {
                if m, ok := item.(map[string]any); ok {
                        if b := normBook(m); b != nil {
                                out = append(out, b)
                        }
                }
        }
        return out
}

// subWordsMatch — 从 "扮猪吃虎・连载・1632万字" 提取 "1632万字"。
func subWordsMatch(sub string) string {
        re := subWordsRe.FindStringSubmatch(sub)
        if len(re) >= 2 {
                return re[1]
        }
        return ""
}

// getAny — 多键取值, 第一个非 nil 的。
func getAny(m map[string]any, keys ...string) any {
        for _, k := range keys {
                if v, ok := m[k]; ok && v != nil {
                        return v
                }
        }
        return ""
}

// ---------- 健康检查缓存 ----------
// R41-1B: 修复 healthProbe 同步 bug — 原代码:
//  1) goroutine 写 healthProbe=nil 在 healthProbeMu 下, 调用方读 healthProbe 在 apiReachableMu 下 → 数据竞争
//  2) goroutine 永不 close(healthProbe) → 调用方 <-healthProbe 永久阻塞, 桥无法响应 /health
//  3) goroutine 内 panic 会泄漏 channel
// 修复: 用单一 apiReachableMu 守护 healthProbe; goroutine defer close+nil; 加 recover 兜底
var (
        apiReachableMu sync.Mutex
        apiReachable   bool
        apiLastCheck   int64
        upstreamStatus int
        healthProbe    chan struct{}
)

func healthCheck() (map[string]any, error) {
        now := time.Now().UnixMilli()
        apiReachableMu.Lock()
        if now-apiLastCheck > 60_000 && healthProbe == nil {
                probe := make(chan struct{})
                healthProbe = probe
                apiReachableMu.Unlock()
                go func() {
                        // R41-1B: defer close + nil + recover 兜底, 防 channel 永不关闭导致 <-healthProbe 永久阻塞
                        defer func() {
                                if rcv := recover(); rcv != nil {
                                        fmt.Printf("[qimao-proxy] healthCheck goroutine panic: %v\n", rcv)
                                }
                                apiReachableMu.Lock()
                                // R41-1B: 防止 race — 只关自己创建的 probe, 不关他人后续创建的 channel
                                if healthProbe == probe {
                                        close(probe)
                                        healthProbe = nil
                                }
                                apiReachableMu.Unlock()
                        }()
                        sp := map[string]string{
                                "gender":  "3",
                                "imei_ip": imeiIP,
                                "page":    "1",
                                "wd":      "七猫",
                        }
                        sp["sign"] = signParams(sp)
                        targetURL := apiBC + "/search/v1/words?" + qs(sp)
                        r := upstreamJSON(targetURL, signHeaders(headersSearchMap()))
                        apiReachableMu.Lock()
                        apiReachable = false
                        if r.OK && r.JSON != nil {
                                if data, ok := r.JSON["data"].(map[string]any); ok {
                                        if books, ok := data["books"].([]any); ok && len(books) >= 0 {
                                                apiReachable = true
                                        }
                                }
                        }
                        apiLastCheck = time.Now().UnixMilli()
                        upstreamStatus = r.Status
                        apiReachableMu.Unlock()
                }()
                <-probe
        } else if healthProbe != nil {
                probe := healthProbe
                apiReachableMu.Unlock()
                <-probe
        } else {
                apiReachableMu.Unlock()
        }
        // R41-1B: 复制一份 snapshot 后返回, 防止读时另一线程写入
        apiReachableMu.Lock()
        reachableSnapshot := apiReachable
        upstreamSnapshot := upstreamStatus
        apiReachableMu.Unlock()
        return map[string]any{
                "apiReachable": reachableSnapshot,
                "upstream":     upstreamSnapshot,
        }, nil
}

// ---------- 路由 ----------
func handle(w http.ResponseWriter, r *http.Request) {
        u := r.URL
        p := u.Path
        apiVer := "v4/v1"
        if strings.ToLower(u.Query().Get("api")) == "v2" {
                apiVer = "v2"
        }
        var paths map[string]string
        if apiVer == "v2" {
                paths = apiPathsV2
        } else {
                paths = apiPathsV4V1
        }

        switch p {
        case "/search":
                handleSearch(w, r, paths, apiVer)
        case "/rank":
                handleRank(w, r, paths, apiVer)
        case "/detail":
                handleDetail(w, r, paths, apiVer)
        case "/toc":
                handleToc(w, r, paths, apiVer)
        case "/content":
                handleContent(w, r, paths, apiVer)
        default:
                bridgeserver.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "未知路径 " + p})
        }
}

func handleSearch(w http.ResponseWriter, r *http.Request, paths map[string]string, apiVer string) {
        q := r.URL.Query()
        wd := q.Get("wd")
        // R44-1C 修复: 原 wd[:60] 按字节切片, 中文搜索词可能斩半 (3-byte UTF-8 在边界处切出孤立 continuation byte).
        if len([]rune(wd)) > 60 {
                wd = string([]rune(wd)[:60])
        }
        if wd == "" {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "缺 wd 参数"})
                return
        }
        page := 1
        if v, err := strconv.Atoi(q.Get("page")); err == nil && v >= 1 && v <= 100 {
                page = v
        }
        sp := map[string]string{
                "gender":  "3",
                "imei_ip": imeiIP,
                "page":    strconv.Itoa(page),
                "wd":      wd,
        }
        sp["sign"] = signParams(sp)
        target := apiBC + paths["search"] + "?" + qs(sp)
        res := upstreamJSON(target, signHeaders(headersSearchMap()))
        if !res.OK {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": res.Error, "apiVersion": apiVer})
                return
        }
        var books []*normBookT
        if data, ok := res.JSON["data"].(map[string]any); ok {
                if list, ok := data["books"].([]any); ok {
                        books = normBooks(list)
                }
        }
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":         true,
                "total":      len(books),
                "page":       page,
                "books":      books,
                "apiVersion": apiVer,
        })
}

func handleRank(w http.ResponseWriter, r *http.Request, paths map[string]string, apiVer string) {
        q := r.URL.Query()
        rankType := q.Get("rank_type")
        if rankType == "" {
                rankType = "hot_list"
        }
        if len([]rune(rankType)) > 40 {
                rankType = string([]rune(rankType)[:40])
        }
        tabType := 1
        if v, err := strconv.Atoi(q.Get("tab_type")); err == nil && v > 0 {
                tabType = v
        }
        rp := map[string]string{
                "rank_type":       rankType,
                "category_id":    "0",
                "tab_type":       strconv.Itoa(tabType),
                "category_type":   "0",
                "imei_ip":        imeiIP,
                "book_privacy":   "1",
                "read_preference": "0",
        }
        rp["sign"] = signParams(rp)
        target := apiBC + paths["rank"] + "?" + qs(rp)
        res := upstreamJSON(target, signHeaders(headersUNK))
        if !res.OK {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": res.Error, "apiVersion": apiVer})
                return
        }
        var books []*normBookT
        if data, ok := res.JSON["data"].(map[string]any); ok {
                if list, ok := data["books"].([]any); ok {
                        books = normBooks(list)
                }
        }
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":         true,
                "total":      len(books),
                "books":      books,
                "apiVersion": apiVer,
        })
}

func handleDetail(w http.ResponseWriter, r *http.Request, paths map[string]string, apiVer string) {
        bid := r.URL.Query().Get("bid")
        if !isDigits(bid) {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "bid 必须为数字"})
                return
        }
        dp := map[string]string{
                "id":         bid,
                "imei_ip":    imeiIP,
                "teeny_mode": "0",
        }
        dp["sign"] = signParams(dp)
        target := apiBC + paths["detail"] + "?" + qs(dp)
        res := upstreamJSON(target, signHeaders(headersUNK))
        if !res.OK {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": res.Error, "apiVersion": apiVer})
                return
        }
        data, _ := res.JSON["data"].(map[string]any)
        if data == nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "上游 data 为空", "apiVersion": apiVer})
                return
        }
        b, _ := data["book"].(map[string]any)
        if b == nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "上游 data.book 为空", "apiVersion": apiVer})
                return
        }
        // book_tag_list (detail 形态: [{title:...}] 或 [str])
        var tagStrs []string
        if bt, ok := b["book_tag_list"].([]any); ok {
                for _, t := range bt {
                        if m, ok := t.(map[string]any); ok {
                                if s := fmt.Sprintf("%v", getAny(m, "title")); s != "" {
                                        tagStrs = append(tagStrs, s)
                                }
                        } else if s, ok := t.(string); ok && s != "" {
                                tagStrs = append(tagStrs, s)
                        }
                }
        }
        keywords := strings.Join(tagStrs, ",")
        status := ""
        if io, ok := b["is_over"]; ok {
                switch v := io.(type) {
                case float64:
                        if v == 1 {
                                status = "完结"
                        } else if v == 0 {
                                status = "连载中"
                        }
                case string:
                        if v == "1" {
                                status = "完结"
                        } else if v == "0" {
                                status = "连载中"
                        }
                }
        }
        book := map[string]any{
                "name":          strings.TrimSpace(fmt.Sprintf("%v", b["title"])),
                "author":        strings.TrimSpace(fmt.Sprintf("%v", b["author"])),
                "intro":         strings.TrimSpace(fmt.Sprintf("%v", b["intro"])),
                "cover":         fmt.Sprintf("%v", b["image_link"]),
                "category":      strings.TrimSpace(fmt.Sprintf("%v", b["category1_name"])),
                "category2":     strings.TrimSpace(fmt.Sprintf("%v", b["category2_name"])),
                "keywords":      keywords,
                "words":         fmt.Sprintf("%v", b["words_num"]),
                "latestChapter": strings.TrimSpace(fmt.Sprintf("%v", b["latest_chapter_title"])),
                "isOver":        fmt.Sprintf("%v", b["is_over"]),
                "status":        status,
        }
        if id, ok := b["id"]; ok {
                book["id"] = fmt.Sprintf("%v", id)
        } else {
                book["id"] = bid
        }
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":         true,
                "book":       book,
                "apiVersion": apiVer,
        })
}

func handleToc(w http.ResponseWriter, r *http.Request, paths map[string]string, apiVer string) {
        bid := r.URL.Query().Get("bid")
        if !isDigits(bid) {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "bid 必须为数字"})
                return
        }
        tp := map[string]string{"id": bid}
        tp["sign"] = signParams(tp)
        target := apiKS + paths["toc"] + "?" + qs(tp)
        res := upstreamJSON(target, signHeaders(headersUNK))
        if !res.OK {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": res.Error, "apiVersion": apiVer})
                return
        }
        data, _ := res.JSON["data"].(map[string]any)
        list, _ := data["chapter_lists"].([]any)
        if list == nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "上游 data.chapter_lists 非数组", "apiVersion": apiVer})
                return
        }
        type chapter struct {
                CID   string `json:"cid"`
                Title string `json:"title"`
                Words string `json:"words"`
        }
        chapters := []chapter{}
        for _, item := range list {
                if c, ok := item.(map[string]any); ok {
                        cid := strings.TrimSpace(fmt.Sprintf("%v", c["id"]))
                        title := strings.TrimSpace(fmt.Sprintf("%v", c["title"]))
                        if cid != "" && title != "" {
                                chapters = append(chapters, chapter{CID: cid, Title: title, Words: fmt.Sprintf("%v", c["words"])})
                        }
                }
        }
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":         true,
                "total":      len(chapters),
                "chapters":   chapters,
                "apiVersion": apiVer,
        })
}

func handleContent(w http.ResponseWriter, r *http.Request, paths map[string]string, apiVer string) {
        q := r.URL.Query()
        bid := q.Get("bid")
        cid := q.Get("cid")
        if !isDigits(bid) || !isDigits(cid) {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "bid/cid 必须为数字"})
                return
        }
        cp := map[string]string{
                "id":        bid,
                "chapterId": cid,
        }
        cp["sign"] = signParams(cp)
        target := apiKS + paths["content"] + "?" + qs(cp)
        res := upstreamJSON(target, signHeaders(headersUNK))
        if !res.OK {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": res.Error, "apiVersion": apiVer})
                return
        }
        data, _ := res.JSON["data"].(map[string]any)
        if data == nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "上游 data 为空", "apiVersion": apiVer})
                return
        }
        content, _ := data["content"].(string)
        if content == "" {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "上游 data.content 为空", "apiVersion": apiVer})
                return
        }
        dec, err := aesDecrypt(content)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "AES 解密失败: " + err.Error(), "apiVersion": apiVer})
                return
        }
        if strings.HasPrefix(dec, "PK") {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "出版书正文为 EPUB 包, 不支持文本提取", "cid": cid, "apiVersion": apiVer})
                return
        }
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":         true,
                "cid":        cid,
                "content":   dec,
                "apiVersion": apiVer,
        })
}

// ---------- 工具 ----------
func isDigits(s string) bool {
        if s == "" {
                return false
        }
        for _, c := range s {
                if c < '0' || c > '9' {
                        return false
                }
        }
        return true
}

func main() {
        stOk := aesRoundtripSelfTest()
        fmt.Printf("[qimao-proxy] self-test(AES-128-CBC 回环): %s port=%d\n", bridgeserver.BoolStr(stOk), PORT)
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:            "qimao-proxy",
                Port:            PORT,
                Version:         "1.1.0",
                SelfTest:        aesRoundtripSelfTest,
                HealthCheck:     healthCheck,
                IdleTimeoutS:    120,
                Handler:         handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "upstream":     map[string]string{"api_bc": apiBC, "api_ks": apiKS},
                                "apiVersions":  []string{"v4/v1(default)", "v2(experimental)"},
                                "endpoints":    []string{"/health", "/info", "/metrics", "/search", "/rank", "/detail", "/toc", "/content"},
                        }, nil
                },
        })
        bs.ListenAndServe()
}
