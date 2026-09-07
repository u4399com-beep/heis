// ============================================================
// feat-round-11 B2: Service Worker — 离线 App Shell + 静态资源缓存
// (vanilla JS, 无 Workbox 依赖, ~85 行)
//
// 缓存策略:
//   · 静态资源(icons / manifest / svg): cache-first(命中即返回, 后台更新)
//   · 导航请求(mode === 'navigate'): network-first, 失败回退缓存的 App Shell
//   · API 请求(/api/*): network-only(动态数据不缓存, 避免陈旧)
//   · 其它同源静态资源(_next/static 等): stale-while-revalidate
//
// 生命周期:
//   · install: 预缓存 App Shell(/, /manifest.json, /icon.svg)
//   · activate: 清理旧版本缓存(CACHE_VERSION 升级即丢弃旧 cache)
//   · fetch: 上述策略分发
//
// 注意:
//   · 本 SW 不缓存 Next.js 动态路由(用户/书/章节数据), 离线时仅保证
//     "应用外壳"可打开(空首页/离线提示), 内容仍需联网加载。
//   · 不拦截跨域请求(第三方封面图等)。
//   · 不缓存 POST/PUT/DELETE(只缓存 GET/HEAD)。
// ============================================================

const CACHE_VERSION = 'heis-v1-r11'
const PRECACHE_URLS = ['/', '/manifest.json', '/icon.svg']
const STATIC_ASSET_RE = /\/(_next\/static|icon\.svg|manifest\.json|robots\.txt|logo\.svg)(\?|$)/

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION)
      // 预缓存逐个 try, 单个失败不影响整体 install(网络抖动不应阻塞 SW 启用)
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: 'no-cache' }))
          } catch (_e) {
            /* 静默: 预缓存失败由后续 fetch 策略补偿 */
          }
        }),
      )
      // install 完成后立即激活(跳过 waiting)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清理旧版本缓存(任何非当前 CACHE_VERSION 的 cache 全删)
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      )
      // 立即接管所有 client(不等下次导航)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  // 只拦截 GET/HEAD; POST/PUT/DELETE 一律放行(network-only 等价)
  if (req.method !== 'GET' && req.method !== 'HEAD') return

  const url = new URL(req.url)
  // 仅同源请求走缓存策略; 跨域(第三方封面/CSS)放行直连
  if (url.origin !== self.location.origin) return

  // 1) API 请求: network-only(动态数据不缓存)
  if (url.pathname.startsWith('/api/')) {
    return // 不调用 event.respondWith, 浏览器默认走网络
  }

  // 2) 导航请求: network-first, 失败回退缓存的 App Shell(/)
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req)
          // 异步更新缓存(不阻塞响应)
          const cache = await caches.open(CACHE_VERSION)
          cache.put('/', fresh.clone()).catch(() => {})
          return fresh
        } catch (_e) {
          // 离线: 回退缓存的 App Shell(/ 预缓存或上次访问留下的)
          const cache = await caches.open(CACHE_VERSION)
          const cached = (await cache.match('/')) || (await cache.match(req))
          if (cached) return cached
          // 兜底离线页(无任何缓存时)
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>离线</title><body style="font:14px/1.6 system-ui;background:#09090b;color:#a1a1aa;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px"><div><div style="font-size:48px">📖</div><p style="margin-top:12px">当前离线, 请连接网络后重试</p></div></body>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )
        }
      })(),
    )
    return
  }

  // 3) 静态资源(图标/manifest/_next/static): cache-first, 后台更新(stale-while-revalidate)
  if (STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION)
        const cached = await cache.match(req)
        // 后台更新(不阻塞响应)
        const networkUpdate = fetch(req)
          .then((fresh) => {
            if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {})
            return fresh
          })
          .catch(() => null)
        // 命中即返回, 未命中等网络
        if (cached) {
          // 触发后台更新(不 await)
          networkUpdate.catch(() => {})
          return cached
        }
        const fresh = await networkUpdate
        if (fresh) return fresh
        // 都失败: 兜底空响应
        return new Response('', { status: 504, statusText: 'Gateway Timeout' })
      })(),
    )
    return
  }

  // 4) 其它同源 GET: 默认 network-first, 失败回退缓存(兼容性兜底)
  event.respondWith(
    (async () => {
      try {
        return await fetch(req)
      } catch (_e) {
        const cache = await caches.open(CACHE_VERSION)
        const cached = await cache.match(req)
        if (cached) return cached
        return new Response('', { status: 504, statusText: 'Gateway Timeout' })
      }
    })(),
  )
})
