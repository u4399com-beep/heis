// ============================================================
// verify-ll-c-parser.ts — ll-c parser 域断言(分卷 const 字段 + Referer 翻页链)
//   1. parseToc JSON 模式: rec.volume(json 字段)回归守卫
//   2. parseToc JSON 模式: fields.volume 为 const 型(单卷 API 全目录打同一卷名)——
//      修前 phase-1 跳过 const 型且无后置提取, volume 静默丢失
//   3. parseToc HTML 分页: pageFetch 第2页起收到 (nextUrl, 上一页URL) —— Referer 链逐页回溯
//   4. parseContent 分页: 同口径(正文第2页 Referer=正文第1页)
//   5. 未启用回传时 pageFetch 单参调用语义兼容(实现端可选参)
// 纯内存 mock, 零网络零 DB。运行: bun scripts/verify-ll-c-parser.ts
// ============================================================
import { parseToc, parseContent } from '../src/lib/crawl/parser'
import type { PageRule } from '../src/lib/crawl/types'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: string) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, d ?? '') } }

console.log('== 1. parseToc JSON 模式: json 型 volume(回归守卫) ==')
{
  const rule: PageRule = {
    itemSelector: { type: 'json', expression: 'data.list' },
    fields: {
      title: { type: 'json', expression: 'c_title' },
      url: { type: 'const', expression: 'https://a.example/ch/{index}.html' },
      volume: { type: 'json', expression: 'volume_name' },
    },
  } as unknown as PageRule
  const html = JSON.stringify({ data: { list: [{ c_title: '第一章', volume_name: '第一卷 北游' }, { c_title: '第二章', volume_name: '第一卷 北游' }, { c_title: '第三章', volume_name: '第二卷 南归' }] } })
  const res = await parseToc('https://a.example/toc?id=9', html, rule, {})
  ok('1a 3 条目全部入目录', res.items.length === 3, JSON.stringify(res.items.map((x) => x.title)))
  ok('1b json volume 提取在位', res.items[0]?.volume === '第一卷 北游' && res.items[2]?.volume === '第二卷 南归', JSON.stringify(res.items.map((x) => x.volume)))
}

console.log('== 2. parseToc JSON 模式: const 型 volume(修前静默丢失) ==')
{
  const rule: PageRule = {
    itemSelector: { type: 'json', expression: 'chapters' },
    fields: {
      title: { type: 'json', expression: '.' },
      url: { type: 'const', expression: 'https://b.example/{q.bid}/{index}.html' },
      volume: { type: 'const', expression: '第一卷 全一卷' },
    },
  } as unknown as PageRule
  const html = JSON.stringify({ chapters: ['楔子', '第一章 起', '第二章 承'] })
  const res = await parseToc('https://b.example/toc?bid=77', html, rule, {})
  ok('2a 3 条目入目录且 URL 模板合成正确', res.items.length === 3 && res.items[1]?.url === 'https://b.example/77/2.html', JSON.stringify(res.items))
  ok('2b const volume 全目录打卷名标签', res.items.every((x) => x.volume === '第一卷 全一卷'), JSON.stringify(res.items.map((x) => x.volume)))
}

console.log('== 3. parseToc HTML 分页: Referer 链逐页回溯 ==')
{
  const calls: { u: string; r?: string }[] = []
  const page1 = `<html><head><title>t</title></head><body><ul id="toc">
    <li><a href="/c1">第1章</a></li><li><a href="/c2">第2章</a></li>
  </ul><a class="next" href="/toc?page=2">下一页</a></body></html>`
  const page2 = `<html><head><title>t</title></head><body><ul id="toc">
    <li><a href="/c3">第3章</a></li><li><a href="/c4">第4章</a></li>
  </ul><a class="next" href="/toc?page=3">下一页</a></body></html>`
  const page3 = `<html><head><title>t</title></head><body><ul id="toc">
    <li><a href="/c5">第5章</a></li>
  </ul></body></html>`
  const P1 = 'https://mock.example/toc'
  const P2 = 'https://mock.example/toc?page=2'
  const P3 = 'https://mock.example/toc?page=3'
  const rule: PageRule = {
    itemSelector: { type: 'css', expression: 'ul#toc > li' },
    fields: {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    },
    pagination: { enabled: true, maxPages: 5, nextLink: { type: 'css', expression: 'a.next', attr: 'href' } },
  } as unknown as PageRule
  const pages: Record<string, string> = { [P1]: page1, [P2]: page2, [P3]: page3 }
  const fetchCfg = {
    pageFetch: async (u: string, refererUrl?: string) => {
      calls.push({ u, r: refererUrl })
      return { html: pages[u] ?? '' }
    },
  }
  const res = await parseToc(P1, page1, rule, fetchCfg as never)
  ok('3a 三页合并 5 章', res.items.length === 5 && res.pages === 3, `${res.items.length}/${res.pages}`)
  ok('3b 翻页两次都回传上一页 URL(第2页 Referer=第1页)', calls.length === 2 && calls[0].u === P2 && calls[0].r === P1, JSON.stringify(calls))
  ok('3c 第3页 Referer=第2页(链式回溯非恒首页)', calls[1]?.u === P3 && calls[1]?.r === P2, JSON.stringify(calls[1]))
}

console.log('== 4. parseContent 分页: 同口径 ==')
{
  const calls: { u: string; r?: string }[] = []
  const p1 = `<html><body><div id="content">正文一。${'段'.repeat(30)}</div><a class="next" href="/c1?p=2">下一页</a></body></html>`
  const p2 = `<html><body><div id="content">正文二。${'段'.repeat(30)}</div></body></html>`
  const C1 = 'https://mock.example/c1'
  const C2 = 'https://mock.example/c1?p=2'
  const rule: PageRule = {
    fields: { content: { type: 'css', expression: '#content', attr: 'html' } },
    pagination: { enabled: true, maxPages: 3, nextLink: { type: 'css', expression: 'a.next', attr: 'href' } },
  } as unknown as PageRule
  const fetchCfg = {
    pageFetch: async (u: string, refererUrl?: string) => {
      calls.push({ u, r: refererUrl })
      return { html: u === C2 ? p2 : '' }
    },
  }
  const res = await parseContent(C1, p1, rule, fetchCfg as never)
  ok('4a 正文两页合并', res.content.includes('正文一') && res.content.includes('正文二') && res.pages === 2, `pages=${res.pages}`)
  ok('4b 正文第2页 Referer=正文第1页', calls.length === 1 && calls[0].u === C2 && calls[0].r === C1, JSON.stringify(calls))
}

console.log('== 5. pageFetch 单参实现兼容(未回传时不炸) ==')
{
  const page1 = `<html><head><title>t</title></head><body><ul id="toc"><li><a href="/c1">第1章</a></li></ul></body></html>`
  const rule: PageRule = {
    itemSelector: { type: 'css', expression: 'ul#toc > li' },
    fields: {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    },
    pagination: { enabled: false },
  } as unknown as PageRule
  let arityOk = true
  const fetchCfg = {
    pageFetch: async (u: string) => { arityOk = !!u; return { html: '' } },
  }
  const res = await parseToc('https://mock.example/toc', page1, rule, fetchCfg as never)
  ok('5a 单参 pageFetch 实现零回归(分页关闭不调用)', arityOk && res.items.length === 1, `${res.items.length}`)
}

console.log(`\nPASS ${pass} / FAIL ${fail}`)
process.exit(fail ? 1 : 0)
