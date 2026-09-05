// 解壳+存盘: book4.cc 多页面侦察
// 用法: bun run scripts/probe-cc-a-pages.ts
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

function unwrap(raw: string): { shell: boolean; html: string } {
  const m = raw.match(/html_b\s*=\s*"([A-Za-z0-9+/=\s]+)"/)
  if (!m) return { shell: false, html: raw }
  const b64 = m[1].replace(/\s+/g, '')
  const html = Buffer.from(b64, 'base64').toString('utf8')
  return { shell: true, html }
}

const targets: Record<string, string> = {
  list: 'https://book4.cc/AU%E6%96%87%E5%AD%A6/',
  home: 'https://book4.cc/',
  book: 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E5%90%8C%E4%BA%BA/411853/',
}

async function main() {
  for (const [name, url] of Object.entries(targets)) {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
    })
    const raw = await res.text()
    const { shell, html } = unwrap(raw)
    const fs = await import('node:fs')
    fs.writeFileSync(`/home/z/my-project/tmp/cc-a/${name}.html`, html)
    console.log(`${name}: ${res.status} shell=${shell} rawLen=${raw.length} decodedLen=${html.length} finalUrl=${res.url}`)
    await new Promise((r) => setTimeout(r, 1200))
  }
  process.exit(0)
}
main()

export {}
