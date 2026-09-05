// bb-e 修复验证: admin/chapters/[id] PUT 仅改标题时 txt 章节正文被清空(数据丢失)
// 修前: PUT {title} → 文件正文被 (newContent ?? '') 覆盖为空 → GET content 丢正文 (FAIL)
// 修后: PUT {title} → 保留文件原正文(仅换标题) → GET content 仍含全部正文 (PASS)
// 回归: PUT {title, content} 正常编辑路径行为不变
import { db } from '../src/lib/db'
import { promises as fs } from 'fs'
import path from 'path'

const BASE = 'http://localhost:3000'
const MARK1 = 'bb-e第一段正文不应被清空。'
const MARK2 = 'bb-e第二段正文同样保留。'

async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(BASE + url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json: any = null
  try { json = await res.json() } catch { /* ignore */ }
  return { status: res.status, json }
}

async function main() {
  const results: { name: string; pass: boolean; detail: string }[] = []
  let bookId = ''
  let chId = ''
  try {
    // ---- 准备: txt 存储书 + 章节 + 落盘文件 ----
    const book = await db.book.create({
      data: { name: 'bb-e探针书(可删)', author: 'bb-e', storageMode: 'txt', sourceUrl: '' },
    })
    bookId = book.id
    const rel = path.join('novels', bookId, '00001_bb-e-probe.txt')
    const ch = await db.chapter.create({
      data: { bookId, idx: 1, title: '旧标题', url: '', storage: 'txt', filePath: rel, wordCount: 20, fetched: true },
    })
    chId = ch.id
    const full = path.join(process.cwd(), 'data', rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, `旧标题\n\n${MARK1}\n${MARK2}\n`, 'utf-8')

    // ---- 用例1: 仅改标题(不带 content) → 正文必须保留 ----
    const put1 = await api('PUT', `/api/admin/chapters/${chId}`, { title: 'bb-e新标题' })
    const get1 = await api('GET', `/api/admin/chapters/${chId}`)
    const content1: string = get1.json?.data?.content ?? ''
    const pass1 = put1.status === 200 && content1.includes(MARK1) && content1.includes(MARK2)
    results.push({
      name: '仅改标题保留正文',
      pass: pass1,
      detail: `PUT status=${put1.status} content(${content1.length}字)=${JSON.stringify(content1.slice(0, 60))}`,
    })

    // ---- 用例2(回归): title+content 正常编辑 → 文件与读取均为新正文 ----
    const put2 = await api('PUT', `/api/admin/chapters/${chId}`, { title: 'bb-e新标题2', content: `全新的正文内容。\n${MARK1}` })
    const get2 = await api('GET', `/api/admin/chapters/${chId}`)
    const content2: string = get2.json?.data?.content ?? ''
    const pass2 = put2.status === 200 && content2.includes('全新的正文内容') && content2.includes(MARK1)
    results.push({
      name: '标题+正文正常编辑',
      pass: pass2,
      detail: `PUT status=${put2.status} content(${content2.length}字)=${JSON.stringify(content2.slice(0, 60))}`,
    })

    // ---- 用例3(回归): db 存储章节 title+content 编辑不受影响(再建一本 db 书) ----
    const bookDb = await db.book.create({ data: { name: 'bb-e探针书db(可删)', author: 'bb-e', storageMode: 'db' } })
    const chDb = await db.chapter.create({
      data: { bookId: bookDb.id, idx: 1, title: 'db章节', url: '', storage: 'db', content: '<p>db正文</p>', wordCount: 5, fetched: true },
    })
    const put3 = await api('PUT', `/api/admin/chapters/${chDb.id}`, { title: 'db章节改' })
    const get3 = await api('GET', `/api/admin/chapters/${chDb.id}`)
    const pass3 = put3.status === 200 && (get3.json?.data?.content || '').includes('db正文') && get3.json?.data?.title === 'db章节改'
    results.push({ name: 'db存储仅改标题不受影响', pass: pass3, detail: `PUT status=${put3.status} title=${get3.json?.data?.title} content=${get3.json?.data?.content}` })
    await db.book.delete({ where: { id: bookDb.id } })

    // ---- 汇总 ----
    let failed = 0
    for (const r of results) {
      if (!r.pass) failed++
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  —  ${r.detail}`)
    }
    console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
    process.exitCode = failed === 0 ? 0 : 1
  } finally {
    // ---- 清理: 删书(级联章节)+删目录 ----
    try { if (chId) { /* 级联随书删除 */ } } catch { /* ignore */ }
    try { if (bookId) await db.book.delete({ where: { id: bookId } }) } catch { /* ignore */ }
    try { await fs.rm(path.join(process.cwd(), 'data', 'novels', bookId), { recursive: true, force: true }) } catch { /* ignore */ }
    try { await db.$disconnect() } catch { /* ignore */ }
  }
}

main()
