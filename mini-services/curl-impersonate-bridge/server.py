#!/usr/bin/env python3
# ============================================================
# curl-impersonate 桥 (R29-1B) — 端口 3018, 仅绑定 127.0.0.1
# ============================================================
# 背景: 8 级降级链 native → curl(OpenSSL) → fetch-relay(bun BoringSSL) →
#   scrapling-static(curl_cffi) → scrapling-stealthy(patchright) → Obscura →
#   uc-bridge(undetected-chromedriver) → moli-bridge(Rust AI 浏览器)。
# 其中 native/curl/fetch-relay 的 TLS 栈(BoringSSL/OpenSSL)JA3 指纹固定,
# 部分 WAF(Akamai/Cloudflare/DataDome/PerimeterX)按 JA3/JA4 hash 拦截常见
# HTTP 客户端, 即使 UA + Client Hints + Sec-Fetch-* 头组完全自洽, TLS 握手
# 阶段就被拒连/403。
#
# curl-impersonate 是 lwthiker/curl-impersonate 项目的 curl 补丁版, 用 nghttp2/
# BoringSSL 替换 OpenSSL 并定制 ClientHello(CipherSuites + Extensions + Curves)
# 完整模拟 Chrome/Firefox/Safari 的 TLS 握手指纹。curl_cffi 是其 Python 绑定
# (Yifei-Kong/curl_cffi), 通过 requests-style API 暴露 impersonate 参数:
#   requests.get(url, impersonate='chrome120')
# 即用 Chrome 120 的 TLS 指纹 + 头组顺序 + HTTP/2 SETTINGS 发起请求。
#
# 本桥(mini-service 范式, 与 scrapling-bridge 同构): 接收引擎 POST /fetch
# 调用, 用 curl_cffi 代发, 响应重组为 {ok, status, headers, setCookie, bodyB64}
# 信封忠实透传(含 3xx/4xx/5xx); 桥不可达 / curl_cffi 未装 / 目标网络层失败 →
# {ok:false, error} 200 返回, 引擎侧 fetchViaCurlImpersonate 据此降级下一级
# (fetch-relay 或抛错)。
#
# 协议:
#   GET  /health → 200 { ok:true, curlCffiAvailable:bool, version, impersonates:list, ts }
#                  curlCffiAvailable=false 时引擎侧 checkCurlImpersonateBridge 缓存 60s
#                  视为不可用, 跳过该级降级(零回归, 走原 fetch-relay/scrapling 路径)
#   POST /fetch   body: { url, headers?:Record, proxy?, timeoutMs?, impersonate?, method? }
#                → 200 { ok:true,  status, headers:[[k,v]], setCookie:[], bodyB64 } 目标侧
#                  任何响应(含 3xx 跟随后终态/4xx/5xx)都算 ok:true 如实透传 —— 仅传输
#                  层语义; 引擎侧不再对目标双发请求(与 fetch-relay / scrapling 同契约)
#                → 200 { ok:false, error }  桥内异常(url 非法 / curl_cffi 未装 / 网络
#                  层失败 / 超时 / 代理协议不支持), 引擎侧据此降级
#   GET  /info    → 200 { service, version, uptimeSeconds, config, endpoints, ... }
#                  (运维端点, 鉴权闸同主路径; 限 60/min/IP)
#   GET  /metrics → 200 text/plain  Prometheus 0.0.4 文本格式
#
# 安全: 仅绑 127.0.0.1(不对局域网暴露); url 仅 http/https 且限长 8KB; 请求头键经
#       RFC 7230 token 白名单过滤、值剥 CR/LF/NUL(与引擎 safeHeaderKey/safeSingleLine
#       同向); 响应体上限 20MB(base64 膨胀 ~33%, 实际目标响应 ≤15MB); 超时上限 30s
#       (与 fetch-relay 同口径); AUTH_TOKEN/BRIDGE_KEY 鉴权 + 60/min/IP 限速 + 安全
#       响应头(X-Content-Type-Options/X-Frame-Options/Referrer-Policy); SSRF 守卫
#       (默认拒 localhost/私网/链路本地/元数据端点, BRIDGE_SSRF_ALLOW_LOOPBACK=1 放行
#       127.0.0.1/::1 供回环测试场景, 生产不应设)
#
# 运维: 由同目录 package.json 的 dev script 拉起(优先 .venv/bin/python, 回退系统
#       python3); curl_cffi 装在 mini-services/curl-impersonate-bridge/.venv 内
#       (uv venv + uv pip install curl_cffi)。未装时 /health 仍 200 + curlCffiAvailable
#       false, 引擎自动跳过(零回归)。
# ============================================================

import base64
import ipaddress
import json
import math
import os
import re
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

PORT = int(os.environ.get('CURL_IMPERSONATE_BRIDGE_PORT', '3018'))
HOST = '127.0.0.1'
VERSION = '1.0.0'
MAX_BODY_BYTES = 20 * 1024 * 1024            # 目标响应体上限(与 fetch-relay 同量级)
MAX_REQUEST_BYTES = 1024 * 1024              # 桥请求体上限(JSON 很小, 防滥用)
MAX_TIMEOUT_MS = 30_000                      # 任务硬要求 30s 上限(与 fetch-relay 同口径)

# 鉴权(AUTH_TOKEN 优先, BRIDGE_KEY 别名); 任一非空时, 非 /health 请求须带
# X-Auth-Token / X-Bridge-Key / Authorization: Bearer 之一(常量时间比较, 失败 401)
AUTH_TOKEN = os.environ.get('AUTH_TOKEN') or os.environ.get('BRIDGE_KEY') or ''

# 每 IP 限速(60/min, RATE_LIMIT_PER_MIN 可调); 0=禁用(dev)
RATE_LIMIT_PER_MIN = int(os.environ.get('RATE_LIMIT_PER_MIN', '60'))

# SSRF 守卫(与引擎侧 assertSafeTarget 双重防线)。默认拒绝 localhost/私网/链路本地/
# 元数据端点; BRIDGE_SSRF_ALLOW_LOOPBACK=1 放行 127.0.0.1/::1(回环测试场景)
SSRF_ALLOW_LOOPBACK = os.environ.get('BRIDGE_SSRF_ALLOW_LOOPBACK') == '1'

# curl_cffi 支持的 impersonate profile 列表(2024-2025 主流版本, 与引擎 tlsProfile
# 字段 chrome120/firefox121/safari17 映射; 引擎侧 tlsProfile 缺省/未知时回退 chrome120)
# 注: 此列表用于 /health 与 /info 暴露给运维, 实际 impersonate 字符串直接传给 curl_cffi,
# curl_cffi 不识别时会抛 CURLIgnoredError, 桥侧 ok:false 透传引擎降级
IMPERSONATES = [
    'chrome99', 'chrome100', 'chrome101', 'chrome104', 'chrome107',
    'chrome110', 'chrome116', 'chrome119', 'chrome120', 'chrome123',
    'chrome124', 'chrome131',
    'edge99', 'edge101',
    'safari15_3', 'safari15_5', 'safari17_0', 'safari17_2_ios',
    'firefox102', 'firefox109', 'firefox117', 'firefox120',
]

# curl_cffi 模块缓存(全局, 避免每请求重 import)
_CURL_CFFI = None
_CURL_CFFI_PROBED = False


def probe_curl_cffi():
    """探测 curl_cffi 是否可用。延迟导入(只在首次 /health 或 /fetch 时触发)避免无谓启动开销。
    返回 (available: bool, version: str, error: str)。"""
    global _CURL_CFFI, _CURL_CFFI_PROBED
    if _CURL_CFFI_PROBED:
        if _CURL_CFFI is None:
            return (False, '', 'curl_cffi not installed')
        return (True, getattr(_CURL_CFFI, '__version__', 'unknown'), '')
    _CURL_CFFI_PROBED = True
    try:
        import curl_cffi  # noqa: F401
        from curl_cffi import requests as cffi_requests  # noqa: F401
        _CURL_CFFI = curl_cffi
        return (True, getattr(curl_cffi, '__version__', 'unknown'), '')
    except Exception as e:
        _CURL_CFFI = None
        return (False, '', f'{type(e).__name__}: {e}')


# ---------- SSRF 守卫(与 scrapling-bridge 同口径) ----------
def _is_private_ip(ip_str: str) -> bool:
    """判断 IP 字面量是否为私网/回环/链路本地/元数据端点"""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    if ip.is_loopback or ip.is_link_local or ip.is_private or ip.is_unspecified:
        return True
    if isinstance(ip, ipaddress.IPv4Address):
        # CGNAT 100.64/10(ipaddress.is_private 某些 Python 版本不含, 手动补)
        if 100 <= ip.packed[0] <= 100 and 64 <= ip.packed[1] <= 127:
            return True
    return False


def assert_safe_ssrf_target(raw_url: str, allow_loopback: bool = False) -> tuple:
    """返回 (ok: bool, reason: str)。ok=True 表示目标安全可抓"""
    try:
        u = urlparse(raw_url)
    except Exception:
        return (False, 'URL 解析失败')
    if u.scheme not in ('http', 'https'):
        return (False, f'非 http/https 协议: {u.scheme}')
    host = (u.hostname or '').lower()
    if not host:
        return (False, 'URL 缺少 hostname')
    if host == 'localhost' or host.endswith('.localhost'):
        return (True, '') if allow_loopback else (False, f'localhost 域名 ({host})')
    if _is_private_ip(host):
        if allow_loopback and (host == '127.0.0.1' or host == '::1' or host == '::'):
            return (True, '')
        return (False, f'私网/回环/链路本地地址 {host}')
    return (True, '')


# ---------- 限速器 ----------
class RateLimiter:
    """每 IP 滑窗限速, 线程安全(ThreadingHTTPServer 多 worker)"""
    def __init__(self, max_per_window, window_s=60.0):
        self.max_per_window = max_per_window if max_per_window > 0 else 60
        self.window_s = window_s
        self._lock = threading.Lock()
        self._map = {}
        self._cleanup_at = 0.0

    def allow(self, ip):
        if self.max_per_window <= 0:
            return True
        now = time.time()
        with self._lock:
            entry = self._map.get(ip)
            if not entry or entry[1] <= now:
                self._map[ip] = [1, now + self.window_s]
                ok = True
            else:
                entry[0] += 1
                ok = entry[0] <= self.max_per_window
            if now > self._cleanup_at:
                self._cleanup_at = now + 5 * 60
                expired = [k for k, v in self._map.items() if v[1] <= now]
                for k in expired:
                    self._map.pop(k, None)
            return ok

    def retry_after(self, ip):
        with self._lock:
            entry = self._map.get(ip)
            if not entry:
                return 1
            return max(1, int(math.ceil(entry[1] - time.time())))


RATE_LIMITER = RateLimiter(RATE_LIMIT_PER_MIN)


# ---------- 安全响应头 ----------
def security_headers(extra=None):
    h = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
    }
    if extra:
        h.update(extra)
    return h


def constant_time_equal(a, b):
    """常量时间字符串比较(防时序侧信道)"""
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b):
        result |= ord(x) ^ ord(y)
    return result == 0


def authorize(handler):
    """鉴权闸: AUTH_TOKEN 非空时, 非 /health 请求必须带 X-Auth-Token /
    X-Bridge-Key / Authorization: Bearer 之一。返回 True 通过, False 已发 401。"""
    if not AUTH_TOKEN:
        return True
    tokens = [
        handler.headers.get('X-Auth-Token', ''),
        handler.headers.get('X-Bridge-Key', ''),
    ]
    auth = handler.headers.get('Authorization', '')
    if auth.startswith('Bearer '):
        tokens.append(auth[7:])
    for t in tokens:
        if t and constant_time_equal(t, AUTH_TOKEN):
            return True
    return False


# ---------- 头键/值清洗(与引擎 safeHeaderKey/safeSingleLine 同口径) ----------
TOKEN_RE = re.compile(r"^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$")


def safe_header_key(k):
    """RFC 7230 token 字符白名单"""
    if not isinstance(k, str):
        return ''
    kk = k.strip()[:100]
    if not kk:
        return ''
    if not TOKEN_RE.match(kk):
        return ''
    return kk


def safe_header_value(v):
    """剥 CR/LF/NUL, 单行化(防 CRLF 注入 / HoR smuggling)"""
    if not isinstance(v, str):
        return ''
    return re.sub(r'[\r\n\0]+', ' ', v).strip()[:4096]


# ---------- 指标收集 ----------
class Metrics:
    def __init__(self, service_name):
        self.service_name = service_name.replace('-', '_')
        self._lock = threading.Lock()
        self._requests_total = 0
        self._errors_total = 0
        self._in_flight = 0
        self._response_time_sum_ms = 0.0
        self._response_time_count = 0
        self._started_at = time.time()

    def start_request(self):
        with self._lock:
            self._requests_total += 1
            self._in_flight += 1

    def end_request(self, ok, duration_ms):
        with self._lock:
            self._in_flight = max(0, self._in_flight - 1)
            if not ok:
                self._errors_total += 1
            self._response_time_sum_ms += duration_ms
            self._response_time_count += 1

    def to_prometheus(self):
        with self._lock:
            avg_ms = (self._response_time_sum_ms / self._response_time_count
                      if self._response_time_count > 0 else 0.0)
            uptime = time.time() - self._started_at
            lines = [
                f'# HELP {self.service_name}_requests_total Total requests processed',
                f'# TYPE {self.service_name}_requests_total counter',
                f'{self.service_name}_requests_total {self._requests_total}',
                f'# HELP {self.service_name}_errors_total Total error responses',
                f'# TYPE {self.service_name}_errors_total counter',
                f'{self.service_name}_errors_total {self._errors_total}',
                f'# HELP {self.service_name}_in_flight In-flight requests',
                f'# TYPE {self.service_name}_in_flight gauge',
                f'{self.service_name}_in_flight {self._in_flight}',
                f'# HELP {self.service_name}_avg_response_ms Average response time in ms',
                f'# TYPE {self.service_name}_avg_response_ms gauge',
                f'{self.service_name}_avg_response_ms {avg_ms:.2f}',
                f'# HELP {self.service_name}_uptime_seconds Uptime in seconds',
                f'# TYPE {self.service_name}_uptime_seconds gauge',
                f'{self.service_name}_uptime_seconds {uptime:.0f}',
                '',
            ]
            return '\n'.join(lines)


METRICS = Metrics('curl_impersonate_bridge')


# ---------- curl_cffi 调用 ----------
def _do_fetch(url, headers, proxy, timeout_ms, impersonate, method='GET'):
    """调用 curl_cffi.requests 发起请求, 返回 (ok, status, headers_list, set_cookies, body_bytes, error)。
    headers_list 形如 [[k, v], ...]; set_cookies 形如 ['k=v; ...', ...] (Set-Cookie 全部)。
    ok=False 时其他字段为空, 仅 error 有值。"""
    available, _, err = probe_curl_cffi()
    if not available:
        return (False, 0, [], [], b'', f'curl_cffi 未装: {err}')
    try:
        from curl_cffi import requests as cffi_requests
    except Exception as e:
        return (False, 0, [], [], b'', f'curl_cffi import 失败: {type(e).__name__}: {e}')

    # 钳制超时(30s 硬帽)
    tmo = max(2000, min(int(timeout_ms) if timeout_ms else 20000, MAX_TIMEOUT_MS)) / 1000.0

    # 钳制 impersonate(profile 在白名单内才透传, 否则 None 让 curl_cffi 用默认 OpenSSL 栈)
    imp = None
    if impersonate and isinstance(impersonate, str) and impersonate in IMPERSONATES:
        imp = impersonate

    # 请求头组装: 复用引擎传入的 UA / Referer / Cookie / Client Hints 头组; curl_cffi
    # 启用 impersonate 时会自动注入对应的 sec-ch-ua 等头组, 故同名头让 curl_cffi 优先
    # (即不强制覆盖; 引擎传入的 cfg.headers 仅作为补充/覆盖)
    req_headers = {}
    if isinstance(headers, dict):
        for k, v in headers.items():
            kk = safe_header_key(k)
            vv = safe_header_value(v)
            if kk and vv:
                req_headers[kk] = vv

    # 代理(curl_cffi 走 curl -x 全形态 http/https/socks5)
    proxies = None
    if proxy and isinstance(proxy, str):
        proxy = proxy.strip()[:500]
        if proxy:
            proxies = {'http': proxy, 'https': proxy}

    # 方法(GET/HEAD/POST, 与 fetch-relay 同口径; POST 需要 data 但本桥只做传输, 不
    # 接收 body 字段 — 引擎层 fetcher.ts 调用本桥只为 GET 章节正文/列表 HTML, 不发 POST)
    req_method = method.upper() if isinstance(method, str) and method.upper() in ('GET', 'HEAD') else 'GET'

    try:
        resp = cffi_requests.request(
            req_method,
            url,
            headers=req_headers,
            proxies=proxies,
            timeout=tmo,
            impersonate=imp,
            allow_redirects=True,
            verify=True,
        )
    except Exception as e:
        return (False, 0, [], [], b'', f'curl_cffi 请求失败: {type(e).__name__}: {str(e)[:300]}')

    # 状态码 / 响应头 / Set-Cookie / body 重组
    status = int(getattr(resp, 'status_code', 0))
    headers_list = []
    set_cookies = []
    try:
        # curl_cffi Response.headers 是 Headers-like 对象, items() 迭代保留全部(含多值)
        for k, v in resp.headers.items():
            kk = safe_header_key(k)
            vv = safe_header_value(v)
            if not kk:
                continue
            if kk.lower() == 'set-cookie':
                set_cookies.append(vv)
            else:
                headers_list.append([kk, vv])
    except Exception:
        # 头解析失败不影响 body 透传
        pass

    try:
        body_bytes = resp.content or b''
    except Exception:
        body_bytes = b''

    # 20MB 上限(解码后的 body, 与 fetch-relay 同口径)
    if len(body_bytes) > MAX_BODY_BYTES:
        return (False, 0, [], [], b'', f'目标响应体超过 {MAX_BODY_BYTES} 字节上限, 已中止')

    if status == 0:
        return (False, 0, [], [], b'', 'curl_cffi 返回无 status_code(响应畸形或被劫持)')

    return (True, status, headers_list, set_cookies, body_bytes, '')


# ---------- HTTP handler ----------
class Handler(BaseHTTPRequestHandler):
    server_version = f'curl-impersonate-bridge/{VERSION}'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        # 静默(与 scrapling-bridge 同口径, 日志走 stdout/stderr 由 nohup 重定向)
        pass

    def _send_json(self, data, status=200, extra_headers=None):
        body = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        h = security_headers({'Content-Type': 'application/json; charset=utf-8',
                               'Content-Length': str(len(body))})
        if extra_headers:
            h.update(extra_headers)
        self.send_response(status)
        for k, v in h.items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_text(self, data, status=200, content_type='text/plain; charset=utf-8'):
        body = data.encode('utf-8') if isinstance(data, str) else data
        h = security_headers({'Content-Type': content_type,
                              'Content-Length': str(len(body))})
        self.send_response(status)
        for k, v in h.items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_body_capped(self):
        """读 POST body, 上限 MAX_REQUEST_BYTES。超限返回 None。"""
        try:
            cl = int(self.headers.get('Content-Length', '0') or '0')
        except (ValueError, TypeError):
            cl = 0
        if cl > MAX_REQUEST_BYTES:
            return None
        if cl == 0:
            return b''
        data = b''
        remaining = cl
        while remaining > 0:
            chunk = self.rfile.read(min(65536, remaining))
            if not chunk:
                break
            data += chunk
            remaining -= len(chunk)
            if len(data) > MAX_REQUEST_BYTES:
                return None
        return data

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        # /health 免鉴权免限速(健康探针不应被自身闸门拦)
        if path == '/health':
            available, version, err = probe_curl_cffi()
            self._send_json({
                'ok': True,
                'service': 'curl-impersonate-bridge',
                'version': VERSION,
                'curlCffiAvailable': available,
                'curlCffiVersion': version if available else '',
                'curlCffiError': err if not available else '',
                'impersonates': list(IMPERSONATES),
                'ts': int(time.time() * 1000),
            })
            return
        if path == '/metrics':
            # 鉴权闸同主路径; 免限速(指标端点不应被自身闸门拦)
            if not authorize(self):
                self._send_json({'error': 'unauthorized'}, 401)
                return
            self._send_text(METRICS.to_prometheus(), 200, 'text/plain; version=0.0.4; charset=utf-8')
            return
        if path == '/info':
            if not authorize(self):
                self._send_json({'error': 'unauthorized'}, 401)
                return
            available, version, err = probe_curl_cffi()
            self._send_json({
                'service': 'curl-impersonate-bridge',
                'version': VERSION,
                'uptimeSeconds': int(time.time() - METRICS._started_at),
                'config': {
                    'port': PORT,
                    'host': HOST,
                    'maxBodyBytes': MAX_BODY_BYTES,
                    'maxRequestBytes': MAX_REQUEST_BYTES,
                    'maxTimeoutMs': MAX_TIMEOUT_MS,
                    'authEnabled': bool(AUTH_TOKEN),
                    'rateLimitPerMin': RATE_LIMIT_PER_MIN,
                    'ssrfAllowLoopback': SSRF_ALLOW_LOOPBACK,
                },
                'endpoints': ['GET /health', 'GET /metrics', 'GET /info', 'POST /fetch'],
                'curlCffi': {
                    'available': available,
                    'version': version if available else '',
                    'error': err if not available else '',
                },
                'impersonates': list(IMPERSONATES),
            })
            return
        # 其他 GET 路径
        self._send_json({'error': 'not found', 'path': path}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path != '/fetch':
            self._send_json({'error': 'not found', 'path': path}, 404)
            return
        # 鉴权
        if not authorize(self):
            self._send_json({'error': 'unauthorized'}, 401)
            return
        # 限速
        client_ip = self.client_address[0]
        if not RATE_LIMITER.allow(client_ip):
            retry_after = RATE_LIMITER.retry_after(client_ip)
            self._send_json({'error': 'rate limited', 'retryAfter': retry_after}, 429,
                            extra_headers={'Retry-After': str(retry_after)})
            return
        METRICS.start_request()
        t_start = time.time()
        ok_overall = False
        try:
            raw = self._read_body_capped()
            if raw is None:
                self._send_json({'ok': False, 'error': f'请求体超过 {MAX_REQUEST_BYTES} 字节上限'}, 200)
                return
            try:
                payload = json.loads(raw.decode('utf-8') if raw else '{}')
            except Exception as e:
                self._send_json({'ok': False, 'error': f'JSON 解析失败: {type(e).__name__}: {e}'}, 200)
                return
            if not isinstance(payload, dict):
                self._send_json({'ok': False, 'error': '请求体非 JSON object'}, 200)
                return
            url = str(payload.get('url', '')).strip()[:8192]
            if not url or not re.match(r'^https?://', url, re.I):
                self._send_json({'ok': False, 'error': 'url 缺失或非 http/https'}, 200)
                return
            # SSRF 守卫
            ssrf_ok, ssrf_reason = assert_safe_ssrf_target(url, allow_loopback=SSRF_ALLOW_LOOPBACK)
            if not ssrf_ok:
                self._send_json({'ok': False, 'error': f'SSRF blocked: {ssrf_reason}'}, 200)
                return
            headers = payload.get('headers') if isinstance(payload.get('headers'), dict) else {}
            proxy = str(payload.get('proxy', '') or '').strip()[:500] or ''
            try:
                timeout_ms = int(payload.get('timeoutMs', 20000))
            except (ValueError, TypeError):
                timeout_ms = 20000
            impersonate = str(payload.get('impersonate', '') or '').strip()[:64] or ''
            method = str(payload.get('method', 'GET') or 'GET').strip()[:16] or 'GET'

            ok, status, headers_list, set_cookies, body_bytes, err = _do_fetch(
                url, headers, proxy, timeout_ms, impersonate, method
            )
            if not ok:
                self._send_json({'ok': False, 'error': err[:500]}, 200)
                return
            ok_overall = True
            body_b64 = base64.b64encode(body_bytes).decode('ascii')
            self._send_json({
                'ok': True,
                'status': status,
                'headers': headers_list,
                'setCookie': set_cookies,
                'bodyB64': body_b64,
                'finalUrl': url,  # curl_cffi 跟随重定向后的 final_url 不可靠跨版本, 简化为原 url
            }, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': f'内部错误: {type(e).__name__}: {str(e)[:300]}'}, 200)
        finally:
            duration_ms = (time.time() - t_start) * 1000.0
            METRICS.end_request(ok_overall, duration_ms)


# ---------- 优雅关闭 ----------
def _shutdown(signum, frame):
    # Python http.server 的 shutdown 需在另一线程调用, 否则死锁
    import threading as _t
    _t.Thread(target=httpd.shutdown, daemon=True).start()


if __name__ == '__main__':
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    # SIGTERM/SIGINT 优雅关闭(unref 等价; Python ThreadingHTTPServer.shutdown 非阻塞)
    try:
        signal.signal(signal.SIGTERM, _shutdown)
        signal.signal(signal.SIGINT, _shutdown)
    except Exception:
        pass
    # stdout 启动横幅(供运维确认)
    sys_print = print
    sys_print(f'[curl-impersonate-bridge] listening on {HOST}:{PORT} (version={VERSION})', flush=True)
    available, version, err = probe_curl_cffi()
    if available:
        sys_print(f'[curl-impersonate-bridge] curl_cffi available (version={version})', flush=True)
    else:
        sys_print(f'[curl-impersonate-bridge] curl_cffi NOT available: {err} (桥 /health 仍 200 + curlCffiAvailable=false, 引擎自动跳过该级降级, 零回归)', flush=True)
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
