/**
 * moli-bridge — Moli (Rust AI browser) 桥接服务
 * ============================================================
 * 背景: Moli 是专为 AI Agent 打造的开源浏览器(https://github.com/lexmount/moli)
 *   - Rust 从零写的浏览器内核, 自带 V8/CSS/布局/软件渲染引擎
 *   - 按需渲染: 平时不布局不绘制不占显存, 截图时才渲染一帧
 *   - 内存占用远低于 Chrome headless(~50MB vs ~700MB)
 *   - 支持 CDP 协议, Playwright 可直接连接
 *   - 支持 --dump markdown/json/semantic_tree + --eval JS
 *
 * 本服务封装 moli fetch 命令, 提供HTTP API:
 *   GET /health                → 健康检查
 *   GET /metrics               → Prometheus 指标
 *   GET /info                  → 版本+配置
 *   POST /fetch                → { url, dump?, eval?, waitUntil?, timeout? } → { ok, html, title, status, finalUrl }
 *   POST /screenshot           → { url, full?, timeout? } → { ok, image (base64) }
 *
 * 启动: cd mini-services/moli-bridge && bun run dev (端口 3017)
 */
import { createBridgeServer, json } from '../_shared/server'
import { accessSync, constants } from 'node:fs'

const PORT = Number(process.env.PORT || 3017)
const MOLI_BIN = process.env.MOLI_BIN || process.env.HOME + '/.local/bin/moli'

interface FetchOptions {
  url: string
  dump?: 'json' | 'html' | 'markdown' | 'semantic_tree' | 'semantic_tree_text'
  eval?: string
  waitUntil?: string
  timeout?: number
  headers?: Record<string, string>
  disableJs?: boolean
}

async function execMoli(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([MOLI_BIN, 'fetch', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  // 30s 超时
  const timer = setTimeout(() => proc.kill(), 30000)
  try {
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    const code = await proc.exited
    return { stdout, stderr, code }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * R7-28 selfTest (audit-16 fix):
 * 旧实现返回 { ok, detail } 对象, 与 _shared/server.ts 的 selfTest?:
 * () => boolean | Promise<boolean> 契约不符(/health.selfTestOk 字段污染为对象);
 * 且依赖 Bun.spawn 同步抛异常检测缺失二进制 —— Bun.spawn 对不存在路径在某些 Bun 版本
 * 仅在 await proc.exited 时以非零 code 返回, 不抛同步异常, selfTest 恒为 ok:true
 * 即使 moli 未安装。改为 fs.accessSync(F_OK) 探测二进制文件存在性, 失败返回 false
 * (与 bqg713/deqixs-proxy 等同款 boolean 契约); detail 文本仅在 console 启动日志保留。
 */
function moliBinaryAvailable(): boolean {
  try {
    accessSync(MOLI_BIN, constants.F_OK | constants.X_OK)
    return true
  } catch {
    return false
  }
}

const server = createBridgeServer({
  name: 'moli-bridge',
  port: PORT,
  idleTimeoutS: 60,
  selfTest: moliBinaryAvailable,
  fetch: async (req: Request) => {
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === '/fetch') {
      const body = await req.json() as FetchOptions
      if (!body.url) return json({ ok: false, error: 'url required' }, 400)

      const args: string[] = []
      if (body.dump) args.push('--dump', body.dump)
      if (body.eval) args.push('--eval', body.eval)
      if (body.waitUntil) args.push('--wait-until', body.waitUntil)
      if (body.disableJs) args.push('--disable-js')
      if (body.headers) {
        for (const [k, v] of Object.entries(body.headers)) {
          args.push('-H', `${k}: ${v}`)
        }
      }
      args.push(body.url)

      const { stdout, stderr, code } = await execMoli(args)
      if (code !== 0 && !stdout) {
        return json({ ok: false, error: stderr || 'moli fetch failed', code }, 502)
      }

      // 如果 dump=json, 解析 JSON
      if (body.dump === 'json') {
        try {
          const data = JSON.parse(stdout)
          return json({ ok: true, ...data })
        } catch {
          return json({ ok: false, error: 'invalid JSON from moli', raw: stdout.slice(0, 500) }, 502)
        }
      }

      return json({ ok: true, html: stdout, len: stdout.length })
    }

    if (req.method === 'POST' && url.pathname === '/screenshot') {
      const body = await req.json() as { url: string; full?: boolean; timeout?: number }
      if (!body.url) return json({ ok: false, error: 'url required' }, 400)

      const args = ['--layout', '--image', '--font', '--dump', body.full ? 'screenshot_full' : 'screenshot', body.url]
      const { stdout, stderr, code } = await execMoli(args)
      if (code !== 0 && !stdout) {
        return json({ ok: false, error: stderr || 'screenshot failed', code }, 502)
      }
      // stdout 是二进制 PNG, 转 base64
      const buf = Buffer.from(stdout, 'binary')
      return json({ ok: true, image: buf.toString('base64'), format: 'png' })
    }

    return json({ ok: false, error: 'not found' }, 404)
  },
})

console.log(`[moli-bridge] serving on port ${PORT}, moli=${MOLI_BIN}, selfTest=${moliBinaryAvailable() ? 'PASS' : 'FAIL(missing binary)'}`)
