// ============================================================
// 友情链接 + 站群链轮 — 服务端领域逻辑 (含 Prisma)
// ⚠️ 仅限服务端(API 路由)导入; 客户端组件禁止 import 本文件
//    (Prisma 会被打进客户端包), 常量请在前端本地另定义。
//
// 链轮设计 (SEO):
//   - 每次请求实时随机(洗牌), 服务端只缓存 友链列表+链轮配置 60s
//   - 链轮链接不加 nofollow/noreferrer (传递权重), 锚文本=站点标题/书名
//   - 排除当前站, 永不指向自己
//   - 宁缺毋滥: 填不满链位数就少给, 任何 URL 不重复
// ============================================================
import { db } from '@/lib/db'
import { buildBookUrl } from '@/lib/pseudostatic'

// ---------------- 链轮配置 ----------------

export type WheelMode = 'home' | 'book' | 'mixed'

export interface WheelConfig {
  enabled: boolean
  mode: WheelMode
  count: number
}

/** 链位数量边界 */
export const WHEEL_COUNT_MIN = 1
export const WHEEL_COUNT_MAX = 30
/** 链轮配置在 Setting 表中的 key */
export const WHEEL_SETTING_KEY = 'linkwheel'

const WHEEL_MODES: readonly WheelMode[] = ['home', 'book', 'mixed']
/** 链位数量缺省值 */
export const WHEEL_COUNT_DEFAULT = 6

/**
 * 链轮配置消毒: 任意来源(JSON/表单) → 合法 WheelConfig。
 * enabled 仅认 false 为关; mode 白名单外回退 home; count 钳制 1~30。
 */
export function sanitizeWheelConfig(raw: unknown): WheelConfig {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const mode = String(o.mode ?? '')
  const n = typeof o.count === 'number' ? o.count : Number(o.count)
  const count = Number.isFinite(n) ? Math.trunc(n) : NaN
  return {
    enabled: o.enabled !== false,
    mode: (WHEEL_MODES as readonly string[]).includes(mode) ? (mode as WheelMode) : 'home',
    count: Number.isFinite(count) ? Math.min(WHEEL_COUNT_MAX, Math.max(WHEEL_COUNT_MIN, count)) : WHEEL_COUNT_DEFAULT,
  }
}

// ---------------- 站点域名规范化 ----------------

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/

/**
 * 站点域名规范化(双保险): 去 scheme / 去路径与查询 / 去首尾杂字符, 小写输出。
 * 用于把 DB 中的 domain 兜底成纯 host 再拼跨站绝对地址; 非法返回 ''(调用方跳过该站)。
 * 例: "https://www.a.com/path?x=1" → "www.a.com"; "www.B.com:3000/" → "www.b.com:3000"
 */
export function normalizeSiteDomain(raw: string): string {
  let s = (raw || '').trim().toLowerCase()
  if (!s) return ''
  // 保险 1: URL 解析取 host(含端口)
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`)
    if (u.host) s = u.host
  } catch {
    // 落到保险 2
  }
  // 保险 2: 正则去协议残留 + 截断路径/查询/锚点
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].trim()
  if (!s || s.length > 253) return ''
  return DOMAIN_RE.test(s) ? s : ''
}

// ---------------- 链轮随机书籍 ----------------

export interface WheelBook {
  id: string
  name: string
}

/**
 * 随机挑选 N 本书 (总数→skip 随机单行 + notIn 去重 + 有界重试)。
 * 每个链位: count 总数 → 随机 skip → findFirst 单行, 已选中的书用 notIn 排除;
 * skip 落空(并发删除等)时重试, 有界(≤5次)防死循环; 书库耗尽即止(宁缺毋滥)。
 */
export async function pickRandomBooks(need: number, excludeIds: string[] = []): Promise<WheelBook[]> {
  const out: WheelBook[] = []
  if (need <= 0) return out
  const notIn = [...excludeIds]
  const RETRY = 5
  for (let i = 0; i < need; i++) {
    let picked: WheelBook | null = null
    for (let r = 0; r < RETRY; r++) {
      const where = notIn.length ? { id: { notIn } } : undefined
      const total = await db.book.count({ where })
      if (total <= 0) break // 去重后书库已空
      const skip = Math.floor(Math.random() * total)
      const row = await db.book.findFirst({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // 稳定排序使随机 skip 均匀有效
        skip,
        take: 1,
        select: { id: true, name: true },
      })
      if (row) {
        picked = row
        break
      }
      // 该 skip 恰好无行(极小概率竞态) → 换一个随机位重试
    }
    if (!picked) break // 书库不足: 不硬凑
    notIn.push(picked.id)
    out.push(picked)
  }
  return out
}

// ---------------- 链轮链接计算 ----------------

export interface WheelLink {
  /** 锚文本: 站点标题 / 书名 */
  text: string
  /** 跨站绝对地址 https://{domain}{path} */
  url: string
}

/** Fisher–Yates 洗牌(返回新数组) */
function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 计算站群链轮链接 (实时随机, 每次调用结果都不同):
 *  1. 候选站: status=true + inLinkWheel=true, 排除当前站, 洗牌定序
 *  2. 槽位规划: home=全主页槽 / book=全书籍槽 / mixed=主页·书籍交替
 *  3. 主页槽: 沿洗牌序轮转, 每站最多贡献一条主页链
 *  4. 书籍槽: 从主页槽消费完的位置继续轮转站点(同站可贡献不同书),
 *     每槽随机挑一本全局不重复的书, 地址 = https://{domain}{buildBookUrl(id)}
 *  5. 书库不足: 剩余书籍槽回退为「未用过」站点的主页链(每站一条)
 *  6. 任何 URL/域名不重复, 填不满就少给(宁缺毋滥)
 */
export async function computeWheelLinks(cfg: WheelConfig, excludeSiteId?: string): Promise<WheelLink[]> {
  if (!cfg.enabled || cfg.count <= 0) return []
  const sites = await db.site.findMany({
    where: {
      status: true,
      inLinkWheel: true,
      ...(excludeSiteId ? { id: { not: excludeSiteId } } : {}),
    },
    select: { id: true, name: true, title: true, domain: true },
  })
  if (!sites.length) return []
  const order = shuffled(sites)

  // 槽位规划
  const slots: Array<'home' | 'book'> = []
  for (let i = 0; i < cfg.count; i++) {
    slots.push(cfg.mode === 'home' ? 'home' : cfg.mode === 'book' ? 'book' : i % 2 === 0 ? 'home' : 'book')
  }

  const result: (WheelLink | null)[] = new Array(slots.length).fill(null)
  const seenUrls = new Set<string>()
  const homeUsedSiteIds = new Set<string>()

  // 3. 主页槽: 每站最多一条
  let cursor = 0
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] !== 'home') continue
    while (cursor < order.length) {
      const s = order[cursor++]
      const dom = normalizeSiteDomain(s.domain)
      if (!dom || homeUsedSiteIds.has(s.id)) continue
      const url = `https://${dom}/`
      if (seenUrls.has(url)) continue // 异常数据(同域名多行)防重复
      homeUsedSiteIds.add(s.id)
      seenUrls.add(url)
      const text = (s.title || s.name || dom).trim().slice(0, 60) || dom
      result[i] = { text, url }
      break
    }
  }

  // 4. 书籍槽: 轮转站点(同站可不同书), 全局不重复的书
  const bookSlotIdx = slots.reduce<number[]>((acc, s, i) => (s === 'book' ? (acc.push(i), acc) : acc), [])
  if (bookSlotIdx.length) {
    const books = await pickRandomBooks(bookSlotIdx.length)
    // 书籍槽站点轮转序: 优先「还没贡献过主页链」的站点(分散站点覆盖),
    // 供应不足时再绕回已用站点 — 同站可携带不同书
    const bookSites = [
      ...shuffled(order.filter((s) => !homeUsedSiteIds.has(s.id))),
      ...shuffled(order.filter((s) => homeUsedSiteIds.has(s.id))),
    ]
    for (let bi = 0; bi < bookSlotIdx.length && bi < books.length && bookSites.length > 0; bi++) {
      const b = books[bi]
      const s = bookSites[bi % bookSites.length]
      const dom = normalizeSiteDomain(s.domain)
      if (!dom) continue
      const url = `https://${dom}${buildBookUrl(b.id)}`
      if (seenUrls.has(url)) continue
      seenUrls.add(url)
      result[bookSlotIdx[bi]] = { text: (b.name || '未知书籍').trim().slice(0, 60), url }
    }

    // 5. 回退: 书库不足的书籍槽 → 未贡献过主页链的站点(每站一条, 宁缺毋滥)
    for (const idx of bookSlotIdx) {
      if (result[idx]) continue
      for (const s of order) {
        if (homeUsedSiteIds.has(s.id)) continue
        const dom = normalizeSiteDomain(s.domain)
        if (!dom) continue
        const url = `https://${dom}/`
        if (seenUrls.has(url)) continue
        homeUsedSiteIds.add(s.id)
        seenUrls.add(url)
        const text = (s.title || s.name || dom).trim().slice(0, 60) || dom
        result[idx] = { text, url }
        break
      }
    }
  }

  return result.filter((x): x is WheelLink => x !== null)
}

// ---------------- 读侧缓存 (60s) ----------------

export interface PublicFriendLink {
  id: string
  name: string
  url: string
  logo: string
}

const CACHE_TTL_MS = 60_000

interface LinksCache {
  at: number
  friend: PublicFriendLink[]
  wheelCfg: WheelConfig
}

let cache: LinksCache | null = null
let inflight: Promise<Omit<LinksCache, 'at'>> | null = null
/** 失效代际: 读取期间发生变更时, 不把读到的新鲜度写回缓存 */
let cacheVersion = 0

/** 配置/友链变更后调用, 立即失效读侧缓存 */
export function invalidateLinksCache(): void {
  cacheVersion++
  cache = null
  inflight = null
}

async function loadFresh(): Promise<Omit<LinksCache, 'at'>> {
  if (inflight) return inflight
  inflight = (async () => {
    const [friendRows, settingRow] = await Promise.all([
      db.friendLink.findMany({
        where: { enabled: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, url: true, logo: true },
      }),
      db.setting.findUnique({ where: { key: WHEEL_SETTING_KEY }, select: { value: true } }),
    ])
    let rawCfg: unknown = null
    if (settingRow?.value) {
      try {
        rawCfg = JSON.parse(settingRow.value)
      } catch {
        rawCfg = null
      }
    }
    return { friend: friendRows, wheelCfg: sanitizeWheelConfig(rawCfg) }
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}

async function loadCached(): Promise<Omit<LinksCache, 'at'>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { friend: cache.friend, wheelCfg: cache.wheelCfg }
  }
  const v0 = cacheVersion
  const fresh = await loadFresh()
  // 读取期间发生过失效(POST/PUT/DELETE 等) → 本轮结果可能已过时, 不写回缓存
  if (v0 === cacheVersion) {
    cache = { at: Date.now(), ...fresh }
  }
  return fresh
}

/** 启用中的友链 (sortOrder 升序), 60s 缓存 */
export async function getPublicFriendLinks(): Promise<PublicFriendLink[]> {
  return (await loadCached()).friend
}

/** 链轮配置 (Setting.linkwheel 消毒后), 60s 缓存 */
export async function getWheelConfig(): Promise<WheelConfig> {
  return (await loadCached()).wheelCfg
}
