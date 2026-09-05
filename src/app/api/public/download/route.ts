// 成品TXT下载 — Node流式响应, 错误分支统一信封
import { db } from '@/lib/db'
import { fail } from '@/lib/api'
import { DATA_ROOT, DOWNLOADS_DIR } from '@/lib/crawl/storage'
import { createReadStream, promises as fsp } from 'fs'
import { Readable } from 'stream'
import { withGuard, str, safeJoin } from '../../_lib/http'

/** RFC5987: UTF-8 文件名用 filename*=UTF-8'' 传输, 另附 ASCII 回退 */
function contentDisposition(name: string): string {
  const encoded = encodeURIComponent(name).replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  const asciiFallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download.txt'
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const id = str(url.searchParams.get('id'), 64).trim()
    // book=<bookId>: 前台书籍页"TXT 下载"按书取最新已完成成品
    // (原先传 book.id 走 ?id= 任务通道, 永远查不到任务 → 恒 404 死链)
    const bookId = str(url.searchParams.get('book'), 64).trim()
    if (!id && !bookId) return fail('缺少id')

    const job = bookId
      ? await db.downloadJob.findFirst({
          where: { bookId, status: 'done', filePath: { not: null } },
          orderBy: { createdAt: 'desc' },
          include: { book: true },
        })
      : await db.downloadJob.findUnique({ where: { id }, include: { book: true } })
    if (!job || job.status !== 'done' || !job.filePath) {
      return fail('文件不存在或未生成完毕', 404)
    }
    // 路径穿越防护: filePath 仅允许落在 data/downloads/ 内
    const full = safeJoin(DATA_ROOT, job.filePath)
    if (!full || !full.startsWith(DOWNLOADS_DIR)) {
      return fail('文件路径非法', 400)
    }

    let stat
    try {
      stat = await fsp.stat(full)
      if (!stat.isFile()) throw new Error('not a file')
    } catch {
      return fail('文件不存在或已被清理', 404)
    }

    // Node 可读流 → Web 流; 出错时销毁防资源泄漏
    const nodeStream = createReadStream(full)
    nodeStream.on('error', (e) => {
      console.error('[api] download stream error:', e?.message)
      nodeStream.destroy()
    })
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>

    const fileName = `${job.book?.name || 'book'}_下载版.txt`
    return new Response(webStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': contentDisposition(fileName),
        'Content-Length': String(stat.size),
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
