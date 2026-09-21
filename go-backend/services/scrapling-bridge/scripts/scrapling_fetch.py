#!/usr/bin/env python3
"""scrapling-bridge Go 调用脚本 (R40-1A).

Go 版 scrapling-bridge 在 stealthy/playwright 模式下通过 exec python3 调用本脚本:
  python3 scrapling_fetch.py --url URL --mode stealthy [--timeout 30000] [--proxy URL] [--headless]
                            [--header "K: V" ...]

输出 stdout: 一行 JSON, 形态与 scrapling-bridge 的 do_fetch 返回值一致:
  {"ok": true, "status": 200, "html": "...", "finalUrl": "..."}
  {"ok": false, "error": "..."}

(用于 Go 版 scrapling-bridge 在 stealthy/playwright 模式下保留 Python scrapling 的能力,
 static 模式由 Go 直接用 net/http 完成, 不走本脚本。)
"""
import argparse
import json
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', required=True)
    ap.add_argument('--mode', required=True, choices=['static', 'stealthy', 'playwright'])
    ap.add_argument('--timeout', type=int, default=30000)
    ap.add_argument('--proxy', default='')
    ap.add_argument('--headless', action='store_true')
    ap.add_argument('--header', action='append', default=[])
    args = ap.parse_args()

    headers = {}
    for h in args.header:
        if ':' in h:
            k, v = h.split(':', 1)
            headers[k.strip()] = v.strip()

    try:
        from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher
    except Exception as e:
        print(json.dumps({'ok': False, 'error': f'scrapling 不可用: {type(e).__name__}: {e}'}))
        sys.exit(0)

    try:
        if args.mode == 'static':
            kw = {'timeout': max(1, args.timeout // 1000), 'follow_redirects': True, 'retries': 0}
            if headers: kw['headers'] = headers
            if args.proxy: kw['proxy'] = args.proxy
            page = Fetcher.get(args.url, **kw)
        elif args.mode == 'stealthy':
            kw = {'headless': bool(args.headless), 'timeout': args.timeout, 'google_search': False,
                  'disable_resources': True, 'solve_cloudflare': True, 'retries': 1}
            if headers: kw['extra_headers'] = headers
            if args.proxy: kw['proxy'] = args.proxy
            page = StealthyFetcher.fetch(args.url, **kw)
        else:  # playwright
            kw = {'headless': bool(args.headless), 'timeout': args.timeout, 'google_search': False,
                  'disable_resources': True, 'retries': 1}
            if headers: kw['extra_headers'] = headers
            if args.proxy: kw['proxy'] = args.proxy
            page = DynamicFetcher.fetch(args.url, **kw)
        body = getattr(page, 'body', b'') or b''
        enc = getattr(page, 'encoding', None) or 'utf-8'
        try:
            html = body.decode(enc, errors='replace')
        except (LookupError, TypeError, ValueError):
            html = body.decode('utf-8', errors='replace')
        final_url = getattr(page, 'url', None) or args.url
        print(json.dumps({'ok': True, 'status': int(getattr(page, 'status', 0)),
                          'html': html, 'finalUrl': final_url if isinstance(final_url, str) else args.url}))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': f'{type(e).__name__}: {str(e)[:300]}'}))


if __name__ == '__main__':
    main()
