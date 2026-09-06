/**
 * verify-qq-e2-downloader.ts — qq-e2 残作收编 downloader 域断言(纯离线 mock)
 * 验收对象:
 *   1. [qq-e 原改动验收] generateBookTxt 卷头判重基准 lastEmittedVolume:
 *      空卷名不重置基准(同卷夹未提卷章不重发卷头)/真换卷重发/卷回归重发
 *   2. [qq-e2 新增] stripHtmlToText 实体单遍解码(&amp;lt; 不再链式二次解码成 "<")
 * 纪律: mock.module 掉 @/lib/db(零 DB 触碰); 产物写 data/downloads 后即时删除;
 *      断言计数+ALL PASS 收尾
 */
// qq-e2 收尾: bun:test 由 Bun 运行时内置但类型包未收录 —— 改动态 import + expect-error,
// 消 tsc TS2664/TS2307(运行时行为零变化)
// @ts-expect-error bun:test 运行时存在, 类型包未含声明
const { mock } = await import('bun:test')

const BOOK_ID = 'bk_qqe2_verify'
mock.module('@/lib/db', () => ({
  db: {
    book: {
      findUniqueOrThrow: async (args: any) => ({
        id: BOOK_ID,
        name: 'qq-e2卷头验证书',
        author: '验证作者',
        intro: '<p>简介&amp;lt;保持&amp;gt;测试</p>',
        status: 'completed',
        wordCount: 10000,
        chapters: [
          { idx: 1, title: '第1章 甲', content: '<p>正文甲&amp;lt;标记&amp;gt;保留</p>', storage: 'db', filePath: null, volume: '第一卷' },
          { idx: 2, title: '第2章 乙', content: '<p>正文乙</p>', storage: 'db', filePath: null, volume: '' },
          { idx: 3, title: '第3章 丙', content: '<p>正文丙</p>', storage: 'db', filePath: null, volume: '第一卷' },
          { idx: 4, title: '第4章 丁', content: '<p>正文丁</p>', storage: 'db', filePath: null, volume: '第二卷' },
          { idx: 5, title: '第5章 戊', content: '<p>正文戊</p>', storage: 'db', filePath: null, volume: '第一卷' },
        ],
      }),
    },
  },
}))

const { generateBookTxt } = await import('../src/lib/crawl/downloader')

let pass = 0
let failCnt = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { failCnt++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const res = await generateBookTxt(BOOK_ID, { siteInfo: false, insertAds: false, obfuscate: false }, '验证站', 'https://x.example')
const { readFile, unlink } = await import('fs/promises')
const txt = await readFile('data/' + res.rel, 'utf-8')

console.log('\n== 1. 卷头判重基准 lastEmittedVolume(qq-e 改动验收) ==')
{
  const v1 = (txt.match(/══════ 第一卷 ══════/g) || []).length
  const v2 = (txt.match(/══════ 第二卷 ══════/g) || []).length
  ok(`第一卷卷头恰 2 次(章1+章5卷回归; 修前空卷名清零基准→3次重发), got=${v1}`, v1 === 2, `v1=${v1}`)
  ok(`第二卷卷头恰 1 次, got=${v2}`, v2 === 1, `v2=${v2}`)
  // 位置语义: 第2章(空卷)与第3章(同卷)之间不得出现卷头重发 → 乙丙两章之间无卷头行
  const seg23 = txt.slice(txt.indexOf('第2章 乙'), txt.indexOf('══════ 第二卷'))
  ok('空卷名章+同卷回归章之间零重发卷头', !seg23.includes('══════'), JSON.stringify(seg23.slice(0, 60)))
  ok('真换卷仍插头(第4章前有第二卷卷头)', txt.slice(txt.indexOf('第3章 丙'), txt.indexOf('第4章 丁')).includes('══════ 第二卷 ══════'))
  ok('卷回归仍插头(第5章前有第一卷卷头)', txt.slice(txt.indexOf('第4章 丁'), txt.indexOf('第5章 戊')).includes('══════ 第一卷 ══════'))
  ok('chapters 计数=5', res.chapters === 5, `got=${res.chapters}`)
  ok('5 章正文齐全', ['甲', '乙', '丙', '丁', '戊'].every((c) => txt.includes(`正文${c}`)))
}

console.log('\n== 2. stripHtmlToText 实体单遍解码(qq-e2 新增) ==')
{
  ok('&amp;lt; 在 TXT 保持字面量 &lt;(修前链式二次解码成 <)', txt.includes('正文甲&lt;标记&gt;保留'), JSON.stringify((txt.match(/正文甲.{0,20}/) || [''])[0]))
  ok('TXT 中不得出现二次解码产物 正文甲<标记', !txt.includes('正文甲<标记'))
  ok('简介 &amp;lt; 同口径保持', txt.includes('简介&lt;保持&gt;测试'), JSON.stringify((txt.match(/简介.{0,20}/) || [''])[0]))
}

// 收尾: 删除产物文件
await unlink('data/' + res.rel)
ok('产物文件已清理', true)

console.log('\n==========')
console.log(`PASS ${pass} / FAIL ${failCnt}`)
if (failCnt) { console.log('FAILURES:'); for (const f of failures) console.log('  - ' + f); process.exit(1) }
console.log('ALL PASS')
process.exit(0)

// 模块化: 顶层 await 需要(原 import 面移除后由 dynamic import 承担)
export {}
