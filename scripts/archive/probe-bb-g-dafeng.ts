// ============================================================
// Task bb-g 探针 — dafengdagengren "抽月票" 清洗收尾验证
// 用法: bun scripts/probe-bb-g-dafeng.ts [--use-seed]
//   默认: 取库内规则配置(修后应含 '抽月票' adPattern)
//   --use-seed: 直接用 seed 脚本内联配置(不依赖入库状态)
// 断言: 23409004 / 23409006 两章引擎级全文 "抽月票"×0 且 "捧场"×0, 尾部干净
// 附带: DB 内 dafeng 书籍/章节残留检查(只读)
// ============================================================
const BASE = 'http://localhost:3000'

const CHAPTERS = [
  'https://www.dafengdagengren.com/0_2/23409004.html',
  'https://www.dafengdagengren.com/0_2/23409006.html',
]

async function loadCfg(): Promise<{ fetchCfg: any; cleanCfg: any; contentCfg: any; source: string }> {
  if (process.argv.includes('--use-seed')) {
    const mod = await import('./seed-rule-dafengdagengren')
    // seed 脚本 main() 会跑测试+入库, 不能 import —— 改为直接读文件文本提取 config 太脆,
    // 这里改为: 从 seed 源码 eval 不安全; 直接读库内配置是主路径, seed 模式提示不支持
    void mod
    throw new Error('--use-seed 未实现: 请先跑 seed 入库后用库内配置验证(与生产路径一致)')
  }
  const res = await fetch(`${BASE}/api/admin/rules?take=100`)
  const json: any = await res.json()
  const rules: any[] = Array.isArray(json.data) ? json.data : json.data?.rules || []
  const rule = rules.find((r) => r.name === '大奉打更人 (dafengdagengren.com)')
  if (!rule) throw new Error('库内无 dafeng 规则')
  const cfg = typeof rule.config === 'string' ? JSON.parse(rule.config) : rule.config
  console.log(`库内规则 id=${rule.id} adPatterns=${JSON.stringify(cfg.clean?.adPatterns)}`)
  return { fetchCfg: cfg.fetch, cleanCfg: cfg.clean, contentCfg: cfg.content, source: `db:${rule.id}` }
}

async function main() {
  const { fetchPage } = await import('../src/lib/crawl/fetcher')
  const { parseContent } = await import('../src/lib/crawl/parser')
  const { cleanContentHtml } = await import('../src/lib/crawl/cleaner')
  const { fetchCfg, cleanCfg, contentCfg, source } = await loadCfg()
  console.log(`配置来源: ${source}`)

  let allPass = true
  for (const url of CHAPTERS) {
    const res = await fetchPage(url, fetchCfg)
    if (res.blocked) { console.log(`✗ ${url} 首抓被拦截`); allPass = false; continue }
    const parsed = await parseContent(url, res.html, contentCfg, fetchCfg)
    const cleaned = cleanContentHtml(parsed.content || '', cleanCfg)
    const text = cleaned
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const hits = {
      抽月票: (text.match(/抽月票/g) || []).length,
      求月票: (text.match(/求月票/g) || []).length,
      捧场: (text.match(/捧场/g) || []).length,
      月票: (text.match(/月票/g) || []).length,
      纵横币: (text.match(/纵横币/g) || []).length,
    }
    const pass = hits.抽月票 === 0 && hits.捧场 === 0
    if (!pass) allPass = false
    console.log(`\n${url}`)
    console.log(`  全文=${text.length}字 抽月票×${hits.抽月票} 求月票×${hits.求月票} 捧场×${hits.捧场} 月票×${hits.月票} 纵横币×${hits.纵横币} → ${pass ? '✅ 0残留' : '❌ 有残留'}`)
    console.log(`  尾部160字: ${JSON.stringify(text.slice(-160))}`)
  }

  // DB 残留检查(只读): dafeng 来源书籍/章节里 content 含"抽月票/捧场"的
  try {
    const { db } = await import('../src/lib/db')
    const books = await (db as any).book.findMany({ where: { OR: [{ sourceUrl: { contains: 'dafengdagengren' } }, { name: { contains: '逆天邪神' } }] }, select: { id: true, name: true, sourceUrl: true } })
    console.log(`\nDB 内 dafeng 来源/探针书籍: ${books.length} 本`)
    for (const b of books) {
      const chapCount = await (db as any).chapter.count({ where: { bookId: b.id } })
      const bad = await (db as any).chapter.count({ where: { bookId: b.id, content: { contains: '抽月票' } } })
      const bad2 = await (db as any).chapter.count({ where: { bookId: b.id, content: { contains: '捧场' } } })
      console.log(`  书 ${b.id} "${b.name}" 章节=${chapCount} 含'抽月票'章节=${bad} 含'捧场'章节=${bad2}`)
    }
    const tasks = await (db as any).task.findMany({ where: { name: { contains: '逆天' } }, select: { id: true, name: true, status: true } })
    console.log(`DB 内 dafeng 探针任务: ${tasks.length ? JSON.stringify(tasks) : '0'}`)
    await (db as any).$disconnect()
  } catch (e: any) {
    console.log(`DB 检查失败: ${e?.message?.slice(0, 200)}`)
  }

  console.log(allPass ? '\n✅ 两探针章 0 残留断言通过' : '\n❌ 存在残留, 清洗缺口仍在')
  if (!allPass) process.exit(2)
}

main()

export {}
