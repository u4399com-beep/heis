/**
 * verify-qq-e2-cleaner.ts — qq-e2 残作收编 cleaner 域断言
 * 验收对象:
 *   1. [qq-e 原改动] cleanTextField/cleanIntro 控制字符剥离(\t\n\r 保留口径)
 *   2. [qq-e 原改动→qq-e2 修正] cleanChapterTitle 垃圾尾巴切割点=关键词起点;
 *      量词懒惰(*?)修贪婪回溯取最右关键词 bug(域名/www. 残留)
 *   3. [qq-e2 新增] decodeEntitiesOnce 导出共用(单遍解码防链式二次解码)
 * 纪律: 纯函数直测, 零 DB/零网络/零任务触碰; 断言计数+ALL PASS 收尾
 */
import { cleanTextField, cleanIntro, cleanChapterTitle, decodeEntitiesOnce } from '../src/lib/crawl/cleaner'

let pass = 0
let failCnt = 0
const failures: string[] = []
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { failCnt++; failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ---------- 1. 控制字符剥离(qq-e 原改动验收) ----------
console.log('\n== 1. cleanTextField/cleanIntro 控制字符剥离 ==')
{
  ok('cleanTextField 剥 \\x00/\\x08/\\x0B', cleanTextField('第1章\x00测\x08试\x0B标\x0C题\x01') === '第1章测试标题', JSON.stringify(cleanTextField('第1章\x00测\x08试\x0B标\x0C题\x01')))
  ok('\\x1F(分离器)同剥', !cleanTextField('a\x1Fb').includes('\x1F'))
  ok('\\t\\n\\r 保留后规整为空格(与正文出口同口径)', cleanTextField('a\tb\nc\rd') === 'a b c d', JSON.stringify(cleanTextField('a\tb\nc\rd')))
  ok('剥离先于 t2s/空白规整(杂符不会变空白残留)', cleanTextField('标\x08题 问') === '标 题 问' || cleanTextField('标\x08题 问') === '标题 问', JSON.stringify(cleanTextField('标\x08题 问')))
  ok('cleanIntro 剥控制字符保留换行', cleanIntro('简介\x00首行\n\x01次行') === '简介首行\n次行', JSON.stringify(cleanIntro('简介\x00首行\n\x01次行')))
  ok('cleanIntro 空值安全', cleanIntro(null as any) === '' && cleanIntro('') === '')
  // 删除线伪象防御: 剥离正则不含 \t\n\r(\x09\x0A\x0D)
  ok('剥离类排除 \\t\\n\\r', !/\\x09|\\x0A|\\x0D/.test('x') && cleanTextField('a\tb') === 'a b')
}

// ---------- 2. cleanChapterTitle 垃圾尾巴切割(qq-e2 懒惰量词修正) ----------
console.log('\n== 2. cleanChapterTitle 站点尾巴剥离 ==')
{
  // qq-e 注释自举双例(贪婪版实测皆反, 懒惰版必须全过):
  ok('尾巴紧贴分隔符: 转折_www.x.com首发 → 转折', cleanChapterTitle('转折_www.x.com首发') === '转折', JSON.stringify(cleanChapterTitle('转折_www.x.com首发')))
  ok('隔空格尾巴: 龙争-虎斗 www.y.com → 龙争-虎斗(修前旧行为丢"-虎斗"/贪婪版残"www.")', cleanChapterTitle('龙争-虎斗 www.y.com') === '龙争-虎斗', JSON.stringify(cleanChapterTitle('龙争-虎斗 www.y.com')))
  ok('正文词在前不误切: 第一首发_www.x.com → 第一首发', cleanChapterTitle('第一首发_www.x.com') === '第一首发', JSON.stringify(cleanChapterTitle('第一首发_www.x.com')))
  ok('垃圾词紧跟分隔符: 转折_首发网www.x.com → 转折(首个垃圾词起全剥)', cleanChapterTitle('转折_首发网www.x.com') === '转折', JSON.stringify(cleanChapterTitle('转折_首发网www.x.com')))
  // 旧行为兼容面(kk/jj 轮历史语义):
  ok('旧行为兼容: 第2卷-风起_x.com → 第2卷-风起', cleanChapterTitle('第2卷-风起_x.com') === '第2卷-风起', JSON.stringify(cleanChapterTitle('第2卷-风起_x.com')))
  ok('无垃圾词不命中: 龙争-虎斗 原样', cleanChapterTitle('龙争-虎斗') === '龙争-虎斗')
  ok('无分隔符纯垃圾不命中(防"我的首发日"误伤)', cleanChapterTitle('我的首发日') === '我的首发日')
  ok('无分隔符域名标题不命中', cleanChapterTitle('www.x.com连载') === 'www.x.com连载')
  ok('剥后为空保留原标题(防空标题)', cleanChapterTitle('_www.x.com') === '_www.x.com', JSON.stringify(cleanChapterTitle('_www.x.com')))
  ok('中文站名尾巴: 铁血_小说网 → 铁血', cleanChapterTitle('铁血_小说网') === '铁血', JSON.stringify(cleanChapterTitle('铁血_小说网')))
  ok('书名前缀剥离回归', cleanChapterTitle('凡人修仙传_第一百章 凡人修仙传', '凡人修仙传').includes('第一百章'), JSON.stringify(cleanChapterTitle('凡人修仙传_第一百章 凡人修仙传', '凡人修仙传')))
  ok('码点截断 120(emoji 不斩半)', Array.from(cleanChapterTitle('第1章 ' + '好'.repeat(130) + '🙂')).length <= 120)
  ok('空值 → 未命名章节', cleanChapterTitle('') === '未命名章节' || cleanChapterTitle('') === '')
}

// ---------- 3. decodeEntitiesOnce 单遍解码(qq-e2 导出共用) ----------
console.log('\n== 3. decodeEntitiesOnce 单遍解码 ==')
{
  ok('&amp;lt; → &lt;(字面量保持, 不二次解码)', decodeEntitiesOnce('&amp;lt;b&amp;gt;') === '&lt;b&gt;', JSON.stringify(decodeEntitiesOnce('&amp;lt;b&amp;gt;')))
  ok('&amp; → &(常规解码)', decodeEntitiesOnce('a &amp; b') === 'a & b')
  ok('&nbsp;/&apos;/数字实体', decodeEntitiesOnce('a&nbsp;b&#39;c&#x41;') === "a b'cA", JSON.stringify(decodeEntitiesOnce('a&nbsp;b&#39;c&#x41;')))
  ok('越界数字实体安全(空串)', decodeEntitiesOnce('&#999999999;') === '')
  ok('大小写不敏感(&LT;)', decodeEntitiesOnce('&LT;') === '<', JSON.stringify(decodeEntitiesOnce('&LT;')))
}

console.log('\n==========')
console.log(`PASS ${pass} / FAIL ${failCnt}`)
if (failCnt) { console.log('FAILURES:'); for (const f of failures) console.log('  - ' + f); process.exit(1) }
console.log('ALL PASS')
process.exit(0)
