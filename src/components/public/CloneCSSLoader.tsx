'use client'
import { usePublic } from './ctx'
import { useEffect } from 'react'
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
  useEffect(() => {
    if (!cssUrl) return
    const id = 'clone-css-' + theme.layout
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = cssUrl; link.id = id
    document.head.appendChild(link)
  }, [cssUrl, theme.layout])
  return null
}
