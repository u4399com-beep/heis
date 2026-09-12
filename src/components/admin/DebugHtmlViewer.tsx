'use client'

// ============================================================
// DebugHtmlViewer — 可视化规则调试的 HTML 预览器(feat-c)
// 把测试 API 返回的 debugHtml(注入 <mark class="heis-debug-match"> 高亮标记)
// 放进一个 sandbox="" 的 iframe 渲染, 隔离抓取页 CSS / 阻断脚本执行,
// 防止抓取页 XSS 串到后台域。父组件通过 activeMatch 切换"当前激活的匹配",
// 本组件重渲染 iframe srcdoc 给该匹配加 .heis-debug-active 类(闪烁 + 强高亮)。
//
// agent-X-rule-test 增强:
//   - 视图模式新增 'highlighted' (HTML 加语法高亮着色, 仅 raw 视图有效)
//   - 复制按钮 setTimeout 改用 ref + effect cleanup, 避免卸载后 setState 告警
//   - 主组件包 React.memo(deep-compare 浅比较), activeMatch 变化仅触发 srcDoc useMemo
//   - 元素选择器模式: iframe 内点击元素 → postMessage 出 CSS 路径, 父组件回填字段表达式
// ============================================================
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MousePointerClick } from 'lucide-react'
import { escapeReg } from '@/lib/utils'

interface DebugMatchSummary {
  field: string
  idx: number
}

interface DebugHtmlViewerProps {
  /** 注入高亮标记的 HTML(服务端 cheerio 序列化, body 内部) */
  debugHtml: string
  /** 原始未修改 HTML, 供"原始 HTML"视图切换(以源码形式展示) */
  rawHtml: string
  /** 父组件控制的当前激活匹配; 变化时本组件重渲染 iframe, 给对应 mark 加 active 类 */
  activeMatch?: DebugMatchSummary | null
  /** 激活匹配变化时回调(供父组件同步状态) — 本组件不消费, 留作未来扩展 */
  onActiveChange?: (m: DebugMatchSummary | null) => void
  /** 元素选择器模式开关: 开启后 iframe 接管点击事件并回调生成的 CSS 选择器 */
  pickerEnabled?: boolean
  /** picker 命中元素后回调(供父组件回填字段表达式) */
  onPick?: (selector: string) => void
}

/**
 * iframe 内联 CSS — 全部 hardcode 在 srcdoc 内, 完全脱离后台 Tailwind 主题:
 *  · body 浅色背景 + 等宽字体(抓取页 HTML 代码气味, 不与后台 zinc 主题冲突)
 *  · mark.heis-debug-match 默认浅黄; title=绿 / url|link=蓝 / content=粉
 *  · .heis-debug-item 紫色虚线 outline(列表/目录段容器)
 *  · mark.heis-debug-active 红色边框 + 3 次闪烁动画(父组件激活时点亮)
 *  · scroll-margin-top 让浏览器 scroll-into-view 留出顶部空间(若未来加脚本)
 */
const IFRAME_CSS = `
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace;
    padding: 12px;
    background: #fafafa;
    color: #333;
    font-size: 13px;
    line-height: 1.6;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  pre {
    font-family: inherit;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
  mark.heis-debug-match {
    background: #fef08a;
    border: 1px solid #facc15;
    padding: 0 2px;
    border-radius: 2px;
    color: inherit;
    font-style: normal;
    font-weight: inherit;
  }
  mark.heis-debug-match[data-field="title"] {
    background: #bbf7d0;
    border-color: #22c55e;
  }
  mark.heis-debug-match[data-field="url" i],
  mark.heis-debug-match[data-field="link" i],
  mark.heis-debug-match[data-field="bookUrl" i] {
    background: #bfdbfe;
    border-color: #3b82f6;
  }
  mark.heis-debug-match[data-field="content" i] {
    background: #fbcfe8;
    border-color: #ec4899;
  }
  mark.heis-debug-match[data-field="name" i] {
    background: #bbf7d0;
    border-color: #22c55e;
  }
  mark.heis-debug-match[data-field="author" i],
  mark.heis-debug-match[data-field="category" i],
  mark.heis-debug-match[data-field="keywords" i],
  mark.heis-debug-match[data-field="intro" i],
  mark.heis-debug-match[data-field="cover" i],
  mark.heis-debug-match[data-field="latestChapter" i],
  mark.heis-debug-match[data-field="status" i] {
    background: #fed7aa;
    border-color: #f97316;
  }
  .heis-debug-item {
    outline: 2px dashed #a855f7;
    outline-offset: 2px;
    margin: 4px 0;
    display: block;
  }
  @keyframes heis-debug-flash {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); outline: 2px solid transparent; }
    25%, 75% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.75); outline: 2px solid #ef4444; }
    50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0.9); outline: 3px solid #b91c1c; }
  }
  mark.heis-debug-active {
    animation: heis-debug-flash 0.6s ease-in-out 3;
    scroll-margin-top: 12px;
  }
  mark.heis-debug-active[data-field="title"] { background: #86efac !important; }
  mark.heis-debug-active[data-field="url" i],
  mark.heis-debug-active[data-field="link" i],
  mark.heis-debug-active[data-field="bookUrl" i] { background: #93c5fd !important; }
  mark.heis-debug-active[data-field="content" i] { background: #f9a8d4 !important; }
  /* agent-X: 元素选择器模式视觉反馈 */
  body.heis-picker-on { cursor: crosshair; }
  body.heis-picker-on *:hover { outline: 2px solid #6366f1 !important; outline-offset: 1px; }
  body.heis-picker-on .heis-picker-hit {
    outline: 3px solid #10b981 !important; outline-offset: 2px;
    animation: heis-debug-flash 0.4s ease-in-out 1;
  }
`

/** 图例: 颜色 → 字段含义(供工具栏下方展示) */
const LEGEND_ITEMS: { label: string; swatchClass: string }[] = [
  { label: '标题', swatchClass: 'bg-[#bbf7d0] border-[#22c55e]' },
  { label: '链接', swatchClass: 'bg-[#bfdbfe] border-[#3b82f6]' },
  { label: '正文', swatchClass: 'bg-[#fbcfe8] border-[#ec4899]' },
  { label: '其它字段', swatchClass: 'bg-[#fed7aa] border-[#f97316]' },
  { label: '列表/目录项', swatchClass: 'border-dashed border-[#a855f7] bg-transparent' },
]

/** HTML escape: 用于"原始 HTML"视图, 把整段 HTML 作为文本展示(不渲染) */
function escapeHtmlForPre(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * agent-X-rule-test: 极简 HTML/CSS/JSON 语法高亮 (regex-based, 不引第三方库)
 *  · 标签名: <span class="heis-tk">tag</span>  蓝紫
 *  · 属性名: <span class="heis-attr">class</span>  橙
 *  · 字符串值: <span class="heis-str">"foo"</span>  绿
 *  · 注释: <span class="heis-com">&lt;!-- ... --&gt;</span>  灰
 *  · 关键字 (CSS/JSON): <span class="heis-kw">function/return/null/true/false</span>  紫
 * 高亮先于转义执行: 占位符替换 → 转义恢复 → 再转义其它字符; 安全不破坏 HTML 结构。
 *
 * 实现策略: 先 escape → 用 split/join 把已转义的 token 块"挖出"加 span 包装;
 * 这是"基于已转义字符串"的高亮, 不会引入未转义字符到 DOM, 安全。
 */
function highlightHtmlSource(escaped: string): string {
  // 注释优先(避免内部 < 被 token 化)
  let s = escaped.replace(
    /(&lt;!--[\s\S]*?--&gt;)/g,
    '<span class="heis-com">$1</span>',
  )
  // 标签 + 属性: <tag attr="val"> 或 <tag attr='val'> 或 自闭合
  s = s.replace(
    /(&lt;\/?)([a-zA-Z][\w:-]*)((?:\s+[^&<>]*?)*?)(\/?&gt;)/g,
    (_m, lt: string, tag: string, attrs: string, gt: string) => {
      const attrsHl = attrs.replace(
        /([a-zA-Z_:][\w:-]*)(\s*=\s*)?("(?:&quot;|[^"])*"|'(?:[^']|&amp;)*')?/g,
        (_m2: string, name: string, eq: string | undefined, val: string | undefined) => {
          if (val) {
            return `<span class="heis-attr">${name}</span>${eq}<span class="heis-str">${val}</span>`
          }
          return `<span class="heis-attr">${name}</span>${eq || ''}`
        },
      )
      return `${lt}<span class="heis-tk">${tag}</span>${attrsHl}${gt}`
    },
  )
  return s
}

/** JSON / CSS 风格字符串 + 关键字高亮(共享 helper) */
function highlightJsonSource(escaped: string): string {
  // 字符串: "..."" 或 '...'
  let s = escaped.replace(
    /("(?:\\.|[^"\\])*")/g,
    '<span class="heis-str">$1</span>',
  )
  // 关键字: true / false / null / 数字
  s = s.replace(
    /\b(true|false|null)\b/g,
    '<span class="heis-kw">$1</span>',
  )
  s = s.replace(
    /\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/gi,
    '<span class="heis-num">$1</span>',
  )
  return s
}

/** 根据内容嗅探: 看上去像 JSON ({ 或 [ 开头) → 用 JSON 高亮; 否则 HTML 高亮 */
function highlightAuto(escaped: string): string {
  const trimmed = escaped.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return highlightJsonSource(escaped)
  }
  return highlightHtmlSource(escaped)
}

const HIGHLIGHT_CSS = `
  .heis-tk { color: #6366f1; }
  .heis-attr { color: #f59e0b; }
  .heis-str { color: #10b981; }
  .heis-com { color: #6b7280; font-style: italic; }
  .heis-kw { color: #a855f7; font-weight: 600; }
  .heis-num { color: #ef4444; }
`

/**
 * 给指定 (field, idx) 的 <mark> 注入 .heis-debug-active 类。
 * 服务端注入的 mark 标签格式: <mark class="heis-debug-match" data-field="X" data-idx="N">...</mark>
 * 这里用正则把首个匹配该 field+idx 的 mark 升级为 active。
 *
 * 注意: 当列表/目录段有多个列表项时, 同一 field 在不同 idx 下会有多个 mark,
 *       必须按 data-idx 严格区分, 不能简单按 data-field 替换(会把所有项的同名字段都激活)。
 *       替换首个匹配即可 — 同 idx+field 只会有一个 mark(因为 parser 也只用 .first())。
 */
function injectActiveClass(html: string, field: string, idx: number): string {
  if (!html) return html
  const fieldEsc = escapeReg(field)
  // 匹配 class="heis-debug-match" data-field="<field>" data-idx="<idx>"
  // (cheerio 序列化时属性顺序固定, 见 route.ts wrapInner 调用)
  const pattern = new RegExp(
    `class="heis-debug-match" data-field="${fieldEsc}" data-idx="${idx}"`,
  )
  if (pattern.test(html)) {
    return html.replace(
      pattern,
      `class="heis-debug-match heis-debug-active" data-field="${field}" data-idx="${idx}"`,
    )
  }
  // 兜底: cheerio 可能用单引号或不同属性顺序; 退化用属性选择器拆段拼接
  const loose = new RegExp(
    `(<mark\\b[^>]*\\bclass="heis-debug-match"[^>]*\\bdata-field="${fieldEsc}"[^>]*\\bdata-idx="${idx}"[^>]*>)`,
  )
  return html.replace(
    loose,
    (m) => m.replace('class="heis-debug-match"', 'class="heis-debug-match heis-debug-active"'),
  )
}

/**
 * 元素选择器模式: 给定 iframe 内元素 → 生成最短唯一定位 CSS 选择器
 * 策略: id 优先 → 否则 tag + 同级第 N 个 nth-child → 自底向上拼接, 直到选择器在
 * document 内仅命中 1 个元素(或链爬到 <html>); 与浏览器 DevTools "Copy CSS Selector" 同口径。
 * 此函数注入到 iframe 内, 通过 postMessage 把生成结果发给父组件。
 */
const PICKER_SCRIPT = `
<script>
(function() {
  function buildSelector(el) {
    if (!(el instanceof Element)) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      var sib = cur, nth = 1;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === cur.tagName) nth++;
      }
      if (nth > 1) part += ':nth-of-type(' + nth + ')';
      parts.unshift(part);
      try {
        if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
      } catch (e) {}
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }
  document.addEventListener('click', function(e) {
    if (!document.body.classList.contains('heis-picker-on')) return;
    e.preventDefault();
    e.stopPropagation();
    var sel = buildSelector(e.target);
    if (sel) {
      e.target.classList.add('heis-picker-hit');
      setTimeout(function(){ e.target.classList.remove('heis-picker-hit'); }, 600);
      parent.postMessage({ source: 'heis-debug-picker', selector: sel }, '*');
    }
  }, true);
})();
</script>
`

function DebugHtmlViewerImpl({
  debugHtml,
  rawHtml,
  activeMatch,
  onActiveChange: _onActiveChange,
  pickerEnabled = false,
  onPick,
}: DebugHtmlViewerProps) {
  // 视图模式: 高亮预览 / 原始 HTML / 高亮源码(语法着色)
  const [view, setView] = useState<'highlight' | 'raw' | 'highlighted'>('highlight')
  // 复制按钮反馈
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // 解构 activeMatch 子字段, 让 useMemo 依赖数组可稳定引用(react-hooks/exhaustive-deps
  // 要求完整对象引用; 子字段取值会触发"manual memoization 不可保留"告警)
  const activeField = activeMatch?.field ?? null
  const activeIdx = activeMatch?.idx ?? null

  // 卸载时清掉"已复制"反馈的 setTimeout, 避免 setState-after-unmount 告警
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  // picker 模式开关: 通过给 iframe postMessage 切换 body 类名
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe || !iframe.contentWindow) return
    // 注意: sandbox="" 不含 allow-same-origin 时, contentWindow.postMessage 仍可发送
    // (postMessage 是跨沙箱通道, 但接收方需要有脚本环境 — 当前 sandbox="" 禁用了 allow-scripts)
    // 因此 picker 模式实际生效需在 srcdoc 内嵌入 PICKER_SCRIPT 并设置 sandbox="allow-scripts"
    // (allow-scripts 单独开启仍安全, 不开 allow-same-origin 就阻止了同源访问)
    try {
      iframe.contentWindow.postMessage(
        { source: 'heis-debug-picker-toggle', on: pickerEnabled },
        '*',
      )
    } catch {
      /* 跨沙箱 postMessage 失败: 静默, 不影响主流程 */
    }
  }, [pickerEnabled, view, activeField, activeIdx, debugHtml, rawHtml])

  // 监听 iframe postMessage (picker 命中元素 → 回调父组件)
  useEffect(() => {
    if (!pickerEnabled) return
    const handler = (e: MessageEvent) => {
      const data = e.data
      if (!data || typeof data !== 'object') return
      if (data.source !== 'heis-debug-picker' || typeof data.selector !== 'string') return
      onPick?.(data.selector)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [pickerEnabled, onPick])

  // 构建 iframe srcdoc:
  //  · highlight 视图: 渲染 debugHtml(注入 <mark>); 若父组件传入 activeMatch,
  //                    给该 mark 加 .heis-debug-active 类(闪烁 + 强高亮)
  //  · raw 视图: 把原始 HTML 转义为 <pre> 文本(显示源码而非渲染)
  //  · highlighted 视图: 在 raw 基础上做语法高亮
  const srcDoc = useMemo(() => {
    const extraCss = view === 'highlighted' ? HIGHLIGHT_CSS : ''
    if (view === 'raw') {
      const pre = `<pre>${escapeHtmlForPre(rawHtml || debugHtml || '')}</pre>`
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${IFRAME_CSS}${extraCss}</style></head><body>${pre}</body></html>`
    }
    if (view === 'highlighted') {
      const escaped = escapeHtmlForPre(rawHtml || debugHtml || '')
      const highlighted = highlightAuto(escaped)
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${IFRAME_CSS}${extraCss}</style></head><body><pre>${highlighted}</pre></body></html>`
    }
    // highlight 视图: 可能注入 picker 脚本(pickerEnabled 时)
    let html = debugHtml || ''
    if (activeField !== null && activeIdx !== null) {
      html = injectActiveClass(html, activeField, activeIdx)
    }
    const pickerToggle = pickerEnabled
      ? `<script>document.addEventListener('DOMContentLoaded',function(){document.body.classList.add('heis-picker-on');});</script>${PICKER_SCRIPT}`
      : ''
    // picker 模式必须开 allow-scripts(单独开, 不开 allow-same-origin → 仍沙箱隔离)
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${IFRAME_CSS}${extraCss}</style></head><body>${html}${pickerToggle}</body></html>`
  }, [view, debugHtml, rawHtml, activeField, activeIdx, pickerEnabled])

  // sandbox: picker 模式需 allow-scripts 才能让 postMessage 工作;
  //          非-picker 模式保持严格空串(无 allow-scripts / 无 allow-same-origin)
  const sandbox = pickerEnabled ? 'allow-scripts' : ''

  // 复制当前视图的 HTML
  const handleCopy = async () => {
    const text = view === 'raw' ? (rawHtml || debugHtml || '') : (debugHtml || '')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      // 清掉之前的 timer(快速连续复制), 重置 1.5s 反馈窗口
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard API 在非 HTTPS / 非 localhost 下可能不可用, 静默忽略 */
    }
  }

  const hasDebug = !!(debugHtml && debugHtml.trim())
  const hasRaw = !!(rawHtml && rawHtml.trim())

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant={view === 'highlight' ? 'default' : 'outline'}
            onClick={() => setView('highlight')}
            disabled={!hasDebug}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            高亮预览
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'raw' ? 'default' : 'outline'}
            onClick={() => setView('raw')}
            disabled={!hasRaw}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            原始 HTML
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'highlighted' ? 'default' : 'outline'}
            onClick={() => setView('highlighted')}
            disabled={!hasRaw && !hasDebug}
            className="h-7 gap-1.5 px-2 text-xs"
            title="带语法着色(标签蓝紫 / 属性橙 / 字符串绿 / 注释灰)"
          >
            语法高亮
          </Button>
        </div>
        <div className="flex items-center gap-1.5">
          {pickerEnabled && (
            <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 px-1.5 py-0 text-[10px] text-violet-300">
              <MousePointerClick className="mr-0.5 h-2.5 w-2.5" />
              选择器模式
            </Badge>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCopy}
            disabled={!hasDebug && !hasRaw}
            className="h-7 gap-1.5 px-2 text-xs"
          >
            {copied ? '已复制 ✓' : '复制 HTML'}
          </Button>
        </div>
      </div>

      {/* 图例(仅高亮预览视图显示) */}
      {view === 'highlight' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800/70 bg-zinc-950/40 px-3 py-1.5 text-[11px] text-zinc-400">
          <span className="text-zinc-500">图例:</span>
          {LEGEND_ITEMS.map((it) => (
            <span key={it.label} className="flex items-center gap-1">
              <span
                className={`inline-block h-3 w-3 rounded-sm border ${it.swatchClass}`}
                aria-hidden
              />
              <span>{it.label}</span>
            </span>
          ))}
          {pickerEnabled && (
            <span className="ml-auto text-violet-300">
              点击元素 → 生成 CSS 选择器
            </span>
          )}
        </div>
      )}

      {/* iframe: 默认 sandbox="" 严格(无 allow-scripts / 无 allow-same-origin),
          彻底隔离抓取页脚本与后台同源访问; srcDoc 注入完整 HTML 文档 + 内联 CSS。
          picker 模式下临时开 allow-scripts(仍不开 allow-same-origin), 让 postMessage 工作。
          key 用 srcDoc 长度+前缀哈希, 在切换 debugHtml/rawHtml/activeMatch 时强制
          iframe 重建 —— React 仅更新 srcDoc 属性时部分浏览器不重载文档, 导致高亮错位。 */}
      <iframe
        ref={iframeRef}
        title="heis-debug-html-viewer"
        sandbox={sandbox}
        srcDoc={srcDoc}
        key={`${view}:${srcDoc.length}:${srcDoc.slice(0, 32)}`}
        className="h-[400px] w-full border-0 bg-[#fafafa]"
      />
    </div>
  )
}

/**
 * agent-X-rule-test: memo 化 — TestPanel 重渲染频繁(activeMatch 切换 / url 输入),
 * 但 DebugHtmlViewer 仅依赖 (debugHtml, rawHtml, activeField, activeIdx, pickerEnabled),
 * 浅比较即可截断大部分无关注入渲染。onPick 是父组件闭包, 默认引用稳定(useCallback);
 * 若父未 useCallback, 退化为每次都重渲(无回归, 仅失去 memo 收益)。
 */
export const DebugHtmlViewer = memo(DebugHtmlViewerImpl, (prev, next) => {
  return (
    prev.debugHtml === next.debugHtml &&
    prev.rawHtml === next.rawHtml &&
    prev.pickerEnabled === next.pickerEnabled &&
    prev.onPick === next.onPick &&
    prev.activeMatch?.field === next.activeMatch?.field &&
    prev.activeMatch?.idx === next.activeMatch?.idx
  )
})
