// bb-b 结构挖掘: 用项目 fetchPage(http) 抓页面落盘 /tmp/bbb/, 供选择器分析
import { fetchPage } from '../src/lib/crawl/fetcher'
import { writeFileSync, mkdirSync } from 'node:fs'

const OUT = '/tmp/bbb'
mkdirSync(OUT, { recursive: true })

async function dump(name: string, url: string) {
  try {
    const res = await fetchPage(url, { engine: 'http', timeout: 25000, retries: 1, autoCookie: true, referer: true })
    writeFileSync(`${OUT}/${name}.html`, res.html)
    const m = res.html.match(/<title[^>]*>([^<]*)<\/title>/i)
    console.log(`${name}: blocked=${res.blocked} len=${res.html.length} title=${JSON.stringify(m?.[1]?.slice(0, 60))}`)
  } catch (e: any) {
    console.log(`${name}: ERROR ${e?.status || ''} ${String(e?.message).slice(0, 150)}`)
  }
}

async function main() {
  await dump('dawei-b1c1', 'https://www.daweixs.com/781_781707/253172718.html')
  await dump('dawei-b1c2', 'https://www.daweixs.com/781_781707/253172719.html')
  await dump('dawei-b2c0', 'https://www.daweixs.com/766_766217/253171785.html')
}

main().finally(() => process.exit(0))
