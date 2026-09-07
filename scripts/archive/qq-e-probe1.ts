// qq-e 探针1: sorter 跨卷乱序/同名卷/空卷名行为侦察(只读, 无db)
import { reorderToc, extractVolumeAnchor } from '../src/lib/crawl/sorter'
import type { TocItem } from '../src/lib/crawl/types'

const mk = (title: string, volume?: string): TocItem => ({ title, url: 'u_' + Math.random().toString(36).slice(2), volume })

console.log('--- 场景A: 字段卷 跨卷乱序 [v3块, v1块, v2块] ---')
const A: TocItem[] = [
  mk('第31章 c31', '第三卷'), mk('第32章 c32', '第三卷'),
  mk('第1章 c1', '第一卷'), mk('第2章 c2', '第一卷'),
  mk('第11章 c11', '第二卷'), mk('第12章 c12', '第二卷'),
]
console.log(reorderToc(A).map((x) => x.title).join(' | '))

console.log('--- 场景B: 卷锚点 跨卷乱序 [v3块, v1块, v2块] ---')
const B: TocItem[] = [
  mk('卷三'), mk('第31章'), mk('第32章'),
  mk('卷一'), mk('第1章'), mk('第2章'),
  mk('卷二'), mk('第11章'), mk('第12章'),
]
console.log(reorderToc(B).map((x) => x.title).join(' | '))

console.log('--- 场景C: 同名卷字段交叉出现(kk-a已修, 回归确认) ---')
const C: TocItem[] = [
  mk('第1章', '第一卷 北游'), mk('第11章', '第二卷 南归'), mk('第2章', '第一卷 北游'), mk('第12章', '第二卷 南归'),
]
console.log(reorderToc(C).map((x) => x.title + '@' + (x.volume || '')).join(' | '))

console.log('--- 场景D: 空卷名(空字符串volume)混有卷章节 ---')
const D: TocItem[] = [
  mk('第1章', '第一卷'), mk('第2章', '第一卷'), mk('番外一', ''), mk('第3章', '第一卷'), mk('第4章', '第二卷'),
]
console.log(reorderToc(D).map((x) => x.title + '@' + (x.volume || '∅')).join(' | '))

console.log('--- 场景E: 全角/罗马混合卷号锚点 ---')
console.log('卷 Ⅲ →', JSON.stringify(extractVolumeAnchor('卷 Ⅲ')))
console.log('第２卷 北游 →', JSON.stringify(extractVolumeAnchor('第２卷 北游')))

console.log('--- 场景F: 同名卷锚点出现两次(非连续, 中间隔其他卷) ---')
const F: TocItem[] = [
  mk('第一卷 北游'), mk('第1章'), mk('第2章'),
  mk('第二卷 南归'), mk('第11章'),
  mk('第一卷 北游·续'), mk('第3章'),
]
console.log(reorderToc(F).map((x) => x.title).join(' | '))

console.log('--- 场景G: 字段卷+锚点混合(锚点无字段) ---')
const G: TocItem[] = [
  mk('第一卷 北游', '第一卷 北游'), mk('第2章', '第一卷 北游'), mk('第1章', '第一卷 北游'),
  mk('第二卷 南归'), mk('第12章'), mk('第11章'),
]
console.log(reorderToc(G).map((x) => x.title).join(' | '))
process.exit(0)
