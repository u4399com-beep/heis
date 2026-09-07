// ============================================================
// ee-b 四段验证 ×2 遍 — iidcr.com(稻草人书屋) 库内规则回归
// 过线标准: list≥10本 / book 全字段 name+author+intro / toc≥50章 / content 清洗后≥2000字符
// 附加报告项(不设门槛): book 全字段透出(status/latestChapter/cover) + 大书目录 p25202
// 运行: bun scripts/verify-ee-b-foursection.ts
// ============================================================
export {}

const BASE = 'http://localhost:3000'
const RULE_NAME = '稻草人书屋 (iidcr.com)'

const PROBE = {
  list: 'https://www.iidcr.com/nav/sublove-1.html',
  book: 'https://www.iidcr.com/book/p25225/',
  toc: 'https://www.iidcr.com/book/p25225/',
  content: 'https://www.iidcr.com/book/p25225/7231478.html',
  tocBig: 'https://www.iidcr.com/book/p25202/',
}

interface Envelope { ok: boolean; message?: string; data?: any }
interface RuleRow { id: string; name: string; config: string }

async function api<T = Envelope>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  return (await res.json()) as T
}

async function loadRule(): Promise<{ id: string; cfg: Record<string, any> }> {
  const r = await api<{ ok: boolean; data?: RuleRow[] | { rules?: RuleRow[] } }>('/api/admin/rules?take=100')
  const arr = Array.isArray(r.data) ? r.data : (r.data as any)?.rules || []
  const row = arr.find((x: RuleRow) => x.name === RULE_NAME)
  if (!row) throw new Error(`库内规则未找到: ${RULE_NAME}`)
  return { id: row.id, cfg: JSON.parse(row.config) }
}

async function testSection(section: string, url: string, ruleSection: unknown, cfg: Record<string, any>): Promise<Record<string, any> | null> {
  const res = await api<Envelope>('/api/admin/rules/test', {
    method: 'POST',
    body: JSON.stringify({
      section, url, rule: ruleSection,
      // ★UA 门禁站必须显式带规则 fetch 配置(customUa 移动 UA): 缺省 auto+rotate 池
      // 桌面 UA 占多数 → 深路径随机 403 → auto 链切 browser 仍 403 → count=0 假绿
      // (首遍实证, 见脚本头注释); clean 随 content 段清洗口径一致
      fetch: cfg.fetch,
      clean: cfg.clean,
    }),
  })
  if (!res.ok) {
    console.log(`  [${section}] ❌ ${res.message}`)
    return null
  }
  const d = res.data as Record<string, any>
  if (section === 'list') console.log(`  [list] ✅ engine=${d.engine} count=${d.count} ${d.ms}ms`)
  else if (section === 'book') console.log(`  [book] ✅ engine=${d.engine} ${d.ms}ms fields=${JSON.stringify(d.fields)}`)
  else if (section === 'toc') console.log(`  [toc] ✅ engine=${d.engine} count=${d.count} pages=${d.pages} ${d.ms}ms`)
  else console.log(`  [content] ✅ engine=${d.engine} pages=${d.pages} raw=${d.rawLength} clean=${d.cleanedLength} ${d.ms}ms`)
  return d
}

async function main() {
  const { id, cfg } = await loadRule()
  console.log(`== iidcr 四段验证 ×2 遍 (rule id=${id}) ==`)
  let allPass = true

  for (let pass = 1; pass <= 2; pass++) {
    console.log(`--- 第 ${pass} 遍 ---`)
    const list = await testSection('list', PROBE.list, cfg.list, cfg)
    if (!list || (list.count as number) < 10) allPass = false

    const book = await testSection('book', PROBE.book, cfg.book, cfg)
    if (!book?.fields?.name || !book?.fields?.author || !book?.fields?.intro) allPass = false

    const toc = await testSection('toc', PROBE.toc, cfg.toc, cfg)
    if (!toc || (toc.count as number) < 50) allPass = false

    const content = await testSection('content', PROBE.content, cfg.content, cfg)
    if (!content || (content.cleanedLength as number) < 2000) allPass = false

    // 附加报告项: 大书目录(不设门槛)
    await testSection('toc', PROBE.tocBig, cfg.toc, cfg)

    if (pass === 1) await new Promise((r) => setTimeout(r, 1500))
  }

  console.log(allPass ? '✅ 四段验证 ×2 遍全过线' : '❌ 存在未过线段落')
  if (!allPass) process.exit(2)
}

main().catch((e) => { console.error('verify ERROR', e); process.exit(1) })
