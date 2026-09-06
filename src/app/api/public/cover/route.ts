// 封面webp服务 — data/covers/{file}.webp
import { fail } from '@/lib/api'
import { readCover } from '@/lib/crawl/storage'
import { withGuard, str } from '../../_lib/http'

export async function GET(req: Request) {
  return withGuard(async () => {
    const url = new URL(req.url)
    // searchParams 已做一次URL解码, %2e%2e(%2E%2E) 到这里已是 '..'; 正则 + readCover 的
    // basename 双重防护下, 任何路径穿越输入都会被拒
    const file = str(url.searchParams.get('file'), 200).replace(/^covers\//, '')
    if (!file || !/^\w[\w.-]*\.webp$/.test(file)) {
      return fail('非法的封面文件名', 400)
    }
    let buf: Buffer | null = null
    try {
      buf = await readCover(file)
    } catch {
      buf = null
    }
    if (!buf) return fail('封面不存在', 404)
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
