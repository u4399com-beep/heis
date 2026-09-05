// ============================================================
// 小说TXT下载系统 — 混淆注入 / 广告插入 / 站点信息植入
// ============================================================
import { db } from '@/lib/db'
import { decodeEntitiesOnce } from './cleaner'
import { saveDownloadTxt, readChapterTxt, openDownloadTxtWriter } from './storage'

export interface DownloadOptions {
  /** 插入站点信息(头/尾/章末) */
  siteInfo: boolean
  siteName?: string
  siteUrl?: string
  /** 插入广告文案 */
  insertAds: boolean
  ads?: string[]
  /** 每N章插入一次广告 */
  adInterval?: number
  /** 文本混淆 */
  obfuscate: boolean
  /** zero-width: 零宽字符 | homoglyph: 同形字 | punctuation: 标点扰动 */
  obfuscateMode?: 'zero-width' | 'homoglyph' | 'punctuation' | 'mixed'
  /** 混淆密度 0-1 */
  obfuscateDensity?: number
  /** 自定义头部模板 {book} {author} {site} */
  headerTemplate?: string
  footerTemplate?: string
  /** 章节间分隔符 */
  chapterGap?: string
}

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
  siteInfo: true,
  insertAds: true,
  ads: ['本书由 {site} 收录整理，更多精彩好书请访问本站。', '记得收藏本书网址，防止迷路哦～'],
  adInterval: 10,
  obfuscate: true,
  obfuscateMode: 'zero-width',
  obfuscateDensity: 0.05,
  chapterGap: '\n\n',
  headerTemplate: '《{book}》\n作者：{author}\n来源：{site}\n\n简介：{intro}\n\n==================\n',
  footerTemplate: '\n==================\n全书完 —— 由 {site} 提供下载',
}

// ---------- 混淆 ----------
const ZW_CHARS = ['\u200b', '\u200c', '\u200d', '\u2060']
const HOMOGLYPHS: Record<string, string> = {
  '一': '㇐', '二': '㇑', '人': '𛲟', '于': '於', '今': '令', '门': '門', '间': '間',
  '东': '東', '车': '車', '长': '長', '见': '見', '说': '說', '请': '請', '读': '讀',
}

function obfuscateText(text: string, mode: string, density: number): string {
  if (!text) return text
  const d = Math.min(Math.max(density, 0), 0.3)
  let out = ''
  // 安全性说明: for...of 按码点迭代(代理对不会拆半); 同形字分支仅在 HOMOGLYPHS[ch] 命中
  // (键全为 BMP 字符)时才 slice(0,-1), 因此零宽插入/替换永远落在完整码点边界上, 不会产生乱码半字符
  for (const ch of text) {
    out += ch
    if (Math.random() < d) {
      switch (mode) {
        case 'zero-width':
          out += ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)]
          break
        case 'homoglyph':
          if (HOMOGLYPHS[ch] && Math.random() < d * 8) out = out.slice(0, -1) + HOMOGLYPHS[ch]
          break
        case 'punctuation':
          // 修复: 原实现把 '，' 替换成同样的 '，'(无任何效果的空操作); 改为在标点后
          // 插入零宽字符 —— 不改变可见文本, 但同样扰动字符串指纹/复制比对
          if ('，。！？；：、'.includes(ch)) out += ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)]
          break
        case 'mixed':
          if (Math.random() < 0.5) out += ZW_CHARS[Math.floor(Math.random() * ZW_CHARS.length)]
          else if (HOMOGLYPHS[ch] && Math.random() < 0.3) out = out.slice(0, -1) + HOMOGLYPHS[ch]
          break
      }
    }
  }
  return out
}

function stripHtmlToText(html: string): string {
  if (!html) return ''
  const text = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  // qq-e2 修复: 实体改单遍解码(与 cleaner 主链同口径, decodeEntitiesOnce 共用) ——
  // 旧 replace 链 &amp; 规则先于 &lt;, "&amp;lt;" 被链式二次解码成 "<"(源站展示的
  // 转义字面量被吃掉); 单遍解码后恒保持字面量 "&lt;", 与浏览器展示语义一致
  return decodeEntitiesOnce(text)
}

/** html 内容转纯文本(章节存储可能是db的html或txt文件) */
async function chapterPlainText(ch: { content: string | null; filePath: string | null; storage: string; title: string }): Promise<string> {
  if (ch.storage === 'txt' && ch.filePath) {
    const raw = await readChapterTxt(ch.filePath)
    if (raw) {
      const lines = raw.split('\n')
      lines.splice(0, 1) // 去掉标题行
      return lines.join('\n').trim()
    }
    return ''
  }
  return stripHtmlToText(ch.content || '')
}

/** 生成整本书TXT
 *  gg-a 流式落盘改造: 原实现把全部 parts 在内存 join 后单次落盘(万章书数百 MB 峰值),
 *  改为 openDownloadTxtWriter 逐段 append 写盘 —— 组装语义(parts.join(chapterGap))与
 *  输出字节逐字节一致(verify-gg-a-txt-stream 以修前基准 diff 实证); 单章文本仍在内存
 *  逐章处理(与原实现相同), 全书级拼接峰值消除。中途失败 abort() 删除半成品,
 *  保持"失败即无成品文件"卫生语义
 *  kk-d 分卷结构: 章节携带 volume(kk-a 番茄规则提取)时, 在卷变化处插入独立卷标题行
 *  『══════ 卷名 ══════』(作为独立 part 参与流式 emit, 受 chapterGap 分隔; 卷行为结构性
 *  文本不做混淆, 空卷/旧书不插入 —— 输出与改前逐字节一致, verify-gg-a-txt-stream 回归保障) */
export async function generateBookTxt(
  bookId: string,
  optionsOverride: Partial<DownloadOptions>,
  defaultSiteName: string,
  defaultSiteUrl: string
): Promise<{ rel: string; size: number; chapters: number }> {
  const book = await db.book.findUniqueOrThrow({
    where: { id: bookId },
    include: { chapters: { orderBy: { idx: 'asc' } } },
  })
  const opts: DownloadOptions = { ...DEFAULT_DOWNLOAD_OPTIONS, ...optionsOverride }

  const siteName = opts.siteName || defaultSiteName || '小说站'
  const siteUrl = opts.siteUrl || defaultSiteUrl || ''
  const siteTag = siteUrl ? `${siteName}(${siteUrl})` : siteName

  const intro = stripHtmlToText(book.intro || '').split('\n')[0]?.slice(0, 200) || ''
  const header = (opts.headerTemplate || DEFAULT_DOWNLOAD_OPTIONS.headerTemplate!)
    .replaceAll('{book}', book.name)
    .replaceAll('{author}', book.author)
    .replaceAll('{site}', siteTag)
    .replaceAll('{intro}', intro)

  const siteInfoHeader = opts.siteInfo
    ? `【本书信息】\n书名：${book.name}\n作者：${book.author}\n分类：${book.status === 'completed' ? '完结' : '连载'}\n字数：约${Math.round(book.wordCount / 10000)}万字\n来源：${siteTag}\n\n==================\n`
    : ''

  let ads = (opts.ads || []).map((a) => a.replaceAll('{site}', siteTag).replaceAll('{book}', book.name).replaceAll('{author}', book.author))
  if (opts.insertAds && ads.length === 0) {
    ads = DEFAULT_DOWNLOAD_OPTIONS.ads!.map((a) => a.replaceAll('{site}', siteTag))
  }

  // adInterval 合法化: 仅接受正数, 否则回退默认 10。原 Math.max(1, opts.adInterval || 10)
  // 会把负数钳成 1 —— 反而变成"每章都插广告"的极端行为(比不设防更糟)
  const adEvery = typeof opts.adInterval === 'number' && Number.isFinite(opts.adInterval) && opts.adInterval > 0
    ? Math.floor(opts.adInterval)
    : 10

  const footer = (opts.footerTemplate || DEFAULT_DOWNLOAD_OPTIONS.footerTemplate!)
    .replaceAll('{site}', siteTag)
    .replaceAll('{book}', book.name)
    .replaceAll('{author}', book.author) // 修复: 尾部模板原先不支持 {author}/{intro}, 用户写了会残留原样字面量
    .replaceAll('{intro}', intro)

  // zz-d 修复(并发同书互踩): 文件名原为 book.name + Date.now(), 同一毫秒内并发生成同一本书
  // (双击连发/脚本重放; 并发上限为全局 3 而非按书去重) → downloadTxtTarget 产出同一路径,
  // fs.open('w') 两路句柄写同一文件互相截断/交错 → 成品损坏且两个任务均报 done。补进程内
  // 随机段消解毫秒碰撞(与封面命名 book_${Date.now()}_${random} 同款做法); 单发常规路径
  // 文件名仅多一段随机后缀, 读回走 job.filePath 不受影响
  const writer = await openDownloadTxtWriter(`${book.name}_${Date.now()}_${Math.floor(Math.random() * 100000)}`)
  // emit ≡ parts.push: 首段直接写, 后续段先写分隔符再写段(≡ parts.join(gap) 的增量形态)
  const gap = opts.chapterGap || '\n\n'
  let first = true
  const emit = async (part: string) => {
    if (first) { first = false; await writer.write(part) }
    else { await writer.write(gap + part) }
  }

  try {
    await emit(header)
    if (opts.siteInfo) await emit(siteInfoHeader)

    let count = 0
    // qq-e 修复: 卷头判重基准改为「上一个已输出卷头」而非「上一章卷名」——
    // 原实现 prevVolume 被空卷名章节无条件清零, 同卷章节间夹带未提卷的章节
    // (源站 volume 字段部分缺失/reorderToc 把无号章挂进卷组后 DB 卷名仍为空)时,
    // 后续同卷章每次都重发『══════ 卷名 ══════』, 万章书可产生几十个重复卷头。
    // lastEmittedVolume 语义: 空卷名不重置基准; 真正换卷(v2)/卷回归(v1)仍正确插头。
    let lastEmittedVolume = ''
    for (const ch of book.chapters) {
      count++
      let text = await chapterPlainText(ch as any)
      if (!text) continue

      // 分卷结构: 卷变化处插入卷标题行(volume 为空不插, 仅对有正文的章节生效防孤儿卷头;
      // 空卷名不重置判重基准 —— 详见上方 qq-e 修复注释)
      const vol = (ch as { volume?: string }).volume || ''
      if (vol && vol !== lastEmittedVolume) {
        await emit(`══════ ${vol} ══════`)
        lastEmittedVolume = vol
      }

      if (opts.obfuscate) {
        text = obfuscateText(text, opts.obfuscateMode || 'zero-width', opts.obfuscateDensity ?? 0.05)
      }

      await emit(`\n${ch.title}\n\n${text}`)

      if (opts.siteInfo && count % 5 === 0) {
        await emit(`\n—— 本章节由 ${siteTag} 整理 ——`)
      }
      if (opts.insertAds && ads.length > 0 && count % adEvery === 0) {
        await emit(`\n\n【${ads[Math.floor(Math.random() * ads.length)]}】`)
      }
    }

    await emit(footer)
  } catch (e) {
    await writer.abort() // 半成品清理: 与原实现"失败即无文件"一致
    throw e
  }

  const { rel, size } = await writer.finish()
  return { rel, size, chapters: book.chapters.length }
}
