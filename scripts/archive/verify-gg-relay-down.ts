export {}
// gg 中继桥·失败分类验证: 中继服务不在(死端口)时, relayHop 抛 RelayTransportError
// 语义(消息含"中继不可达"), 供 fetchHttpWithCurlSingle 据此落 curl 兜底 ——
// 目标侧响应(403/5xx)与中继层失败的二分类是"不双发"契约的前提。
// 运行: FETCH_RELAY_URL 指向死端口后 import 引擎(模块加载时读 env), bun 直跑。
// 注意: 必须在 import 前设置 FETCH_RELAY_URL —— 本文件顶部即设置, 引擎模块随后加载。
process.env.FETCH_RELAY_URL = 'http://127.0.0.1:4999'

async function main() {
  const { fetchHttpForTest } = await import('../src/lib/crawl/fetcher')
  let msg = ''
  try {
    await fetchHttpForTest('http://example.invalid/', {} as import('../src/lib/crawl/types').FetchConfig, 'test-ua', 'http://127.0.0.1:3991', 'relay')
    console.log('❌ 未抛错(中继死端口应抛 RelayTransportError)')
    process.exit(1)
  } catch (e: unknown) {
    const err = e as Error
    msg = `${err.name}: ${err.message}`
    const classified = err.name === 'RelayTransportError' && msg.includes('中继不可达')
    console.log(`${classified ? '✅' : '❌'} 中继层失败分类: ${msg.slice(0, 160)}`)
    process.exit(classified ? 0 : 1)
  }
}
main()
