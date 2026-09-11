// 导出失败书籍 URL 列表 (agent-H-features)
// GET 返回 text/plain: 失败书籍 URL 一行一条, 供浏览器下载 .txt。
// 数据来源: DB progress.failedBookUrls(运行中也会定期落库, 是最新的稳定副本);
// 内存态 failedBookUrls Set 不直接序列化给本端点(进度写入有 5~10s 落库延迟, 但导出场景可接受)
import { db } from '@/lib/db'
import { withGuard } from '../../../../_lib/http'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withGuard(async () => {
    const { id } = await params
    const task = await db.task.findUnique({ where: { id }, select: { id: true, name: true, progress: true } })
    if (!task) {
      return new Response('任务不存在', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    // 从 DB progress JSON 提取失败 URL 列表
    let urls: string[] = []
    try {
      const p = task.progress ? JSON.parse(task.progress) : {}
      if (p && Array.isArray(p.failedBookUrls)) {
        urls = (p.failedBookUrls as unknown[])
          .filter((u): u is string => typeof u === 'string' && u.length > 0 && u.length <= 2000 && /^https?:\/\//i.test(u))
      }
    } catch { /* 脏 progress 视为空 */ }

    // text/plain 响应; filename 用 ASCII 兜底, filename*=UTF-8''<encoded> 兜中文(浏览器优先用后者)
    const body = urls.length > 0 ? urls.join('\n') + '\n' : ''
    // ASCII fallback: 去除非字母数字/连字符/下划线外的字符, 保证 ByteString 兼容
    const asciiName = (task.name || 'task')
      .replace(/[^\w-]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 50) || 'task'
    const cnName = (task.name || 'task').slice(0, 50)
    const filename = `${asciiName}-failed-${urls.length}.txt`
    const filenameStar = `${encodeURIComponent(cnName)}-failed-${urls.length}.txt`
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filenameStar}`,
        'Cache-Control': 'no-store',
      },
    })
  })
}
