/** verify-qq-e2-sorter.ts — qq-e2 残作收编 sorter④ 断言: 无号卷装配式归位(纯离线)
 *  修复对象: reorderWithVolumes 旧比较器"有号vs无号→无号恒在前"把目录尾部无号卷
 *  (番外/后记/最终话)错插全书最前([第一卷,第二卷,番外]→[番外,第一卷,第二卷])。
 *  新语义: 首个有号卷之前的无号组→排最前(前言/作品相关不变); 其余无号组→紧跟源站前置有号卷。
 *  口径: 卷序=volume 首现去重序列; 章序=title。
 */
import { reorderToc } from '../src/lib/crawl/sorter'
import type { TocItem } from '../src/lib/crawl/types'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: string) => { if (c) { pass++; console.log('  ✓', n) } else { fail++; console.log('  ✗', n, d ?? '') } }
const items = (defs: Array<[string, string]>): TocItem[] => defs.map(([title, vol], i) => ({ title, url: `u${i}`, volume: vol }))
const volSeq = (xs: TocItem[]) => [...new Set(xs.map((x) => x.volume))]

console.log('== 1. 尾部无号卷归位(修复核心) ==')
const r1 = reorderToc(items([
  ['第1章 甲', '第一卷'], ['第2章 乙', '第一卷'],
  ['第3章 丙', '第二卷'], ['第4章 丁', '第二卷'],
  ['番外一', '番外篇'], ['后记', '后记'],
]))
ok('1a 尾部无号卷保持末尾(旧实现会错插最前)', JSON.stringify(volSeq(r1)) === JSON.stringify(['第一卷', '第二卷', '番外篇', '后记']), `实际=${JSON.stringify(volSeq(r1))}`)

console.log('== 2. 头部无号卷语义不变 ==')
const r2 = reorderToc(items([
  ['前言', '前言'], ['作品相关', '作品相关'],
  ['第1章 甲', '第一卷'], ['第2章 乙', '第二卷'],
]))
ok('2a 首个有号卷之前的无号组仍排最前', JSON.stringify(volSeq(r2)) === JSON.stringify(['前言', '作品相关', '第一卷', '第二卷']), `实际=${JSON.stringify(volSeq(r2))}`)

console.log('== 3. 卷间夹注紧跟其前置有号卷 ==')
const r3 = reorderToc(items([
  ['第1章 甲', '第一卷'], ['第2章 乙', '第一卷'],
  ['间注A', '间注A'],
  ['第3章 丙', '第二卷'], ['第4章 丁', '第二卷'],
]))
ok('3a 夹注跟在第一卷之后', JSON.stringify(volSeq(r3)) === JSON.stringify(['第一卷', '间注A', '第二卷']), `实际=${JSON.stringify(volSeq(r3))}`)

console.log('== 4. 纯无号卷: 首现序零回归 ==')
const r4 = reorderToc(items([
  ['第1章 甲', '序'], ['第2章 乙', '正文集'], ['第3章 丙', '杂篇'],
]))
ok('4a 全无号按首现序', JSON.stringify(volSeq(r4)) === JSON.stringify(['序', '正文集', '杂篇']), `实际=${JSON.stringify(volSeq(r4))}`)

console.log('== 5. 有号卷乱序进入仍按卷号升序 ==')
const r5 = reorderToc(items([
  ['第5章 戊', '第三卷'],
  ['第1章 甲', '第一卷'],
  ['第3章 丙', '第二卷'],
]))
ok('5a 卷号升序重排', JSON.stringify(volSeq(r5)) === JSON.stringify(['第一卷', '第二卷', '第三卷']), `实际=${JSON.stringify(volSeq(r5))}`)

console.log('== 6. 同卷章内顺序(乱序目录修排)不回归 ==')
const r6 = reorderToc(items([
  ['第10章 癸', '第一卷'], ['第2章 乙', '第一卷'], ['第1章 甲', '第一卷'],
]))
ok('6a 同卷按章号升序', r6[0].title.includes('第1章') && r6[2].title.includes('第10章'), `实际=${JSON.stringify(r6.map((x) => x.title))}`)

console.log(`\nverify-qq-e2-sorter: ${pass} pass / ${fail} fail ${fail === 0 ? '— ALL PASS' : '— FAIL'}`)
process.exit(fail === 0 ? 0 : 1)
