// TXT下载任务 — 创建/列表
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { generateBookTxt, type DownloadOptions } from '@/lib/crawl/downloader'
import { withGuard, str, httpUrl, isPlainObject, clampInt } from '../../_lib/http'

const OBFUSCATE_MODES = ['zero-width', 'homoglyph', 'punctuation', 'mixed'] as const

/** 并发生成上限(gg-a): 全量生成是分钟级重活(逐章读盘+混淆), 无上限时刷 POST 可同时
 *  起任意多个生成作业互相挤占 IO/内存。达到上限后新请求返回 429。
 *  batch 的 retry/regenerate 委托本 POST, 自动同享该上限 */
const MAX_CONCURRENT_DOWNLOAD_JOBS = 3
/** 本进程在途生成计数(gg-a): 与 DB count 取 max —— 检查后、建行前无 await(同步占位),
 *  关闭"并发请求同读 count=0 全部放行"的 TOCTOU 窗口; 进程重启归零由 DB count 兜底 */
let inFlightGenerations = 0
/** 陈旧在途任务判定: 生成循环与 POST 同进程, 服务重启会遗留永久 pending 的孤儿任务 ——
 *  不自愈会把并发额度永久占满。1h 未见终态(正常 41 章书生成秒级/万章书分钟级)视为孤儿,
 *  POST 入口顺带清扫置 error */
const STALE_DOWNLOAD_JOB_MS = 60 * 60 * 1000

export async function GET() {
  return withGuard(async () => {
    const jobs = await db.downloadJob.findMany({
      orderBy: { createdAt: 'desc' },
      include: { book: { select: { name: true, author: true } } },
    })
    return ok(jobs)
  })
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const body = await readBody(req)
    const bookId = str(body?.bookId, 64).trim()
    if (!bookId) return fail('请选择书籍')
    const book = await db.book.findUnique({ where: { id: bookId }, include: { _count: { select: { chapters: true } } } })
    if (!book) return fail('书籍不存在', 404)
    if (book._count.chapters === 0) return fail('该书暂无章节, 无法生成下载')

    // 陈旧在途任务清扫(gg-a): 服务重启遗留的永久 pending/running 孤儿不再占用并发额度
    try {
      const stale = await db.downloadJob.updateMany({
        where: {
          status: { in: ['pending', 'running'] },
          createdAt: { lt: new Date(Date.now() - STALE_DOWNLOAD_JOB_MS) },
        },
        data: { status: 'error', error: '生成中断(服务重启或进程退出), 请重新发起' },
      })
      if (stale.count > 0) console.warn(`[downloads] 清扫陈旧在途生成任务 ${stale.count} 条(超 ${Math.round(STALE_DOWNLOAD_JOB_MS / 60000)} 分钟无终态)`)
    } catch { /* 清扫失败不阻塞主流程 */ }

    const options: Partial<DownloadOptions> = {}
    if (body?.siteInfo !== undefined) options.siteInfo = !!body.siteInfo
    if (body?.siteName !== undefined) options.siteName = str(body.siteName, 100)
    if (body?.siteUrl !== undefined) {
      const u = httpUrl(body.siteUrl)
      if (body.siteUrl && !u) return fail('站点URL格式非法(需 http/https)')
      options.siteUrl = u || ''
    }
    if (body?.insertAds !== undefined) options.insertAds = !!body.insertAds
    if (Array.isArray(body?.ads)) {
      // tt-b: 数组元素类型窄化 — 非字符串元素(对象等)原会被 String() 化成 "[object Object]"
      // 混入成品正文, 仅接受字符串项
      options.ads = body.ads
        .filter((a: unknown) => typeof a === 'string')
        .slice(0, 20)
        .map((a: unknown) => str(a, 200))
        .filter(Boolean)
    }
    if (body?.adInterval !== undefined) options.adInterval = clampInt(body.adInterval, 10, 1, 1000)
    if (body?.obfuscate !== undefined) options.obfuscate = !!body.obfuscate
    if (body?.obfuscateMode !== undefined) {
      if (!(OBFUSCATE_MODES as readonly string[]).includes(body.obfuscateMode)) {
        return fail('无效的混淆模式')
      }
      options.obfuscateMode = body.obfuscateMode
    }
    if (body?.obfuscateDensity !== undefined) {
      options.obfuscateDensity = Math.min(1, Math.max(0, Number(body.obfuscateDensity) || 0))
    }
    if (body?.headerTemplate !== undefined) options.headerTemplate = str(body.headerTemplate, 5000)
    if (body?.footerTemplate !== undefined) options.footerTemplate = str(body.footerTemplate, 5000)

    // 并发占位(ii-a 引入, tt-b 挪序): 全部入参校验(纯同步段)通过后立即同步占位, 再做需要
    // await 的 DB 计数判定 —— 校验失败路径(fail return)不经过占位, 非法请求不烧额度。
    // mySlot 取自占位瞬间(JS 单线程同步自增, 原子), 判定不重读共享计数(并发请求彼此
    // 的占位会推高计数, 重读会让全体请求同判超限)
    const mySlot = ++inFlightGenerations

    // 并发上限(gg-a 引入, tt-b 真闭合): 修前"先 await DB count 再同步占位", 并发请求
    // 同读 count=N(<MAX) 后全部放行, TOCTOU 窗口可突破上限; 修后占位先行(同步无 await,
    // 先于 count 的并发窗口), 判定 = DB 计数(含跨进程/重启遗留孤儿, 不含本请求未建行)
    // ≥ MAX 或本请求占位序号 > MAX → 同进程内严格 ≤MAX, DB 计数仅兜底遗留孤儿
    const dbActive = await db.downloadJob.count({
      where: { status: { in: ['pending', 'running'] } },
    })
    if (dbActive >= MAX_CONCURRENT_DOWNLOAD_JOBS || mySlot > MAX_CONCURRENT_DOWNLOAD_JOBS) {
      inFlightGenerations-- // 429 路径回滚占位, 防额度虚耗
      return fail(`已有 ${MAX_CONCURRENT_DOWNLOAD_JOBS} 个下载任务进行中，请稍后再试`, 429)
    }

    let job
    try {
      job = await db.downloadJob.create({
        data: { bookId, options: JSON.stringify(options), status: 'pending' },
      })
    } catch (e) {
      inFlightGenerations-- // 建行失败回滚占位, 防额度虚耗
      throw e
    }

    // 同步生成(章节量大时也在后台异步完成, 通过轮询状态); finally 释放在途额度
    void (async () => {
      try {
        const site = await db.site.findFirst({ where: { isDefault: true } })
        const res = await generateBookTxt(bookId, options, site?.name || '小说站', site?.domain || '')
        await db.downloadJob.update({
          where: { id: job.id },
          data: { status: 'done', filePath: res.rel, size: res.size },
        })
      } catch (e: unknown) {
        try {
          await db.downloadJob.update({
            where: { id: job.id },
            data: { status: 'error', error: String(e instanceof Error ? e.message : e).slice(0, 300) },
          })
        } catch { /* 任务可能已被删除 */ }
      } finally {
        inFlightGenerations = Math.max(0, inFlightGenerations - 1)
      }
    })()

    return ok(job)
  })
}
