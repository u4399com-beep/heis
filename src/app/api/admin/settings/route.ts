// 全局设置
import { db } from '@/lib/db'
import { ok, fail, readBody } from '@/lib/api'
import { withGuard, isPlainObject } from '../../_lib/http'
import { WHEEL_SETTING_KEY, invalidateLinksCache } from '@/lib/links'

/** key 白名单: 字母数字下划线点横线, 1~64位 */
const KEY_RE = /^[A-Za-z0-9_.-]{1,64}$/
/** 单个 value JSON 上限, 防DB膨胀 */
const VALUE_MAX = 100_000

async function readAllSettings(): Promise<Record<string, unknown>> {
  const rows = await db.setting.findMany()
  const settings: Record<string, unknown> = {}
  for (const r of rows) {
    try { settings[r.key] = JSON.parse(r.value) } catch { settings[r.key] = r.value }
  }
  return settings
}

export async function GET() {
  return withGuard(async () => {
    return ok(await readAllSettings())
  })
}

export async function PUT(req: Request) {
  return withGuard(async () => {
    const body = await readBody<Record<string, any>>(req)
    // 必须是纯对象(拒绝数组/标量直接当kv写库)
    if (!isPlainObject(body)) return fail('设置项必须是键值对象')
    const entries = Object.entries(body)
    if (entries.length === 0) return fail('没有需要保存的设置项')
    // 修复(y-c): 单 key 有 VALUE_MAX 上限但 key 数量不钳, 超大对象打成巨型事务
    // (前端每次只发 1~2 个 key, 上限 100 零影响)
    if (entries.length > 100) return fail('单次最多保存 100 个设置项')
    for (const [key, value] of entries) {
      if (!KEY_RE.test(key)) return fail(`非法的设置项 key: ${key.slice(0, 32)}`)
      let serialized: string
      try {
        serialized = JSON.stringify(value ?? null)
      } catch {
        return fail(`设置项 ${key} 不可序列化(含循环引用等)`)
      }
      if (serialized.length > VALUE_MAX) return fail(`设置项 ${key} 过大(上限100KB)`)
      await db.setting.upsert({
        where: { key },
        create: { key, value: serialized },
        update: { value: serialized },
      })
    }
    // 链轮配置变更 → 失效读侧缓存(友链/链轮配置 60s), 页脚立即生效
    if (entries.some(([key]) => key === WHEEL_SETTING_KEY)) invalidateLinksCache()
    return ok(await readAllSettings())
  })
}
