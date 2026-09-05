// kk-a 场景2修正: 真实番茄形态(卷内绝大多数带章号, 特殊章如"楔子"既有行为=排组尾)
import { reorderToc } from '../src/lib/crawl/sorter'
import type { TocItem } from '../src/lib/crawl/types'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: string) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, d ?? '') } }

// 场景2(真实番茄): 卷字段+章号, 特殊章"楔子"跟随既有全局行为(NaN 排组尾)
const tomatoshape: TocItem[] = [
  { title: '第二章', url: 'https://t.com/2', volume: '第一卷北游' },
  { title: '楔子', url: 'https://t.com/0', volume: '第一卷北游' },
  { title: '第一章', url: 'https://t.com/1', volume: '第一卷北游' },
  { title: '新篇第二章', url: 'https://t.com/5', volume: '第二卷南归' },
  { title: '新篇第一章', url: 'https://t.com/4', volume: '第二卷南归' },
]
const r2 = reorderToc(tomatoshape)
const t2 = r2.map(x => x.title)
const v1 = t2.slice(0, 3), v2 = t2.slice(3)
ok('卷1在前: 3项', v1.length === 3 && v1.every(t => ['第一章','第二章','楔子'].includes(t)), JSON.stringify(t2))
ok('卷1内章号相对序: 第一章<第二章', v1.indexOf('第一章') < v1.indexOf('第二章'), JSON.stringify(v1))
ok('卷2在后: 新篇章序正确', v2.join(',') === '新篇第一章,新篇第二章', JSON.stringify(v2))
ok('无号章(楔子)不跨卷泄漏', v2.every(t => t.startsWith('新篇')))

// 场景5: 源站乱序+卷字段(卷间也乱序) — 全乱序修复
const messy2: TocItem[] = [
  { title: '第20章', url: 'https://m.com/20', volume: '第三卷' },
  { title: '第9章', url: 'https://m.com/9', volume: '第二卷' },
  { title: '第2章', url: 'https://m.com/2', volume: '第一卷' },
  { title: '第1章', url: 'https://m.com/1', volume: '第一卷' },
  { title: '第10章', url: 'https://m.com/10', volume: '第二卷' },
  { title: '第19章', url: 'https://m.com/19', volume: '第三卷' },
]
const r5 = reorderToc(messy2)
const t5 = r5.map(x => x.title)
ok('全乱序: 卷1→卷2→卷3 且卷内章序正确', t5.join(',') === '第1章,第2章,第9章,第10章,第19章,第20章', JSON.stringify(t5))

// 场景6: 同一卷名交叉出现(非连续) — 分组按卷名聚合重排
const cross: TocItem[] = [
  { title: '第1章', url: 'https://x.com/1', volume: '卷A' },
  { title: '第5章', url: 'https://x.com/5', volume: '卷B' },
  { title: '第2章', url: 'https://x.com/2', volume: '卷A' },
  { title: '第6章', url: 'https://x.com/6', volume: '卷B' },
]
const r6 = reorderToc(cross)
ok('交叉卷名聚合(卷A全部→卷B全部)', r6.map(x => x.title).join(',') === '第1章,第2章,第5章,第6章', JSON.stringify(r6.map(x => x.title)))

console.log(`\nPASS ${pass} / FAIL ${fail}`)
process.exit(fail ? 1 : 0)
// kk-a 正式版: 上述 6 场景 + 甄别记录:
// - "无号章(楔子/序)排组尾"系既有全局行为(extractChapterNo NaN 排尾)在卷内的延续, kk-a 零回归原则不改动
// - 卷内 validRatio<0.6 走自然比较分支亦为既有兜底行为, 真实番茄数据 validRatio>0.9 不触发
