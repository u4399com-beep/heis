// moli-bridge — Moli (Rust AI browser) 桥接服务 (Go 重写, R40-1A).
//
// 与 TS 端 mini-services/moli-bridge/index.ts 同口径:
//   Moli 是专为 AI Agent 打造的开源浏览器(https://github.com/lexmount/moli)
//   - Rust 从零写的浏览器内核, 自带 V8/CSS/布局/软件渲染引擎
//   - 按需渲染: 平时不布局不绘制不占显存, 截图时才渲染一帧
//   - 内存占用远低于 Chrome headless(~50MB vs ~700MB)
//   - 支持 CDP 协议, Playwright 可直接连接
//   - 支持 --dump markdown/json/semantic_tree + --eval JS
//
// 本服务封装 moli fetch 命令, 提供HTTP API:
//   GET  /health     → 健康检查(selfTestOk = moli binary 存在)
//   GET  /metrics    → Prometheus 指标
//   GET  /info       → 版本+配置
//   POST /fetch      → { url, dump?, eval?, waitUntil?, timeout?, headers?, disableJs? } → { ok, html, ... }
//   POST /screenshot → { url, full?, timeout? } → { ok, image (base64) }
//
// 启动: cd go-backend/services/moli-bridge && go run . (端口固定 3017)
package main

import (
        "bytes"
        "context"
        "encoding/base64"
        "encoding/json"
        "fmt"
        "net/http"
        "os"
        "os/exec"
        "time"

        "heis-backend/services/bridgeserver"
)

const PORT = 3017

const execTimeoutMs = 30_000

// R41-1C: httpURLRe 已收口到 bridgeserver.HTTPURLRe (与其余 3 个服务同款, 消除 4 处重复定义)
// R42-1C: truncStr/boolStr/ifEmpty 收口到 bridgeserver (TruncStr/BoolStr/IfEmpty), 消除 3 处本地副本

// moliBinaryPath — 优先 MOLI_BIN 环境变量, 否则 ~/.local/bin/moli。
func moliBinaryPath() string {
        if p := os.Getenv("MOLI_BIN"); p != "" {
                return p
        }
        return os.Getenv("HOME") + "/.local/bin/moli"
}

// moliBinaryAvailable — 探测 moli 二进制文件存在性(F_OK|X_OK)。
func moliBinaryAvailable() bool {
        p := moliBinaryPath()
        if p == "" {
                return false
        }
        if fi, err := os.Stat(p); err != nil || fi.IsDir() {
                return false
        }
        // 检查可执行权限
        if fi, err := os.Stat(p); err == nil {
                mode := fi.Mode()
                if mode&0o111 == 0 {
                        // 没有任何执行位
                        return false
                }
        }
        return true
}

// execMoli — 执行 moli fetch 命令, 30s 超时。
type execResult struct {
        Stdout string
        Stderr string
        Code   int
}

func execMoli(args []string) (execResult, error) {
        bin := moliBinaryPath()
        ctx, cancel := context.WithTimeout(context.Background(), execTimeoutMs*time.Millisecond)
        defer cancel()
        cmd := exec.CommandContext(ctx, bin, append([]string{"fetch"}, args...)...)
        var stdout, stderr bytes.Buffer
        cmd.Stdout = &stdout
        cmd.Stderr = &stderr
        err := cmd.Run()
        code := 0
        if exitErr, ok := err.(*exec.ExitError); ok {
                code = exitErr.ExitCode()
        } else if err != nil && ctx.Err() == context.DeadlineExceeded {
                return execResult{Stdout: stdout.String(), Stderr: stderr.String(), Code: -1}, fmt.Errorf("moli 超时(>%dms)", execTimeoutMs)
        }
        return execResult{Stdout: stdout.String(), Stderr: stderr.String(), Code: code}, nil
}

// ---------- 请求体 ----------
type fetchOptions struct {
        URL        string            `json:"url"`
        Dump       string            `json:"dump"`
        Eval       string            `json:"eval"`
        WaitUntil  string            `json:"waitUntil"`
        Timeout    int               `json:"timeout"`
        Headers    map[string]string `json:"headers"`
        DisableJS  bool              `json:"disableJs"`
}

type screenshotOptions struct {
        URL     string `json:"url"`
        Full    bool   `json:"full"`
        Timeout int    `json:"timeout"`
}

// ---------- 路由 ----------
func handle(w http.ResponseWriter, r *http.Request) {
        u := r.URL
        if r.Method == http.MethodPost && u.Path == "/fetch" {
                handleFetch(w, r)
                return
        }
        if r.Method == http.MethodPost && u.Path == "/screenshot" {
                handleScreenshot(w, r)
                return
        }
        bridgeserver.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "not found"})
}

func handleFetch(w http.ResponseWriter, r *http.Request) {
        raw, err := bridgeserver.ReadBodyCapped(r, bridgeserver.MaxRequestBytes)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
                return
        }
        var body fetchOptions
        if err := json.Unmarshal(raw, &body); err != nil {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "请求体非 JSON"})
                return
        }
        if body.URL == "" {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "url required"})
                return
        }
        // R41-1B: SSRF 守卫 + URL 形态校验 (修复前完全缺失, moli 可被诱导访问内网)
        if !bridgeserver.HTTPURLRe.MatchString(body.URL) || len(body.URL) > 2048 {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "url 非法(仅 http/https, ≤2048)"})
                return
        }
        if ok, reason := bridgeserver.AssertSafeSsrfTarget(body.URL, bridgeserver.EnvBool("BRIDGE_SSRF_ALLOW_LOOPBACK")); !ok {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "SSRF 拒绝: " + reason})
                return
        }

        args := []string{}
        if body.Dump != "" {
                // R41-1B: dump 字段白名单 (防注入命令行参数)
                switch body.Dump {
                case "json", "markdown", "semantic_tree", "text", "html":
                default:
                        bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "dump 字段非法"})
                        return
                }
                args = append(args, "--dump", body.Dump)
        }
        if body.Eval != "" {
                // R41-1B: 限长 (防巨型 eval 注入)
                if len(body.Eval) > 10000 {
                        bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "eval 过长(>10KB)"})
                        return
                }
                args = append(args, "--eval", body.Eval)
        }
        if body.WaitUntil != "" {
                // R41-1B: waitUntil 白名单
                switch body.WaitUntil {
                case "load", "domcontentloaded", "networkidle0", "networkidle2":
                default:
                        bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "waitUntil 非法"})
                        return
                }
                args = append(args, "--wait-until", body.WaitUntil)
        }
        if body.DisableJS {
                args = append(args, "--disable-js")
        }
        for k, v := range body.Headers {
                // R41-1B: 头键经安全名单 + 头值剥 CRLF (防 moli 命令行头注入)
                key := bridgeserver.SafeHeaderKey(k)
                if key == "" {
                        continue
                }
                args = append(args, "-H", key+": "+bridgeserver.SafeHeaderValue(v))
        }
        // R41-1B: 在 URL 前插 "--" 终止符, 防 URL 以 - 开头被 moli 误判为 flag
        args = append(args, "--", body.URL)

        res, err := execMoli(args)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error(), "code": res.Code})
                return
        }
        if res.Code != 0 && res.Stdout == "" {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{
                        "ok":    false,
                        "error": bridgeserver.IfEmpty(res.Stderr, "moli fetch failed"),
                        "code":  res.Code,
                })
                return
        }
        // dump=json → 解析 JSON
        if body.Dump == "json" {
                var data map[string]any
                if err := json.Unmarshal([]byte(res.Stdout), &data); err != nil {
                        bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{
                                "ok":   false,
                                "error": "invalid JSON from moli",
                                "raw":   bridgeserver.TruncStr(res.Stdout, 500),
                        })
                        return
                }
                out := map[string]any{"ok": true}
                for k, v := range data {
                        out[k] = v
                }
                bridgeserver.WriteJSON(w, http.StatusOK, out)
                return
        }
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":   true,
                "html": res.Stdout,
                "len":   len(res.Stdout),
        })
}

func handleScreenshot(w http.ResponseWriter, r *http.Request) {
        raw, err := bridgeserver.ReadBodyCapped(r, bridgeserver.MaxRequestBytes)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
                return
        }
        var body screenshotOptions
        if err := json.Unmarshal(raw, &body); err != nil {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "请求体非 JSON"})
                return
        }
        if body.URL == "" {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "url required"})
                return
        }
        // R41-1B: SSRF 守卫 + URL 形态校验
        if !bridgeserver.HTTPURLRe.MatchString(body.URL) || len(body.URL) > 2048 {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "url 非法(仅 http/https, ≤2048)"})
                return
        }
        if ok, reason := bridgeserver.AssertSafeSsrfTarget(body.URL, bridgeserver.EnvBool("BRIDGE_SSRF_ALLOW_LOOPBACK")); !ok {
                bridgeserver.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "SSRF 拒绝: " + reason})
                return
        }
        dumpArg := "screenshot"
        if body.Full {
                dumpArg = "screenshot_full"
        }
        // R41-1B: 用 -- 终止 URL 参数 (防 - 开头被 moli 误判)
        args := []string{"--layout", "--image", "--font", "--dump", dumpArg, "--", body.URL}
        res, err := execMoli(args)
        if err != nil {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error(), "code": res.Code})
                return
        }
        if res.Code != 0 && res.Stdout == "" {
                bridgeserver.WriteJSON(w, http.StatusBadGateway, map[string]any{
                        "ok":    false,
                        "error": bridgeserver.IfEmpty(res.Stderr, "screenshot failed"),
                        "code":  res.Code,
                })
                return
        }
        // stdout 是二进制 PNG, 转 base64
        buf := []byte(res.Stdout)
        bridgeserver.WriteJSON(w, http.StatusOK, map[string]any{
                "ok":     true,
                "image":   base64.StdEncoding.EncodeToString(buf),
                "format": "png",
        })
}

func main() {
        stOk := moliBinaryAvailable()
        fmt.Printf("[moli-bridge] serving on port %d, moli=%s, selfTest=%s\n",
                PORT, moliBinaryPath(), bridgeserver.BoolStr(stOk))
        bs := bridgeserver.New(bridgeserver.BridgeServerOptions{
                Name:            "moli-bridge",
                Port:            PORT,
                Version:         "1.0.0",
                SelfTest:        moliBinaryAvailable,
                IdleTimeoutS:    60,
                Handler:         handle,
                ExtraInfo: func() (map[string]any, error) {
                        return map[string]any{
                                "moliBin":   moliBinaryPath(),
                                "endpoints": []string{"/health", "/info", "/metrics", "/fetch", "/screenshot"},
                        }, nil
                },
        })
        bs.ListenAndServe()
}
