// ============================================================
// hh-d2 book4.cc list 段渲染面探针 — count=0 甄别(回归期结构漂移 vs 引擎渲染问题)
// 单发串行: fetchPage(engine=browser + 规则 fetch 同参) → html 存档 + 结构指纹统计
// 运行: bun scripts/probe-hh-d2-book4.ts [outfile]
// ============================================================
export {}

import * as fs from 'fs'
import { fetchPage } from '../src/lib/crawl/fetcher'
const URL = 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/1'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

async function main(): Promise<void> {
  const res = await fetchPage(URL, {
    engine: 'browser',
    uaMode: 'custom',
    customUa: UA,
    timeout: 60000,
    retries: 1,
    waitMs: 1500,
    hostGateLimit: 2,
  })
  const html = res.html
  const out = process.argv[2] || '/home/z/my-project/tmp/hh-d/book4-list.html'
  fs.writeFileSync(out, html)
  console.log('engine=', res.engine, 'blocked=', res.blocked, 'len=', html.length)
  console.log('book-info 出现次数:', (html.match(/book-info/g) || []).length)
  console.log('li:has(div.book-info) 近似计数(li 含 book-info):', (html.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*?book-info[\s\S]*?<\/li>/g) || []).length)
  console.log('h3 标签数:', (html.match(/<h3[\s>]/g) || []).length)
  const m = html.match(/<title[^>]*>([\s\S]{1,120}?)<\/title>/i)
  console.log('title =', m ? m[1].trim() : '(无)')
  for (const marker of ['正在', '验证', 'captcha', 'challenge', 'html_b', 'atob']) {
    const n = (html.match(new RegExp(marker, 'gi')) || []).length
    if (n) console.log(`marker "${marker}":`, n)
  }
  const firstLi = html.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*?book-info[\s\S]*?<\/li>/)
  if (firstLi) console.log('首个 li 样本:', firstLi[0].replace(/\s+/g, ' ').slice(0, 400))
  process.exit(0)
}

main().catch((e) => {
  console.error('probe 失败:', (e as Error).message?.slice(0, 200))
  process.exit(1)
})
