#!/usr/bin/env python3
# ============================================================
# uc-bridge (agent-JJ-turnstile) — 端口 3016, 仅绑定 127.0.0.1
# ============================================================
# 场景: 采集引擎 5 级 CF Turnstile 反反爬策略链(agent-JJ)的 L2/L3 级——
#   L2 = undetected-chromedriver(UC) 直接 launch; UC patches Chromium 规避 CDP 检测、
#        navigator.webdriver、CDP Runtime.enable 探针 等常见自动化指纹。本桥承担"UC 浏览器
#        实例的拉起与目标 URL 渲染", 与引擎既有 CloakBrowser(obscura.ts, L4) 能力互补。
#   L3 = xvfb-run + UC; 当本进程未在 X server 下运行(DISPLAY 环境变量未设)时, 用
#        pyvirtualdisplay 包一层虚拟帧缓冲, 让 UC 在 headless 服务器上正常 launch。
#        也可经 ?xvfb=1 查询参数强制启用, 即使 DISPLAY 已设。
#
# 引擎侧(src/lib/crawl/obscura.ts:bypassTurnstile)在 cfg.turnstileBypass=true 且
# captchaType='turnstile' 时, 依次调用 L1(Cookie)→L2(本桥 /fetch)→L3(本桥 /fetch?xvfb=1)
# →L4(CloakBrowser)→L5(裸 Playwright); 任一级成功即返回, 全部失败才落回原冷却逻辑。
#
# 协议:
#   GET  /health → 200 { ok, selfTestOk, versions: {uc, selenium, python},
#                       chromePath, xvfbAvailable, ts }
#                  selfTestOk = undetected_chromedriver 可导入 + chrome 可执行文件存在
#   GET  /metrics → 200 text/plain  Prometheus 文本 0.0.4 格式(agent-L 同款):
#                  uc_bridge_requests_total / _errors_total / _in_flight /
#                  _avg_response_ms / _uptime_seconds
#   GET  /info    → 200 { service, version, uptimeSeconds, config, endpoints, ... }
#                  (鉴权闸同主路径; 免限速)
#   POST /fetch   body: { url, cookies?, timeout?, xvfb? }
#                → 200 { ok: true,  status, html, cookies, finalUrl }   目标侧任何响应
#                  (3xx 跟随后终态/4xx/5xx)都算 ok:true 如实透传 —— 仅传输层语义;
#                  引擎侧不再对目标双发请求
#                → 200 { ok: false, error }                    桥内异常(url 非法/
#                  Chrome 不可用/UC 启动失败/网络层失败/超时), 引擎侧据此降级下一级
#   POST /solve-turnstile  body: { url, xvfb? }
#                → 200 { ok: true, solved, cookies, html }     solved=是否检测到 Turnstile
#                  元素消失(成功通过); cookies=UC 浏览器 context 全部 cookie 回传
#                → 200 { ok: false, error }                    桥内异常同 /fetch
#
# 安全: 仅绑 127.0.0.1(不对局域网暴露); url 仅 http/https 且限长; SSRF 守卫拒绝
#       localhost/私网/链路本地/元数据端点(allow_loopback=BRIDGE_SSRF_ALLOW_LOOPBACK);
#       请求头键经 RFC 7230 token 白名单过滤、值剥 CR/LF/NUL; 响应体上限 MAX_BODY_BYTES;
#       超时上限 MAX_TIMEOUT_MS=30s(任务硬帽); 浏览器并发闸 BROWSER_CONCURRENCY=2
#       (UC 启动慢 + 内存开销大, 严防上游并发打爆沙箱)。
# 运维: 由同目录 package.json 的 dev script 拉起(优先 .venv/bin/python, 回退系统
#       python3); UC + selenium + pyvirtualdisplay 装在 mini-services/uc-bridge/.venv 内
#       (python -m venv .venv && .venv/bin/pip install -r requirements.txt);
#       Chrome 见 README.md 安装步骤(Playwright Chromium 已含或 apt install google-chrome-stable)
# ============================================================

import json
import math
import os
import platform
import re
import signal
import threading
import time
import ipaddress
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get('UC_BRIDGE_PORT', '3016'))
HOST = '127.0.0.1'
VERSION = '1.0.0'
MAX_BODY_BYTES = 20 * 1024 * 1024          # 目标响应体上限(与 scrapling-bridge 同量级)
MAX_REQUEST_BYTES = 1024 * 1024            # 桥请求体上限(JSON 很小, 防滥用)
# 任务硬要求 30s 上限(与 scrapling-bridge 同口径)。UC 冷启 + Turnstile 求解常需 10~25s,
# 慢尾超 30s 触发降级下一级(引擎侧重试承担恢复语义)。
MAX_TIMEOUT_MS = 30_000
BROWSER_CONCURRENCY = 2                   # UC 启动慢 + 内存大, 并发闸严于 scrapling-bridge(3)

# 鉴权(AUTH_TOKEN 优先, BRIDGE_KEY 别名); 任一非空时, 非 /health 请求须带
# X-Auth-Token / X-Bridge-Key / Authorization: Bearer 之一(常量时间比较, 失败 401)。
AUTH_TOKEN = os.environ.get('AUTH_TOKEN') or os.environ.get('BRIDGE_KEY') or ''

# 每 IP 限速(60/min, RATE_LIMIT_PER_MIN 可调); 0=禁用(dev)
RATE_LIMIT_PER_MIN = int(os.environ.get('RATE_LIMIT_PER_MIN', '60'))

# SSRF 守卫(与引擎侧 assertSafeTarget 双重防线)。默认拒绝 localhost/私网/
# 链路本地/元数据端点; BRIDGE_SSRF_ALLOW_LOOPBACK=1 放行 127.0.0.1/::1(回环测试场景)。
SSRF_ALLOW_LOOPBACK = os.environ.get('BRIDGE_SSRF_ALLOW_LOOPBACK') == '1'

# xvfb-run 路径(env 可改; 默认 PATH 查找)
XVFB_RUN_PATH = os.environ.get('XVFB_RUN_PATH') or shutil.which('xvfb-run') or ''
DISPLAY_ENV = os.environ.get('DISPLAY', '')

# ---------- Chrome 探测 ----------
# 候选 Chrome 可执行文件路径(按优先级): PLAYWRIGHT_BROWSERS_PATH 内置 chromium >
# 系统 google-chrome > chromium-browser > chromium > /opt/google/chrome/chrome
def _candidate_chrome_paths():
    paths = []
    # 1. 环境变量显式指定
    env_path = os.environ.get('UC_CHROME_PATH', '').strip()
    if env_path:
        paths.append(env_path)
    # 2. Playwright Chromium(~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome)
    pw_cache = os.environ.get('PLAYWRIGHT_BROWSERS_PATH') or os.path.expanduser('~/.cache/ms-playwright')
    if os.path.isdir(pw_cache):
        try:
            for name in sorted(os.listdir(pw_cache), reverse=True):
                if not name.startswith('chromium-'):
                    continue
                # 优先完整 chrome, 次之 headless_shell
                for sub in ('chrome-linux64/chrome', 'chrome-linux/chrome'):
                    p = os.path.join(pw_cache, name, sub)
                    if os.path.isfile(p) and os.access(p, os.X_OK):
                        paths.append(p)
                        break
                if paths:
                    break
        except OSError:
            pass
    # 3. 系统包管理器安装的稳定版 Chrome
    for sysp in ('/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
                 '/usr/bin/chromium-browser', '/usr/bin/chromium',
                 '/opt/google/chrome/chrome', '/snap/bin/chromium'):
        if os.path.isfile(sysp) and os.access(sysp, os.X_OK):
            paths.append(sysp)
            break
    return paths


def _find_chrome():
    """返回首个可执行 Chrome 路径; 不可用时返回空串。"""
    for p in _candidate_chrome_paths():
        if p and os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return ''


def _detect_chrome_version(chrome_path: str) -> int:
    """从 chrome --version 输出提取主版本号(如 'Google Chrome 151.0.7922.34' → 151)。
    UC 的 version_main 参数需匹配 Chrome 主版本, 否则 ChromeDriver 版本不匹配会抛
    SessionNotCreatedException(典型场景: Playwright Chromium 是 151, UC 默认拉最新
    ChromeDriver 153 → 报错 'only supports Chrome version 153')。
    探测失败返回 0(让 UC 自行 auto-detect)。"""
    if not chrome_path:
        return 0
    try:
        out = subprocess.check_output(
            [chrome_path, '--version'],
            stderr=subprocess.STDOUT,
            timeout=8,
        ).decode('utf-8', errors='replace')
        m = re.search(r'(\d+)\.', out)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return 0


CHROME_PATH = _find_chrome()
CHROME_VERSION_MAIN = _detect_chrome_version(CHROME_PATH)
# Chrome 是否在启动时探测到(/health 与 /info 暴露; 启动后安装 Chrome 需重启本服务)

# ---------- SSRF 守卫(与 scrapling-bridge 同口径) ----------
def _is_private_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    if ip.is_loopback or ip.is_link_local or ip.is_private or ip.is_unspecified:
        return True
    if isinstance(ip, ipaddress.IPv4Address):
        # CGNAT 100.64/10(ipaddress.is_private 在某些 Python 版本不含此段, 手动补)
        if 100 <= ip.packed[0] <= 100 and 64 <= ip.packed[1] <= 127:
            return True
    return False


def assert_safe_ssrf_target(raw_url: str, allow_loopback: bool = False) -> tuple:
    """返回 (ok: bool, reason: str)。ok=True 表示目标安全可抓。"""
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


# ---------- 限速器(每 IP 60/min, 与 scrapling-bridge 同口径) ----------
class RateLimiter:
    """每 IP 滑窗限速。线程安全(单进程 ThreadingHTTPServer 多 worker)。"""
    def __init__(self, max_per_window: int, window_s: float = 60.0):
        self.max_per_window = max_per_window if max_per_window > 0 else 60
        self.window_s = window_s
        self._lock = threading.Lock()
        self._map = {}
        self._cleanup_at = 0.0

    def allow(self, ip: str) -> bool:
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

    def retry_after(self, ip: str) -> int:
        with self._lock:
            entry = self._map.get(ip)
            if not entry:
                return 1
            return max(1, int(math.ceil(entry[1] - time.time())))


RATE_LIMITER = RateLimiter(RATE_LIMIT_PER_MIN)

# 浏览器并发闸: UC 启动慢 + 内存开销大, 每次请求独立 driver 实例
BROWSER_SEM = threading.BoundedSemaphore(BROWSER_CONCURRENCY)


# ---------- 指标收集(agent-L: /metrics + /info 共用) ----------
class Metrics:
    """运行时指标收集器: 请求计数 / 错误计数 / 在途请求数 / 平均响应时延 / uptime。
    线程安全(ThreadingHTTPServer 多 worker)。to_prometheus() 输出文本 0.0.4 格式。"""

    def __init__(self, service_name: str):
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
            self._in_flight += 1

    def end_request(self, duration_ms: float, ok: bool):
        with self._lock:
            self._in_flight = max(0, self._in_flight - 1)
            self._requests_total += 1
            if not ok:
                self._errors_total += 1
            self._response_time_sum_ms += max(0.0, min(60_000.0, float(duration_ms)))
            self._response_time_count += 1

    def snapshot(self) -> dict:
        with self._lock:
            avg = (self._response_time_sum_ms / self._response_time_count
                   if self._response_time_count > 0 else 0.0)
            return {
                'requests_total': self._requests_total,
                'errors_total': self._errors_total,
                'in_flight': self._in_flight,
                'avg_response_ms': int(round(avg)),
                'uptime_seconds': int(time.time() - self._started_at),
            }

    def to_prometheus(self) -> str:
        snap = self.snapshot()
        name = self.service_name
        lines = []
        samples = [
            ('requests_total', 'counter', 'Total HTTP requests processed'),
            ('errors_total', 'counter', 'Total failed HTTP requests (4xx/5xx/timeout)'),
            ('in_flight', 'gauge', 'Current in-flight requests'),
            ('avg_response_ms', 'gauge', 'Average response time in milliseconds'),
            ('uptime_seconds', 'gauge', 'Process uptime in seconds'),
        ]
        for metric, mtype, help_text in samples:
            lines.append(f'# HELP {name}_{metric} {help_text}')
            lines.append(f'# TYPE {name}_{metric} {mtype}')
            lines.append(f'{name}_{metric} {snap[metric]}')
        return '\n'.join(lines) + '\n'


METRICS = Metrics('uc_bridge')


# ---------- 常量时间字符串比较(供 AUTH_TOKEN 校验, 防计时旁路) ----------
def _constant_time_equal(a: str, b: str) -> bool:
    try:
        import hmac
        return hmac.compare_digest(a.encode('utf-8'), b.encode('utf-8'))
    except Exception:
        return a == b


# ---------- 错误脱敏(剥文件路径/堆栈, 限长 200) ----------
def sanitize_error(e) -> str:
    if isinstance(e, BaseException):
        msg = f'{type(e).__name__}: {e}'
    else:
        msg = str(e)
    msg = re.sub(r'(?:/[\w.-]+){2,}', '<path>', msg)
    msg = re.sub(r'[A-Z]:\\[^\s]+', '<path>', msg)
    return msg[:200]


# ---------- 安全响应头(注入到所有响应) ----------
_SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
}


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


# ---------- undetected-chromedriver 惰性加载 ----------
_UC_MODULE = None
_UC_ERR = None
_UC_LOCK = threading.Lock()


def get_uc():
    """惰性加载 undetected_chromedriver(首次 import 约 1~2s), 结果进程内缓存。
    不可用时抛 RuntimeError, 调用方 catch 后返回 503。"""
    global _UC_MODULE, _UC_ERR
    if _UC_MODULE is None and _UC_ERR is None:
        with _UC_LOCK:
            if _UC_MODULE is None and _UC_ERR is None:
                try:
                    import undetected_chromedriver as uc  # noqa: F401
                    _UC_MODULE = uc
                except Exception as e:  # noqa: BLE001
                    _UC_ERR = f'{type(e).__name__}: {e}'
    if _UC_MODULE is None:
        raise RuntimeError(f'undetected_chromedriver 不可用: {_UC_ERR}')
    return _UC_MODULE


def versions() -> dict:
    v = {'python': platform.python_version(), 'uc': 'unknown', 'selenium': 'unknown'}
    try:
        import importlib.metadata as md
        v['uc'] = md.version('undetected-chromedriver')
        v['selenium'] = md.version('selenium')
    except Exception:
        pass
    return v


def self_test() -> bool:
    """UC 可导入 + Chrome 可执行文件存在 = True。不实际启动浏览器(冷启开销大)。"""
    try:
        get_uc()
        return bool(CHROME_PATH) and os.path.isfile(CHROME_PATH)
    except Exception:
        return False


def xvfb_available() -> bool:
    """xvfb-run 可执行 或 pyvirtualdisplay 已装 = True。"""
    if XVFB_RUN_PATH:
        return True
    try:
        import pyvirtualdisplay  # noqa: F401
        return True
    except Exception:
        return False


def should_use_xvfb(xvfb_flag):
    """决定是否启用 xvfb: 显式 xvfb=1 强制开; 否则 DISPLAY 未设时自动开。"""
    if xvfb_flag is True:
        return True
    if xvfb_flag is False:
        return False
    # 未传 xvfb 参数 → 看 DISPLAY 环境变量
    return not DISPLAY_ENV


class XvfbGuard:
    """上下文管理器: 进入时按需启动 pyvirtualdisplay, 退出时停止。
    不可用时抛 RuntimeError(调用方应预先 xvfb_available() 校验, 跳过 L3)。"""
    def __init__(self, use_xvfb: bool):
        self.use_xvfb = use_xvfb
        self.display = None

    def __enter__(self):
        if not self.use_xvfb:
            return self
        try:
            from pyvirtualdisplay import Display
            # visible=False 头less, size=(1280,800) 与 obscura 桌面视口同口径
            self.display = Display(visible=False, size=(1280, 800))
            self.display.start()
        except Exception as e:
            raise RuntimeError(f'xvfb(pyvirtualdisplay) 启动失败: {e}') from e
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.display is not None:
            try:
                self.display.stop()
            except Exception:
                pass
        return False  # 不吞业务异常


# ---------- UC 抓取核心 ----------
def _parse_cookies(cookie_str: str) -> list:
    """把 'k1=v1; k2=v2' 形态的 cookie 字符串转成 selenium cookie dict 列表。
    selenium 要求 cookie dict 含 name/value/domain/path 字段。"""
    out = []
    if not cookie_str:
        return out
    for pair in cookie_str.split(';'):
        pair = pair.strip()
        if not pair or '=' not in pair:
            continue
        name, _, value = pair.partition('=')
        name = name.strip()[:256]
        value = value.strip()[:4096]
        if not name:
            continue
        out.append({'name': name, 'value': value, 'path': '/'})
    return out


def _cookies_to_strings(driver) -> list:
    """从 UC driver 取出 cookies, 转 Set-Cookie 风格字符串数组(与 obscura 回传同口径)。"""
    try:
        cookies = driver.get_cookies() or []
    except Exception:
        return []
    out = []
    for c in cookies:
        parts = [f"{c.get('name', '')}={c.get('value', '')}"]
        path = c.get('path', '/') or '/'
        domain = c.get('domain', '')
        if path:
            parts.append(f'path={path}')
        if domain:
            parts.append(f'domain={domain}')
        if c.get('secure'):
            parts.append('Secure')
        if c.get('httpOnly'):
            parts.append('HttpOnly')
        out.append('; '.join(parts))
    return out


def _launch_uc(url: str, cookies: list, timeout_ms: int, headless: bool):
    """启动 UC 浏览器, 导航到 url, 注入 cookies 后重载一次(让 cookie 生效)。
    返回 (driver, status, html, final_url, cookie_strings)。调用方负责 driver.quit()。"""
    uc = get_uc()
    if not CHROME_PATH:
        raise RuntimeError('Chrome 可执行文件不可用(见 README.md 安装步骤)')

    options = uc.ChromeOptions()
    if headless:
        # UC 自己的 headless 模式: --headless=new 比 --headless=chrome 旧名更稳(UC v3.5+)
        options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1280,800')
    # UC 不接受 --disable-blink-features=AutomationControlled(那正是 UC 自家要补的指纹)
    # 显式指定 Chrome 路径(UC 默认查找 google-chrome, Playwright Chromium 路径需手动)
    options.binary_location = CHROME_PATH

    # version_main 必须匹配 Chrome 主版本(否则 ChromeDriver 版本不匹配会抛
    # SessionNotCreatedException 'only supports Chrome version XXX'); 启动期已探测
    driver = uc.Chrome(
        options=options,
        version_main=CHROME_VERSION_MAIN or None,
        headless=headless,
        use_subprocess=True,
    )
    try:
        driver.set_page_load_timeout(max(5, int(timeout_ms // 1000)))
        # 先访问目标域任意页(让 cookie domain 匹配生效), 再注入 cookies, 然后重载目标 URL
        if cookies:
            try:
                driver.get(url)
            except Exception:
                pass
            for ck in cookies:
                try:
                    driver.add_cookie(ck)
                except Exception:
                    pass
        driver.get(url)
        # 等 DOM 稳定(UC 内置 WebDriverWait 太重, 简单 sleep 即可; timeout 已含此前开销)
        time.sleep(1.0)
        html = driver.page_source or ''
        status = 0
        try:
            # UC/Selenium 无直接 status code API; 用 JS fetch 同 URL 取 status(尽力而为)
            status = int(driver.execute_script(
                'try { var r = new XMLHttpRequest(); r.open("GET", arguments[0], false);'
                'r.send(); return r.status; } catch(e) { return 0; }', url
            ) or 0)
        except Exception:
            status = 0
        final_url = driver.current_url or url
        cookie_strings = _cookies_to_strings(driver)
        return driver, status, html, final_url, cookie_strings
    finally:
        # 调用方负责 quit; 这里不释放, 让 do_fetch 在 finally 中处理
        pass


def do_fetch(payload: dict, query: dict) -> dict:
    """/fetch 实现: 启动 UC 导航到 url, 返回 html/cookies/status。
    xvfb=?xvfb=1 时启用虚拟帧缓冲(L3 级); 默认按 DISPLAY 环境变量决定。"""
    url = payload.get('url')
    if not isinstance(url, str) or not re.match(r'^https?://', url, re.I) or len(url) > 2048:
        return {'ok': False, 'error': 'url 非法(仅 http/https, ≤2048 字符)'}
    ssrf_ok, ssrf_reason = assert_safe_ssrf_target(url, allow_loopback=SSRF_ALLOW_LOOPBACK)
    if not ssrf_ok:
        print(f'[uc-bridge] SSRF 拒绝 {url[:120]}: {ssrf_reason}', flush=True)
        return {'ok': False, 'error': f'SSRF 拒绝: {ssrf_reason}'}

    cookies_raw = payload.get('cookies')
    if not isinstance(cookies_raw, str):
        cookies_raw = ''
    timeout_ms = payload.get('timeout')
    if not isinstance(timeout_ms, (int, float)) or timeout_ms <= 0:
        timeout_ms = 20_000
    timeout_ms = min(int(timeout_ms), MAX_TIMEOUT_MS)

    # xvfb 决策: ?xvfb=1 强制开, ?xvfb=0 强制关, 不传 → DISPLAY 环境变量决定
    xvfb_param = None
    if isinstance(query.get('xvfb'), str):
        xvfb_param = query['xvfb'][0] == '1'
    elif 'xvfb' in query:
        xvfb_param = True
    use_xvfb = should_use_xvfb(xvfb_param)

    if use_xvfb and not xvfb_available():
        return {'ok': False, 'error': 'xvfb-run / pyvirtualdisplay 不可用(L3 需安装 xvfb 或 pip install pyvirtualdisplay)'}

    acquired = False
    driver = None
    try:
        BROWSER_SEM.acquire()
        acquired = True
        cookies = _parse_cookies(cookies_raw)
        with XvfbGuard(use_xvfb):
            driver, status, html, final_url, cookie_strings = _launch_uc(
                url, cookies, timeout_ms, headless=True
            )
        if len(html.encode('utf-8', errors='replace')) > MAX_BODY_BYTES:
            return {'ok': False, 'error': f'响应体超限({len(html)} chars)'}
        return {
            'ok': True,
            'status': status,
            'html': html,
            'cookies': cookie_strings,
            'finalUrl': final_url,
            'xvfbUsed': use_xvfb,
        }
    except Exception as e:  # noqa: BLE001 — 桥内任何异常都以 ok:false 信封 200 返回
        return {'ok': False, 'error': sanitize_error(e)}
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
        if acquired:
            try:
                BROWSER_SEM.release()
            except ValueError:
                pass


def _looks_like_turnstile(html: str) -> bool:
    """检测 HTML 是否含 Cloudflare Turnstile 挑战元素/脚本。"""
    if not html:
        return False
    return bool(re.search(
        r'cf-turnstile|challenges\.cloudflare\.com/turnstile/v0/api\.js|cf-turnstile-response',
        html, re.I
    ))


def _looks_like_challenge_page(html: str) -> bool:
    """更宽泛的"挑战页"检测: 含 CF Just a moment / checking your browser / ddos-guard 等。"""
    if not html:
        return False
    return bool(re.search(
        r'just a moment|cf-browser-verification|cf-chl|challenge-platform|cf_chl_|'
        r'checking your browser|attention required|ddos-guard|challenge\.js|'
        r'cf-turnstile|please verify you are a human',
        html, re.I
    ))


def do_solve_turnstile(payload: dict, query: dict) -> dict:
    """/solve-turnstile 实现: 启动 UC 导航到 url, 等待 Turnstile 通过(最多 timeout_ms);
    尝试点击复选框(interactive 模式); 返回 solved/cookies/html。"""
    url = payload.get('url')
    if not isinstance(url, str) or not re.match(r'^https?://', url, re.I) or len(url) > 2048:
        return {'ok': False, 'error': 'url 非法(仅 http/https, ≤2048 字符)'}
    ssrf_ok, ssrf_reason = assert_safe_ssrf_target(url, allow_loopback=SSRF_ALLOW_LOOPBACK)
    if not ssrf_ok:
        print(f'[uc-bridge] SSRF 拒绝 {url[:120]}: {ssrf_reason}', flush=True)
        return {'ok': False, 'error': f'SSRF 拒绝: {ssrf_reason}'}

    timeout_ms = payload.get('timeout')
    if not isinstance(timeout_ms, (int, float)) or timeout_ms <= 0:
        timeout_ms = 25_000
    timeout_ms = min(int(timeout_ms), MAX_TIMEOUT_MS)

    xvfb_param = None
    if isinstance(query.get('xvfb'), str):
        xvfb_param = query['xvfb'][0] == '1'
    elif 'xvfb' in query:
        xvfb_param = True
    use_xvfb = should_use_xvfb(xvfb_param)
    if use_xvfb and not xvfb_available():
        return {'ok': False, 'error': 'xvfb-run / pyvirtualdisplay 不可用(L3 需安装 xvfb)'}

    acquired = False
    driver = None
    try:
        BROWSER_SEM.acquire()
        acquired = True
        with XvfbGuard(use_xvfb):
            driver, status, html, final_url, cookie_strings = _launch_uc(
                url, [], timeout_ms, headless=True
            )
            # 挑战循环: 最多等 timeout_ms / 2 让 CF 自动放行(managed 模式), 期间尝试点击
            # Turnstile 复选框(interactive 模式需用户交互)
            deadline = time.time() + (timeout_ms / 1000.0) * 0.6
            solved = not _looks_like_challenge_page(html)
            attempts = 0
            while not solved and time.time() < deadline:
                attempts += 1
                time.sleep(1.5)
                # 尝试点击 Turnstile 复选框(跨域 iframe 内 input[type=checkbox])
                try:
                    frames = driver.find_elements('xpath', '//iframe') or []
                    for f in frames[:8]:
                        try:
                            driver.switch_to.frame(f)
                            try:
                                cb = driver.find_elements('css selector', 'input[type=checkbox]')
                                for el in cb[:3]:
                                    try:
                                        el.click()
                                        time.sleep(0.5)
                                    except Exception:
                                        pass
                            finally:
                                driver.switch_to.default_content()
                        except Exception:
                            try:
                                driver.switch_to.default_content()
                            except Exception:
                                pass
                except Exception:
                    pass
                try:
                    html = driver.page_source or ''
                except Exception:
                    html = ''
                if not _looks_like_challenge_page(html):
                    solved = True
                    break
            # 取最新 cookies(挑战通过后 cf_clearance 等 cookie 会更新)
            cookie_strings = _cookies_to_strings(driver)
            final_url = driver.current_url or url
        if len(html.encode('utf-8', errors='replace')) > MAX_BODY_BYTES:
            return {'ok': False, 'error': f'响应体超限({len(html)} chars)'}
        return {
            'ok': True,
            'solved': solved,
            'cookies': cookie_strings,
            'html': html,
            'finalUrl': final_url,
            'xvfbUsed': use_xvfb,
        }
    except Exception as e:  # noqa: BLE001
        return {'ok': False, 'error': sanitize_error(e)}
    finally:
        if driver is not None:
            try:
                driver.quit()
            except Exception:
                pass
        if acquired:
            try:
                BROWSER_SEM.release()
            except ValueError:
                pass


# ---------- HTTP Handler ----------
class Handler(BaseHTTPRequestHandler):
    server_version = 'uc-bridge/1.0'
    protocol_version = 'HTTP/1.1'
    timeout = 30  # 30s 请求总时长硬帽(任务要求)

    def log_message(self, fmt, *args):  # noqa: A003
        print(f'[uc-bridge] {self.address_string()} {fmt % args}', flush=True)

    def _send_text(self, text: str, status=200, content_type='text/plain; charset=utf-8', extra_headers=None):
        data = text.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        for k, v in _SECURITY_HEADERS.items():
            self.send_header(k, v)
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_json(self, obj, status=200, extra_headers=None):
        data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        for k, v in _SECURITY_HEADERS.items():
            self.send_header(k, v)
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _client_ip(self) -> str:
        try:
            return self.client_address[0] if self.client_address else 'unknown'
        except Exception:
            return 'unknown'

    def _extract_token(self) -> str:
        v = self.headers.get('X-Auth-Token')
        if v:
            return v
        v = self.headers.get('X-Bridge-Key')
        if v:
            return v
        authz = self.headers.get('Authorization') or ''
        if authz.lower().startswith('bearer '):
            return authz[7:].strip()
        return ''

    def _check_auth(self) -> bool:
        if not AUTH_TOKEN:
            return True
        return _constant_time_equal(self._extract_token(), AUTH_TOKEN)

    def _check_rate_limit(self) -> tuple:
        if not RATE_LIMITER or RATE_LIMIT_PER_MIN <= 0:
            return (True, 0)
        ip = self._client_ip()
        if RATE_LIMITER.allow(ip):
            return (True, 0)
        return (False, RATE_LIMITER.retry_after(ip))

    def _gate(self, path: str) -> bool:
        """统一闸门: /health 豁免; 其余路径走 鉴权 + 限速。
        返回 True=已发响应(调用方应 return), False=放行。"""
        if path == '/health':
            return False
        if not self._check_auth():
            self._send_json(
                {'ok': False, 'error': 'missing or invalid auth token', 'code': 'AUTH_REQUIRED'},
                status=401,
            )
            return True
        if path in ('/metrics', '/info'):
            return False
        ok, retry = self._check_rate_limit()
        if not ok:
            self._send_json(
                {'ok': False, 'error': f'rate limit exceeded ({RATE_LIMIT_PER_MIN}/min)',
                 'code': 'RATE_LIMITED'},
                status=429,
                extra_headers={'Retry-After': str(retry)},
            )
            return True
        return False

    def do_GET(self):  # noqa: N802
        path = self.path.split('?')[0]
        if path == '/health':
            if self._gate(path):
                return
            self._send_json({
                'ok': True,
                'service': 'uc-bridge',
                'version': VERSION,
                'selfTestOk': self_test(),
                'versions': versions(),
                'chromePath': CHROME_PATH or '(not found)',
                'chromeVersionMain': CHROME_VERSION_MAIN,
                'xvfbAvailable': xvfb_available(),
                'displayEnv': DISPLAY_ENV or '(unset)',
                'ts': int(time.time() * 1000),
            })
            return
        if path == '/metrics':
            if self._gate(path):
                return
            self._send_text(
                METRICS.to_prometheus(),
                content_type='text/plain; version=0.0.4; charset=utf-8',
            )
            return
        if path == '/info':
            if self._gate(path):
                return
            snap = METRICS.snapshot()
            info = {
                'service': 'uc-bridge',
                'version': VERSION,
                'uptimeSeconds': snap['uptime_seconds'],
                'python': platform.python_version(),
                'config': {
                    'authEnabled': bool(AUTH_TOKEN),
                    'authSource': ('AUTH_TOKEN' if os.environ.get('AUTH_TOKEN')
                                   else 'BRIDGE_KEY' if os.environ.get('BRIDGE_KEY') else None),
                    'rateLimitPerMin': RATE_LIMIT_PER_MIN if RATE_LIMIT_PER_MIN > 0 else None,
                    'requestTimeoutMs': MAX_TIMEOUT_MS,
                    'ssrfCheckEnabled': True,
                    'maxBodyBytes': MAX_BODY_BYTES,
                    'maxRequestBytes': MAX_REQUEST_BYTES,
                    'hostname': HOST,
                    'ssrfAllowLoopback': SSRF_ALLOW_LOOPBACK,
                    'browserConcurrency': BROWSER_CONCURRENCY,
                    'displayEnvSet': bool(DISPLAY_ENV),
                },
                'versions': versions(),
                'chromePath': CHROME_PATH or '(not found)',
                'chromeVersionMain': CHROME_VERSION_MAIN,
                'xvfbAvailable': xvfb_available(),
                'xvfbRunPath': XVFB_RUN_PATH or '(not found)',
                'metrics': snap,
                'endpoints': ['/health', '/metrics', '/info', '/fetch', '/solve-turnstile'],
            }
            self._send_json(info)
            return
        if self._gate(path):
            return
        self._send_json({'ok': False, 'error': 'not found'}, status=404)

    def do_POST(self):  # noqa: N802
        # 解析 query 用于 ?xvfb=1
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if self._gate(path):
            return
        if path not in ('/fetch', '/solve-turnstile'):
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
        METRICS.start_request()
        ok_flag = True
        try:
            if path == '/fetch':
                result = do_fetch(payload, query)
            else:
                result = do_solve_turnstile(payload, query)
            if not result.get('ok'):
                ok_flag = False
            cost = int((time.time() - started) * 1000)
            if result.get('ok'):
                print(
                    f"[uc-bridge] {path} solved={str(result.get('solved', '-'))[:8]} "
                    f"xvfb={result.get('xvfbUsed')} "
                    f"{str(payload.get('url'))[:120]} ({cost}ms, {len(result.get('html', ''))} chars)",
                    flush=True,
                )
            else:
                print(
                    f"[uc-bridge] FAIL {path} {str(payload.get('url'))[:120]} ({cost}ms): "
                    f"{str(result.get('error'))[:200]}",
                    flush=True,
                )
            self._send_json(result)
        finally:
            cost_ms = (time.time() - started) * 1000
            METRICS.end_request(cost_ms, ok_flag)


def main():
    # 启动即预热 UC 导入(首个 /fetch 不吃冷启动 import 开销; 失败留档,
    # /health selfTestOk=false 让引擎/运维可感知)
    ok = self_test()
    auth_mode = f'AUTH({("AUTH_TOKEN" if os.environ.get("AUTH_TOKEN") else "BRIDGE_KEY")})' if AUTH_TOKEN else 'NO_AUTH(dev)'
    ssrf_mode = f'SSRF(allow_loopback={SSRF_ALLOW_LOOPBACK})'
    xvfb_mode = f'xvfb({"available" if xvfb_available() else "missing"})'
    chrome_mode = f'chrome={CHROME_PATH or "(not found)"} v{CHROME_VERSION_MAIN or "?"}'
    print(
        f'[uc-bridge] 启动 http://{HOST}:{PORT} v{VERSION} '
        f'(selfTest={"ok" if ok else "FAIL: " + str(_UC_ERR)}) '
        f'{auth_mode} ratelimit:{RATE_LIMIT_PER_MIN}/min timeout:30s {ssrf_mode} {xvfb_mode} {chrome_mode} '
        f'versions={versions()}',
        flush=True,
    )
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True

    # SIGTERM/SIGINT 优雅关闭(stop-all.sh 杀进程时给在途请求 ≤5s 完成)
    shutting_down = threading.Event()

    def shutdown(signum, frame):
        if shutting_down.is_set():
            return
        shutting_down.set()
        sig_name = signal.Signals(signum).name if hasattr(signal, 'Signals') else str(signum)
        print(f'[uc-bridge] {sig_name} received, shutting down gracefully (5s grace)', flush=True)

        def _stop():
            server.shutdown()
            time.sleep(0.1)
            os._exit(0)
        t = threading.Thread(target=_stop, daemon=True)
        t.start()

        def _force():
            time.sleep(5.0)
            print('[uc-bridge] graceful shutdown timed out, force exit', flush=True)
            os._exit(1)
        threading.Thread(target=_force, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
