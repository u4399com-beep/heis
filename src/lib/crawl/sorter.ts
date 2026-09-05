// ============================================================
// 目录乱序重排 + 去重
// 从章节标题提取序号(第X章 / 纯数字 / 中文数字) → 自然排序
// 检测正序/倒序/乱序 → 统一重排为正序
// URL去重 + 章节名去重
// ============================================================
import { type TocItem } from './types'

const CN_NUM: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** 全角数字折叠(０-９ → 0-9): 部分源站目录用全角数字("第１２章"), 原实现完全不识别 →
 *  全部 NaN 进无号路径。仅折叠数字, 不做整体 NFKC(避免拉丁字母/标点折叠改变正则语义) */
function foldDigits(s: string): string {
  return s.replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
}

// ---------- 罗马数字(ll-c) ----------
// kk 轮卷锚点只认阿拉伯+中文数字, "Volume III"/"卷 IV"/Unicode 罗马字符(Ⅰ-ⅿ)目录的
// 卷锚点整体判空 → 卷标题被当无号章拍平排序。补罗马数字解析(NFKC 归一 Unicode 罗马字符)。
const ROMAN_VAL: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }

/** 罗马数字 → 阿拉伯数字(减前缀法; 大小写/Unicode 罗马字符经 NFKC 归一; 非法形态返回 NaN) */
export function romanToNumber(s: string): number {
  const u = (s || '').trim().normalize('NFKC').toUpperCase()
  if (!u || !/^[IVXLCDM]+$/.test(u)) return NaN
  let total = 0
  for (let i = 0; i < u.length; i++) {
    const cur = ROMAN_VAL[u[i]]
    const next = i + 1 < u.length ? ROMAN_VAL[u[i + 1]] : 0
    total += cur < next ? -cur : cur
  }
  return total
}

/** 卷号 token 判值: 中文/阿拉伯数字走 cnNumToNumber, 罗马字母(含 Unicode 罗马字符)走
 *  romanToNumber; 空串返回 NaN */
function volTokenToNumber(token: string): number {
  if (!token) return NaN
  return /^[0-9\uFF10-\uFF19零〇一二两三四五六七八九十百千万亿]+$/.test(token)
    ? cnNumToNumber(foldDigits(token))
    : romanToNumber(token)
}

/** 中文数字 → 阿拉伯数字 (支持 十/百/千/万/亿 与 "一零二四"式位值连写) */
export function cnNumToNumber(cn: string): number {
  if (!cn) return NaN
  let total = 0
  let section = 0 // 万以下当前段
  let num = 0
  // 修复: 连续数字位(中文数字或阿拉伯)按位值累加 —— 原实现对"一零二四/二〇二四/一二三"式
  // 连写只会取最后一个字(1024→4, 123→3); 引入 prevDigit 后 一零二四=1024, 一二三=123
  let prevDigit = false
  for (const ch of cn) {
    if (CN_NUM[ch] !== undefined) {
      num = prevDigit ? num * 10 + CN_NUM[ch] : CN_NUM[ch]
      prevDigit = true
    } else if (ch === '十') {
      section += (num || 1) * 10
      num = 0
      prevDigit = false
    } else if (ch === '百') {
      section += (num || 1) * 100
      num = 0
      prevDigit = false
    } else if (ch === '千') {
      section += (num || 1) * 1000
      num = 0
      prevDigit = false
    } else if (ch === '万') {
      // jj-d 修复: "万"前若已有"亿"段(如"一亿二千万"), 原实现 total=(section+num)*10000
      // 直接覆盖丢失亿位(1.2亿→2000万); 累加语义下 无亿段(常态"三万")结果不变
      total += (section + num) * 10000
      section = 0
      num = 0
      prevDigit = false
    } else if (ch === '亿') {
      total = (total + section + num) * 100000000
      section = 0
      num = 0
      prevDigit = false
    } else if (/[0-9]/.test(ch)) {
      num = num * 10 + parseInt(ch)
      prevDigit = true
    } else {
      return NaN
    }
  }
  return total + section + num
}

/** 从标题提取章节序号 */
export function extractChapterNo(title: string): number {
  if (!title) return NaN
  const t = foldDigits(title.trim())
  // ll-c 修复: 单位类拆两级 —— 章节单位([章节回集])优先于卷级单位([卷篇])。原实现单类
  // 左扫描, 混写标题"第二卷 第10章"先命中"第二卷"(卷属单位类) → 返回卷号 2 而非章号 10,
  // 卷字段组内全部混写章提号相同, 组内排序退化为原始顺序。纯卷标题([章节回集]不命中)
  // 仍走 [卷篇] 兜底, 拍平模式"第五卷"=5 的历史语义零回归。
  // tt-c 修复: 小数章号(如番外"第1.5章")原被字符类拦断(不含'.')→ 降级无号卷内垫底;
  // 扩展为可选小数段, 含 '.' 时走 parseFloat(排序比较用减法, 浮点安全)
  let m = t.match(/第\s*([0-9零〇一两一二三四五六七八九十百千万亿]+(?:\.[0-9]+)?)\s*[章节回集]/)
  if (m) {
    // 修复: 阿拉伯数字与中文单位混写(如"第1万2千章")时 parseInt 会在"万"处截断成 1,
    // 只要含中文单位一律走 cnNumToNumber(它同时能处理位值阿拉伯数字)
    const raw = m[1]
    const n = raw.includes('.')
      ? parseFloat(raw)
      : /[0-9]/.test(raw) && !/[零〇一二两三四五六七八九十百千万亿]/.test(raw)
        ? parseInt(raw)
        : cnNumToNumber(raw)
    if (!isNaN(n)) return n
  }
  m = t.match(/第\s*([0-9零〇一两一二三四五六七八九十百千万亿]+)\s*[卷篇]/)
  if (m) {
    const raw = m[1]
    const n = /[0-9]/.test(raw) && !/[零〇一二两三四五六七八九十百千万亿]/.test(raw)
      ? parseInt(raw)
      : cnNumToNumber(raw)
    if (!isNaN(n)) return n
  }
  // Chapter 12 / Chapter IV(ll-c: 罗马字母形态, 词边界防"chapter in"误判)
  m = t.match(/chapter\s*(\d+|[ivxlcdm]+)\b/i)
  if (m) {
    if (/^\d+$/.test(m[1])) return parseInt(m[1])
    const rn = romanToNumber(m[1])
    if (!isNaN(rn)) return rn
  }
  // 正文 第X
  m = t.match(/(?:^|[\s._-])(\d{1,6})(?:[\s._-]|$)/)
  if (m) return parseInt(m[1])
  return NaN
}

/**
 * kk-a: 卷锚点识别 —— 纯分卷标题(如"第一卷 北游"/"卷二"/"Volume 3")
 * 返回 { no: 卷号, name: 卷名 }; 非卷标题(含章节单位如"第一卷 第1章")返回 null。
 * 用途: reorderToc 分卷感知重排 —— 修前纯卷标题会走 extractChapterNo 被拍平进全局
 * 章号空间("第五卷"no=5 排到第5章旁, 多卷书目录被卷标题彻底打乱)。
 */
export function extractVolumeAnchor(title: string): { no: number; name: string } | null {
  if (!title) return null
  const t = foldDigits(title.trim())
  // 同时含章节单位 → 是章节标题, 不是卷锚点("第一卷 第1章 xxx"属章节)
  if (/第\s*[0-9零〇一二两三四五六七八九十百千万亿]+\s*[章节回集]/.test(t)) return null
  if (/chapter\s*\d+/i.test(t)) return null
  // 卷号 token: 中文/阿拉伯数字 或 罗马字母(含 Unicode 罗马字符 Ⅰ-ⅿ U+2160-217F, NFKC 归一)
  const NUM = '[0-9零〇一两一二三四五六七八九十百千万亿]+|[IVXLCDMivxlcdm]+|[\\u2160-\\u217F]+'
  // 第X卷/部/篇 [卷名]
  let m = t.match(new RegExp(`^第\\s*(${NUM})\\s*[卷部篇]\\s*(.*)$`))
  if (m) {
    const no = volTokenToNumber(m[1])
    if (!isNaN(no)) return { no, name: (m[2] || '').trim() || t }
  }
  // 卷X [卷名]
  m = t.match(new RegExp(`^卷\\s*(${NUM})\\s*(.*)$`))
  if (m) {
    const no = volTokenToNumber(m[1])
    if (!isNaN(no)) return { no, name: (m[2] || '').trim() || t }
  }
  // Volume 3 / Volume III [name]
  m = t.match(new RegExp(`^volume\\s*(${NUM})\\s*(.*)$`, 'i'))
  if (m) {
    const no = volTokenToNumber(m[1])
    if (!isNaN(no)) return { no, name: (m[2] || '').trim() || t }
  }
  return null
}

/** 从 volume 字段值或卷名提取卷号(取不到返回 NaN) */
function volumeNoOf(vol: string): number {
  const a = extractVolumeAnchor(vol || '')
  if (a) return a.no
  // 卷名不带"第X卷"前缀(如纯"北游")无法提号
  return NaN
}

/** 自然比较: 序号优先, 数字段自然比较 */
function naturalCompare(a: string, b: string): number {
  const na = extractChapterNo(a)
  const nb = extractChapterNo(b)
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb
  // 自然数字段比较
  const ra = a.match(/\d+/g)?.map(Number) || []
  const rb = b.match(/\d+/g)?.map(Number) || []
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) {
    if (ra[i] !== rb[i]) return ra[i] - rb[i]
  }
  return a.localeCompare(b, 'zh-CN')
}

/**
 * 乱序重排:
 * 1. URL去重(绝对化后), 章节名去重
 * 2. kk-a: 存在分卷上下文(TocItem.volume 字段或标题卷锚点) → 分卷感知重排
 *    (卷间按卷号/首现序, 卷内按章号; 纯卷标题锚定卷首, 不再拍平进章号空间)
 * 3. 提取序号成功比例高 → 按序号排序
 * 4. 检测倒序(前几项序号递减) → 翻转
 * 5. 无序号的保持相对顺序排后
 */
export function reorderToc(items: TocItem[]): TocItem[] {
  // ---- 去重 ----
  const seenUrl = new Set<string>()
  const seenTitle = new Set<string>()
  const deduped: TocItem[] = []
  for (const it of items) {
    const uKey = normalizeUrlKey(it.url)
    const tKey = it.title.trim()
    if (uKey && seenUrl.has(uKey)) continue
    if (tKey && seenTitle.has(tKey)) continue
    if (uKey) seenUrl.add(uKey)
    if (tKey) seenTitle.add(tKey)
    deduped.push(it)
  }

  // ---- kk-a: 分卷上下文检测 ----
  const hasFieldVolume = deduped.some((it) => !!(it.volume && it.volume.trim()))
  const hasAnchor = deduped.some((it) => extractVolumeAnchor(it.title) !== null)
  if (hasFieldVolume || hasAnchor) return reorderWithVolumes(deduped)

  return sortByChapterNo(deduped)
}

/** 卷内/无卷排序: 提取序号成功比例高→按序号, 否则自然比较+倒序检测(原 reorderToc 主逻辑原样保留, 零回归) */
function sortByChapterNo(deduped: TocItem[]): TocItem[] {
  // ---- 提取序号 ----
  const withNo = deduped.map((it, i) => ({ it, i, no: extractChapterNo(it.title) }))
  const validRatio = withNo.filter((w) => !isNaN(w.no)).length / Math.max(1, withNo.length)

  if (validRatio >= 0.6) {
    // 主序号排序; 无序号的按出现位置排
    withNo.sort((x, y) => {
      const xa = isNaN(x.no)
      const xb = isNaN(y.no)
      if (xa && xb) return x.i - y.i
      if (xa) return 1
      if (xb) return -1
      if (x.no !== y.no) return x.no - y.no
      return x.i - y.i
    })
    // 检测是否整体倒序来源(排序前原始顺序递减) — 排序后无需翻转, 序号升序即正序
  } else {
    // 无序号: 检测倒序(标题自然比较前30项是否递减)。
    // ll-c 守卫: 样本 <8 项不做翻转 —— 无号小列表(卷内"楔子/尾声/番外"组或极短目录)
    // 单次 localeCompare 即判整组翻转, 而 locale 码点序与阅读序无必然关系
    // (修前实测复现: 卷组[楔子,尾声]被翻成[尾声,楔子]); 样本不足时尊重源站顺序更安全。
    // ≥8 项时样本量足够, 既有整目录倒序检测语义不变(真站整卷倒序仍修复)。
    if (deduped.length < 8) return deduped
    const sample = deduped.slice(0, 30)
    let desc = 0
    let asc = 0
    for (let i = 1; i < sample.length; i++) {
      const c = naturalCompare(sample[i - 1].title, sample[i].title)
      if (c > 0) desc++
      else if (c < 0) asc++
    }
    const list = asc >= desc ? deduped : [...deduped].reverse()
    return list
  }

  return withNo.map((w) => w.it)
}

/**
 * kk-a: 分卷感知重排
 * - 分组: item.volume 字段定卷; 无字段时标题卷锚点开新卷, 其余归当前卷
 * - 卷间: 卷号升序(从 volume 值/锚点标题提取), 无号卷保持首现顺序; 首个无归属段排在最前
 * - 卷内: 锚点条目排最前(它是卷扉), 其余按原章号算法
 */
function reorderWithVolumes(items: TocItem[]): TocItem[] {
  interface Group { key: string; no: number; firstIdx: number; members: TocItem[] }
  const groups: Group[] = []
  const byKey = new Map<string, Group>()
  let cur: Group | null = null
  items.forEach((it, i) => {
    const fv = (it.volume || '').trim()
    const anchor = extractVolumeAnchor(it.title)
    if (fv) {
      // 字段定卷: 同名卷聚合(源站目录交叉/乱序时, 同卷章条目归入同一组), 卷间排序按卷号/首现序
      const key = `f:${fv}`
      let g = byKey.get(key)
      if (!g) {
        g = { key, no: volumeNoOf(fv), firstIdx: i, members: [] }
        groups.push(g)
        byKey.set(key, g)
      }
      g.members.push(it)
      cur = g // 后续无字段条目跟随最近出现的卷
    } else if (anchor) {
      // 纯卷标题: 自开新卷, 条目本身排卷首
      cur = { key: `t:${i}`, no: anchor.no, firstIdx: i, members: [it] }
      groups.push(cur)
    } else {
      if (!cur) {
        cur = { key: 'p:head', no: NaN, firstIdx: i, members: [] }
        groups.push(cur)
      }
      cur.members.push(it)
    }
  })

  // 卷间排序(kk-a 原版 + qq-e2 修正无号卷归位):
  // 有号卷按卷号升序(同号按首现序, groups 按首现序构建故 gi≡firstIdx 序)。
  // 无号卷(前言/作品相关/番外等)原实现"有号vs无号→无号恒在前", 位于目录尾部的
  // 无号卷(番外篇/最终话/后记, volume 字段或锚点提不出卷号)会被错插到全书最前
  // ([第一卷,第二卷,番外]→[番外,第一卷,第二卷])。改装配式归位:
  //   - 首个有号卷之前出现的无号组 → 排最前(前言/作品相关语义不变)
  //   - 其余无号组 → 紧跟其"源站前置有号卷"(firstIdx ≤ 本组 firstIdx 中最大者)之后
  //     (尾部番外跟在最后一卷后; 卷间夹注跟在当前卷后), 同槽位按首现序
  //   - 无有号卷时全部按首现序(纯无号卷书零回归)
  const numbered = groups.filter((g) => !isNaN(g.no))
    .sort((a, b) => (a.no !== b.no ? a.no - b.no : a.firstIdx - b.firstIdx))
  const unnumbered = groups.filter((g) => isNaN(g.no))
    .sort((a, b) => a.firstIdx - b.firstIdx)
  const firstNumIdx = numbered.length ? numbered[0].firstIdx : Infinity
  const afterPred = new Map<Group, Group[]>()
  const headGroups: Group[] = []
  for (const u of unnumbered) {
    if (u.firstIdx < firstNumIdx) { headGroups.push(u); continue }
    let pred: Group | null = null
    for (const n of numbered) {
      if (n.firstIdx <= u.firstIdx && (!pred || n.firstIdx > pred.firstIdx)) pred = n
    }
    if (!pred) headGroups.push(u) // 防御: firstNumIdx 守卫下不应发生
    else {
      const arr = afterPred.get(pred)
      if (arr) arr.push(u)
      else afterPred.set(pred, [u])
    }
  }
  const orderedGroups: Group[] = [...headGroups]
  for (const n of numbered) {
    orderedGroups.push(n)
    const arr = afterPred.get(n)
    if (arr) orderedGroups.push(...arr)
  }

  const out: TocItem[] = []
  for (const g of orderedGroups) {
    // 卷内: 锚点条目(纯卷标题)固定最前, 其余按章号算法
    const anchors = g.members.filter((m) => extractVolumeAnchor(m.title) !== null && !(m.volume && m.volume.trim()))
    const rest = g.members.filter((m) => !anchors.includes(m))
    out.push(...anchors)
    out.push(...sortByChapterNo(rest))
  }
  return out
}

function normalizeUrlKey(u: string): string {
  if (!u) return ''
  try {
    const url = new URL(u)
    return url.host + url.pathname.replace(/\/+$/, '') + url.search
  } catch {
    return u
  }
}
