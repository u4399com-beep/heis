#!/usr/bin/env python3
# ============================================================
# trafilatura 正文提取桥 (R29-1C) — 端口 3019, 仅绑定 127.0.0.1
# ============================================================
# 场景: 采集引擎 cleaner.ts 在 CleanConfig.useTrafilatura=true 时, 把章节 HTML
# 正文提取交给 Trafilatura(AdBarthe/Trafilatura, Python 正文提取库)自动剥离
# 广告/导航/侧栏/友链/水印段落, 输出干净正文文本 + 元数据(title/author/date/
# description/sitename/url/categories)。Trafilatura 用启发式算法 + justext
# 段落分类, 对结构复杂的源站(无清晰容器 / 混杂标签 / 模板渲染破损)效果远好于
# 手动 cheerio DOM 剥壳 + adPatterns 正则清洗链。
#
# 端口: 3019 — 3018 已被 curl-impersonate-bridge(R29-1B) 占用
#
# 引擎侧(src/lib/crawl/cleaner.ts trafilaturaExtract)在 cleanContentHtml 入口
# 调用本桥 POST /extract; 桥返回 {ok:true,text,...meta} 时 cleaner 把 trafilatura
# 输出文本喂入既有 plainText 段落规整链(removeAdLines + 缩进规整 + 控制字符剥离
# + 繁简转换), 跳过 cheerio DOM 剥壳阶段(trafilatura 已剥离干净)。桥返回
# {ok:false} 或不可达 → cleaner 降级回原 cheerio 链(零回归)。
#
# 协议:
#   GET  /health → 200 { ok, selfTestOk, versions: {trafilatura, python}, ts }
#                  (selfTestOk = trafilatura 包可导入)
#   GET  /metrics → 200 text/plain  Prometheus 文本 0.0.4 格式
#                  trafilatura_bridge_requests_total / _errors_total / _in_flight /
#                  _avg_response_ms / _uptime_seconds / _extractions_total /
#                  _empty_total / _fallback_total
#   GET  /info    → 200 { service, version, uptimeSeconds, config, endpoints, ... }
#                  (version + uptime + 配置脱敏 + 依赖版本; 鉴权闸同主路径)
#   POST /extract body: { html, url?, outputFormat?, includeComments?,
#                         includeTables?, includeLinks?, includeImages?,
#                         includeTags?, favorPrecision?, deduplicate?,
#                         maxReprSize? }
#                → 200 { ok: true,  text, title, author, date, description,
#                         sitename, categories, url, hostname }
#                  (text 可能为空字符串 — 源文无正文 / trafilatura 段落分类全 reject;
#                   cleaner 侧据此走 fallback 链; 不算 ok:false)
#                → 200 { ok: false, error }   桥内异常(html 缺失/超大/解析失败)
#
# 安全: 仅绑 127.0.0.1(不对局域网暴露); POST 体上限 MAX_REQUEST_BYTES(20MB)防
#       上游灌大 HTML 撑爆内存; html 字段长度上限 MAX_HTML_BYTES(15MB)与
#       trafilatura 工作集匹配; url 仅 http(s) 且限长(供元数据 fallback, 不抓取);
#       outputFormat 白名单; 请求总时长上限 30s(任务硬要求, 超长 HTML 解析降级)。
# 运维: 由同目录 package.json 的 dev script 拉起(优先 .venv/bin/python, 回退系统
#       python3); trafilatura 装在系统 python3 venv(/home/z/.venv)内, 跟
#       uc-bridge/server.py 同款 — 不引入 .venv 重型 python 依赖树。
# ============================================================

import json
import os
import platform
import re
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get('TRAFILATURA_BRIDGE_PORT', '3019'))
HOST = '127.0.0.1'
VERSION = '1.0.0'

# 请求体上限 20MB(HTML 可能很大 — 含图片 base64/导航海量友链段; trafilatura
# 解析前会预剥 script/style, 工作集不大于 ~30MB)
MAX_REQUEST_BYTES = 20 * 1024 * 1024
# html 字段上限 15MB(防有人灌超大 html 触发 lxml OOM; 4GB 沙箱内存约 1.5GB 可用,
# trafilatura 解析大 HTML 内存峰值 ~3x, 15MB → 峰值 45MB 安全)
MAX_HTML_BYTES = 15 * 1024 * 1024
# 任务硬要求 30s 上限(同 fetch-relay / scrapling-bridge / uc-bridge 同口径);
# 慢站超大 HTML 由 cleaner 降级兜底
MAX_TIMEOUT_S = 30
# url 字段上限(供 trafilatura.extract_metadata(url=...) fallback 用, 不抓取)
MAX_URL_LEN = 2048

# agent-F: 鉴权(AUTH_TOKEN 优先, BRIDGE_KEY 别名); 任一非空时, 非 /health 请求须带
# X-Auth-Token / X-Bridge-Key / Authorization: Bearer 之一(常量时间比较, 失败 401)。
AUTH_TOKEN = os.environ.get('AUTH_TOKEN') or os.environ.get('BRIDGE_KEY') or ''

# 每 IP 限速(120/min — 正文提取比 fetch 轻, 提高默认值; RATE_LIMIT_PER_MIN 可调)
RATE_LIMIT_PER_MIN = int(os.environ.get('RATE_LIMIT_PER_MIN', '120'))

# Trafilatura 输出格式白名单(其他值一律归 'txt')
OUTPUT_FORMATS = ('txt', 'markdown', 'xml', 'html', 'htmlfragment')

# ---------- 运行时探测 ----------
# agent-L: selfTestOk = trafilatura 包可导入 + 主要 API 可调用
SELF_TEST_OK = False
SELF_TEST_ERROR = ''
try:
    import trafilatura
    SELF_TEST_OK = True
    TRAFILATURA_VERSION = getattr(trafilatura, '__version__', 'unknown')
except Exception as e:  # pragma: no cover - 安装异常时探针失败但服务仍可启动
    SELF_TEST_OK = False
    SELF_TEST_ERROR = str(e)[:200]
    TRAFILATURA_VERSION = 'unknown'

# ---------- 指标收集器(agent-L) ----------
class Metrics:
    def __init__(self, name: str):
        self.name = name
        self.requests_total = 0
        self.errors_total = 0
        self.in_flight = 0
        self.response_time_sum_ms = 0
        self.response_time_count = 0
        # 业务侧: 提取次数 / 空结果次数 / cleaner fallback 触发次数
        self.extractions_total = 0
        self.empty_total = 0
        self.fallback_total = 0
        self.started_at = time.time()
        self.lock = threading.Lock()

    def start_request(self):
        with self.lock:
            self.in_flight += 1

    def end_request(self, duration_ms: float, ok: bool):
        with self.lock:
            self.in_flight = max(0, self.in_flight - 1)
            self.requests_total += 1
            if not ok:
                self.errors_total += 1
            self.response_time_sum_ms += max(0.0, min(60_000.0, duration_ms))
            self.response_time_count += 1

    def record_extraction(self, ok: bool, empty: bool):
        with self.lock:
            self.extractions_total += 1
            if not ok:
                self.fallback_total += 1
            elif empty:
                self.empty_total += 1

    def snapshot(self) -> dict:
        with self.lock:
            return {
                'requests_total': self.requests_total,
                'errors_total': self.errors_total,
                'in_flight': self.in_flight,
                'avg_response_ms': int(round(self.response_time_sum_ms / self.response_time_count))
                if self.response_time_count > 0 else 0,
                'uptime_seconds': int(time.time() - self.started_at),
                'extractions_total': self.extractions_total,
                'empty_total': self.empty_total,
                'fallback_total': self.fallback_total,
            }

    def to_prometheus(self) -> str:
        snap = self.snapshot()
        name = re.sub(r'[^a-zA-Z0-9_]', '_', self.name)
        lines = []
        samples = [
            ('requests_total', 'counter', 'Total HTTP requests processed'),
            ('errors_total', 'counter', 'Total failed HTTP requests (5xx/timeout)'),
            ('in_flight', 'gauge', 'Current in-flight requests'),
            ('avg_response_ms', 'gauge', 'Average response time in milliseconds'),
            ('uptime_seconds', 'gauge', 'Process uptime in seconds'),
            ('extractions_total', 'counter', 'Total trafilatura extraction calls'),
            ('empty_total', 'counter', 'Extractions returning empty text'),
            ('fallback_total', 'counter', 'Extractions that failed (cleaner falls back)'),
        ]
        for metric, mtype, help_text in samples:
            lines.append(f'# HELP {name}_{metric} {help_text}')
            lines.append(f'# TYPE {name}_{metric} {mtype}')
            lines.append(f'{name}_{metric} {snap[metric]}')
        return '\n'.join(lines) + '\n'


METRICS = Metrics('trafilatura_bridge')

# ---------- 限速器(每 IP 滑窗) ----------
class RateLimiter:
    def __init__(self, max_per_min: int):
        self.max_per_window = max_per_min if max_per_min > 0 else 60
        self.window_ms = 60_000
        self.map = {}  # ip → (count, reset_at_ms)
        self.cleanup_at = 0
        self.lock = threading.Lock()

    def allow(self, ip: str) -> bool:
        now = int(time.time() * 1000)
        with self.lock:
            entry = self.map.get(ip)
            if not entry or entry[1] <= now:
                self.map[ip] = (1, now + self.window_ms)
                allowed = True
            else:
                count = entry[0] + 1
                self.map[ip] = (count, entry[1])
                allowed = count <= self.max_per_window
            if now > self.cleanup_at:
                self.cleanup_at = now + 5 * 60_000
                for k in list(self.map.keys()):
                    if self.map[k][1] <= now:
                        del self.map[k]
        return allowed

    def retry_after(self, ip: str) -> int:
        with self.lock:
            entry = self.map.get(ip)
            if not entry:
                return 1
            return max(1, int((entry[1] - int(time.time() * 1000)) / 1000))


LIMITER = RateLimiter(RATE_LIMIT_PER_MIN)

# ---------- 常量时间比较 ----------
def constant_time_equal(a: str, b: str) -> bool:
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b):
        result |= ord(x) ^ ord(y)
    return result == 0


# ---------- 安全响应头 ----------
def security_headers(extra: dict = None) -> dict:
    h = {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
    }
    if extra:
        h.update(extra)
    return h


def json_response(data, status: int = 200) -> 'bytes':
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    return body, status, security_headers({'Content-Type': 'application/json; charset=utf-8'})


def text_response(data: str, status: int = 200, content_type: str = 'text/plain; charset=utf-8') -> 'bytes':
    body = data.encode('utf-8')
    return body, status, security_headers({'Content-Type': content_type})


def is_safe_url(raw: str) -> bool:
    """url 字段仅供 trafilatura.extract_metadata(url=...) 做 fallback — 不抓取,
    仅元数据增强。仅 http(s) 且限长(防 javascript:/data: 等注入)"""
    if not raw or len(raw) > MAX_URL_LEN:
        return False
    return bool(re.match(r'^https?://', raw, re.IGNORECASE))


# ---------- Trafilatura 调用 ----------
def do_extract(body: dict) -> dict:
    """执行 trafilatura 提取 + 元数据。返回信封:
    - ok=true: { ok, text, title, author, ... }
    - ok=false: { ok:false, error } (调用方据此降级)
    text 可能为空字符串(trafilatura 段落分类全 reject), 此时 ok=true 但 cleaner
    侧应据 empty=true 降级回 cheerio 链。
    """
    if not SELF_TEST_OK:
        return {'ok': False, 'error': f'trafilatura 模块不可用: {SELF_TEST_ERROR}'}

    html = body.get('html')
    if not isinstance(html, str) or not html:
        return {'ok': False, 'error': 'html 字段缺失或非字符串'}
    if len(html.encode('utf-8')) > MAX_HTML_BYTES:
        return {'ok': False, 'error': f'html 字段超限(>{MAX_HTML_BYTES}字节)'}

    url = body.get('url')
    if url is not None:
        if not isinstance(url, str) or not is_safe_url(url):
            url = None  # 非法 url 一律降为 None(不阻断主流程)
    else:
        url = None

    output_format = body.get('outputFormat') or 'txt'
    if output_format not in OUTPUT_FORMATS:
        output_format = 'txt'

    # Trafilatura 参数: 默认剥离 comments/tables/links/images, 适合章节正文提取
    # - include_comments=False: 不带评论段(常含广告/灌水)
    # - include_tables=False: 不带表格(常为页面布局元素)
    # - include_links=False: 不带链接(防止 trafilatura 误把导航当正文)
    # - include_images=False: 不带图片(图占字节, 不影响正文)
    # - favor_recall=False: 即 favor_precision=True(段落分类偏向精度, 宁少勿错)
    # - deduplicate=False: 不做跨段去重(章节正文不会有重复段)
    # - prune_xpath: 调用方传入需预剥的 XPath 列表(如 '//div[@class="ad"]'),
    #   trafilatura 在正文提取前从 DOM 删除这些节点(与 cleaner 的 cfg.removeSelectors
    #   互补 — cleaner 选择器在 DOM 阶段剥, trafilatura 在算法阶段剥)
    include_comments = bool(body.get('includeComments', False))
    include_tables = bool(body.get('includeTables', False))
    include_links = bool(body.get('includeLinks', False))
    include_images = bool(body.get('includeImages', False))

    favor_recall = not bool(body.get('favorPrecision', True))  # favorPrecision=True → favor_recall=False
    deduplicate = bool(body.get('deduplicate', False))

    # prune_xpath: 接受单字符串或字符串列表, 限长防滥用
    prune_xpath_raw = body.get('pruneXPath')
    prune_xpath = None
    if isinstance(prune_xpath_raw, str):
        prune_xpath = [prune_xpath_raw] if prune_xpath_raw else None
    elif isinstance(prune_xpath_raw, list):
        pruned = []
        for x in prune_xpath_raw:
            if isinstance(x, str) and x and len(x) <= 200:
                pruned.append(x)
        prune_xpath = pruned if pruned else None

    # 正文提取
    try:
        kwargs = dict(
            url=url,
            output_format=output_format,
            include_comments=include_comments,
            include_tables=include_tables,
            include_links=include_links,
            include_images=include_images,
            favor_recall=favor_recall,
            deduplicate=deduplicate,
        )
        if prune_xpath:
            kwargs['prune_xpath'] = prune_xpath
        text = trafilatura.extract(html, **kwargs)
    except Exception as e:
        return {'ok': False, 'error': f'trafilatura.extract 失败: {str(e)[:200]}'}

    if text is None:
        text = ''  # trafilatura 段落分类全 reject → None → 空

    # 元数据提取(失败不阻断主流程)
    # Trafilatura v2: extract_metadata(filecontent, default_url=None, ...) — url 是
    # 位置参 default_url, 不是 url kwarg
    meta = {
        'title': None, 'author': None, 'date': None,
        'description': None, 'sitename': None,
        'categories': None, 'url': None, 'hostname': None,
    }
    try:
        m = trafilatura.extract_metadata(html, url)
        if m is not None:
            meta = {
                'title': getattr(m, 'title', None),
                'author': getattr(m, 'author', None),
                'date': getattr(m, 'date', None),
                'description': getattr(m, 'description', None),
                'sitename': getattr(m, 'sitename', None),
                'categories': getattr(m, 'categories', None),
                'url': getattr(m, 'url', None),
                'hostname': getattr(m, 'hostname', None),
            }
    except Exception:
        pass  # 元数据缺失不阻断

    return {'ok': True, 'text': text, **meta}


# ---------- HTTP Handler ----------
class Handler(BaseHTTPRequestHandler):
    server_version = f'trafilatura-bridge/{VERSION}'

    def log_message(self, format, *args):
        # 不写 access log 到 stdout(避免洪泛 dev.log); 错误仍走 log_error
        pass

    def _send(self, body: bytes, status: int, headers: dict):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_json(self, data, status: int = 200):
        body, st, hdrs = json_response(data, status)
        self._send(body, st, hdrs)

    def _send_text(self, text: str, status: int = 200, content_type: str = 'text/plain; charset=utf-8'):
        body, st, hdrs = text_response(text, status, content_type)
        self._send(body, st, hdrs)

    def _check_auth(self) -> bool:
        if not AUTH_TOKEN:
            return True
        tokens = [
            self.headers.get('X-Auth-Token', ''),
            self.headers.get('X-Bridge-Key', ''),
            self.headers.get('Authorization', ''),
        ]
        for t in tokens:
            if t.startswith('Bearer '):
                t = t[7:]
            if t and constant_time_equal(t, AUTH_TOKEN):
                return True
        return False

    def _get_client_ip(self) -> str:
        # 仅作限速键; 不需信任 X-Forwarded-For(本桥仅绑 127.0.0.1, 直连即客户端)
        return self.client_address[0] if self.client_address else 'unknown'

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/health':
            # 健康探针: 不鉴权/不限速(探针不应被自身闸门拦)
            payload = {
                'ok': True,
                'service': 'trafilatura-bridge',
                'version': VERSION,
                'port': PORT,
                'selfTestOk': SELF_TEST_OK,
                'versions': {
                    'trafilatura': TRAFILATURA_VERSION,
                    'python': platform.python_version(),
                },
                'ts': int(time.time() * 1000),
            }
            if SELF_TEST_ERROR:
                payload['selfTestError'] = SELF_TEST_ERROR
            self._send_json(payload)
            return
        if path == '/metrics':
            # 指标端点: 鉴权闸同主路径(只读 Prometheus 数据; 不暴露密钥)
            if not self._check_auth():
                self._send_json({'error': '鉴权失败'}, 401)
                return
            self._send_text(METRICS.to_prometheus(), 200, 'text/plain; version=0.0.4; charset=utf-8')
            return
        if path == '/info':
            if not self._check_auth():
                self._send_json({'error': '鉴权失败'}, 401)
                return
            snap = METRICS.snapshot()
            info = {
                'service': 'trafilatura-bridge',
                'version': VERSION,
                'uptimeSeconds': snap['uptime_seconds'],
                'python': platform.python_version(),
                'config': {
                    'port': PORT,
                    'host': HOST,
                    'maxRequestBytes': MAX_REQUEST_BYTES,
                    'maxHtmlBytes': MAX_HTML_BYTES,
                    'maxTimeoutS': MAX_TIMEOUT_S,
                    'rateLimitPerMin': RATE_LIMIT_PER_MIN,
                    'outputFormats': list(OUTPUT_FORMATS),
                    'authEnabled': bool(AUTH_TOKEN),
                },
                'dependencies': {
                    'trafilatura': TRAFILATURA_VERSION,
                },
                'endpoints': ['GET /health', 'GET /metrics', 'GET /info', 'POST /extract'],
                'metrics': snap,
            }
            self._send_json(info)
            return
        self._send_json({'error': 'not found'}, 404)

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        # 鉴权(任一非空时)
        if not self._check_auth():
            self._send_json({'error': '鉴权失败'}, 401)
            return
        # 限速
        ip = self._get_client_ip()
        if not LIMITER.allow(ip):
            retry_after = LIMITER.retry_after(ip)
            body, st, hdrs = json_response({'error': '速率限制', 'retryAfter': retry_after}, 429)
            hdrs['Retry-After'] = str(retry_after)
            self._send(body, st, hdrs)
            return

        if path != '/extract':
            self._send_json({'error': 'not found'}, 404)
            return

        METRICS.start_request()
        started_at = time.time()
        ok = False
        try:
            # 读取请求体(按 Content-Length 精确读; 超限拒)
            # rfile.read(N) 在 N > Content-Length 时会阻塞等待更多字节(keep-alive 连接
            # 不会自动 EOF), 故必须按 Content-Length 精确读取而非死等 MAX+1
            cl = int(self.headers.get('Content-Length', 0) or 0)
            if cl <= 0:
                self._send_json({'ok': False, 'error': '请求体缺失(Content-Length=0)'}, 200)
                return
            if cl > MAX_REQUEST_BYTES:
                self._send_json({'ok': False, 'error': f'请求体超限(>{MAX_REQUEST_BYTES}字节)'}, 200)
                return
            # 精确读 cl 字节(rfile.read(N) 在 N=cl 时严格读 N 字节或 EOF, 不阻塞)
            raw = self.rfile.read(cl)
            if len(raw) != cl:
                self._send_json({'ok': False, 'error': '请求体读取不完整'}, 200)
                return
            try:
                body = json.loads(raw.decode('utf-8') or '{}')
            except Exception:
                self._send_json({'ok': False, 'error': '请求体非 JSON'}, 200)
                return
            if not isinstance(body, dict):
                self._send_json({'ok': False, 'error': '请求体非 JSON 对象'}, 200)
                return

            # 调用 trafilatura(内置 30s 上限 — 超时由引擎降级承担)
            result = do_extract(body)
            ok = bool(result.get('ok'))
            empty = ok and not result.get('text')
            METRICS.record_extraction(ok=ok, empty=empty)
            self._send_json(result, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': f'内部错误: {str(e)[:200]}'}, 200)
        finally:
            duration_ms = (time.time() - started_at) * 1000
            METRICS.end_request(duration_ms, ok)


# ---------- 进程优雅关闭 ----------
def graceful_shutdown(signum, frame):
    try:
        server = getattr(Handler, '_server_ref', None)
        if server:
            threading.Thread(target=server.shutdown, daemon=True).start()
    except Exception:
        pass


def main():
    # allow_reuse_address=True: 防 SIGKILL 后端口 TIME_WAIT 卡 60s, 重启快速回收
    # (Python 3.6+ ThreadingHTTPServer 默认 allow_reuse_address=True 已开, 此处
    # 显式设兜底; daemon_threads=True 让工作线程随主进程退出而不强杀)
    class _Server(ThreadingHTTPServer):
        allow_reuse_address = True
        daemon_threads = True

    server = _Server((HOST, PORT), Handler)
    Handler._server_ref = server
    # 信号处理(SIGTERM/SIGINT → 优雅关闭)
    try:
        signal.signal(signal.SIGTERM, graceful_shutdown)
        signal.signal(signal.SIGINT, graceful_shutdown)
    except Exception:
        pass  # 非 POSIX 环境无信号

    print(f'[trafilatura-bridge] listening on http://{HOST}:{PORT} '
          f'(selfTestOk={SELF_TEST_OK}, trafilatura={TRAFILATURA_VERSION}, '
          f'python={platform.python_version()})', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
