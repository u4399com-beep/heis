// ============================================================
// 公开反馈提交 — POST 接收用户反馈, 不允许 GET 列表
// 防滥用: 内容 URL 数量上限 / 全大写检测 / 同 IP 1 小时上限 5 条
// 入库字段: type / contact / content / url / siteId / userAgent / ip
// ============================================================
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, str } from '../../_lib/http'

export const dynamic = 'force-dynamic'

const VALID_TYPES = new Set(['bug', 'suggestion', 'praise', 'other'])
const CONTENT_MIN = 5
const CONTENT_MAX = 1000
const CONTACT_MAX = 100
const URL_MAX = 2000
const URL_REGEX = /https?:\/\/\S+/gi
const URL_LIMIT = 3
const IP_HOUR_LIMIT = 5
const HOUR_MS = 60 * 60 * 1000

function clientIp(req: Request): string {
  // 优先 x-forwarded-for 第一段; 兜底 req.ip(Next.js 16 Route Handler 可读)
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  // Next 16 Route Handler 上 request.ip 不可读时降级空串
  const rip = (req as Request & { ip?: string }).ip
  return rip ? String(rip).slice(0, 64) : ''
}

function isAllCaps(s: string): boolean {
  // 仅当含字母且全为大写 → 视为 shouting
  const letters = s.replace(/[^A-Za-z]/g, '')
  if (letters.length < 6) return false
  return letters === letters.toUpperCase()
}

function countUrls(s: string): number {
  return (s.match(URL_REGEX) || []).length
}

export async function POST(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const siteId = str(url.searchParams.get('site'), 64).trim() || null
    const body = await readBody<Record<string, any>>(req)

    const type = str(body?.type, 20).trim()
    if (!VALID_TYPES.has(type)) return fail('反馈类型不合法')

    const content = str(body?.content, CONTENT_MAX).trim()
    if (content.length < CONTENT_MIN) return fail(`反馈内容至少 ${CONTENT_MIN} 个字符`)
    if (content.length > CONTENT_MAX) return fail(`反馈内容不能超过 ${CONTENT_MAX} 个字符`)

    const contact = str(body?.contact, CONTACT_MAX).trim()
    const feedbackUrl = str(body?.url, URL_MAX).trim()

    // 基础反垃圾: URL 数量 / 全大写 / 同 IP 频率
    const urlCount = countUrls(content)
    if (urlCount > URL_LIMIT) return fail('反馈内容包含过多链接, 请精简后重试')
    if (isAllCaps(content)) return fail('反馈内容请勿全部大写')

    const ip = clientIp(req)
    const userAgent = req.headers.get('user-agent')?.slice(0, 500) || null

    if (ip) {
      // 同 IP 1 小时上限: 简单计数 (无 Redis 依赖, 直接查 DB)
      const since = new Date(Date.now() - HOUR_MS)
      const cnt = await db.feedback.count({ where: { ip, createdAt: { gte: since } } })
      if (cnt >= IP_HOUR_LIMIT) return fail('提交过于频繁, 请稍后再试', 429)
    }

    const fb = await db.feedback.create({
      data: {
        type,
        contact: contact || null,
        content,
        url: feedbackUrl || null,
        siteId,
        userAgent,
        ip: ip || null,
        status: 'new',
      },
      select: { id: true },
    })

    return ok({ id: fb.id })
  })
}

export function GET() {
  // 公开接口不允许列表
  return fail('Method Not Allowed', 405)
}
