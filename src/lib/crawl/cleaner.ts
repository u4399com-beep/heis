// ============================================================
// 内容清洗系统 — 广告清洗 / HTML标签规范 / 段落规整 / 繁体→简体
// 适用于 书籍信息 / 章节目录 / 章节内容
// ============================================================
import * as cheerio from 'cheerio'
import * as OpenCC from 'opencc-js'
import { type CleanConfig, DEFAULT_CLEAN_CONFIG } from './types'

// ---------- 繁体→简体转换(OpenCC, 采集源为繁体时自动启用) ----------
// 设计: 逐段检测"繁体独有字"命中才触发转换 —— 简体源站零误转, 繁体源站任意段落必然
// 高频命中。转换用 OpenCC 词组级词典(t→cn), 对已是简体的词组(如「乾隆」「乾坤」)有
// 短语保护, 不会误改。
// 强信号集: 差异字中再过滤掉"同形归并字"(t2s 会改写但 s2t 不回环的字, 如 乾→干/
// 係→系/唸→念 共 281 个) —— 这些字在规范简体中合法存在(乾隆/乾县/乾坤), 却会被
// OpenCC 字符级归并, 若作为触发信号则简体文本被误转换(乾县→干县)。过滤法: 双向回环
// 检测 s2t(t2s(ch))===ch 的字才是繁体特有字(書→书→書 ✓; 乾→干→幹 ✗ 被排除)。
// 注意: 转换只做单遍(不做不动点迭代) —— 含「乾」的文本(乾县/乾清宫等非词组保护词)
// 第二遍会被继续转成「干县」, 单遍语义下第一遍保留的写法才是正确结果(繁体源 乾縣→乾县)。
type T2SConv = (s: string) => string
interface T2SState {
  conv: T2SConv
  /** 简体→繁体反向转换器: 仅供构建强信号集(同形归并字回环过滤)用 */
  convBack?: T2SConv
  /** 繁体特有字强信号集: 全 CJK 区逐字符过转换器, t2s 有变化且 s2t 回环一致(即该字
   * 不会以简体身份出现)的字。简体文本含这些字才视为繁体源; 同形归并字(乾/係/唸…)被
   * 排除在外, 简体正文/书名含它们零误触发 */
  diffSet: Set<string>
}
// 挂 globalThis 防 dev 热更新每轮模块重求值都重建转换器+差异字集(实测构建约 70ms,
// 且 HMR 多实例下重复驻留词典内存); 与 hostGates/__novelHostGate_v1 同款做法。
// v2: diffSet 语义收紧(同形归并字排除), 键升级防热重载复用旧全量集合
const globalForT2S = globalThis as unknown as { __novelT2S_v2?: T2SState | null }

/** 强信号差异字集构建: CJK扩展A + 基本区 + 兼容表意文字, 分块以换行分隔逐字转换防词组跨界合并。
 * 行数不变式断言: 输出若与输入行数不齐(词组词典跨行合并/吞行), 该块降级逐字转换兜底,
 * 保证差异字集不错位漏字。t2s 变化的字再做 s2t 回环检查(排除同形归并字) */
function buildDiffCharSet(conv: T2SConv, convBack: T2SConv): Set<string> {
  const set = new Set<string>()
  const chars: string[] = []
  for (let cp = 0x3400; cp <= 0x9fff; cp++) chars.push(String.fromCodePoint(cp))
  for (let cp = 0xf900; cp <= 0xfa6f; cp++) chars.push(String.fromCodePoint(cp))
  const CHUNK = 500
  for (let i = 0; i < chars.length; i += CHUNK) {
    const chunk = chars.slice(i, i + CHUNK)
    let out: string[] | null = null
    try {
      const joined = conv(chunk.join('\n')).split('\n')
      if (joined.length === chunk.length) out = joined
    } catch { /* 该块降级逐字 */ }
    for (let j = 0; j < chunk.length; j++) {
      const ch = chunk[j]
      const converted = out ? out[j] : conv(ch)
      if (converted === ch) continue
      // 同形归并字过滤: s2t(t2s(ch)) 回环不到原字的(乾→干→幹), 说明该字在规范简体中
      // 合法存在(乾隆/乾坤), 不作为繁体触发信号 —— 否则简体文本被误转换
      try {
        if (convBack(converted) !== ch) continue
      } catch { /* 反向转换异常: 保守收录(旧行为) */ }
      set.add(ch)
    }
  }
  return set
}

/** 惰性初始化(每进程最多构建一次, 失败标记 null 不再重试) */
function ensureT2S(): T2SState | null {
  if (globalForT2S.__novelT2S_v2 !== undefined) return globalForT2S.__novelT2S_v2
  try {
    const conv = OpenCC.Converter({ from: 't', to: 'cn' }) as T2SConv
    const convBack = OpenCC.Converter({ from: 'cn', to: 't' }) as T2SConv
    globalForT2S.__novelT2S_v2 = { conv, convBack, diffSet: buildDiffCharSet(conv, convBack) }
  } catch {
    globalForT2S.__novelT2S_v2 = null
  }
  return globalForT2S.__novelT2S_v2
}

/** 文本是否含繁体特有字(强信号) */
function hasVariantChinese(text: string, st: T2SState): boolean {
  if (!text) return false
  for (const ch of text) if (st.diffSet.has(ch)) return true
  return false
}

/** 繁体→简体(纯文本); 简体/无CJK文本原样返回; 空值安全 */
export function t2sText(text: string | undefined | null): string {
  if (!text) return ''
  const st = ensureT2S()
  if (!st) return text
  if (!hasVariantChinese(text, st)) return text
  return st.conv(text)
}

/** 标签段匹配(用于 t2sHtml 拆分): 收窄为 <[a-zA-Z/! 开头 —— 文本中的裸 "<"(如 "1 < 2")
 *  后跟非标签字符时, 宽松版 <[^>]*> 会一路吞到下一个真正的 ">" 为止, 把中间的繁体文本
 *  并进"标签"段漏转换(htmlparser2 对裸 < 按文本解析, 收窄后两侧行为一致)。
 *  注释/CDATA 整段按标签跳过不转换(均不进渲染文本, 无碍) */
const T2S_TAG_SPLIT = /(<[a-zA-Z/!][^>]*>)/g

/** HTML 繁体→简体: 仅转换标签外文本段(标签/属性名不动; 早期转换让后续广告正则/导航词
 *  匹配都在简体上进行)。split 捕获组保证标签恒落在奇数下标, 文本段按下标奇偶精确区分。
 *  供采集管线与后台存量数据批量繁转简共用; 检测未命中时原样返回(简体内容零开销) */
export function t2sHtml(html: string): string {
  if (!html) return html
  const st = ensureT2S()
  if (!st) return html
  // 快速预检: 剥标签后的可见文本无差异字则整段跳过(纯ASCII/简体页零开销)
  if (!hasVariantChinese(html.replace(T2S_TAG_SPLIT, ''), st)) return html
  const parts = html.split(T2S_TAG_SPLIT)
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i]) parts[i] = st.conv(parts[i])
  }
  return parts.join('')
}

// ---------- 实体单遍解码(防双重解码) ----------
/** 白名单实体一次扫描解码, 不回扫替换产物: 逐条 .replace 链会"链式再解码" —— 源文
 *  &amp;lt; 先被 &amp; 规则还原成 "&lt;", 又被后续 &lt; 规则二次还原成 <, 源站刻意
 *  展示的转义字面量被吃掉; 单遍正则一次消费后扫描指针越过已替换文本, &amp;lt;
 *  恒解码为字面量 "&lt;"(与浏览器对已解码文本的展示语义一致)。数字实体复用
 *  fromCodePointSafe(越界/孤立代理区返回空) */
const ENTITY_RE = /&(?:nbsp|amp|lt|gt|quot|apos|#x[0-9a-f]+|#[0-9]+);/gi
const ENTITY_BASIC: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function fromCodePointSafe(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return ''
  try {
    // 孤立代理区(0xD800-0xDFFF) String.fromCodePoint 直接抛 RangeError
    return String.fromCodePoint(cp)
  } catch {
    return ''
  }
}
/** 实体单遍解码(白名单实体; 不回扫替换产物防链式二次解码)。
 *  qq-e2 起导出: 下载TXT链(downloader.stripHtmlToText)与主清洗链共用同一解码口径,
 *  防 replace 链 "&amp;lt;"→"&lt;"→"<" 双重解码在各出口漂移 */
export function decodeEntitiesOnce(s: string): string {
  return s.replace(ENTITY_RE, (m) => {
    const key = m.slice(1, -1).toLowerCase()
    const basic = ENTITY_BASIC[key]
    if (basic !== undefined) return basic
    if (key.startsWith('#x')) return fromCodePointSafe(parseInt(key.slice(2), 16))
    return fromCodePointSafe(parseInt(key.slice(1), 10))
  })
}

/** 清洗章节正文HTML */
export function cleanContentHtml(raw: string, cfgOverride?: Partial<CleanConfig>): string {
  const cfg: CleanConfig = { ...DEFAULT_CLEAN_CONFIG, ...cfgOverride }
  if (!raw) return ''
  // 0. 繁体→简体(标签外文本段): 后续广告清洗/导航词匹配/存储统一在简体上进行
  let html = t2sHtml(raw)

  if (cfg.plainText) {
    // 纯文本模式: 剥全部标签, 保留换行
    // (实体解码走单遍 decodeEntitiesOnce —— 先剥真实标签后解码, 源站 "&lt;b&gt;" 类
    //  编码文本解码后保持字面量, 不会反向变成标签被误剥)
    let text = html
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
    text = decodeEntitiesOnce(text)
    text = removeAdLines(text, cfg.adPatterns)
    text = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n\n')
    // 不再结尾二次 t2sText: 入口 t2sHtml 已转完 —— 转换非幂等(含「乾」的文本第二遍
    // 会把词组保护外的「乾县」继续转成「干县」), 双重转换是真实的简体损坏路径
    // 控制字符剥离(\b 退格等源站杂符; \t\n\r 不在剥离类内): 全库实扫发现 2 章孤立 \b
    // 随正文入库(dd 轮), 输出层统一剥离一次
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  }

  // HTML模式
  const $ = cheerio.load(`<div id="__clean_root">${html}</div>`)
  // 0. 硬移除脚本/样式类标签: 修复 —— 自定义清洗配置可能不带 removeSelectors(或遗漏),
  //    白名单剥壳时 script/style 的内部代码会以"纯文本"形式漏进正文
  $(`#__clean_root script, #__clean_root style, #__clean_root noscript, #__clean_root iframe, #__clean_root object, #__clean_root embed`).remove()
  // 1. 移除指定选择器(广告/脚本)
  for (const sel of cfg.removeSelectors) {
    try { $(`#__clean_root ${sel}`).remove() } catch { /* 无效选择器 */ }
  }
  // 1.5 移除分页/导航链接(下一页/上一页/目录等)
  $(`#__clean_root a`).each((_, el) => {
    const t = ($(el).text() || '').trim()
    if (t && /^(下一页|上一页|下页|上页|目录|首?页|尾?页|返回目录|继续阅读|点击阅读|分页阅读?|加入书签|推荐本书?|报错).{0,4}$/.test(t)) {
      $(el).remove()
    }
  })
  // 1.8 乱序段落重排: 部分站点(如 5165.org)把段落以 <div data-id="n"> 乱序输出作反采集
  //     手段 —— 直接清洗会保留乱序段落顺序。判定: 同一父容器下 ≥3 个 data-id 子元素且
  //     数值序列非单调递增时, 按 data-id 数值升序重组父容器内容(恢复原文段落顺序)。
  //     修复: 原 parent.html(重排字符串) 以"序列化→重解析"重组父容器全部内容, 同父容器
  //     内非 data-id 兄弟节点(真实正文段落间夹带的 span/em/br/文本等)被整体丢弃。改为
  //     DOM 节点移动: 按 data-id 升序把各 data-id 节点 appendChild 到父容器尾部, 其后
  //     紧邻的非 data-id 兄弟(直到下一个 data-id 节点为止)作为同组尾随节点一起移动;
  //     首个 data-id 之前的节点无处可随, 原地保留。单调 data-id 快路径与"无 data-id
  //     不走此路径"的判定不变, 唯一行为差异是不再吞掉这些夹带节点。
  //     重组后复刻旧版包 <p> 语义: 内部 html 以 <p>/<br> 开头时原位展开原子节点,
  //     否则子节点整体移入新建 <p>(包裹判定与旧版逐字符一致, 但不再字符串重组,
  //     属性/实体保真)。append/replaceWith 对已存在节点均为移动而非复制(cheerio 实测)。
  {
    const dEls = $(`#__clean_root [data-id]`).toArray()
    if (dEls.length >= 3) {
      const parent = $(dEls[0]).parent()
      const inParent = dEls.filter((el) => $(el).parent().is(parent))
      if (inParent.length === dEls.length) {
        const items: { n: number; el: any }[] = []
        let ok = true
        for (const el of inParent) {
          const n = Number($(el).attr('data-id'))
          if (!Number.isFinite(n)) { ok = false; break }
          items.push({ n, el })
        }
        const nums = items.map((x) => x.n)
        const monotonic = nums.every((n, i) => i === 0 || n >= nums[i - 1])
        if (ok && !monotonic) {
          // items.sort 稳定(同值保持文档序, 与旧版一致); 快照遍历期间节点仅被移动
          // 不被复制, 引用恒有效
          items.sort((a, b) => a.n - b.n)
          const tails = new Map<any, any[]>()
          let cur: any[] | null = null
          for (const node of parent.contents().toArray()) {
            const a = (node as any).attribs
            const isDataId = (node as any).type === 'tag' && !!a && Object.prototype.hasOwnProperty.call(a, 'data-id')
            if (isDataId) { cur = []; tails.set(node, cur) } else if (cur) cur.push(node)
          }
          for (const { el } of items) {
            const tail = tails.get(el)
            if (!tail) continue // 防御: 与快照不一致时跳过该项(不应发生)
            parent.append(el)
            for (const t of tail) parent.append(t)
          }
          for (const { el } of items) {
            const $el = $(el)
            const h = ($el.html() || '').trim()
            if (/^<(p|br)\b/i.test(h)) {
              $el.replaceWith($el.contents())
            } else {
              const p = $('<p></p>')
              const kids = $el.contents()
              $el.replaceWith(p)
              p.append(kids)
            }
          }
        }
      }
    }
  }
  // 2. 白名单外的标签剥壳保文本
  // 修复: 原实现 replaceWith($(el).html()) 会把子节点重新 parse 成新副本, 而迭代快照
  // 仍指向已脱离文档的旧节点 —— 外层容器(div等)先被剥壳后, 内层 span/style 等永远
  // 逃过白名单过滤泄漏进正文。改用 contents() 移动【原节点】而非字符串重解析, 快照引用
  // 保持挂载, 内层标签能继续被后续迭代处理。
  $(`#__clean_root *`).each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase()
    if (tag && !cfg.whitelist.includes(tag)) {
      $(el).replaceWith($(el).contents())
    }
  })
  // 2.5 白名单标签属性消毒: 采集正文内嵌 on* 事件属性 / style 表达式会随内容入库,
  // 前台 dangerouslySetInnerHTML 渲染成活动节点(存储型注入面)。白名单语义
  // 是"只保留内容标签", 默认白名单(p/br/b/strong/em/i/u/h1-6)内所有标签均无合法属性
  // 用例 —— 属性一律剥除; 仅 a 标签(自定义白名单可能放行)保留 href 且必须为 http(s)
  // 绝对地址(与 parser.absolutize 的协议过滤同口径)。须置于 1.8 重排之后:
  // 重排依赖 data-id 属性判定, 先剥会永久禁用重排。
  $(`#__clean_root *`).each((_, el) => {
    const a = (el as any).attribs as Record<string, string> | undefined
    if (!a) return
    const tag = (el as any).tagName?.toLowerCase()
    for (const name of Object.keys(a)) {
      const keep = tag === 'a' && name === 'href' && /^https?:\/\//i.test(a[name] || '')
      if (!keep) $(el).removeAttr(name)
    }
  })
  let out = $(`#__clean_root`).html() || ''
  // 3. 广告正则清洗
  out = removeAdLines(out, cfg.adPatterns)
  // 4. 规范化
  if (cfg.normalize) {
    out = out
      .replace(/<\s*br\s*\/?\s*>\s*<\s*br\s*\/?\s*>/gi, '</p><p>')
      // 修复: 空段落清理由 <p></p> 扩展到 <p>空白/&nbsp;/纯<br></p>, 消除广告行删除后残留的空壳段落
      .replace(/<p>(?:\s|&nbsp;|<br\s*\/?\s*>)*<\/p>/gi, '')
      .replace(/<p>\s+/g, '<p>')
      .replace(/\s+<\/p>/g, '</p>')
  }
  // 5. 若无任何p标签, 按换行重建段落
  if (!/<(p|br)\b/i.test(out)) {
    out = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `<p>${l}</p>`)
      .join('')
  }
  // 同上: HTML 模式出口同样剥离控制字符(源站 \b 杂符曾随 <p>\b话虽… 入库)
  return out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim()
}

// 广告正则清洗的 URL 保护例外(y-a重放): 默认首条广告正则
// (www\.)?[a-z0-9-]+\.(com|net|…)(\/\S*)? 会把正文里【带 scheme 的合法 URL 文本】
// 一并啃掉 —— "访问https://example.com/book看正文"被剥成"访问https://看正文",
// <a href="https://…"> 的 href 属性同理受损。方案(取最小): 跑广告正则前先把
// "https?://…" 完整 URL 区段掩码成 \u0000N\u0000 占位符, 正则跑完原样还原。
// 覆盖面: 正文行内 URL / <a href> 属性值 / 引号或括号上下文中的完整 URL;
// 裸域名灌水(www.xxx.com 无 scheme, 广告常态)不受保护, 照常剥除。
// 占位符损坏容忍: 若某条广告正则恰好吃掉占位符一半(如含 \d 的模式), 还原失败
// 的残留 \u0000 序列由末尾 scrub 兜底清掉, 不留控制字符进库
function removeAdLines(text: string, patterns: string[]): string {
  const urls: string[] = []
  let out = text.replace(/https?:\/\/[^\s"'<>]+/gi, (m) => {
    urls.push(m)
    return `\u0000${urls.length - 1}\u0000`
  })
  for (const p of patterns) {
    if (!p) continue
    // 基础 ReDoS 闸门: 超长/超复杂模式直接跳过(用户自配正则在单线程服务里跑飞会拖垮整个采集;
    // 完整防护需 re2, 这里做低成本上限控制)
    if (p.length > 300) continue
    // 嵌套量词闸门: "(a+)+/(\\w*){2,}"类灾难性回溯(ReDoS)在长度闸门内仍可能卡死,
    // 命中"量词+右括号+量词"形态直接跳过该模式
    if (/[+*]\s*\)\s*[+*{]/.test(p)) continue
    try {
      out = out.replace(new RegExp(p, 'gi'), '')
    } catch { /* 无效正则跳过 */ }
  }
  // 还原被保护的 URL(良构占位符), 再清掉还原失败的控制字符残留
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => urls[Number(i)] ?? '')
  out = out.replace(/\u0000\d*/g, '')
  return out
}

/** 清洗纯文本字段(简介/标题等) */
export function cleanTextField(raw: string | undefined | null, maxLength?: number): string {
  if (!raw) return ''
  let v = String(raw).replace(/<[^>]+>/g, '')
  // 实体单遍解码(含 nbsp/apos/数字实体): 旧 replace 链 &amp; 规则最前, "&amp;lt;"
  // 类序列会被后续 &lt; 规则链式二次解码; 解码置于空白规整之前, &nbsp; 与普通空格同待遇
  v = decodeEntitiesOnce(v)
  // 控制字符剥离(qq-e): dd 轮只修了正文出口(cleanContentHtml), 纯文本字段(章节标题/简介/
  // 关键词)漏网 —— 源站标题混入 \x00/\x08/\x0B 等随 DB 入库并进 JSON API/前台。
  // \t\n\r(\x09\x0A\x0D)不在剥离类内, 与正文出口同口径
  v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  // 繁体→简体(检测未命中原样返回)
  v = t2sText(v)
  v = v
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (maxLength && v.length > maxLength) {
    // 按码点截断(UTF-16 slice 会把 emoji 等 astral 字符代理对斩半产出乱码 U+FFFD)
    v = Array.from(v).slice(0, maxLength).join('')
  }
  return v
}

/** 清洗多行简介 */
export function cleanIntro(raw: string | undefined | null, maxLength = 2000): string {
  if (!raw) return ''
  let v = String(raw).replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n')
  v = v.replace(/<[^>]+>/g, '')
  v = decodeEntitiesOnce(v)
  // 控制字符剥离(qq-e): 与 cleanTextField 同口径(\t\n\r 保留, 供下方按行切段)
  v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  v = t2sText(v)
  v = removeAdLines(v, DEFAULT_CLEAN_CONFIG.adPatterns)
  v = v
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
  if (v.length > maxLength) v = Array.from(v).slice(0, maxLength).join('')
  return v
}

/** 清洗章节标题(去书名号残留/网站后缀) */
export function cleanChapterTitle(raw: string | undefined | null, bookName?: string): string {
  if (!raw) return ''
  let t = cleanTextField(raw)
  if (bookName) {
    t = t.replace(new RegExp(`^${escapeReg(bookName)}\\s*`, 'g'), '')
  }
  // 修复(qq-e): 剥离切割点从「分隔符起点」改为「垃圾关键词起点」—— 原实现
  // t.slice(0, junk.index) 以匹配起点(分隔符)切割, 标题内嵌连字符且站点尾巴与正文隔了
  // 空格时把真实内容一并切掉("龙争-虎斗 www.y.com"→"龙争", 丢了"-虎斗")。
  // 关键词起点切割后: 尾巴紧贴分隔符("转折_www.x.com首发")结果不变("转折"),
  // 隔空格形态只剥尾巴本身("龙争-虎斗 www.y.com"→"龙争-虎斗");
  // 切割后残留的分隔符/空白尾巴统一清掉。无分隔符前缀的纯垃圾(如"www.x.com"整标题)
  // 仍不命中(防"我的首发日"这类正文词误伤, 与旧行为一致), 落码点截断兜底。
  // 修复(qq-e2): 量词必须懒惰(*?) —— 贪婪版回溯语义是「取最右关键词」:
  // "转折_www.x.com首发"贪婪命中最右侧"首发", 切割结果"转折_www.x.com"(域名残留!),
  // "龙争-虎斗 www.y.com"命中"y.com"残留"www."(修前双例实测皆反, 与本注释承诺相悖);
  // 懒惰版从最短前缀起试, 恒取【最左】关键词, 一切从首个垃圾词起全剥, 上述双例
  // 实测复原为"转折"/"龙争-虎斗"。
  const junk = t.match(/[_\-–—|]\s*[^_\-–—|]*?((?:www\.|[a-z0-9-]+\.(?:com|net|cc|org|info|top|xyz|vip)|中文网|文学网|小说网|首发|无弹窗|全文阅读|在线阅读|最新章节|手打|txt下载|敬请期待))/i)
  if (junk && junk.index !== undefined && junk[1]) {
    const cutAt = junk.index + junk[0].length - junk[1].length
    const cut = t.slice(0, cutAt).replace(/[\s_\-–—|]+$/, '').trim()
    if (cut) t = cut // 剥后为空则保留原标题, 避免标题被清空
  }
  // 按码点截断(与 cleanTextField/cleanIntro 同款): UTF-16 slice(0,120) 会把 emoji 等
  // astral 字符代理对斩半产出乱码(U+FFFD)
  return Array.from(t.trim()).slice(0, 120).join('') || '未命名章节'
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
