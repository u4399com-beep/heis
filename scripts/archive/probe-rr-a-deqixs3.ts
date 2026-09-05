// ============================================================
// rr-a 探针3: deqixs 三参数链路最小化定案 + 边界复证
// 结论目标: ①最小可行请求组合(是否需要先访章节页)
//           ②referrer 绑定语义(错配 Referer/错配章节)
//           ③跨章 token / 旧时间戳 / 新章验证
// 运行: bun run scripts/probe-rr-a-deqixs3.ts
// ============================================================
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const B = 'https://www.deqixs.cc'

function jsum(buf: ArrayBuffer) {
  const txt = new TextDecoder('gbk', { fatal: false }).decode(buf)
  try {
    const j = JSON.parse(txt)
    return { status: j.status as number, len: (j.data?.content?.length ?? 0) as number, msg: String(j.message ?? '') }
  } catch {
    return { status: -1, len: 0, msg: `非JSON ${txt.slice(0, 40)}` }
  }
}

/** 拉三参数: referrer 参数值可指定; 是否带 Referer 头可指定 */
async function fetchParams(aid: string, cid: string, referrer: string, withReferer: boolean) {
  const q = `aid=${aid}&cid=${cid}&referrer=${encodeURIComponent(referrer)}`
  const res = await fetch(`${B}/scripts/chapter.js.php?${q}`, {
    headers: { 'User-Agent': UA, ...(withReferer ? { Referer: referrer } : {}) },
    signal: AbortSignal.timeout(15000),
  })
  const t = new TextDecoder('utf-8', { fatal: false }).decode(await res.arrayBuffer())
  return {
    token: t.match(/chapterToken\s*=\s*'([^']+)'/)?.[1] ?? '',
    timestamp: t.match(/timestamp\s*=\s*(\d+)/)?.[1] ?? '',
    nonce: t.match(/nonce\s*=\s*'([^']+)'/)?.[1] ?? '',
  }
}

/** 打 ajax2: 显式指定 Referer 头 */
async function ajax2(aid: string, cid: string, p: { token: string; timestamp: string; nonce: string }, referer: string | null) {
  const q = new URLSearchParams({ aid, cid, ...p })
  const res = await fetch(`${B}/modules/article/ajax2.php?${q}`, {
    headers: { 'User-Agent': UA, ...(referer ? { Referer: referer, 'X-Requested-With': 'XMLHttpRequest' } : {}) },
    signal: AbortSignal.timeout(15000),
  })
  return jsum(await res.arrayBuffer())
}

// ---- ① 最小组合: 不访章节页, chapter.js.php 带 referrer 参数, 两步都带 Referer 头 ----
const ch1 = `${B}/books/126/81417.html`
const p1 = await fetchParams('126', '81417', ch1, true)
console.log('[①最小组合·不访章节页]', p1.token ? 'token OK' : 'token EMPTY', await ajax2('126', '81417', p1, ch1))

// ---- ② referrer 错配: token 按 ch1 签发, ajax2 Referer 指向书页(非章节页) ----
const p2 = await fetchParams('126', '81417', ch1, true)
console.log('[②Referer错配=书页]', await ajax2('126', '81417', p2, `${B}/books/126/`))

// ---- ③ token 按 ch1 签发打 ch2(跨章复用) ----
const ch2 = `${B}/books/126/81418.html`
const p3 = await fetchParams('126', '81417', ch1, true)
console.log('[③token打跨章cid=81418]', await ajax2('126', '81418', p3, ch2))

// ---- ④ ch2 自洽(新参数新章) ----
const p4 = await fetchParams('126', '81418', ch2, true)
console.log('[④ch2自洽]', await ajax2('126', '81418', p4, ch2))

// ---- ⑤ 最新章(5435755 完本感言)自洽 ----
const ch5 = `${B}/books/126/5435755.html`
const p5 = await fetchParams('126', '5435755', ch5, true)
console.log('[⑤最新章5435755自洽]', await ajax2('126', '5435755', p5, ch5))

// ---- ⑥ 旧时间戳 ----
const p6 = await fetchParams('126', '81417', ch1, true)
console.log('[⑥旧时间戳]', await ajax2('126', '81417', { ...p6, timestamp: '1000000000000' }, ch1))

// ---- ⑦ 换一本书(随便取书页 12? 先探 /books/2/ 第一章) ----
const res2 = await fetch(`${B}/books/2/`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })
const book2 = new TextDecoder('utf-8', { fatal: false }).decode(await res2.arrayBuffer())
const m2 = book2.match(/https:\/\/www\.deqixs\.cc\/books\/2\/(\d+)\.html/)
if (m2) {
  const cidB = m2[1]
  const chB = `${B}/books/2/${cidB}.html`
  const pB = await fetchParams('2', cidB, chB, true)
  console.log(`[⑦书2章${cidB}自洽]`, await ajax2('2', cidB, pB, chB))
} else {
  console.log('[⑦书2] 未提取到章节链接(书可能不存在), 跳过')
}

// ---- ⑧ 参数顺序无关性(URLSearchParams 排序) ----
const p8 = await fetchParams('126', '81417', ch1, true)
const r8 = await fetch(`${B}/modules/article/ajax2.php?nonce=${p8.nonce}&timestamp=${p8.timestamp}&token=${p8.token}&cid=81417&aid=126`, {
  headers: { 'User-Agent': UA, Referer: ch1 },
  signal: AbortSignal.timeout(15000),
})
console.log('[⑧参数乱序]', jsum(await r8.arrayBuffer()))

console.log('探测3完成')
process.exit(0)
