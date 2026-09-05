// ============================================================
// Task ee-d 验证脚本② — fetchHttp 错误路径 bodyHtml 解码一致性(GBK 中文挑战壳漏判)
// 场景: 源站返回 HTTP 403 + GBK 编码中文挑战壳(≥1200字节, 无 ASCII 强标记,
//       title="请稍候…", 正文含"正在进行安全验证"强标记)。
//       fetchHttp 错误路径 bodyHtml 用 res.text() 硬 utf8 解码 —— GBK 壳页变乱码:
//       STRONG_BLOCK_MARKERS 中文标记匹配不到 + 乱码 title 恰好不含 bad 词 →
//       hasNormalTitle()=true + 长度≥1200 → looksBlocked()=false(盾页被当正常内容)。
//       curl 出口同型错误路径早已用 decodeBuffer(带 Content-Type charset) 正确解码
//       —— 同一响应两个传输出口挑战判定分裂(bun fetch 漏判 / curl 正确)。
// 断言: 捕获 fetchHttpWithCurlFallback 抛出的错误(err.status=403, err.bodyHtml 为壳页):
//       修前 looksBlocked(err.bodyHtml)===false(FAIL) → 修后 ===true(PASS)
// 运行: bun scripts/verify-ee-d-gbk.ts
// ============================================================
import http from 'http'
import iconv from 'iconv-lite'

export {}

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${name}${detail ? ' — ' + detail : ''}`) }
}

const PORT = 3377
const BASE = `http://127.0.0.1:${PORT}`

// GBK 中文挑战壳: 无任何 ASCII 强标记(just a moment/cf-chl 等), 仅有中文强标记;
// 长度 ≥1200 字节 + title 为挑战提示(解码正确时 hasNormalTitle=false, 解码错乱时=true)
const shellHtml = `<!DOCTYPE html><html><head><title>请稍候…</title><meta charset="gbk"></head><body><div class="wrap"><h1>正在进行安全验证</h1><p>本网站使用安全服务以保护您免受攻击。请稍候，验证完成后即可继续访问。</p><p>${'防护检测进行中，请勿关闭页面，否则需要重新验证。'.repeat(40)}</p></div></body></html>`
const gbkBody = iconv.encode(shellHtml, 'gbk')

const server = http.createServer((req, res) => {
  res.writeHead(403, {
    'Content-Type': 'text/html; charset=gbk',
    'Content-Length': String(gbkBody.length),
  })
  res.end(gbkBody)
})
await new Promise<void>((r) => server.listen(PORT, () => r()))

const { fetchHttpWithCurlFallback } = await import('../src/lib/crawl/fetcher')
const { looksBlocked } = await import('../src/lib/crawl/fetcher')

try {
  console.log(`\n== 场景: HTTP 403 + GBK 中文挑战壳(${gbkBody.length}字节, 无ASCII强标记) ==`)
  ok('mock 壳页按 GBK 正确解码后 looksBlocked===true(壳页判定基准自检)', looksBlocked(iconv.decode(gbkBody, 'gbk')))

  const cfg = {
    engine: 'http' as const,
    uaMode: 'custom' as const,
    customUa: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ee-d-verify',
    timeout: 8000,
    retries: 0,
    autoCookie: true,
    referer: true,
  }
  let captured: any = null
  try {
    await fetchHttpWithCurlFallback(`${BASE}/book`, cfg as any, cfg.customUa)
    console.log('  (未抛错?)')
  } catch (e: any) {
    captured = e
  }
  ok('请求按预期抛出 HTTP 403', captured?.status === 403, `status=${captured?.status} msg=${String(captured?.message).slice(0, 80)}`)
  ok('err.bodyHtml 已带回(错误路径挑战识别原料)', typeof captured?.bodyHtml === 'string' && captured.bodyHtml.length > 500, `len=${captured?.bodyHtml?.length}`)
  ok(
    '403 GBK 中文挑战壳被 looksBlocked 正确判拦(三出口解码一致)',
    looksBlocked(captured?.bodyHtml || '') === true,
    `looksBlocked=${looksBlocked(captured?.bodyHtml || '')} bodyHtml头120=${String(captured?.bodyHtml || '').slice(0, 120).replace(/\uFFFD/g, '<FFFD>')}`
  )
} finally {
  server.close()
  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`)
  process.exit(fail ? 1 : 0)
}
