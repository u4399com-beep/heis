// qq-c: 引擎链路(dev server fetcher)单章 content 实测 — ch9/ch11 各一次
export {}
const BOOK_ID = '6511963569901276163'

async function engine(itemId: string, label: string): Promise<void> {
  const url = `https://fq.taijiwang.top/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id=${itemId}&bid=${BOOK_ID}`
  const t0 = Date.now()
  const r = await fetch('http://localhost:3000/api/admin/rules/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      section: 'content',
      url,
      rule: {
        enabled: true,
        fields: { content: { type: 'json', expression: 'data.content' } },
        pagination: { enabled: false, maxPages: 1 },
      },
      fetch: {
        engine: 'http',
        uaMode: 'custom',
        customUa: 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)',
        headers: { Accept: 'application/json' },
        autoCookie: true,
        referer: true,
        timeout: 20000,
        retries: 2,
        waitMs: 500,
        hostGateLimit: 3,
      },
      clean: { removeSelectors: ['script', 'style'], adPatterns: [], whitelist: ['p', 'br'], normalize: true, plainText: true },
    }),
  })
  const j: any = await r.json()
  console.log(`[${label}] ok=${j.ok} ms=${Date.now() - t0} raw=${j.data?.rawLength} clean=${j.data?.cleanedLength}`)
  if (j.ok) console.log('   head:', String(j.data.cleanedText).slice(0, 80).replace(/\s+/g, ' '))
  else console.log('   msg:', j.message)
}

async function main(): Promise<void> {
  // ch9=6511978602747866xx? — 先拿 itemId: 直接调上游 toc
  const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'
  const t = await fetch(`https://fq.taijiwang.top/api/book?book_id=${BOOK_ID}&bid=${BOOK_ID}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  const tj = await t.json()
  const items = (tj?.data?.data?.chapterListWithVolume || []).flat()
  await engine(items[8].itemId, 'ch9')
  await engine(items[10].itemId, 'ch11')
  process.exit(0)
}
main().catch((e) => { console.error('ERR', e?.message || e); process.exit(1) })
