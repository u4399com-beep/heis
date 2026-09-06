'use client'

// ============================================================
// feat-round-11 B2: PwaRegister — Service Worker 注册(client 组件)
// 在 layout.tsx 中以 <PwaRegister /> 形式挂载, 仅在浏览器环境 + 生产环境注册 SW,
// 避免 dev 模式下 SW 缓存干扰 HMR(开发体验回归)。
// 注册失败/不支持时静默降级(SW 不可用 = 普通网站, 不影响功能)。
// ============================================================
import { useEffect } from 'react'

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // dev 模式不注册(SW 缓存会干扰 HMR; Next 16 dev 资源带版本 hash, 无需 SW 兜底)
    if (process.env.NODE_ENV !== 'production') return

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        // 注册成功静默(SW 后台运行, 不打扰用户)
      } catch (_e) {
        // 注册失败静默降级(SW 不可用不影响主功能)
      }
    }
    // 页面 load 后注册, 避免与首屏关键资源竞争带宽
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
      return () => window.removeEventListener('load', register)
    }
  }, [])

  return null
}
