import * as cheerio from 'cheerio'

async function scraplingFetch(url: string, mode: 'static' | 'stealthy' | 'playwright' = 'static') {
  const res = await fetch('http://127.0.0.1:3012/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, mode, timeoutMs: 25000 }),
  })
  const j = await res.json() as any
  if (!j.ok) throw new Error(j.error)
  return { html: j.html, status: j.status, finalUrl: j.finalUrl }
}

async function tryFetch(url: string) {
  for (const m of ['static', 'stealthy', 'playwright'] as const) {
    try {
      const r = await scraplingFetch(url, m)
      if (r.html && r.html.length > 1000) {
        return { ...r, mode: m }
      }
      console.log(`  [${m}] empty html (${r.html?.length || 0})`)
    } catch (e) {
      console.log(`  [${m}] ERROR:`, (e as Error).message)
    }
  }
  return null
}

async function probe(url: string, name: string) {
  console.log(`\n${'='.repeat(80)}\n=== ${name} ${url}\n${'='.repeat(80)}`)
  const r = await tryFetch(url)
  if (!r) {
    console.log('FAILED ALL MODES')
    return
  }
  console.log(`SUCCESS mode=${r.mode} finalUrl=${r.finalUrl} htmlLen=${r.html.length}`)
  const $ = cheerio.load(r.html)
  console.log('\n--- title/meta ---')
  console.log('title:', $('title').text().trim().slice(0, 200))
  console.log('keywords:', $('meta[name=keywords]').attr('content')?.slice(0, 200))
  console.log('description:', $('meta[name=description]').attr('content')?.slice(0, 200))

  const bodyStyle = $('body').attr('style') || ''
  console.log('body@style:', bodyStyle.slice(0, 300))

  console.log('\n--- inline <style> blocks ---')
  const styles: string[] = []
  $('style').each((_, el) => {
    const t = $(el).text() || ''
    styles.push(t)
  })
  console.log('inline style block count:', styles.length, 'total bytes:', styles.join('\n').length)
  for (const s of styles) {
    const m = s.match(/:root\s*\{([^}]+)\}/)
    if (m) console.log('ROOT VARS:\n', m[1].slice(0, 1500))
  }
  for (const s of styles) {
    const m = s.match(/body\s*\{([^}]+)\}/)
    if (m) console.log('BODY RULE:', m[1].slice(0, 600))
  }
  for (const s of styles) {
    const m = s.match(/(?:^|[\s,])a\s*\{([^}]+)\}/)
    if (m) { console.log('A RULE:', m[1].slice(0, 400)); break }
  }
  for (const s of styles) {
    const m = s.match(/a:hover\s*\{([^}]+)\}/)
    if (m) { console.log('A:HOVER RULE:', m[1].slice(0, 200)); break }
  }
  for (const s of styles) {
    const m = s.match(/\.header[^{]*\{([^}]+)\}/)
    if (m) { console.log('HEADER RULE:', m[0].slice(0, 300)); break }
  }
  for (const s of styles) {
    const m = s.match(/\.nav[^{]*\{([^}]+)\}/)
    if (m) { console.log('NAV RULE:', m[0].slice(0, 300)); break }
  }
  for (const s of styles) {
    const m = s.match(/\.card[^{]*\{([^}]+)\}/)
    if (m) { console.log('CARD RULE:', m[0].slice(0, 300)); break }
  }

  console.log('\n--- external CSS links ---')
  const cssLinks = $('link[rel="stylesheet"]').map((_, el) => $(el).attr('href')).get()
  console.log('css links:', cssLinks.length, cssLinks.slice(0, 8))

  console.log('\n--- top-level structure ---')
  console.log('header:', $('header').length, ' .header:', $('.header').length, ' .header_top:', $('.header_top').length, ' .header-content:', $('.header-content').length, ' #header:', $('#header').length)
  console.log('main:', $('main').length, ' #main:', $('#main').length, ' .main:', $('.main').length, ' .wrap:', $('.wrap').length, ' .headbox:', $('.headbox').length, ' .container:', $('.container').length)

  console.log('\n--- first 3000 chars of body HTML ---')
  const bodyHtml = $('body').html() || ''
  console.log(bodyHtml.slice(0, 3000))

  const fs = await import('fs')
  fs.writeFileSync(`/home/z/probe/probe-${name}.html`, r.html)
  fs.writeFileSync(`/home/z/probe/probe-${name}.styles.txt`, styles.join('\n\n=====\n\n'))
  console.log(`\nsaved to /home/z/probe/probe-${name}.html (${r.html.length}B)`)
}

const targets: Array<[string, string]> = [
  ['https://www.aijjxs.com/', 'aijjxs'],
  ['https://www.ddyueshu.cc/', 'ddyueshu'],
  ['https://www.pilishuwu.com/', 'pilishuwu'],
  ['https://www.23qb.net/', '23qb'],
  ['https://101kks.com/', '101kks'],
  ['https://www.huangjinwu.org/', 'huangjinwu'],
  ['https://www.ggd66.com/', 'ggd66'],
  ['http://demo.shipsay.com/', 'shipsay'],
  ['http://www.x2552.com/', 'x2552'],
]

for (const [url, name] of targets) {
  try {
    await probe(url, name)
  } catch (e) {
    console.log(`\n${name} FAILED:`, (e as Error).message)
  }
}
console.log('\n\nDONE')
