import { ok } from '@/lib/api'

export async function GET() {
  // 根路径健康检查 — 保持与全站一致的 {ok,data} 信封
  return ok({ message: 'Hello, world!' })
}
