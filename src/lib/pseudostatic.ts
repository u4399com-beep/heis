// ============================================================
// 伪静态 URL 构建 — 站群跨站书籍页地址
// 两种风格:
//   id    → /book/{id}.html      (需反向代理/边缘 rewrite 配合, 当前未启用)
//   query → /?view=book&id={id}  (前台路由原生支持, 开箱可用)
// buildBookUrl 默认请求 id 风格; 伪静态未启用时统一回退查询串风格,
// 保证链轮/页脚等跨站链接始终落在可访问的真实路由上。
// ============================================================

export type BookUrlStyle = 'id' | 'query'

/** 伪静态是否已启用 (配置 /book/* rewrite 后置 true, 见 next.config.ts rewrites) */
export const PSEUDOSTATIC_ENABLED = false

/**
 * 构建书籍页路径 (不含域名)。
 * - style='id' 且伪静态启用 → /book/{id}.html
 * - 其余情况回退 → /?view=book&id={id}
 * bookId 为空时返回站点首页路径。
 */
export function buildBookUrl(bookId: string, style: BookUrlStyle = 'id'): string {
  const id = (bookId || '').trim()
  if (!id) return '/'
  if (style === 'id' && PSEUDOSTATIC_ENABLED) return `/book/${encodeURIComponent(id)}.html`
  return `/?view=book&id=${encodeURIComponent(id)}`
}
