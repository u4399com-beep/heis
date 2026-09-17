// 探针: 对每个 enabled 首页最近更新规则, 抓首页 + parseList, 然后扫描首个 list item 内的 img 标签
// 找出潜在 cover 选择器(若有)
import { db } from '/home/z/my-project/src/lib/db'
import { fetchPage } from '/home/z/my-project/src/lib/crawl/fetcher'
import { parseList } from '/home/z/my-project/src/lib/crawl/parser'
import { parseRuleConfig } from '/home/z/my-project/src/lib/crawl/types'

interface Probe {
  name: string
  url: string
  selector: string
  itemsCount: number
  firstItemHtml?: string
  imgTags?: string[]   // img tags within first item
  hasCoverField: boolean
  error?: string
}

async function main() {
  const rules = await db.rule.findMany({ where: { enabled: true, name: { contains: '首页' } } })
  const probes: Probe[] = []
  for (const r of rules) {
    const cfg = parseRuleConfig(r.config)
    if (!cfg.list?.urlTemplate) continue
    const url = cfg.list.urlTemplate
    const selector = cfg.list.itemSelector?.expression || ''
    const hasCoverField = !!(cfg.list.fields?.cover)
    console.log(`\n=== ${r.name} ===`)
    console.log(`  url: ${url}`)
    console.log(`  selector: ${selector}`)
    console.log(`  hasCoverField: ${hasCoverField}`)
    try {
      const res = await fetchPage(url, cfg.fetch)
      if (res.blocked) {
        console.log(`  ❌ BLOCKED captcha=${res.captchaType || 'n/a'} engine=${res.engine}`)
        probes.push({ name: r.name, url, selector, itemsCount: 0, hasCoverField, error: `blocked:${res.captchaType}` })
        continue
      }
      if (!res.html || res.html.length < 200) {
        console.log(`  ❌ empty html (len=${res.html?.length || 0})`)
        probes.push({ name: r.name, url, selector, itemsCount: 0, hasCoverField, error: `empty html` })
        continue
      }
      const parsed = parseList(res.html, url, cfg.list, ['bookUrl', 'url'])
      console.log(`  items: ${parsed.items.length}  engine=${res.engine}`)
      // Find first item's raw HTML for inspection
      // Use cheerio to extract first matching item
      const cheerio = await import('cheerio')
      const $ = cheerio.load(res.html)
      let firstItemHtml = ''
      let imgTags: string[] = []
      try {
        // strip :has(...) pseudo (not supported by cheerio directly without enable cache)
        let sel = selector
        const hasIdx = sel.indexOf(':has(')
        if (hasIdx >= 0) sel = sel.substring(0, hasIdx)
        const firstNode = $(sel).first()
        if (firstNode.length) {
          firstItemHtml = $.html(firstNode) || ''
          // extract img tags within first item
          firstNode.find('img').each((_, img) => {
            const $img = $(img)
            const src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-original') || ''
            const cls = $img.attr('class') || ''
            imgTags.push(`src=${(src||'').slice(0,80)} class=${cls.slice(0,40)}`)
          })
        }
      } catch (e: any) {
        firstItemHtml = `<extract error: ${e?.message || e}>`
      }
      if (firstItemHtml) {
        console.log(`  firstItem (truncated 600): ${firstItemHtml.slice(0, 600)}`)
        if (imgTags.length) {
          console.log(`  img tags (${imgTags.length}):`)
          for (const t of imgTags.slice(0, 6)) console.log(`    ${t}`)
        } else {
          console.log(`  ⚠ no <img> in first item`)
        }
      }
      probes.push({ name: r.name, url, selector, itemsCount: parsed.items.length, firstItemHtml, imgTags, hasCoverField })
    } catch (e: any) {
      console.log(`  ❌ ERROR: ${e?.message || e}`)
      probes.push({ name: r.name, url, selector, itemsCount: 0, hasCoverField, error: String(e?.message || e) })
    }
  }
  console.log('\n=== SUMMARY ===')
  for (const p of probes) {
    const hasImg = (p.imgTags?.length || 0) > 0
    console.log(`  items=${String(p.itemsCount).padStart(3)} img=${hasImg ? 'Y' : 'N'} cover=${p.hasCoverField ? 'Y' : 'N'}  ${p.name}`)
  }
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
