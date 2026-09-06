// 成品TXT下载 — Node流式响应, 错误分支统一信封
import { db } from '@/lib/db'
import { fail } from '@/lib/api'
import { DATA_ROOT, DOWNLOADS_DIR } from '@/lib/crawl/storage'
import { open } from 'node:fs/promises'
import { Readable } from 'stream'
import path from 'path'
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
    // API-10: 加 path.sep 边界 —— 单纯 startsWith(DOWNLOADS_DIR) 会放行 /data/downloadsevil/... 类前缀碰撞
    const full = safeJoin(DATA_ROOT, job.filePath)
    if (!full || !full.startsWith(DOWNLOADS_DIR + path.sep)) {
      return fail('文件路径非法', 400)
    }

    // API-8: TOCTOU —— 修前先 fsp.stat(full) 再 createReadStream(full), 中间窗口文件被删/替换
    // 时 stat 通过但流打开失败, 或反之 stat 报 ENOENT 但文件其实在; 改为 fh.open 后 fh.stat 再
    // fh.createReadStream, fd 全程保持打开, 中间不会被外部 unlink 影响
    let fh
    try {
      fh = await open(full, 'r')
    } catch {
      return fail('文件不存在或已被清理', 404)
    }
    let stat
    let nodeStream
    try {
      stat = await fh.stat()
      if (!stat.isFile()) {
        await fh.close()
        return fail('文件不存在', 404)
      }
      // 以已持有的 fd 创建读流, 关闭责任由 stream 的 end/error 承接
      nodeStream = fh.createReadStream()
    } catch (e) {
      try { await fh.close() } catch { /* ignore */ }
      console.error('[api] download open/stat failed:', (e as Error)?.message)
      return fail('文件读取失败', 500)
    }

    // Node 可读流 → Web 流; 出错时销毁并关闭 fd 防资源泄漏
    nodeStream.on('error', (e) => {
      console.error('[api] download stream error:', e?.message)
      try { nodeStream.destroy() } catch { /* ignore */ }
      try { fh.close() } catch { /* fd already closed */ }
    })
    nodeStream.on('close', () => {
      try { fh.close() } catch { /* fd already closed */ }
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
