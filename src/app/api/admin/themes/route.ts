// 主题模板列表
// - R10-1A: 单模式 API, 仅返回 THEMES 数组(精仿真实小说站点主题)
//   废弃 theme-matrix 1728 组合矩阵 + 分页模式; ThemesSection 单次加载全部
// - R13-1B: THEMES 数组扩为 10 套 (含 clone-trxsw 天人小说)
import { ok } from '@/lib/api'
import { THEMES } from '@/lib/crawl/themes'
import { withGuard } from '../../_lib/http'

export async function GET() {
  return withGuard(async () => ok(THEMES))
}
