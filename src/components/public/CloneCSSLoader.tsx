'use client'
// CloneCSSLoader: 按当前主题加载源站 CSS 文件到 <head>
// 这样所有 clone-themes 组件可以直接用源站 class 名, 不需要 theme.vars 抽象
import { usePublic } from './ctx'
import { useEffect } from 'react'

const SITE_CSS_MAP: Record<string, string> = {
  'clone-aijjxs': '/clone-css/aijjxs.css',
  'clone-ddyueshu': '/clone-css/ddyueshu.css',
  'clone-pilishuwu': '/clone-css/pilishuwu.css',
  'clone-23qb': '/clone-css/23qb.css',
  'clone-101kks': '/clone-css/101kks.css',
  'clone-huangjinwu': '/clone-css/huangjinwu.css',
  'clone-ggd66': '/clone-css/ggd66.css',
  'clone-shipsay': '/clone-css/shipsay.css',
  'clone-x2552': '/clone-css/x2552.css',
  'clone-trxsw': '/clone-css/trxsw.css',
}

export function CloneCSSLoader() {
  const { theme } = usePublic()
  const cssUrl = SITE_CSS_MAP[theme.layout]
  
  useEffect(() => {
    if (!cssUrl) return
    // 检查是否已加载
    const existing = document.getElementById('clone-css-' + theme.layout)
    if (existing) return
    
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = cssUrl
    link.id = 'clone-css-' + theme.layout
    document.head.appendChild(link)
    
    return () => {
      // 不立即删除, 主题切换后旧 CSS 留着不影响(CSS 作用域不冲突)
      // 实际清理在下一次加载时由新 CSS 覆盖
    }
  }, [cssUrl, theme.layout])
  
  return null
}
