// cc-d2 引擎链路验证探针: src/lib/crawl/fetcher fetchPage + tokenUrl {url} 形态
// 断言: (a)无 token 直连 apibi.cc/api/chapter 明文参数 → 403(基线复现)
//       (b)带 tokenUrl=http://127.0.0.1:3010/rewrite?url={url} + tokenPattern=token
//          + tokenInjection=url → 200 且非空正文
//       (c)连续两章各取各的 token(缓存键 bb-g 修复后不串台)
// 运行: bun scripts/probe-cc-d2-engine.ts
export {}
import { fetchPage } from '@/lib/crawl/fetcher'
import type { FetchConfig } from '@/lib/crawl/types'

const CH1 = 'https://apibi.cc/api/chapter?id=2530&chapterid=1'
const CH2 = 'https://apibi.cc/api/chapter?id=2530&chapterid=2'

async function main() {
  // (a) 基线: 无 token 明文直连 → 期望 403/blocked(前驱 cc-d 实测, 复核)
  // fetcher 在 retries 用尽仍失败时抛错(错误信息含末次状态码), 基线里这是预期结果
  try {
    const base = await fetchPage(CH1, {
      engine: 'http',
      uaMode: 'rotate',
      timeout: 20000,
      retries: 0,
      browserFallbackStatus: [],
    })
    console.log('[a] 无token直连: engine=' + base.engine + ' blocked=' + base.blocked + ' len=' + base.html.length + ' head=' + JSON.stringify(base.html.slice(0, 60)))
    if (!base.blocked && base.html.length > 500) console.log('[warn] 无 token 直连未被判拦, 基线行为与 cc-d 记录不一致, 请复核')
  } catch (e: unknown) {
    console.log('[a] 无token直连抛错(预期403基线): ' + (e instanceof Error ? e.message : String(e)))
  }

  // (b) 引擎 token 钩子链路: 预取 → 注入 → 200
  const cfg: Partial<FetchConfig> = {
    engine: 'http',
    uaMode: 'rotate',
    timeout: 20000,
    retries: 0,
    tokenUrl: 'http://127.0.0.1:3010/rewrite?url={url}',
    tokenPattern: 'token',
    tokenInjection: 'url',
  }
  const r1 = await fetchPage(CH1, cfg)
  console.log('[b] ch1: blocked=' + r1.blocked + ' len=' + r1.html.length)
  const j1 = JSON.parse(r1.html) as { chaptername?: string; txt?: string }
  console.log('[b] ch1 chaptername=' + (j1.chaptername || '') + ' txtLen=' + (j1.txt || '').length)
  if (r1.blocked || !j1.txt || j1.txt.length < 200) throw new Error('ch1 token 链路 FAIL')

  // (c) 第二章(不同 chapterid → proxy 签发不同 token, 验证缓存不串台)
  const r2 = await fetchPage(CH2, cfg)
  const j2 = JSON.parse(r2.html) as { chaptername?: string; txt?: string }
  console.log('[c] ch2: blocked=' + r2.blocked + ' chaptername=' + (j2.chaptername || '') + ' txtLen=' + (j2.txt || '').length)
  if (r2.blocked || !j2.txt || j2.txt.length < 200) throw new Error('ch2 token 链路 FAIL(缓存串台?)')
  if (j1.chaptername === j2.chaptername) throw new Error('两章同名, 疑似 token 串台复用')

  console.log('PASS: 引擎链路验证 ch1/ch2 双章 200 非空正文, token 按章分键')
}
main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
