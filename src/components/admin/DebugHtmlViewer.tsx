'use client'

// ============================================================
// DebugHtmlViewer — 可视化规则调试的 HTML 预览器(feat-c)
// 把测试 API 返回的 debugHtml(注入 <mark class="heis-debug-match"> 高亮标记)
// 放进一个 sandbox="" 的 iframe 渲染, 隔离抓取页 CSS / 阻断脚本执行,
// 防止抓取页 XSS 串到后台域。父组件通过 activeMatch 切换"当前激活的匹配",
// 本组件重渲染 iframe srcdoc 给该匹配加 .heis-debug-active 类(闪烁 + 强高亮)。
// ============================================================
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
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

export function DebugHtmlViewer({
  debugHtml,
  rawHtml,
  activeMatch,
  onActiveChange: _onActiveChange,
}: DebugHtmlViewerProps) {
  // 视图模式: 高亮预览 / 原始 HTML
  const [view, setView] = useState<'highlight' | 'raw'>('highlight')
  // 复制按钮反馈
  const [copied, setCopied] = useState(false)

  // 解构 activeMatch 子字段, 让 useMemo 依赖数组可稳定引用(react-hooks/exhaustive-deps
  // 要求完整对象引用; 子字段取值会触发"manual memoization 不可保留"告警)
  const activeField = activeMatch?.field ?? null
  const activeIdx = activeMatch?.idx ?? null

  // "已复制 ✓" 仅由 setTimeout 自动消除(1.5s), 切视图时按钮文字"已复制"会被自然
  // 覆盖(下次复制会重设 timer) — 不用 effect 重置以避免 set-state-in-effect 反模式。

  // 构建 iframe srcdoc:
  //  · highlight 视图: 渲染 debugHtml(注入 <mark>); 若父组件传入 activeMatch,
  //                    给该 mark 加 .heis-debug-active 类(闪烁 + 强高亮)
  //  · raw 视图: 把原始 HTML 转义为 <pre> 文本(显示源码而非渲染)
  const srcDoc = useMemo(() => {
    if (view === 'raw') {
      const pre = `<pre>${escapeHtmlForPre(rawHtml || debugHtml || '')}</pre>`
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${IFRAME_CSS}</style></head><body>${pre}</body></html>`
    }
    let html = debugHtml || ''
    if (activeField !== null && activeIdx !== null) {
      html = injectActiveClass(html, activeField, activeIdx)
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${IFRAME_CSS}</style></head><body>${html}</body></html>`
  }, [view, debugHtml, rawHtml, activeField, activeIdx])

  // 复制当前视图的 HTML
  const handleCopy = async () => {
    const text = view === 'raw' ? (rawHtml || debugHtml || '') : (debugHtml || '')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
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
        </div>
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
        </div>
      )}

      {/* iframe: sandbox="" 严格(无 allow-scripts / 无 allow-same-origin),
          彻底隔离抓取页脚本与后台同源访问; srcDoc 注入完整 HTML 文档 + 内联 CSS。
          key 用 srcDoc 长度+前缀哈希, 在切换 debugHtml/rawHtml/activeMatch 时强制
          iframe 重建 —— React 仅更新 srcDoc 属性时部分浏览器不重载文档, 导致高亮错位。 */}
      <iframe
        title="heis-debug-html-viewer"
        sandbox=""
        srcDoc={srcDoc}
        key={`${view}:${srcDoc.length}:${srcDoc.slice(0, 32)}`}
        className="h-[400px] w-full border-0 bg-[#fafafa]"
      />
    </div>
  )
}
