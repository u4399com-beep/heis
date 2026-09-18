// ============================================================
// 通用主题工具栏组件 — 收藏本站 (Ctrl+D) + 简繁切换
// 共享逻辑: 所有 clone-* 主题复用, 不破坏 1:1 克隆 DOM 结构
// ============================================================
'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { s2t, t2s } from './s2t-table'

// ============================================================
// 收藏本站 — 跨浏览器 addFavorite + 兜底 alert
// ============================================================
export function addFavoriteSite(e?: React.MouseEvent | React.FormEvent | React.KeyboardEvent): void {
  if (e && typeof e.preventDefault === 'function') e.preventDefault()
  if (typeof window === 'undefined') return
  const url = window.location.href
  const title = document.title || '小说阅读网'
  // IE / Edge (旧版)
  const ext = (window as any).external as any
  if (ext && typeof ext.addFavorite === 'function') {
    try { ext.addFavorite(url, title); return } catch {}
  }
  // Firefox 旧版 sidebar
  const sb = (window as any).sidebar as any
  if (sb && typeof sb.addPanel === 'function') {
    try { sb.addPanel(title, url, ''); return } catch {}
  }
  // Chrome / Safari / 现代浏览器: 提示按 Ctrl+D / Cmd+D
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
  const key = isMac ? '⌘+D' : 'Ctrl+D'
  alert(`请按下 ${key} 收藏本站 (将本页加入浏览器书签)`)
}

/** 给 <a> 加 onClick, 同时设置 href="#favorite" 防止跳转, 屏蔽 SSR `window` 访问 */
export const favoriteClick = (e: React.MouseEvent) => addFavoriteSite(e)

// ============================================================
// 简繁切换 Hook — localStorage 持久化偏好 + body 文字节点替换
// - SSR 时输出 isTc=false (简体, 避免水合不匹配)
// - mount 后读 localStorage, 若偏好繁体则 applyTraditionalToBody()
// - toggle 时 setIsTc 并写 localStorage, effect 重应用
// - MutationObserver 处理 React 后续渲染新增节点
// ============================================================
const TC_KEY = 'pub_tc' // localStorage key (1=繁体, 0=简体)

// 文字节点原始简体内容缓存 — 用于简体恢复
// 用 WeakMap 避免内存泄漏 (节点销毁时自动 GC)
const originalTexts = new WeakMap<Text, string>()

// 遍历 root 下所有非空 Text 节点
function walkTextNodes(root: Node, cb: (node: Text) => void): void {
  if (typeof document === 'undefined') return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  })
  let node = walker.nextNode() as Text | null
  while (node) {
    cb(node)
    node = walker.nextNode() as Text | null
  }
}

// 对单个 Text 节点应用繁体转换 (保留原始简体)
function convertTextTc(t: Text): void {
  if (!t.nodeValue) return
  if (!originalTexts.has(t)) originalTexts.set(t, t.nodeValue)
  const orig = originalTexts.get(t) ?? t.nodeValue
  const next = s2t(orig)
  if (next !== t.nodeValue) t.nodeValue = next
}

// 对单个 Text 节点恢复简体
function restoreTextSimplified(t: Text): void {
  const orig = originalTexts.get(t)
  if (orig !== undefined && t.nodeValue !== orig) t.nodeValue = orig
}

// 全 body 应用繁体
export function applyTraditionalToBody(): void {
  if (typeof document === 'undefined' || !document.body) return
  walkTextNodes(document.body, convertTextTc)
}

// 全 body 恢复简体
export function restoreSimplifiedFromBody(): void {
  if (typeof document === 'undefined' || !document.body) return
  walkTextNodes(document.body, restoreTextSimplified)
}

// ============================================================
// 模块级 MutationObserver 单例 — 跨视图持久运行
// 调用 ensureTcObserver(): 若已启动则 no-op; 否则启动全局观察器 + 首次应用繁体
// 调用 stopTcObserverAndRestore(): 停止观察器 + 恢复简体
// 设计目标: 用户在 HomeClone 切到繁体后, 即使导航到 BookView/ReadChrome 等
//           没有 TcToggle 按钮的页面, observer 仍持续转换新增节点
// ============================================================
let tcObserver: MutationObserver | null = null

function ensureTcObserver(): void {
  if (typeof document === 'undefined' || !document.body) return
  if (tcObserver) return // 已启动, no-op (Strict Mode 安全)
  applyTraditionalToBody()
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType === Node.TEXT_NODE) {
          convertTextTc(n as Text)
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          walkTextNodes(n, convertTextTc)
        }
      })
    }
  })
  obs.observe(document.body, { childList: true, subtree: true })
  tcObserver = obs
}

function stopTcObserverAndRestore(): void {
  if (tcObserver) {
    tcObserver.disconnect()
    tcObserver = null
  }
  restoreSimplifiedFromBody()
}

export interface UseTcResult {
  /** 是否处于繁体模式 (SSR=false, mount 后读 localStorage) */
  isTc: boolean
  /** mounted=true 表示客户端已挂载, 可安全读 localStorage */
  mounted: boolean
  /** 切换简/繁体 (写 localStorage + 触发 effect 重应用) */
  toggleTc: () => void
  /** 显式设为简体/繁体 */
  setTc: (enabled: boolean) => void
}

export function useTraditionalChinese(): UseTcResult {
  // mounted: SSR=false → client=true, 用 useSyncExternalStore 避免 setState-in-effect
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
  // isTc: 用 useSyncExternalStore 订阅 localStorage 跨标签/同标签变化
  const isTc = useSyncExternalStore(subscribeTc, getTcSnapshot, getTcServerSnapshot)

  // isTc 变化时应用/恢复 + 启停全局 MutationObserver (effect body 不调 setState)
  // observer 为模块级单例, 不在 cleanup 里 disconnect, 让其在用户导航离开 HomeClone
  // 后继续运行 (跨视图持续转换新增节点); 用户切回简体时显式调用 stopTcObserverAndRestore
  useEffect(() => {
    if (!mounted) return
    if (isTc) {
      ensureTcObserver()
    } else {
      stopTcObserverAndRestore()
    }
  }, [isTc, mounted])

  const setTc = useCallback((enabled: boolean) => {
    try { localStorage.setItem(TC_KEY, enabled ? '1' : '0') } catch {}
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('pub-tc-change'))
  }, [])

  const toggleTc = useCallback(() => {
    try {
      const cur = localStorage.getItem(TC_KEY) === '1'
      localStorage.setItem(TC_KEY, cur ? '0' : '1')
    } catch {}
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('pub-tc-change'))
  }, [])

  return { isTc, mounted, toggleTc, setTc }
}

// useSyncExternalStore 订阅函数 — 监听 storage 跨标签事件 + 自定义同标签事件
function subscribeTc(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === TC_KEY || e.key === null) callback()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener('pub-tc-change', callback)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('pub-tc-change', callback)
  }
}

function getTcSnapshot(): boolean {
  if (typeof window === 'undefined') return false
  try { return localStorage.getItem(TC_KEY) === '1' } catch { return false }
}

function getTcServerSnapshot(): boolean {
  return false
}

// ============================================================
// 可复用工具按钮 — 各主题可选用, 也可直接调用 addFavoriteSite/useTraditionalChinese
// 默认样式偏简体站点风格, 各主题可 wrap 改 className
// ============================================================

/** 收藏本站 (Ctrl+D) 按钮 — 默认渲染成 <a href> 文字链接 */
export function FavoriteLink({
  children = '收藏本站',
  className,
  title = '收藏本站 (Ctrl+D)',
  href = '#favorite',
}: {
  children?: React.ReactNode
  className?: string
  title?: string
  href?: string
}) {
  return (
    <a href={href} title={title} onClick={favoriteClick} className={className}>
      {children}
    </a>
  )
}

/** 简繁切换按钮 — 默认渲染成 <a href> 文字链接, 标签随状态切换 */
export function TcToggleLink({
  className,
  tcLabel = '简体',
  scLabel = '繁體',
  title = '简繁切换',
  href = '#tc-toggle',
}: {
  className?: string
  /** 处于繁体时显示的文案 (点击切回简体) */
  tcLabel?: string
  /** 处于简体时显示的文案 (点击切到繁体) */
  scLabel?: string
  title?: string
  href?: string
}) {
  const { isTc, mounted, toggleTc } = useTraditionalChinese()
  // SSR/CSR 一致: 简体时显示 scLabel (繁體), 繁体时显示 tcLabel (简体)
  // mount 前永远显示简体态 (scLabel), 避免水合不匹配
  const label = mounted && isTc ? tcLabel : scLabel
  return (
    <a
      href={href}
      title={title}
      onClick={(e) => { e.preventDefault(); toggleTc() }}
      className={className}
      data-tc-state={mounted && isTc ? '1' : '0'}
    >
      {label}
    </a>
  )
}

/** 给 101kks/x2552 等已存在 .lang .zh_click DOM 的主题: 调用 setTc(false/true) */
export function useTcControls() {
  const { setTc, isTc, mounted } = useTraditionalChinese()
  return {
    isTc,
    mounted,
    toSimplified: () => setTc(false),
    toTraditional: () => setTc(true),
    toggle: () => setTc(!isTc),
  }
}

// 供需要反向转换 (繁体站正文) 时用
export { s2t, t2s }
