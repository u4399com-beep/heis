'use client'
// R24: 直接渲染 <link> — SSR + client 都加载源站 CSS
// (之前 useEffect 注入, SSR 时不执行 → SSR HTML 无源站 CSS → 用户看到无样式 DOM)
// React 19 / Next.js App Router 会自动 hoist <link> 到 <head>
import { usePublic } from './ctx'
const MAP: Record<string,string> = {
  'clone-aijjxs':'/clone-css/aijjxs.css','clone-ddyueshu':'/clone-css/ddyueshu.css',
  'clone-pilishuwu':'/clone-css/pilishuwu.css','clone-23qb':'/clone-css/23qb.css',
  'clone-101kks':'/clone-css/101kks.css','clone-huangjinwu':'/clone-css/huangjinwu.css',
  'clone-ggd66':'/clone-css/ggd66.css','clone-shipsay':'/clone-css/shipsay.css',
  'clone-x2552':'/clone-css/x2552.css','clone-trxsw':'/clone-css/trxsw.css',
}
export function CloneCSSLoader() {
  const { theme } = usePublic()
  const cssUrl = MAP[theme.layout]
  if (!cssUrl) return null
  return <link rel="stylesheet" href={cssUrl} />
}
