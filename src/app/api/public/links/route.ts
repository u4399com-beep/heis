// 前台页脚链接 — 友情链接(启用中, sortOrder 升序) + 站群链轮(实时随机)
// ?site=<siteId> 排除当前站, 链轮永不指向调用方自己
import { ok } from '@/lib/api'
import { withGuard, str } from '../../_lib/http'
import { computeWheelLinks, getPublicFriendLinks, getWheelConfig } from '@/lib/links'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const siteId = str(url.searchParams.get('site'), 64).trim()

    const [friend, cfg] = await Promise.all([getPublicFriendLinks(), getWheelConfig()])
    // 链轮实时随机: 仅取 status=true + inLinkWheel=true 的站, 排除当前站
    const wheel = cfg.enabled ? await computeWheelLinks(cfg, siteId || undefined) : []

    return ok({
      friend,
      wheel,
      wheelEnabled: cfg.enabled,
      mode: cfg.mode,
      count: cfg.count,
    })
  })
}
