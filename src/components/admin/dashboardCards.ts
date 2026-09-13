// 仪表盘卡片开关配置
export const DASHBOARD_CARD_KEYS = ['health', 'miniServices', 'insights', 'stats', 'trends', 'tasks', 'categories'] as const
export type DashboardCardKey = typeof DASHBOARD_CARD_KEYS[number]

export const DASHBOARD_CARD_META: Record<DashboardCardKey, { label: string; desc: string }> = {
  health: { label: '服务健康', desc: 'Mini-services 运行状态' },
  miniServices: { label: '代理服务', desc: '6+1 采集代理健康指标' },
  insights: { label: '采集洞察', desc: '今日采集/任务队列/规则健康度/错误摘要' },
  stats: { label: '采集统计', desc: '书籍/章节/字数总量' },
  trends: { label: '7天趋势', desc: '近7天采集趋势图' },
  tasks: { label: '任务概览', desc: '运行中/暂停/待执行任务' },
  categories: { label: '分类分布', desc: '书库分类分布图' },
}

export const DASHBOARD_CARDS_DEFAULT = new Set<DashboardCardKey>(DASHBOARD_CARD_KEYS)

export function parseDashboardCards(raw: unknown): Set<DashboardCardKey> {
  if (!raw) return new Set(DASHBOARD_CARDS_DEFAULT)
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return new Set(DASHBOARD_CARDS_DEFAULT)
    const valid = arr.filter((k: string) => DASHBOARD_CARD_KEYS.includes(k as DashboardCardKey)) as DashboardCardKey[]
    return valid.length > 0 ? new Set(valid) : new Set(DASHBOARD_CARDS_DEFAULT)
  } catch { return new Set(DASHBOARD_CARDS_DEFAULT) }
}

export function serializeDashboardCards(set: Set<DashboardCardKey>): string[] {
  return DASHBOARD_CARD_KEYS.filter((k) => set.has(k))
}
