// bqg713-proxy — 笔趣阁 www.bqg713.cc AES-token 外置转换代理 (Go 重写, R40-1A).
//
// 与 TS 端 mini-services/bqg713-proxy/index.ts 同口径:
//   - 站点为 SPA 壳(www.bqg713.cc) + 纯 JSON API; 章节正文接口的真实 API 域名
//     是站点 JS 内置的 site[] 三域名轮换: apibi.cc / apiqu.cc / apige.cc
//   - 章节请求形态: GET https://apibi.cc/api/chapter?token=<urlencoded base64>
//   - token = enaes(JSON.stringify({id, chapterid})):
//       算法      AES-128-CBC + PKCS7, 密文 Base64(toString() 形态, 无 OpenSSL 盐头)
//       密钥派生  code = MD5('book@token.html').toString()  // 32 位 hex, 静态
//                 iv  = Utf8(code[0..16))  = '394c2c3202da6270'
//                 key = Utf8(code[16..32)) = 'a3dc22cf70418a51'
//       明文结构  {"id":<number>,"chapterid":<number>}  (键序 id 在前, 必须数字类型)
//
// 接口:
//   GET /health                  → {ok, service, port, selfTestOk, ts}
//   GET /rewrite?url=<urlenc>    → {ok, id, chapterid, plaintext, token, url}  (url=改写后最终URL)
//   GET /token?url=<urlenc>       → 纯文本 token(便于 curl 调试)
//
// 启动: cd go-backend/services/bqg713-proxy && go run . (端口固定 3010)
package main

import (
        "crypto/aes"
        "crypto/cipher"
        "crypto/md5"
        "encoding/base64"
        "encoding/json"
        "fmt"
        "net/http"
        "net/url"
        "strconv"

        "heis-backend/services/bridgeserver"
)

const PORT = 3010

// ---------- enaes 逆向产物 ----------
// ENAES_SEED — enaes 种子串: 'book' + '@' + 'token' + '.' + 'html'(站点混淆串拼接的有效等价形态)。
const ENAES_SEED = "book@token.html"

var (
        // CODE_HEX = MD5(seed) hex; 32 字符 ASCII。
        // IV = 前 16 字符作 IV(按 UTF-8 字节); KEY = 后 16 字符作 KEY。
        ivBytes  []byte
        keyBytes []byte
)

func init() {
        sum := md5.Sum([]byte(ENAES_SEED))
        codeHex := fmt.Sprintf("%x", sum) // 32 字符 hex
        ivBytes = []byte(codeHex[:16])    // '394c2c3202da6270' (16 字节 ASCII)
        keyBytes = []byte(codeHex[16:])   // 'a3dc22cf70418a51' (16 字节 ASCII)
}

// enaesToken — 与站点 enaes 等价: AES-128-CBC/PKCS7 → Base64。
// 明文 = JSON.stringify({id, chapterid}) — Go 用 encoding/json 输出 {"id":N,"chapterid":N} 形态。
func enaesToken(id, chapterid int64) (string, error) {
        // 明文: {"id":<number>,"chapterid":<number>}; 键序 id 在前(与 CryptoJS JSON.stringify 同款)
        plaintext, err := json.Marshal(struct {
                ID        int64 `json:"id"`
                ChapterID int64 `json:"chapterid"`
        }{id, chapterid})
        if err != nil {
                return "", err
        }
        block, err := aes.NewCipher(keyBytes)
        if err != nil {
                return "", err
        }
        // PKCS7 padding
        bs := block.BlockSize()
        padding := bs - len(plaintext)%bs
        padded := make([]byte, len(plaintext)+padding)
        copy(padded, plaintext)
        for i := len(plaintext); i < len(padded); i++ {
                padded[i] = byte(padding)
        }
        ct := make([]byte, len(padded))
        cipher.NewCBCEncrypter(block, ivBytes).CryptBlocks(ct, padded)
        return base64.StdEncoding.EncodeToString(ct), nil
}

// 启动自检向量(与 TS 端 SELF_TEST_VECTOR 同源, 真网 200 验证过)
const selfTestVector = "b+vXnT3wjuXQsxBmZh033ZjqwezLEinKfOakcVaiDx0="

func selfTest() bool {
        tok, err := enaesToken(2530, 1)
        if err != nil {
                return false
        }
        return tok == selfTestVector
}

// ---------- URL 解析 ----------
// parseTarget — 从目标 URL 解析 id/chapterid(必须为正整数), 失败返回 false。
func parseTarget(raw string) (target *url.URL, id, chapterid int64, ok bool) {
        u, err := url.Parse(raw)
        if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
                return nil, 0, 0, false
        }
        idStr := u.Query().Get("id")
        chapStr := u.Query().Get("chapterid")
        id, err = strconv.ParseInt(idStr, 10, 64)
        if err != nil || id <= 0 {
                return nil, 0, 0, false
        }
        chapterid, err = strconv.ParseInt(chapStr, 10, 64)
        if err != nil || chapterid <= 0 {
                return nil, 0, 0, false
        }
        return u, id, chapterid, true
}

// ---------- 路由 ----------
func handle(w http.ResponseWriter, r *http.Request) {
        path := r.URL.Path
        if path != "/rewrite" && path != "/token" {
                bridgeserver.WriteJSON(w, http.StatusNotFound, map[string]any{
                        "ok":        false,
                        "error":     "not found",
                        "endpoints": []string{"/health", "/rewrite?url=", "/token?url="},
                })
                return
        }
        raw := r.URL.Query().Get("url")
        if raw == "" {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{
                        "ok":    false,
                        "error": "missing ?url=<urlencoded 目标URL>",
                })
                return
        }
        target, id, chapterid, ok := parseTarget(raw)
        if !ok {
                // 引擎侧语义: 预取失败 → 静默降级直连, 故非章节形态 URL(如 list/book 段)回 404 即可
                bridgeserver.WriteJSON(w, http.StatusNotFound, map[string]any{
                        "ok":     false,
                        "error":  "目标 URL 缺少可用的 id/chapterid 查询参数(需正整数)",
                        "target": raw,
                })
                return
        }
        tok, err := enaesToken(id, chapterid)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusInternalServerError, map[string]any{
                        "ok":    false,
                        "error": "AES 加密失败: " + err.Error(),
                })
                return
        }
        // 站点真实请求形态: 仅 token 一个查询参数(base64 经 encodeURIComponent)
        finalURL := target.Scheme + "://" + target.Host + target.Path + "?token=" + url.QueryEscape(tok)
        fmt.Printf("[bqg713-proxy] rewrite id=%d chapterid=%d token=%s...\n", id, chapterid, bridgeserver.TruncStr(tok, 12))
        if path == "/token" {
                bridgeserver.WriteText(w, http.StatusOK, "text/plain; charset=utf-8", tok)
                return
        }
        plaintext := fmt.Sprintf(`{"id":%d,"chapterid":%d}`, id, chapterid)
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":        true,
                "id":        id,
                "chapterid": chapterid,
                "plaintext": plaintext,
                "token":     tok,
                "url":       finalURL,
                "target":    raw,
        })
}

func main() {
        stOk := selfTest()
        fmt.Printf("[bqg713-proxy] self-test(id=2530,chapterid=1): %s\n", bridgeserver.BoolStr(stOk))
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:            "bqg713-proxy",
                Port:            PORT,
                Version:         "1.0.0",
                SelfTest:        selfTest,
                IdleTimeoutS:    30,
                Handler:         handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "endpoints": []string{"/health", "/info", "/metrics", "/rewrite?url=", "/token?url="},
                                "algorithm": "AES-128-CBC/PKCS7 + MD5-seed key derivation",
                        }, nil
                },
        })
        bs.ListenAndServe()
}
