// 主题模板列表
// - feat-combo-theme-incremental: 双模式 API
//   默认(无 query): 返回 THEMES(12 个 preset)数组, 兼容 ThemesSection 卡片网格
//   ?page=N&size=M: 返回 { page, size, total, totalPages, items: [presets + combos] }
//   preset 在 items[0..11], 512 组合紧跟其后, 每页可取任意 size(默认 50, 上限 500)
//   组合主题用惰性切片生成(不长期驻留内存), 仅计算本页所需项后即丢
import { ok, num } from '@/lib/api'
import { THEMES } from '@/lib/crawl/themes'
import {
  TOTAL_COMBOS, sliceCombos, type ThemeListItem,
} from '@/lib/crawl/theme-matrix'
import { withGuard } from '../../_lib/http'

/** preset → ThemeListItem(与组合主题同形态) */
function presetToListItem(t: (typeof THEMES)[number]): ThemeListItem {
  return {
    id: t.id,
    name: t.name,
    desc: t.desc,
    layout: t.layout,
    dark: t.dark,
    read: t.read ? { layout: t.read.layout || 'classic' } : undefined,
    preview: t.preview,
  }
}

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    const pageRaw = url.searchParams.get('page')
    const sizeRaw = url.searchParams.get('size')
    // 双模式: 缺省无分页参数 → 数组(presets); 带分页参数 → 对象(presets+combos 分页)
    if (pageRaw === null && sizeRaw === null) {
      // 默认: 仅返回 presets(12 个) 数组, ThemesSection 卡片网格沿用原契约
      return ok(THEMES)
    }
    // 分页模式: presets + combos 合并分页
    const page = Math.max(1, num(pageRaw, 1))
    const size = Math.max(1, Math.min(500, num(sizeRaw, 50)))
    const presetCount = THEMES.length
    const total = presetCount + TOTAL_COMBOS
    const totalPages = Math.max(1, Math.ceil(total / size))
    const p = Math.max(1, Math.min(totalPages, page))
    const start = (p - 1) * size
    const end = start + size
    const items: ThemeListItem[] = []
    // [start, end) 区间: 跨越 preset 边界时同时填入 preset + combos
    if (start < presetCount) {
      for (let i = start; i < Math.min(end, presetCount); i++) {
        items.push(presetToListItem(THEMES[i]))
      }
    }
    // combos 区间(若 end 超出 preset 边界)
    if (end > presetCount) {
      const comboStart = Math.max(0, start - presetCount)
      const comboEnd = end - presetCount
      items.push(...sliceCombos(comboStart, comboEnd))
    }
    return ok({ page: p, size, total, totalPages, items })
  })
}
