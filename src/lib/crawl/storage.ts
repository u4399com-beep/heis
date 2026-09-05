// ============================================================
// 存储系统 — 章节TXT文件 / 封面webp转换 / 目录管理
// 章节可写库(SQLite)或生成txt文件存指定文件夹
// 封面统一下载转为 webp 格式存储
// ============================================================
import { promises as fs } from 'fs'
import path from 'path'
import sharp from 'sharp'

export const DATA_ROOT = path.join(process.cwd(), 'data')
export const NOVELS_DIR = path.join(DATA_ROOT, 'novels')
export const COVERS_DIR = path.join(DATA_ROOT, 'covers')
export const DOWNLOADS_DIR = path.join(DATA_ROOT, 'downloads')

export async function ensureDirs() {
  await Promise.all([
    fs.mkdir(NOVELS_DIR, { recursive: true }),
    fs.mkdir(COVERS_DIR, { recursive: true }),
    fs.mkdir(DOWNLOADS_DIR, { recursive: true }),
  ])
}

/** 章节txt存储: data/novels/{bookId}/{idx pad5}_{slug}.txt */
export async function saveChapterTxt(
  bookId: string,
  idx: number,
  title: string,
  content: string
): Promise<string> {
  await ensureDirs()
  const dir = path.join(NOVELS_DIR, bookId)
  await fs.mkdir(dir, { recursive: true })
  // 清洗控制字符(\x00-\x1f, 原 \s 不覆盖) + Windows 保留字符; 截断防超长文件名
  // (按码点截断: 直接 slice(0,40) 可能把 emoji 等 astral 字符的代理对拦腰斩断, 落盘出半字符乱码文件名)
  const slug = title.replace(/[\x00-\x1f\\/:*?"<>|\s]+/g, '_').slice(0, 80)
  const slugSafe = Array.from(slug).slice(0, 40).join('') || 'chapter'
  const fileName = `${String(idx).padStart(5, '0')}_${slugSafe}.txt`
  const filePath = path.join(dir, fileName)
  await fs.writeFile(filePath, `${title}\n\n${content}\n`, 'utf-8')
  return path.relative(DATA_ROOT, filePath) // 相对 data/ 的路径
}

export async function readChapterTxt(relPath: string): Promise<string | null> {
  try {
    const full = path.resolve(DATA_ROOT, relPath)
    // 修复: startsWith(DATA_ROOT) 存在同级目录前缀绕过(data vs data-covers),
    // 必须以 path.sep 结尾的前缀匹配才算落在数据目录内
    if (full !== DATA_ROOT && !full.startsWith(DATA_ROOT + path.sep)) return null
    return await fs.readFile(full, 'utf-8')
  } catch {
    return null
  }
}

export async function deleteBookTxt(bookId: string) {
  try {
    await fs.rm(path.join(NOVELS_DIR, bookId), { recursive: true, force: true })
  } catch { /* ignore */ }
}

/** 封面下载 → webp (sharp), 返回相对路径 covers/{name}.webp
 *  转换失败时降级: 先用宽容模式重试, 再失败则回存原始图片字节(公开封面接口按 .webp
 *  文件名提供服务, 浏览器 <img> 解码时按魔数嗅探实际格式, 不影响展示) */
export async function saveCoverWebp(
  buf: Buffer,
  name: string
): Promise<string | null> {
  try {
    await ensureDirs()
    if (!buf || buf.length === 0 || buf.length > 20 * 1024 * 1024) return null // 空文件/超大文件保护
    const safeName = name.replace(/[^\w-]/g, '') || `cover_${Date.now()}`
    const fileName = `${safeName}.webp`
    const filePath = path.join(COVERS_DIR, fileName)
    try {
      await sharp(buf)
        .resize(400, 533, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(filePath)
    } catch {
      // 降级1: 宽容模式(容忍截断/轻微损坏的图)
      try {
        await sharp(buf, { failOn: 'none' })
          .resize(400, 533, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toFile(filePath)
      } catch {
        // 降级2: 回存原始字节(保持 .webp 文件名以兼容封面接口的文件名白名单)
        await fs.writeFile(filePath, buf)
      }
    }
    return `covers/${fileName}`
  } catch (e) {
    console.warn('[storage] cover webp convert failed', e)
    return null
  }
}

export async function readCover(fileName: string): Promise<Buffer | null> {
  try {
    const safe = path.basename(fileName)
    const full = path.join(COVERS_DIR, safe)
    if (!full.startsWith(COVERS_DIR)) return null
    return await fs.readFile(full)
  } catch {
    return null
  }
}

/** 下载成品txt: data/downloads/{name}.txt */
export async function saveDownloadTxt(name: string, content: string): Promise<{ rel: string; size: number }> {
  const { filePath, rel } = downloadTxtTarget(name)
  await ensureDirs()
  await fs.writeFile(filePath, content, 'utf-8')
  const stat = await fs.stat(filePath)
  return { rel, size: stat.size }
}

/** 下载成品文件名计算(saveDownloadTxt 与 openDownloadTxtWriter 共用口径, 防两处漂移):
 *  清洗控制字符 + 截断: 超长书名会导致 ENAMETOOLONG 直接抛错(按码点截断防代理对斩半) */
function downloadTxtTarget(name: string): { filePath: string; rel: string; fileName: string } {
  const base = name.replace(/[\x00-\x1f\\/:*?"<>|\s]+/g, '_').slice(0, 100)
  const fileName = `${Array.from(base).slice(0, 80).join('')}.txt`
  const filePath = path.join(DOWNLOADS_DIR, fileName)
  return { filePath, rel: `downloads/${fileName}`, fileName }
}

/**
 * 下载成品流式写入器(gg-a): 逐段 append 写盘, 全书不再内存拼接后单次落盘 ——
 * 万章书的数百 MB 级 parts 数组峰值(原实现)对大书是生成即 OOM 的形态。
 * 用法: write(header/章节段…) → finish() 落定返回 {rel,size}; 中途失败 abort()
 * 删除半成品(与原实现"失败即无文件"卫生语义一致)。
 * 字节等价性: UTF-8 按码点编码无跨段状态, 分段写入与整串写入逐字节一致
 * (verify-gg-a-txt-stream 以修前基准 diff 实证)
 */
export interface DownloadTxtWriter {
  rel: string
  write(chunk: string): Promise<void>
  finish(): Promise<{ rel: string; size: number }>
  abort(): Promise<void>
}

export async function openDownloadTxtWriter(name: string): Promise<DownloadTxtWriter> {
  await ensureDirs()
  const { filePath, rel } = downloadTxtTarget(name)
  const fh = await fs.open(filePath, 'w')
  return {
    rel,
    async write(chunk: string) {
      if (!chunk) return
      await fh.write(chunk, undefined, 'utf-8')
    },
    async finish() {
      await fh.close()
      const stat = await fs.stat(filePath)
      return { rel, size: stat.size }
    },
    async abort() {
      try { await fh.close() } catch { /* 已关闭忽略 */ }
      try { await fs.unlink(filePath) } catch { /* ignore */ }
    },
  }
}
