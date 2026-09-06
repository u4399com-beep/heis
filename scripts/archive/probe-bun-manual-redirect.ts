// 探针: 验证 bun fetch redirect:'manual' 是否可读 3xx 状态行/Location/Set-Cookie 头
// (fetchHttp 多跳增强重放的前置事实核对)
import http from 'http'

const hits: string[] = []
const server = http.createServer((req, res) => {
  hits.push(req.url || '/')
  const c = req.headers.cookie || '(none)'
  if (req.url === '/a') {
    res.writeHead(302, { Location: '/b', 'Set-Cookie': ['k1=v1; Path=/'] })
    return res.end('hop1')
  }
  if (req.url === '/b') {
    res.writeHead(301, { Location: 'http://127.0.0.1:' + PORT + '/c', 'Set-Cookie': ['k2=v2; Path=/'] })
    return res.end('hop2 got cookie: ' + c)
  }
  if (req.url === '/c') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': ['k3=v3; Path=/'] })
    return res.end('<html><title>final</title><body>final hop, cookie=' + c + '</body></html>')
  }
  res.writeHead(404)
  res.end('nf')
})

const PORT = 3311
server.listen(PORT, '127.0.0.1', async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/a`, { redirect: 'manual' })
    console.log('manual status:', res.status, 'type:', (res as any).type, 'url:', res.url)
    console.log('location:', res.headers.get('location'))
    const sc = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : 'NO getSetCookie'
    console.log('setCookie:', JSON.stringify(sc))
    const t = await res.text()
    console.log('body:', JSON.stringify(t.slice(0, 60)))
  } catch (e: any) {
    console.log('manual ERR:', e?.message)
  } finally {
    server.close()
    console.log('server hits:', JSON.stringify(hits))
  }
})

export {}
