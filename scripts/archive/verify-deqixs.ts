// ============================================================
// rr-a2 — deqixs.cc 全链路健康核查(终局断言脚本)
// 断言面:
//   A. 3014 代理 /health selfTestOk=true(离线确定性自检 5 项)
//   B. 代理 /content 真网拉一章 len>1000 且无 HTML 残渣/未解实体
//   C. 防开放代理 guard(非 deqixs 域 URL 必拒)  ← 收编自 probe-rr-a-deqixs 系列的 URL 形态定案
//   D. GBK 解码确定性(bun TextDecoder('gbk'))   ← 收编自 probe-rr-a-deqixs.ts ⑥
//   E. 规则在库(六段关键选择器逐一在位)
//   F. 生产任务章节数据入库(书名/章节数/抽样正文非空/任务 0 错误)
// 运行: bun scripts/verify-deqixs.ts   (需 dev 3000 + 3014 代理存活)
// ============================================================
export {}

const BASE = 'http://127.0.0.1:3000'
const PROXY = 'http://127.0.0.1:3014'
const RULE_ID = 'cmtmv3ai50004nsxbnyjn7z6g'
const RULE_NAME = '得奇小说网 (deqixs.cc)·直连+签名代理正文'
const TASK_ID = 'cmtmv5res0008nsxbacz9qsyv'
const TASK_NAME = '得奇小说网·捞尸人 单书实测(rr-a)'
const PROBE_CHAPTER = 'https://www.deqixs.cc/books/126/81417.html'
const MIN_CHAPTERS = 30 // 生产实测过线: ≥30 章正文非空

// HTML 残渣: 常见标签 + 未解实体(代理已 htmlToText+解实体, 纯文本不应再现)
const HTML_RESIDUE = /<\/?(?:p|div|br|span|img|script|style|a|b|i|em|strong|h[1-6]|dl|dd|dt)\b/i
const ENTITY_RESIDUE = /&(?:amp|lt|gt|quot|nbsp|#39|apos);/i

function noResidue(text: string): boolean {
  return !HTML_RESIDUE.test(text) && !ENTITY_RESIDUE.test(text)
}

let allPass = true
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) allPass = false
  console.log(`  ${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  console.log(`== deqixs 全链路健康核查 (rule=${RULE_ID}) ==`)

  // ---------- D. GBK 解码确定性(离线, 收编自 probe-rr-a-deqixs.ts ⑥) ----------
  console.log('[D] GBK 解码确定性')
  const gbk = 'gbk' as never // @types/bun Encoding 未收录 gbk, 与代理同款单点 cast
  const decoded = new TextDecoder(gbk).decode(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))
  check('GBK 字节 d6d0cec4 → "中文"', decoded === '中文')

  // ---------- A. 代理 /health ----------
  console.log('[A] 代理 /health')
  let selfTestOk = false
  try {
    const h = (await (await fetch(`${PROXY}/health`)).json()) as {
      ok: boolean; selfTestOk: boolean; selfTestDetail: string; upstreamReachable: boolean; upstream: number | null
    }
    selfTestOk = h.selfTestOk === true
    check('selfTestOk=true', selfTestOk, h.selfTestDetail)
    console.log(`     upstreamReachable=${h.upstreamReachable} upstream=${h.upstream}`)
  } catch (e) {
    check('代理 /health 可达', false, String(e).slice(0, 120))
  }

  // ---------- B. /content 真网拉一章 ----------
  console.log('[B] /content 真网实测')
  let contentOk = false
  try {
    const r = await fetch(`${PROXY}/content?u=${encodeURIComponent(PROBE_CHAPTER)}`)
    const j = (await r.json()) as { ok: boolean; aid: string; cid: string; len: number; content: string; error?: string }
    contentOk = r.status === 200 && j.ok === true && j.len > 1000 && noResidue(j.content)
    check(
      `len(${j.len})>1000 且无HTML残渣`,
      contentOk,
      `aid=${j.aid} cid=${j.cid} 头40=${JSON.stringify((j.content ?? '').slice(0, 40))}${j.error ? ` error=${j.error}` : ''}`,
    )
  } catch (e) {
    check('代理 /content 可达', false, String(e).slice(0, 120))
  }

  // ---------- C. 防开放代理 guard(收编自 probe 系列 URL 形态定案) ----------
  console.log('[C] 防开放代理 guard')
  try {
    const r = await fetch(`${PROXY}/content?u=${encodeURIComponent('https://evil.example.com/books/1/2.html')}`)
    const j = (await r.json()) as { ok: boolean; error?: string }
    check('非 deqixs 域 URL 被拒', r.status !== 200 && j.ok === false, `http=${r.status} error=${(j.error ?? '').slice(0, 80)}`)
  } catch (e) {
    check('guard 请求异常', false, String(e).slice(0, 120))
  }

  // ---------- E. 规则在库(六段关键选择器) ----------
  console.log('[E] 规则在库六段')
  let ruleId: string | null = null
  let cfg: Record<string, any> | null = null
  try {
    const list = (await (await fetch(`${BASE}/api/admin/rules?take=200`)).json()) as { ok: boolean; data?: { id: string; name: string; config: string }[] }
    const arr = Array.isArray(list.data) ? list.data : []
    const row = arr.find((x) => x.id === RULE_ID) ?? arr.find((x) => x.name === RULE_NAME)
    if (row) {
      ruleId = row.id
      cfg = JSON.parse(row.config)
    }
  } catch {
    /* 下方 check 报错 */
  }
  check(`规则在库(id=${ruleId ?? '缺'})`, !!cfg)
  if (cfg) {
    check('list: div.bookbox + /sort/1/{page}.html',
      cfg.list?.itemSelector?.expression === 'div.bookbox' && String(cfg.list?.urlTemplate).includes('/sort/1/{page}.html'),
      String(cfg.list?.urlTemplate))
    check('book: h1.booktitle + og:novel:status',
      cfg.book?.fields?.name?.expression === 'h1.booktitle' && String(cfg.book?.fields?.status?.expression).includes('og:novel:status'))
    check('toc: dd:not(.visible-xs) 排死锚 + 代理前缀',
      cfg.toc?.itemSelector?.expression === 'dl.chapterlist dd:not(.visible-xs)' &&
      String(cfg.toc?.fields?.url?.replaceTo).includes('127.0.0.1:3014/content?u='))
    check('content: json 字段 content', cfg.content?.fields?.content?.type === 'json' && cfg.content?.fields?.content?.expression === 'content')
    check('fetch: engine=http + hostGateLimit=2', cfg.fetch?.engine === 'http' && cfg.fetch?.hostGateLimit === 2)
    check('clean: adPatterns 非空 + plainText', Array.isArray(cfg.clean?.adPatterns) && cfg.clean.adPatterns.length > 0 && cfg.clean?.plainText === true,
      `adPatterns=${cfg.clean?.adPatterns?.length}`)
  }

  // ---------- F. 生产任务章节数据入库 ----------
  console.log('[F] 生产任务入库')
  let taskOk = false
  let taskErrors: number | null = null
  try {
    const t = (await (await fetch(`${BASE}/api/admin/tasks/${TASK_ID}`)).json()) as { ok: boolean; data?: Record<string, any> }
    const td = t.data
    if (td) {
      const stats = JSON.parse(String(td.stats || '{}')) as { errors?: number }
      const progress = JSON.parse(String(td.progress || '{}')) as Record<string, any>
      taskErrors = stats.errors ?? null
      taskOk = td.ruleId === RULE_ID && td.mode === 'single' && taskErrors === 0
      check(`任务在库 ruleId/mode 对 + errors=0`, taskOk,
        `name=${td.name} status=${td.status} errors=${taskErrors} contentDone=${progress.contentDone}/${progress.contentTotal}`)
      check('任务线程参数温和(1~2 线程)', td.threadMin === 1 && td.threadMax === 2, `interval=${td.intervalMin}~${td.intervalMax}ms`)
    } else {
      check(`任务在库(${TASK_NAME})`, false, 'API 未返回该任务')
    }
  } catch (e) {
    check('任务 API 可达', false, String(e).slice(0, 120))
  }

  // 章节数据 prisma 直查(与任务 API 口径互证)
  try {
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    const book = await prisma.book.findFirst({
      where: { OR: [{ sourceRuleId: ruleId ?? RULE_ID }, { sourceUrl: 'https://www.deqixs.cc/books/126/' }] },
      select: { id: true, name: true, author: true },
    })
    check('书在库: 捞尸人/纯洁滴小龙', !!book && book.name === '捞尸人' && book.author === '纯洁滴小龙',
      book ? `id=${book.id}` : '未找到')
    if (book) {
      const total = await prisma.chapter.count({ where: { bookId: book.id } })
      const fetched = await prisma.chapter.count({ where: { bookId: book.id, fetched: true } })
      const nonEmpty = await prisma.chapter.count({ where: { bookId: book.id, fetched: true, wordCount: { gt: 0 } } })
      check(`采入非空章节 ≥${MIN_CHAPTERS}`, nonEmpty >= MIN_CHAPTERS, `total=${total} fetched=${fetched} 非空=${nonEmpty}`)
      const samples = await prisma.chapter.findMany({
        where: { bookId: book.id, fetched: true, wordCount: { gt: 0 } },
        orderBy: { idx: 'asc' },
        take: 3,
        select: { idx: true, title: true, wordCount: true, content: true },
      })
      const samplesOk = samples.length === 3 && samples.every((s) => {
        const c = s.content ?? ''
        return c.length > 0 && noResidue(c)
      })
      check('抽样 3 章正文非空且无HTML残渣', samplesOk,
        samples.map((s) => `#${s.idx}「${s.title}」${s.wordCount}字`).join(' / '))
    }
    await prisma.$disconnect()
  } catch (e) {
    check('prisma 直查', false, String(e).slice(0, 120))
  }

  console.log(allPass ? '✅ deqixs 全链路断言全过' : '❌ deqixs 存在未过线断言')
  process.exit(allPass ? 0 : 2)
}

main().catch((e) => { console.error('verify ERROR', e); process.exit(1) })
