// ============================================================
// ee-b 引擎级探针 — iidcr.com(稻草人书屋) UA 门禁实测
// 侦察结论: 桌面 Chrome UA 主页 200 但深路径(/book/ /nav/) 403(Apache 源站 UA 门禁);
//          移动 UA / Baiduspider UA 深路径全 200 —— 钉 customUa=移动 UA 走 http 引擎
// 本探针: fetchPage(engine=http, uaMode=custom, customUa=移动UA) 三层实测 + 桌面UA对照
// 运行: bun scripts/probe-ee-b-engine.ts
// ============================================================
export {}

declare const Bun: { write(path: string, data: string): Promise<void> }

import { fetchPage } from '../src/lib/crawl/fetcher'

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function probe(tag: string, url: string, ua: string) {
  const t0 = Date.now()
  try {
    const r = await fetchPage(url, {
      engine: 'http',
      uaMode: 'custom',
      customUa: ua,
      autoCookie: true,
      referer: true,
      timeout: 20000,
      retries: 1,
    })
    const marks = {
      cont_body: /id="cont-body"/.test(r.html),
      all_chapter: /id="all-chapter"/.test(r.html),
      media_list: /class="media-title"/.test(r.html),
      forbidden: /403 Forbidden/.test(r.html),
      book_name: /class="book-name"/.test(r.html),
    }
    console.log(
      `[${tag}] engine=${r.engine} blocked=${r.blocked} len=${r.html.length} ${Date.now() - t0}ms marks=${JSON.stringify(marks)}`
    )
    return r
  } catch (e) {
    console.log(`[${tag}] ERROR ${Date.now() - t0}ms — ${e instanceof Error ? e.message : e}`)
    return null
  }
}

async function main() {
  // ① 桌面 UA 对照(复现实测门禁): 深路径应 403
  await probe('desktop/book', 'https://www.iidcr.com/book/p25225/', DESKTOP_UA)
  await new Promise((r) => setTimeout(r, 1200))

  // ② 移动 UA 三层: 列表 / 书页+目录 / 正文(含子页翻页入口)
  await probe('mobile/nav', 'https://www.iidcr.com/nav/sublove-1.html', MOBILE_UA)
  await new Promise((r) => setTimeout(r, 1200))
  const book = await probe('mobile/book', 'https://www.iidcr.com/book/p25225/', MOBILE_UA)
  await new Promise((r) => setTimeout(r, 1200))
  await probe('mobile/ch', 'https://www.iidcr.com/book/p25225/7231478.html', MOBILE_UA)

  // 样本留存
  if (book) await Bun.write('/home/z/my-project/tmp/ee-b/engine-book-p25225.html', book.html)
}

await main()
process.exit(0)
