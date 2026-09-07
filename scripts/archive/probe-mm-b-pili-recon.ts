// ============================================================
// probe-mm-b-pili-recon.ts — 霹雳书屋 menu 分页行为侦察(mm-b 深审证据面)
// 问题: toc 规则 pagination.enabled=false, 若站点对长书分页 menu/2.html,
//       单页 menu 只能采到部分目录 → 需实证分页是否存在/触发阈值
// 纪律: 串行 + 间隔≥1.2s, 共 ≤7 请求, 探针结尾 process.exit(0)
// 运行: bun scripts/probe-mm-b-pili-recon.ts (需 scrapling-bridge 3012 存活)
// ============================================================
export {}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function bridgeFetch(url: string): Promise<{ ok: boolean; status: number; html: string }> {
  const res = await fetch('http://127.0.0.1:3012/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, mode: 'stealthy', headless: true, timeoutMs: 90000, headers: { 'User-Agent': UA } }),
    signal: AbortSignal.timeout(120_000),
  })
  const j = (await res.json()) as { ok: boolean; status: number; html: string; error?: string }
  return j
}

function countItems(html: string): number {
  return (html.match(/works-chapter-item/g) || []).length
}
function menuLinks(html: string): string[] {
  return Array.from(new Set((html.match(/href="\/5\/\d+\/menu\/[^"]+"/g) || [])))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1) 全球高考(176章单页) 的 menu/2.html 是否存在(分页只在需要时出现的判定面)
  const probe1 = await bridgeFetch('https://www.pilishuwu.com/5/2951/menu/2.html')
  console.log(`[1] menu/2.html(176章书): ok=${probe1.ok} status=${probe1.status} len=${probe1.html?.length || 0} items=${probe1.ok ? countItems(probe1.html) : 'n/a'}`)
  await sleep(1300)

  // 2) 抽 3 本分类页书籍, 看 info→menu→章节数与 menu 分页链接
  const books = ['/5/22646/info.html', '/5/19183/info.html', '/5/22688/info.html']
  for (let i = 0; i < books.length; i++) {
    const info = await bridgeFetch(`https://www.pilishuwu.com${books[i]}`)
    if (!info.ok || info.status !== 200) {
      console.log(`[${2 + i}] info ${books[i]}: ok=${info.ok} status=${info.status} error=${(info as unknown as { error?: string }).error?.slice(0, 80)}`)
      await sleep(1300)
      continue
    }
    const titleM = info.html.match(/<title>([^<]{1,60})</)
    const menus = menuLinks(info.html)
    console.log(`[${2 + i}] info ${books[i]}: title=${titleM?.[1]?.trim().slice(0, 30)} menuLinks=${JSON.stringify(menus)}`)
    await sleep(1300)
    if (menus.length) {
      const menu = await bridgeFetch(`https://www.pilishuwu.com${menus[0]}`)
      if (menu.ok && menu.status === 200) {
        const allMenus = menuLinks(menu.html)
        console.log(`    menu ${menus[0]}: status=200 len=${menu.html.length} chapterItems=${countItems(menu.html)} menuPageLinks=${JSON.stringify(allMenus)}`)
      } else {
        console.log(`    menu ${menus[0]}: ok=${menu.ok} status=${menu.status}`)
      }
      await sleep(1300)
    }
  }
  console.log('recon done')
  process.exit(0)
}

main().catch((e) => {
  console.error('probe error:', e?.message || e)
  process.exit(0)
})
