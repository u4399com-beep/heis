// 书籍删除时的本地封面清理 (仅供 books/[id] 与 books/batch 复用)
// 语义: 仅处理 covers/*.webp 本地形态; 确认无其他书籍引用同一封面后才删文件
// (外链 http(s) 封面不涉及本地文件; 共享同一封面路径的多本书全删才清)
import { promises as fs } from 'fs'
import { db } from '@/lib/db'
import { COVERS_DIR } from '@/lib/crawl/storage'
import { safeJoin } from '../../_lib/http'

/** 尽力而为: 调用前书籍行应已删除(计数即剩余引用数); 任何失败静默跳过 */
export async function removeCoverIfOrphan(cover: string | null | undefined): Promise<void> {
  const c = (cover || '').trim()
  // 仅本地 covers/*.webp 形态(saveCoverWebp 的产物); 外链与其它路径不动
  if (!c.startsWith('covers/') || !c.endsWith('.webp')) return
  const refs = await db.book.count({ where: { cover: c } })
  if (refs > 0) return // 仍被其他书籍引用 → 保留
  const full = safeJoin(COVERS_DIR, c.slice('covers/'.length))
  if (!full || !full.startsWith(COVERS_DIR)) return // 路径边界兜底
  try {
    await fs.rm(full, { force: true })
  } catch {
    /* 尽力而为 */
  }
}
