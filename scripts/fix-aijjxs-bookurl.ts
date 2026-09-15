import { db } from '/home/z/my-project/src/lib/db'

async function main() {
  const r = await db.rule.findFirst({ where: { name: '久久小说(aijjxs.com)·toplist分类列表' } })
  if (!r) { console.log('Rule not found'); process.exit(1) }
  
  const cfg = JSON.parse(r.config)
  
  // In JS source code: '\\d' is the string \d (one backslash + d)
  // JSON.stringify will encode it as "\\d" (two chars: backslash, d)
  // JSON.parse will decode it back to \d
  // new RegExp('/txt/(\\d+)\\.html') → wait, the string IS /txt/(\d+)\.html
  // Actually: the JS string literal '/txt/(\\d+)\\.html' has value /txt/(\d+)\.html
  cfg.list.fields.bookUrl = {
    type: 'css',
    expression: 'h4 a',
    attr: 'href',
    replaceFrom: '/txt/(\\d+)\\.html',
    replaceTo: 'https://www.aijjxs.com/read/$1/'
  }
  
  const configStr = JSON.stringify(cfg)
  await db.rule.update({ where: { id: r.id }, data: { config: configStr } })
  
  // Verify
  const r2 = await db.rule.findFirst({ where: { id: r.id } })
  const cfg2 = JSON.parse(r2.config)
  const rf = cfg2.list.fields.bookUrl.replaceFrom
  const rt = cfg2.list.fields.bookUrl.replaceTo
  console.log('replaceFrom:', JSON.stringify(rf))
  console.log('replaceTo:', JSON.stringify(rt))
  
  // Test regex
  const re = new RegExp(rf, 'g')
  const testUrl = '/txt/57329.html'
  const result = testUrl.replace(re, rt)
  console.log('Regex test:', testUrl, '->', result)
  
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
