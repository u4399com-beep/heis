// ============================================================
// verify-ll-c-sorter.ts — ll-c 分卷排序深审断言(kk 轮新代码面边界条件)
// 覆盖: 卷章混写标题提号 / 罗马数字卷号 / 全半角数字 / 卷名含数字干扰 /
//       卷名为空 / 只有卷名无章节 / 章号重复稳定性 / 无号小卷组反翻误判
// 运行: bun scripts/verify-ll-c-sorter.ts
// ============================================================
import { reorderToc, extractChapterNo, extractVolumeAnchor } from '../src/lib/crawl/sorter'
import type { TocItem } from '../src/lib/crawl/types'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: string) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, d ?? '') } }

console.log('== 1. 卷章混写标题: 提号应取章号而非卷号 ==')
// kk 轮 extractChapterNo 的单位类 [章节回集卷篇] 左扫描, "第二卷 第10章" 先命中"第二卷"(卷
// 属于单位类) → 返回卷号 2 而非章号 10 —— 卷字段组内全部混写章提号相同, 组内排序退化为
// 原始顺序(乱序目录修不动)。
ok('1a extractChapterNo("第二卷 第10章 试炼")=10', extractChapterNo('第二卷 第10章 试炼') === 10, `实际=${extractChapterNo('第二卷 第10章 试炼')}`)
ok('1b extractChapterNo("第三卷 第45章 大结局")=45', extractChapterNo('第三卷 第45章 大结局') === 45, `实际=${extractChapterNo('第三卷 第45章 大结局')}`)
// 混写卷前缀是纯卷标题(非锚点判定不回归): "第二卷 第10章" 仍不得当卷锚点
ok('1c 混写标题不判卷锚点(属章节)', extractVolumeAnchor('第二卷 第10章 试炼') === null)
// 纯卷标题提号行为保持(kk 轮语义: 拍平模式下"第五卷"=5)
ok('1d 纯卷标题提号保持: "第五卷"=5', extractChapterNo('第五卷') === 5, `实际=${extractChapterNo('第五卷')}`)
ok('1e 纯卷标题提号保持: "第三篇"=3', extractChapterNo('第三篇') === 3, `实际=${extractChapterNo('第三篇')}`)

const hy: TocItem[] = [
  { title: '第二卷 第20章 甲', url: 'h1', volume: '第二卷' },
  { title: '第二卷 第10章 乙', url: 'h2', volume: '第二卷' },
  { title: '第二卷 第30章 丙', url: 'h3', volume: '第二卷' },
]
const rhy = reorderToc(hy).map((x) => x.title)
ok('1f 卷字段组内混写标题按章号重排 10→20→30', rhy.join(',') === '第二卷 第10章 乙,第二卷 第20章 甲,第二卷 第30章 丙', JSON.stringify(rhy))

console.log('== 2. 罗马数字卷号(kk 轮只认阿拉伯+中文数字, 罗马卷号整卷失效) ==')
ok('2a Volume III 锚点 no=3', extractVolumeAnchor('Volume III')?.no === 3, JSON.stringify(extractVolumeAnchor('Volume III')))
ok('2b 卷 IV 锚点 no=4', extractVolumeAnchor('卷 IV')?.no === 4, JSON.stringify(extractVolumeAnchor('卷 IV')))
ok('2c Unicode 罗马卷号: 卷 Ⅲ → no=3', extractVolumeAnchor('卷 Ⅲ')?.no === 3, JSON.stringify(extractVolumeAnchor('卷 Ⅲ')))
ok('2d 非罗马字母不误判: "卷积云"非锚点', extractVolumeAnchor('卷积云') === null)
// 重排级: 罗马卷锚点目录 — 修前锚点判空 → 卷标题被当无号章拍平排尾
const rom: TocItem[] = [
  { title: 'Volume II', url: 'v2' },
  { title: '第3章', url: 'c3' }, { title: '第4章', url: 'c4' },
  { title: 'Volume I', url: 'v1' },
  { title: '第1章', url: 'c1' }, { title: '第2章', url: 'c2' },
]
const rrom = reorderToc(rom).map((x) => x.title)
ok('2e 罗马卷锚点重排: 卷I组→卷II组且卷扉在首', rrom.join(',') === 'Volume I,第1章,第2章,Volume II,第3章,第4章', JSON.stringify(rrom))

console.log('== 3. 全半角数字混合 ==')
ok('3a 全角章号: "第１２章 试炼"=12', extractChapterNo('第１２章 试炼') === 12, `实际=${extractChapterNo('第１２章 试炼')}`)
ok('3b 全角卷号锚点: "第２卷 北游" no=2', extractVolumeAnchor('第２卷 北游')?.no === 2, JSON.stringify(extractVolumeAnchor('第２卷 北游')))
ok('3c 半角不受影响: "第12章"=12', extractChapterNo('第12章') === 12)

console.log('== 4. 卷名含数字干扰(kk 轮已正确, 回归守卫) ==')
const gd = extractVolumeAnchor('第三卷 2023 特别篇')
ok('4a "第三卷 2023 特别篇"锚点 no=3', gd?.no === 3, JSON.stringify(gd))
ok('4b 卷名保留数字段', gd?.name === '2023 特别篇', JSON.stringify(gd?.name))
ok('4c "第2023章"仍是章(不误判卷锚点)', extractVolumeAnchor('第2023章 第三卷年特别篇') === null)

console.log('== 5. 边界: 卷名为空/只有卷名无章节/章号重复(kk 轮已正确, 回归守卫) ==')
const onlyVol = reorderToc([{ title: '第一卷', url: 'v' }])
ok('5a 只有卷名无章节: 原样保留', onlyVol.length === 1 && onlyVol[0].title === '第一卷', JSON.stringify(onlyVol.map((x) => x.title)))
const emptyVolField: TocItem[] = [
  { title: '第2章', url: 'e2', volume: '   ' },
  { title: '第1章', url: 'e1', volume: '' },
]
ok('5b 卷字段全空白 → 无卷上下文, 按章号排序', reorderToc(emptyVolField).map((x) => x.title).join(',') === '第1章,第2章')
const dup: TocItem[] = [
  { title: '第5章 重', url: 'd1' },
  { title: '第5章 甲', url: 'd2' },
  { title: '第5章 乙', url: 'd3' },
  { title: '第1章', url: 'd4' },
]
ok('5c 章号重复: 同号保持首现相对顺序, 1 在前', reorderToc(dup).map((x) => x.url).join(',') === 'd4,d1,d2,d3', JSON.stringify(reorderToc(dup).map((x) => x.url)))

console.log('== 6. 无号小卷组: 反翻检测不应翻转源站阅读序 ==')
// sortByChapterNo 的倒序检测对【2 项无号组】按单次 localeCompare 判定整组翻转:
// "上篇"(U+4E0A) < "下篇"(U+4E0B) → 判"递减" → 翻转成 下篇,上篇 —— 与源站阅读序相反。
// 修后: 小样本(无号组 <8 项)不做倒序翻转, 尊重源站顺序。
const smallGroup: TocItem[] = [
  { title: '上篇', url: 's1', volume: '卷A' },
  { title: '下篇', url: 's2', volume: '卷A' },
]
const rsmall = reorderToc(smallGroup).map((x) => x.title)
ok('6a 无号 2 项卷组保持源站顺序(上篇→下篇)', rsmall.join(',') === '上篇,下篇', JSON.stringify(rsmall))
// 实锤修前翻转bug: 楔子(U+6954) localeCompare > 尾声(U+5C3E) → 单次比较判"递减" → 整组翻转
// 成 [尾声,楔子] —— 与源站阅读序(楔子在前)相反(修前 bun 实测复现)
const wedge: TocItem[] = [
  { title: '楔子', url: 'w1', volume: '卷A' },
  { title: '尾声', url: 'w2', volume: '卷A' },
]
const rwedge = reorderToc(wedge).map((x) => x.title)
ok('6a2 无号 2 项卷组保持源站顺序(楔子→尾声)', rwedge.join(',') === '楔子,尾声', JSON.stringify(rwedge))
// 全局无号路径(无卷上下文)同样受守卫: 2 项不翻转
const tinyGlobal: TocItem[] = [
  { title: '上篇', url: 'g1' },
  { title: '下篇', url: 'g2' },
]
ok('6b 全局无号 2 项保持源站顺序', reorderToc(tinyGlobal).map((x) => x.title).join(',') === '上篇,下篇', JSON.stringify(reorderToc(tinyGlobal).map((x) => x.title)))
// 倒序检测对大样本仍生效(既有行为回归守卫): 10 项倒序无号标题仍翻转回正序
const desc10: TocItem[] = Array.from({ length: 10 }, (_, i) => ({ title: `卷之${['一','二','三','四','五','六','七','八','九','十'][9 - i]}`, url: `z${i}` }))
const rdesc = reorderToc(desc10).map((x) => x.url).join(',')
ok('6c 大样本(10项)倒序仍检测翻转回正序', rdesc === 'z9,z8,z7,z6,z5,z4,z3,z2,z1,z0', rdesc)

console.log('\n== 7. kk 轮既有场景回归(verify-kk-a-sorter 同款) ==')
const cross: TocItem[] = [
  { title: '第1章', url: 'x1', volume: '卷A' },
  { title: '第5章', url: 'x5', volume: '卷B' },
  { title: '第2章', url: 'x2', volume: '卷A' },
  { title: '第6章', url: 'x6', volume: '卷B' },
]
ok('7a 交叉卷名聚合保持', reorderToc(cross).map((x) => x.title).join(',') === '第1章,第2章,第5章,第6章')
const messy: TocItem[] = [
  { title: '第20章', url: 'm20', volume: '第三卷' },
  { title: '第9章', url: 'm9', volume: '第二卷' },
  { title: '第2章', url: 'm2', volume: '第一卷' },
  { title: '第1章', url: 'm1', volume: '第一卷' },
]
ok('7b 全乱序卷间+卷内重排保持', reorderToc(messy).map((x) => x.title).join(',') === '第1章,第2章,第9章,第20章')
// 无卷上下文零回归(纯章号)
const plain: TocItem[] = [
  { title: '第12章', url: 'p12' }, { title: '序章', url: 'p0' }, { title: '第1章', url: 'p1' },
]
ok('7c 无卷上下文: 章号升序+无号章排尾保持', reorderToc(plain).map((x) => x.url).join(',') === 'p1,p12,p0')

console.log(`\nPASS ${pass} / FAIL ${fail}`)
process.exit(fail ? 1 : 0)
