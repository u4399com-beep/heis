// ============================================================
// gg-b/A — wanben book 段选择器离线甄别(样本实证)
// 输入: tmp/gg-b/wanben-book-*.html(活代理窗口抢抓的真实书籍页)
// 方法: ①原始 HTML 关键 class 标记普查 ②真实引擎 parseBook(与 rules/test book 段
//   同一函数同一规则)跑六字段 ③逐字段对账 → 甄别 ff-a fields={} 疑云根因
// 运行: bun scripts/verify-gg-b-wanben-book-offline.ts
// ============================================================
export {}

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseBook, extractField } from '../src/lib/crawl/parser'
import * as cheerio from 'cheerio'

const BASE = 'http://localhost:3000'
const RULE_ID = 'cmthf0hne08gbnktx1wnobuo5'
const SAMPLES = [
  { file: 'tmp/gg-b/wanben-book-95406838.html', url: 'https://www.wanbenshenzhan.com/95406838/', tag: 'S1已知书页' },
  { file: 'tmp/gg-b/wanben-book-list1.html', url: '', tag: 'S3列表首样本' }, // url 从 hunt-result json 回填
]

interface Envelope { ok: boolean; data?: any }

async function loadRule(): Promise<Record<string, any>> {
  const r = await fetch(`${BASE}/api/admin/rules/${RULE_ID}`).then((x) => x.json()) as Envelope
  if (!r.ok || !r.data) throw new Error('规则加载失败')
  return JSON.parse(r.data.config)
}

/** 单字段规则直接作用整页 HTML(与引擎对书籍页无容器字段语义一致: parseBook 内部
 *  parseList 以整页为单一容器项, css 字段整页根级匹配取首命中) */
function probeField(html: string, expr: string, attr: string, replaceFrom?: string): string {
  const $ = cheerio.load(html)
  const val = extractField(html, $, null, null, {
    type: 'css', expression: expr, attr: attr as any,
    ...(replaceFrom ? { replaceFrom, replaceTo: '' } : {}),
  } as any, {})
  return (val || '').trim()
}

async function main() {
  const cfg = await loadRule()
  const bookFields = cfg.book.fields as Record<string, any>

  // S3 样本 URL 回填: 从 hunt-result-round*.json 读 window.bookUrl(存在才校验)
  let s3Url = ''
  for (let r = 1; r <= 9; r++) {
    const p = `tmp/gg-b/hunt-result-round${r}.json`
    if (!existsSync(p)) continue
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as { bookUrl?: string }
      if (j.bookUrl) { s3Url = j.bookUrl; break }
    } catch { /* 忽略 */ }
  }
  if (s3Url) SAMPLES[1].url = s3Url

  let anySample = false
  const report: string[] = []

  for (const s of SAMPLES) {
    if (!existsSync(s.file)) { report.push(`样本缺失: ${s.file}`); continue }
    const html = readFileSync(s.file, 'utf8')
    anySample = true
    console.log(`\n===== 样本 ${s.tag}: ${s.file} (${html.length}B) =====`)

    // ① 关键标记普查
    const marks = ['book-info-detail', 'book-meta', 'latest-chapter-link', 'book-intro', 'book-cover-large']
    const markCount = Object.fromEntries(marks.map((m) => [m, (html.match(new RegExp(m, 'g')) || []).length]))
    console.log('①标记普查:', JSON.stringify(markCount))

    // ② 真实引擎 parseBook 全六字段
    const parsed = parseBook(html, s.url || 'https://www.wanbenshenzhan.com/95406838/', cfg.book as any)
    console.log('②parseBook(引擎语义):', JSON.stringify(parsed))

    // ③ 逐字段选择器单测(选择器表达式 → 原始命中文本)
    console.log('③逐字段选择器单测:')
    for (const [k, r] of Object.entries(bookFields)) {
      const v = probeField(html, r.expression as string, (r.attr as string) || 'text', r.replaceFrom as string)
      console.log(`   ${k.padEnd(14)} ${r.expression} → ${JSON.stringify(v.slice(0, 90))}`)
    }

    // ④ book-meta span 结构实录(核对 nth-of-type 序号假设)
    const $ = cheerio.load(html)
    const spans = $('.book-meta span').map((_, el) => $(el).text().trim()).get()
    console.log('④.book-meta span 文本序列:', JSON.stringify(spans))
    const h1 = $('.book-info-detail h1').text().trim()
    console.log('④.book-info-detail h1:', JSON.stringify(h1))
    const intro = $('.book-intro p').map((_, el) => $(el).text().trim()).get()
    console.log('④.book-intro p 段数:', intro.length, '首段:', JSON.stringify((intro[0] || '').slice(0, 80)))
    const cover = $('.book-cover-large img').attr('src')
    console.log('④.book-cover-large img src:', JSON.stringify(cover))
    const latest = $('.latest-chapter-link a').first().text().trim()
    console.log('④.latest-chapter-link a:', JSON.stringify(latest))

    const ok =
      !!parsed.name && !!parsed.author && !!parsed.intro &&
      !!$('.latest-chapter-link a').first().text().trim() && !!cover
    report.push(`${s.tag}: ${ok ? '✅ 选择器全命中' : '❌ 有字段落空'} name=${JSON.stringify(parsed.name)} author=${JSON.stringify(parsed.author)}`)
  }

  if (!anySample) { console.log('无样本可甄别'); process.exit(2) }
  console.log('\n===== 甄别结论 =====')
  for (const r of report) console.log(r)
  writeFileSync('tmp/gg-b/offline-verdict.json', JSON.stringify({ report, at: new Date().toISOString() }, null, 2))
}

main().catch((e) => { console.error('offline ERROR', e); process.exit(1) })
