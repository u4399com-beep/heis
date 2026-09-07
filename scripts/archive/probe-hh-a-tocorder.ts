// hh-a 诊断探针: 引擎链路复现 e2e 章节序(库内目录序 vs 静态解析序差异归因)
// 用法: bun run scripts/probe-hh-a-tocorder.ts
// hh-a2 修正: FetchResult 无 status/url 字段(engine/html/blocked 三字段), 落盘改 node:fs(项目
// 脚本惯例, Bun 全局不在 tsconfig 类型面); 本探针传的是裸 toc 配置(无 itemSelector)→ parseToc
// 整页 scope 收全页 <a>, 其"目录序"输出是探针伪象 —— 引擎真实序见 tmp/hh-a/audit-selectors.ts
import { writeFileSync } from 'node:fs'
import { fetchPage } from '../src/lib/crawl/fetcher'
import { parseToc } from '../src/lib/crawl/parser'

const TOC_URL = 'https://www.aijjxs.com/read/57196/'
const fetchCfg = {
  engine: 'http' as const,
  uaMode: 'rotate' as const,
  autoCookie: true,
  referer: true,
  timeout: 25000,
  retries: 2,
  waitMs: 800,
  hostGateLimit: 3,
}

async function main() {
  const page = await fetchPage(TOC_URL, fetchCfg)
  console.log('engine:', page.engine, 'blocked:', page.blocked, 'htmlLen:', page.html.length)
  writeFileSync('tmp/hh-a/engine_toc.html', page.html)
  console.log('saved: tmp/hh-a/engine_toc.html')
  const r = await parseToc(TOC_URL, page.html, {
    enabled: true,
    fields: {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    },
  }, fetchCfg)
  console.log('toc items:', r.items.length, 'pages:', r.pages)
  for (let i = 0; i < 10; i++) console.log(i + 1, JSON.stringify(r.items[i]))
  // 查"现身"在引擎目录中的位置
  const pos = r.items.findIndex((t) => t.title.includes('现身'))
  console.log('现身 位置:', pos + 1, pos >= 0 ? JSON.stringify(r.items[pos]) : '')
  const posYang = r.items.findIndex((t) => t.title.includes('杨家'))
  console.log('杨家 位置:', posYang + 1)
}

main().catch((e) => { console.error('probe ERROR', e); process.exit(1) })

export {}
