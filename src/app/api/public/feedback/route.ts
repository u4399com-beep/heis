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
// R5-4: 公开路由 readBody 默认 5MB 上限对反馈接口仍过大 —— 500MB body 会先全量入内存才被
// req.json() 解析, 单次请求即可 OOM 进程(120 req/min × 500MB = 60GB/min)。
// 反馈字段全部已知上限(CONTENT_MAX+CONTACT_MAX+URL_MAX+type ≈ 4KB), 给 100KB 富余即可。
const FEEDBACK_MAX_BODY_BYTES = 100 * 1024

function clientIp(req: Request): string {
  // R4A-2: 优先 TCP 套接字 IP(req.ip) —— 与 proxy.ts R3-30 修复同款, 防 XFF 头部伪造
  // 绕过同 IP 5条/小时 反垃圾限流(攻击者轮换 XFF 即可拥有无限配额)。XFF 仅作兜底。
  const sockIp = (req as Request & { ip?: string }).ip
  if (sockIp && sockIp.trim()) return sockIp.trim().slice(0, 64)
  // Next 16 Route Handler 上 request.ip 不可读时降级 XFF 首段
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  return ''
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
    const body = await readBody<Record<string, any>>(req, FEEDBACK_MAX_BODY_BYTES)

    const type = str(body?.type, 20).trim()
    if (!VALID_TYPES.has(type)) return fail('反馈类型不合法')

    // R3-36: 内容先剥 HTML 标签再校验长度 —— 防反馈正文里塞 <script>/<img onerror=...> 等
    // 载荷(管理员后台虽以纯文本渲染, 但反馈可能被回执邮件/RSS 等其他出口渲染成 HTML 时
    // 触发存储型 XSS)。剥后 slice(0, 1000) 兜底上限(CONTENT_MAX), 防 str() 上限失效场景
    const rawContent = str(body?.content, CONTENT_MAX).trim()
    const content = rawContent.replace(/<[^>]+>/g, '').slice(0, CONTENT_MAX).trim()
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
