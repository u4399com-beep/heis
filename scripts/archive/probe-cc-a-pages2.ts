// 解壳+存盘 round2: 分类分页/book.json端点/章节页/d.js
// 用法: bun run scripts/probe-cc-a-pages2.ts
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

function unwrap(raw: string): { shell: boolean; html: string } {
  const m = raw.match(/html_b\s*=\s*"([A-Za-z0-9+/=\s]+)"/)
  if (!m) return { shell: false, html: raw }
  const b64 = m[1].replace(/\s+/g, '')
  return { shell: true, html: Buffer.from(b64, 'base64').toString('utf8') }
}

const targets: Record<string, string> = {
  catXianxia: 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/',
  catXianxiaP2: 'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/2/',
  bookJson: 'https://book4.cc/show_jsload_book_info/auwxw/411853/book.json',
  chapter:
    'https://book4.cc/AU%E6%96%87%E5%AD%A6/%E4%BB%99%E4%BE%A0/411853/YXV3eHcvNDExODUzL2FIUjBjSE02THk5M2QzY3VZWFYzZUhjdVkyOXRMMkYxY21WaFpDODFNamcwTUY4ek16QXdPREU0Tmk1b2RHMXMuanNvbg==.html',
  djs: 'https://book4.cc/static/tp2/d.js?t=1234567890',
}

async function main() {
  const fs = await import('node:fs')
  for (const [name, url] of Object.entries(targets)) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow' })
      const raw = await res.text()
      const { shell, html } = unwrap(raw)
      fs.writeFileSync(`/home/z/my-project/tmp/cc-a/${name}.html`, html)
      console.log(`${name}: ${res.status} shell=${shell} rawLen=${raw.length} len=${html.length} ct=${res.headers.get('content-type')} final=${res.url}`)
    } catch (e) {
      console.log(`${name}: ERROR ${e}`)
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
  process.exit(0)
}
main()

export {}
