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
  // R26-1A P1 修复: bookId 路径穿越防御。bookId 通常为 Prisma cuid() (字母数字,
  // 25 字符固定形态), 但防御性 Coding: 剥除所有路径分隔符与父目录指针字符后
  // 才拼路径, 防 caller 侧误传 / DB 迁移 / 手工调用传入非法 ID 造成越出 NOVELS_DIR。
  // 同口径于 slug 处的剥除集, 但额外剥 ' . \0 与路径分隔符(Caddy 不会转发这些字符,
  // 但防御在源头)
  const safeBookId = String(bookId || '').replace(/[\\/\x00\s.]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown_book'
  const dir = path.join(NOVELS_DIR, safeBookId)
  await fs.mkdir(dir, { recursive: true })
  // 清洗控制字符(\x00-\x1f, 原 \s 不覆盖) + Windows 保留字符; 截断防超长文件名
  // (Bug 21 修复: 按码点截断: 直接 slice(0,80) 可能把 emoji 等 astral 字符的代理对拦腰
  // 斩断, 落盘出半字符乱码文件名; Array.from 按码点迭代后再 slice 才安全)
  const slug = Array.from(title.replace(/[\x00-\x1f\\/:*?"<>|\s]+/g, '_')).slice(0, 80).join('')
  const slugSafe = Array.from(slug).slice(0, 40).join('') || 'chapter'
  const fileName = `${String(idx).padStart(5, '0')}_${slugSafe}.txt`
  const filePath = path.join(dir, fileName)
  // R3-27: 标题强制单行 —— 源站标题偶含 \r\n(列表项跨行/HTML br 转文本时残留), 写入
  // "${title}\n\n${content}\n" 后会被分割成多行, 读取侧 readChapterTxt.split('\n').slice(1)
  // 会把标题尾行误当正文首段。落盘前剥成单行(替换 \r\n 为单空格)
  const safeTitle = title.replace(/[\r\n]+/g, ' ')
  // R26-1A P1 修复: 原子写入。原实现 fs.writeFile(filePath, ...) 非原子: 进程崩溃
  // / 磁盘满 / 写入中被信号中断 → 产出半成品文件被后续读取者读到损坏内容(公共
  // /api/public/read 章节接口直接读 filePath 返正文)。改为先写 .tmp 临时文件再 rename。
  // fs.rename 在 POSIX 同文件系统上是原子的(原子 inode 替换), 中间任何时点读者
  // 看到的都是【旧完整文件】或【新完整文件】之一, 永远看不到半成品。跨设备 rename
  // 会 fallback 到 copy+unlink(非原子), 但本场景 filePath 与 .tmp 同目录同设备, 安全。
  // 临时文件名加 PID + 随机段防并发同章节写入互踩(同一本书同章节并发采集场景)
  const tmpPath = `${filePath}.${process.pid}.${Math.floor(Math.random() * 1e9)}.tmp`
  try {
    await fs.writeFile(tmpPath, `${safeTitle}\n\n${content}\n`, 'utf-8')
    await fs.rename(tmpPath, filePath)
  } catch (e) {
    // 临时文件清理: rename 成功后 tmpPath 不存在, unlink 静默失败; rename 失败时
    // tmpPath 可能存在半成品(磁盘满/权限), 主动清避免泄漏(.tmp 文件不会被公共
    // API 读取, 但占用磁盘空间)
    try { await fs.unlink(tmpPath) } catch { /* tmp 不存在或已被 rename, 忽略 */ }
    throw e
  }
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
    const safeName = name.replace(/[^\w-]/g, '') || `cover_${Date.now()}_${Math.floor(Math.random() * 9999)}`
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

/** 下载成品文件名计算(openDownloadTxtWriter 共用口径):
 *  清洗控制字符 + 截断: 超长书名会导致 ENAMETOOLONG 直接抛错(按码点截断防代理对斩半) */
function downloadTxtTarget(name: string): { filePath: string; rel: string; fileName: string } {
  // Bug 21 修复: 原实现 .slice(0, 100) 按 UTF-16 code unit 截断, astral 字符(emoji/CJK 扩展)
  // 代理对被斩半 → 落盘出半字符乱码文件名。改为 Array.from 按码点迭代后再 slice。
  const base = Array.from(name.replace(/[\x00-\x1f\\/:*?"<>|\s]+/g, '_')).slice(0, 100).join('')
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
