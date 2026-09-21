#!/usr/bin/env python3
"""curl-impersonate-bridge Go 调用脚本 (R40-1A).

Go 版 curl-impersonate-bridge 在 stealthy/TLS impersonate 模式下通过 exec python3 调用本脚本:
  python3 curl_cffi_fetch.py --url URL [--timeout 30000] [--proxy URL]
                            [--impersonate chrome120] [--method GET]
                            [--header "K: V" ...]

输出 stdout: 一行 JSON, 形态与 curl-impersonate-bridge 的 do_fetch 返回值一致:
  {"ok": true, "status": 200, "headers": [[k,v],...], "setCookie": [...], "bodyB64": "..."}
  {"ok": false, "error": "..."}

(用于 Go 版 curl-impersonate-bridge 保留 curl_cffi 的精确 TLS 指纹模拟能力;
 若 curl_cffi 不可用, Go 版会回退到 net/http 标准 TLS 栈.)
"""
import argparse
import base64
import json
import re
import sys


def safe_header_key(k):
    if not k or len(k) > 128:
        return ""
    if not re.match(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$", k):
        return ""
    return k


def safe_header_value(v):
    return re.sub(r"[\r\n\0]+", " ", str(v))[:8192]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--timeout', type=int, default=20000)
    ap.add_argument('--proxy', default='')
    ap.add_argument('--impersonate', default='')
    ap.add_argument('--method', default='GET')
    ap.add_argument('--header', action='append', default=[])
    args = ap.parse_args()

    try:
        from curl_cffi import requests as cffi_requests
    except Exception as e:
        print(json.dumps({'ok': False, 'error': f'curl_cffi 不可用: {type(e).__name__}: {e}'}))
        sys.exit(0)

    headers = {}
    for h in args.header:
        if ':' in h:
            k, v = h.split(':', 1)
            kk = safe_header_key(k.strip())
            vv = safe_header_value(v.strip())
            if kk and vv:
                headers[kk] = vv

    imp = None
    if args.impersonate:
        imp = args.impersonate

    tmo = max(2, min(args.timeout, 30000)) / 1000.0
    proxies = None
    if args.proxy:
        proxies = {'http': args.proxy, 'https': args.proxy}

    req_method = args.method.upper() if args.method.upper() in ('GET', 'HEAD') else 'GET'

    try:
        resp = cffi_requests.request(
            req_method,
            args.url,
            headers=headers,
            proxies=proxies,
            timeout=tmo,
            impersonate=imp,
            allow_redirects=True,
            verify=True,
        )
    except Exception as e:
        print(json.dumps({'ok': False, 'error': f'curl_cffi 请求失败: {type(e).__name__}: {str(e)[:300]}'}))
        sys.exit(0)

    status = int(getattr(resp, 'status_code', 0))
    headers_list = []
    set_cookies = []
    try:
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
        pass

    try:
        body_bytes = resp.content or b''
    except Exception:
        body_bytes = b''

    if len(body_bytes) > 20 * 1024 * 1024:
        print(json.dumps({'ok': False, 'error': f'目标响应体超过 {20*1024*1024} 字节上限'}))
        sys.exit(0)

    if status == 0:
        print(json.dumps({'ok': False, 'error': 'curl_cffi 返回无 status_code'}))
        sys.exit(0)

    print(json.dumps({
        'ok': True,
        'status': status,
        'headers': headers_list,
        'setCookie': set_cookies,
        'bodyB64': base64.b64encode(body_bytes).decode('ascii'),
        'finalUrl': args.url,
    }))


if __name__ == '__main__':
    main()
