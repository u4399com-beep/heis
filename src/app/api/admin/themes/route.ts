// 主题模板列表
import { ok } from '@/lib/api'
import { THEMES } from '@/lib/crawl/themes'
import { withGuard } from '../../_lib/http'

export async function GET() {
  return withGuard(async () => {
    return ok(THEMES)
  })
}
