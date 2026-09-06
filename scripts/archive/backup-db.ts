/**
 * 轻量 DB 备份 (mm 轮落地, ll-0 事故教训固化)
 * - sqlite3 backup API 在线备份(与运行中库一致性安全, 优于文件拷贝)
 * - 保留最近 10 份, 超出自动清理
 * - 用法: bun run scripts/backup-db.ts   (建议每轮开工/收官各跑一次)
 */
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/home/z/my-project'
const DB = join(ROOT, 'db/custom.db')
const DIR = join(ROOT, 'backups')
const KEEP = 10

mkdirSync(DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const target = join(DIR, `custom-${stamp}.db`)

const proc = Bun.spawnSync(['python3', '-c', `
import sqlite3
src = sqlite3.connect("${DB}")
dst = sqlite3.connect("${target}")
src.backup(dst)
dst.close(); src.close()
print("ok")
`])
if (proc.stdout.toString().trim() !== 'ok') {
  console.error('备份失败:', proc.stderr.toString().slice(0, 300))
  process.exit(1)
}

const files = readdirSync(DIR).filter((f) => f.startsWith('custom-') && f.endsWith('.db')).sort()
while (files.length > KEEP) unlinkSync(join(DIR, files.shift()!))
const size = statSync(target).size
console.log(`备份完成: ${target} (${(size / 1024 / 1024).toFixed(1)}MB), 现存 ${files.length} 份`)

// mm-theme: 补 export{} 模块化 + Bun 最小类型面(根 tsconfig 无 @types/bun, cc-d2 裁定)
export {}
declare const Bun: { spawnSync(cmd: string[], opts?: Record<string, unknown>): { success: boolean; exitCode: number; stdout: { toString(): string }; stderr: { toString(): string } } }
