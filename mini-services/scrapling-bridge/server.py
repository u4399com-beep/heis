#!/usr/bin/env python3
# ============================================================
# scrapling 桥 (hh-c) — 端口 3012, 仅绑定 127.0.0.1
# ============================================================
# 场景: 采集引擎新增第三方抓取工具接入 —— Scrapling(D4Vinci/Scrapling, Python 自适应
# 抓取框架)提供三类传输引擎, 与引擎既有 native 链(bun fetch/curl/Obscura)能力互补:
#   - static:     curl_cffi TLS 指纹伪装(chrome/firefox/... impersonate) + 浏览器头组
#   - stealthy:   patchright 反检测浏览器(0.3.13 起替代 camoufox 为默认引擎, camoufox
#                 可选增强)+ Cloudflare Turnstile/Interstitial 挑战自动求解
#   - playwright: 裸 Playwright chromium JS 渲染(v0.4 起 PlayWrightFetcher 更名
#                 DynamicFetcher, 旧名不再导出)
# 引擎侧(src/lib/crawl/fetcher.ts)在 FetchConfig.fetchMode='scrapling-*' 时把整次抓取
# 交给本桥 POST /fetch 代发; 桥把 Scrapling 的 Response 重组为 {ok,status,html,finalUrl}
# 信封。mini-service 范式与 bqg713-proxy:3010 / fetch-relay:3011 一致。
#
# 协议:
#   GET  /health → 200 { ok, selfTestOk, versions: {scrapling, python},
#                       modes: ['static','stealthy','playwright'], ts }
#                  (selfTestOk = scrapling.fetchers 三 Fetcher 类可导入)
#   POST /fetch  body: { url, mode, headless?, proxy?, timeoutMs?, headers? }
#                → 200 { ok: true,  status, html, finalUrl }   目标侧任何响应
#                  (含 3xx 跟随后终态/4xx/5xx)都算 ok:true 如实透传 —— 仅目标侧
#                   成功语义; 引擎侧不再对目标双发请求
#                → 200 { ok: false, error }                    桥内异常(url 非法/
#                  mode 未知/网络层失败/超时/浏览器启动失败), 引擎侧据此降级 native 链
#
# 安全: 仅绑 127.0.0.1(不对局域网暴露); url 仅 http/https 且限长; 请求头键经
#       RFC 7230 token 白名单过滤、值剥 CR/LF/NUL(与引擎 safeHeaderKey/safeSingleLine
#       同向); 响应体上限 MAX_BODY_BYTES; 超时上限 MAX_TIMEOUT_MS; 浏览器类模式
#       并发闸(独立 launch 浏览器内存开销大, 防上游并发打爆沙箱)。
# 运维: 由同目录 package.json 的 dev script 拉起(优先 .venv/bin/python, 回退系统
#       python3); scrapling 装在 mini-services/scrapling-bridge/.venv 内
#       (uv venv + uv pip install 'scrapling[fetchers]'), 浏览器依赖经 `scrapling install`。
# ============================================================

import json
import os
import platform
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('SCRAPLING_BRIDGE_PORT', '3012'))
HOST = '127.0.0.1'
MAX_BODY_BYTES = 20 * 1024 * 1024          # 目标响应体上限(与 fetch-relay 同量级)
MAX_REQUEST_BYTES = 1024 * 1024            # 桥请求体上限(JSON 很小, 防滥用)
MAX_TIMEOUT_MS = 120_000
MODES = ('static', 'stealthy', 'playwright')

# 浏览器类模式(stealthy/playwright)每次请求独立 launch 浏览器实例, 内存开销大:
# 桥内并发闸与引擎 hostGate 缺省上限(3)同向, 超出的请求排队等信号量
BROWSER_SEM = threading.BoundedSemaphore(3)

_FETCHERS = None
_FETCHERS_ERR = None
_FETCHERS_LOCK = threading.Lock()


def get_fetchers():
    """惰性加载 scrapling.fetchers(首次 import 约 1~2s), 结果进程内缓存"""
    global _FETCHERS, _FETCHERS_ERR
    if _FETCHERS is None and _FETCHERS_ERR is None:
        with _FETCHERS_LOCK:
            if _FETCHERS is None and _FETCHERS_ERR is None:
                try:
                    from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher
                    _FETCHERS = (Fetcher, StealthyFetcher, DynamicFetcher)
                except Exception as e:  # noqa: BLE001 — 留档启动期失败原因
                    _FETCHERS_ERR = f'{type(e).__name__}: {e}'
    if _FETCHERS is None:
        raise RuntimeError(f'scrapling fetchers 不可用: {_FETCHERS_ERR}')
    return _FETCHERS


def versions() -> dict:
    v = {'python': platform.python_version(), 'scrapling': 'unknown'}
    try:
        import importlib.metadata as md
        v['scrapling'] = md.version('scrapling')
    except Exception:
        pass
    return v


def self_test() -> bool:
    try:
        F, S, D = get_fetchers()
        return all(x is not None for x in (F, S, D))
    except Exception:
        return False


# ---------- 头清洗(与引擎 safeHeaderKey/safeSingleLine 同向) ----------
_HEADER_KEY_RE = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")


def safe_headers(h) -> dict:
    out = {}
    if isinstance(h, dict):
        for k, v in (h.items() if hasattr(h, 'items') else []):
            if not isinstance(k, str) or len(k) > 128 or not _HEADER_KEY_RE.match(k):
                continue
            if isinstance(v, (str, int, float)):
                s = re.sub(r'[\r\n\0]+', ' ', str(v))[:8192]
                if s.strip():
                    out[k] = s
    return out


def body_to_text(page) -> str:
    """Scrapling Response.body(v0.4 起恒为 bytes) → 按 Response.encoding 解码为文本"""
    body = getattr(page, 'body', b'') or b''
    enc = getattr(page, 'encoding', None) or 'utf-8'
    try:
        return body.decode(enc, errors='replace')
    except (LookupError, TypeError, ValueError):
        return body.decode('utf-8', errors='replace')


# ---------- 三模式实现 ----------
def fetch_static(url, timeout_ms, headers, proxy, headless):
    """StaticFetcher → Fetcher(curl_cffi): TLS 指纹伪装 + 浏览器头组。
    follow_redirects=True 全跟随(默认 'safe' 会拒绝指向内网的重定向, 与引擎 native
    链逐跳/中继桥契约不符); retries=0 单次尝试语义(重试额度由引擎侧管理, 失败如实上抛);
    stealthy_headers 保持默认 True(补全引擎未提供的头, 显式 headers 可覆盖单项)。"""
    Fetcher, _, _ = get_fetchers()
    kwargs = {
        'timeout': max(1, int(timeout_ms) // 1000),
        'follow_redirects': True,
        'retries': 0,
    }
    if headers:
        kwargs['headers'] = headers
    if proxy:
        kwargs['proxy'] = proxy
    return Fetcher.get(url, **kwargs)


def fetch_stealthy(url, timeout_ms, headers, proxy, headless):
    """StealthyFetcher(patchright 反检测浏览器): 反自动化检测 + solve_cloudflare
    (Turnstile/Interstitial 挑战自动求解)。google_search=False: 不伪造 Google referer,
    Referer 语义交引擎 headers; disable_resources=True 提速省流量(书源页无资源依赖)。
    retries=1 是 msgspec 下限(Expected int >= 1, 0 会 TypeError), 即连接级失败至多
    重试 1 次(共 2 次尝试); static 模式为 retries=0 严格单次(重试额度归引擎管)。"""
    _, StealthyFetcher, _ = get_fetchers()
    kwargs = {
        'headless': bool(headless),
        'timeout': int(timeout_ms),
        'google_search': False,
        'disable_resources': True,
        'solve_cloudflare': True,
        'retries': 1,
    }
    if headers:
        kwargs['extra_headers'] = headers
    if proxy:
        kwargs['proxy'] = proxy
    return StealthyFetcher.fetch(url, **kwargs)


def fetch_playwright(url, timeout_ms, headers, proxy, headless):
    """DynamicFetcher(v0.4 前名 PlayWrightFetcher): 裸 Playwright chromium JS 渲染。
    retries=1 下限同 fetch_stealthy(msgspec Expected int >= 1)。"""
    _, _, DynamicFetcher = get_fetchers()
    kwargs = {
        'headless': bool(headless),
        'timeout': int(timeout_ms),
        'google_search': False,
        'disable_resources': True,
        'retries': 1,
    }
    if headers:
        kwargs['extra_headers'] = headers
    if proxy:
        kwargs['proxy'] = proxy
    return DynamicFetcher.fetch(url, **kwargs)


IMPLS = {
    'static': fetch_static,
    'stealthy': fetch_stealthy,
    'playwright': fetch_playwright,
}
BROWSER_MODES = {'stealthy', 'playwright'}


def do_fetch(payload) -> dict:
    url = payload.get('url')
    if not isinstance(url, str) or not re.match(r'^https?://', url, re.I) or len(url) > 2048:
        return {'ok': False, 'error': 'url 非法(仅 http/https, ≤2048 字符)'}
    mode = payload.get('mode')
    if mode not in IMPLS:
        return {'ok': False, 'error': f'mode 非法(应为 {"/".join(MODES)}): {str(mode)[:60]}'}
    timeout_ms = payload.get('timeoutMs')
    if not isinstance(timeout_ms, (int, float)) or timeout_ms <= 0:
        timeout_ms = 30_000
    timeout_ms = min(int(timeout_ms), MAX_TIMEOUT_MS)
    headless = payload.get('headless')
    headless = True if not isinstance(headless, bool) else headless
    proxy = payload.get('proxy')
    if proxy is not None:
        if not isinstance(proxy, str) or not re.match(
            r'^(https?|socks5h?|socks4a?)://[^\s,]+$', proxy
        ) or len(proxy) > 500:
            return {'ok': False, 'error': 'proxy 形态非法'}
    headers = safe_headers(payload.get('headers'))

    impl = IMPLS[mode]
    acquired = False
    try:
        if mode in BROWSER_MODES:
            BROWSER_SEM.acquire()
            acquired = True
        page = impl(url, timeout_ms, headers, proxy, headless)
        html = body_to_text(page)
        if len(html.encode('utf-8', errors='replace')) > MAX_BODY_BYTES:
            return {'ok': False, 'error': f'响应体超限({len(html)} chars)'}
        final_url = getattr(page, 'url', None)
        return {
            'ok': True,
            'status': int(page.status),
            'html': html,
            'finalUrl': final_url if isinstance(final_url, str) and final_url else url,
        }
    except Exception as e:  # noqa: BLE001 — 桥内任何异常都以 ok:false 信封 200 返回
        msg = f'{type(e).__name__}: {e}'
        return {'ok': False, 'error': msg[:600]}
    finally:
        if acquired:
            try:
                BROWSER_SEM.release()
            except ValueError:
                pass


class Handler(BaseHTTPRequestHandler):
    server_version = 'scrapling-bridge/1.0'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):  # noqa: A003 — 覆写默认逐行 stderr 日志
        print(f'[scrapling-bridge] {self.address_string()} {fmt % args}', flush=True)

    def _send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):  # noqa: N802 — BaseHTTPRequestHandler 命名约定
        path = self.path.split('?')[0]
        if path == '/health':
            self._send_json({
                'ok': True,
                'selfTestOk': self_test(),
                'versions': versions(),
                'modes': list(MODES),
                'ts': int(time.time() * 1000),
            })
            return
        self._send_json({'ok': False, 'error': 'not found'}, status=404)

    def do_POST(self):  # noqa: N802
        path = self.path.split('?')[0]
        if path != '/fetch':
            self._send_json({'ok': False, 'error': 'not found'}, status=404)
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self._send_json({'ok': False, 'error': f'请求体长度非法({length})'})
            return
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode('utf-8'))
            if not isinstance(payload, dict):
                raise ValueError('请求体根非对象')
        except Exception as e:  # noqa: BLE001
            self._send_json({'ok': False, 'error': f'请求体非 JSON 对象: {type(e).__name__}'})
            return
        started = time.time()
        result = do_fetch(payload)
        cost = int((time.time() - started) * 1000)
        if result.get('ok'):
            print(
                f"[scrapling-bridge] {result.get('status')} {payload.get('mode')} "
                f"{str(payload.get('url'))[:120]} ({cost}ms, {len(result.get('html', ''))} chars)",
                flush=True,
            )
        else:
            print(
                f"[scrapling-bridge] FAIL {payload.get('mode')} "
                f"{str(payload.get('url'))[:120]} ({cost}ms): {str(result.get('error'))[:200]}",
                flush=True,
            )
        self._send_json(result)


def main():
    # 启动即预热 fetchers 导入(首个 /fetch 不吃冷启动 import 开销; 失败留档,
    # /health selfTestOk=false 让引擎/运维可感知)
    ok = self_test()
    print(
        f'[scrapling-bridge] 启动 http://{HOST}:{PORT} (selfTest={"ok" if ok else "FAIL: " + str(_FETCHERS_ERR)})'
        f' versions={versions()}',
        flush=True,
    )
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
