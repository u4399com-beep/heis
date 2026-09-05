// cc-b 探针: 复现 fetcher 对 /zuixin/1.html 的 500 错误链
import { fetchPage } from '../src/lib/crawl/fetcher'

const cfg = {
  engine: 'http' as const,
  uaMode: 'rotate' as const,
  autoCookie: true,
  referer: true,
  timeout: 25000,
  retries: 2,
  waitMs: 800,
}

async function main() {
  const urls = [
    'https://www.shudugu.org/zuixin/1.html',
    'https://www.shudugu.org/zuixin/',
    'https://www.shudugu.org/zuixin/2.html',
  ]
  for (const u of urls) {
    try {
      const res = await fetchPage(u, cfg)
      console.log(`[OK] ${u} -> engine=${res.engine} len=${res.html.length}`)
    } catch (e: any) {
      console.log(`[ERR] ${u} -> ${e?.message?.slice(0, 300)}`)
      if (e?.status) console.log('      status=', e.status, 'body head=', String(e?.bodyHtml || '').slice(0, 200))
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
}

main()
export {}
