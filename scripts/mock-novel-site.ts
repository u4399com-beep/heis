// 本地mock小说站 — 验证采集全链路: 乱序目录/URL+标题去重/正文分页/广告清洗
import http from 'http'

const BOOKS: Record<string, { name: string; author: string; cat: string; intro: string; cover: string }> = {
  '1': { name: '测试之书甲', author: '作者一', cat: '玄幻', intro: '这是一本测试书籍的简介，包含一些内容。 已完结。', cover: '/covers/a.png' },
  '2': { name: '测试之书乙', author: '作者二', cat: '都市', intro: '第二本测试书, 讲述都市故事, 连载中。', cover: '/covers/b.png' },
}

const CHAPTER_TITLES = ['第1章 初入', '第2章 相遇', '第10章 突破', '第3章 风波', '第11章 危机', '第4章 线索', '第5章 反转', '第12章 决战', '第6章 余波', '第13章 新程']

function page302(title: string, url: string): string {
  return `<html><head><meta charset="utf-8"><title>${title} - 乱序测试</title></head>
<body><div id="list"><dl>
${CHAPTER_TITLES.map((t, i) => `<dd><a href="/chapter/${url}/${i + 1}">${t}</a></dd>`).join('\n')}
<dd><a href="/chapter/${url}/1">第1章 初入</a></dd>
</dl></div><a href="/toc/${url}">下一页</a></body></html>`
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://localhost:3030')
  const p = u.pathname
  if (p.startsWith('/covers/')) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    res.writeHead(200, { 'Content-Type': 'image/png' })
    return res.end(png)
  }
  if (p.startsWith('/list/')) {
    const items = Object.entries(BOOKS).map(([id, b]) => `<li><a href="/book/${id}">${b.name}</a></li>`).join('')
    const html = `<html><head><meta charset="utf-8"></head><body><ul class="l">${items}</ul></body></html>`
    res.writeHead(200, { 'Content-Type': 'text/html' })
    return res.end(html)
  }
  if (p.startsWith('/book/')) {
    const id = p.split('/')[2] || ''
    const b = BOOKS[id]
    if (!b) { res.writeHead(404); return res.end('404') }
    const html = `<html><head><meta charset="utf-8"></head><body>
<div id="maininfo"><h1>${b.name}</h1><p>作者：${b.author}</p><p>分类：${b.cat}</p></div>
<div id="intro">${b.intro}</div>
<img id="fmimg" src="${b.cover}"/>
<div id="list-link"><a href="/toc/${id}">查看目录</a></div>
<script>var ad="this should be removed";</script>
</body></html>`
    res.writeHead(200, { 'Content-Type': 'text/html' })
    return res.end(html)
  }
  if (p.startsWith('/toc/')) {
    const id = p.split('/')[2] || '1'
    const html = page302(BOOKS[id]?.name || '', id)
    res.writeHead(200, { 'Content-Type': 'text/html' })
    return res.end(html)
  }
  if (p.startsWith('/chapter/') && !p.endsWith('/p2')) {
    const [, , bid, n] = p.split('/')
    const title = CHAPTER_TITLES[parseInt(n || '1') - 1] || `第${n}章`
    const html = `<html><head><meta charset="utf-8"></head><body>
<div id="content">
<h2>${title}</h2>
<p>这是第${n}章的正文第一页内容。山雨欲来风满楼，主角踏上了新的旅途。</p>
<p>请记住本书首发域名 www.junk-ad.com 免费读</p>
<div id="content-page2-link"><a href="/chapter/${bid}/${n}/p2">下一页</a></div>
</div>
<script>var tracking=1;</script>
</body></html>`
    res.writeHead(200, { 'Content-Type': 'text/html' })
    return res.end(html)
  }
  if (p.endsWith('/p2')) {
    const html = `<html><head><meta charset="utf-8"></head><body><div id="content"><p>这是第二页内容，剧情继续推进。真相渐渐浮出水面。</p></div></body></html>`
    res.writeHead(200, { 'Content-Type': 'text/html' })
    return res.end(html)
  }
  res.writeHead(404); res.end('404')
})

server.listen(3030, () => console.log('mock novel site on :3030'))

export {}
