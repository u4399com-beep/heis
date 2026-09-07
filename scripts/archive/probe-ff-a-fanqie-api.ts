/**
 * ff-a/A3: 番茄小说聚合API(fq.taijiwang.top) 复查探针
 * cc轮终态: 全路径 502 标记未实测。本探针串行探测 API 健康度(curl/bun双栈)。
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const UA = 'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)'

// 规则四段真实入口(与规则 config 对齐)
const TARGETS: { label: string; url: string }[] = [
  { label: 'search(list段入口)', url: 'https://fq.taijiwang.top/api/search?key=%E5%89%91&tab_type=3&offset=0' },
  { label: 'home根域', url: 'https://fq.taijiwang.top/' },
]

async function bunProbe(url: string): Promise<{ status: number; body: string; ms: number }> {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    })
    const body = await res.text()
    return { status: res.status, body: body.slice(0, 300), ms: Date.now() - t0 }
  } catch (e) {
    return { status: -1, body: `FETCH_ERR: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300), ms: Date.now() - t0 }
  }
}

async function main() {
  for (const t of TARGETS) {
    console.log(`\n== [bun] ${t.label} ${t.url}`)
    const r = await bunProbe(t.url)
    console.log(`   status=${r.status} ms=${r.ms} body=${JSON.stringify(r.body.slice(0, 220))}`)
    await sleep(1200)
  }
}
await main()
process.exit(0)
export {}
