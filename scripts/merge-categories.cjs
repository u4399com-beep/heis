// R30: 合并 DB 重复分类 — 将变体("玄幻小说"/"都市娱乐"/"历史军事"等)合并到标准 14 分类
// 逻辑: 对每个分类 normalizeCategory(name), 变体迁移 books.categoryId 到标准分类, 删除变体
const { PrismaClient } = require('@prisma/client')
const db = new PrismaClient()

const ALIASES = {
  '玄幻小说':'玄幻','玄幻魔法':'玄幻','魔幻':'玄幻','异界大陆':'玄幻','异世大陆':'玄幻','东方玄幻':'玄幻',
  '奇幻小说':'奇幻','西方奇幻':'奇幻','史诗奇幻':'奇幻','奇幻魔法':'奇幻',
  '武侠小说':'武侠','传统武侠':'武侠','新武侠':'武侠','武侠仙侠':'武侠',
  '仙侠小说':'仙侠','修真':'仙侠','修仙':'仙侠','古典仙侠':'仙侠','现代仙侠':'仙侠',
  '都市娱乐':'都市','都市异能':'都市','都市生活':'都市','都市言情':'都市','现代都市':'都市','都市职业':'都市','青春都市':'都市',
  '言情小说':'言情','现代言情':'言情','古代言情':'言情','总裁豪门':'言情','甜宠':'言情','豪门':'言情','婚恋':'言情',
  '历史军事':'历史','历史小说':'历史','穿越历史':'历史','古代':'历史','架空历史':'历史','历史架空':'历史','两宋元明':'历史',
  '军事小说':'军事','战争':'军事','抗战':'军事','军旅':'军事',
  '游戏小说':'游戏','网游':'游戏','电竞':'游戏','虚拟网游':'游戏',
  '科幻小说':'科幻','末世危机':'科幻','星际科幻':'科幻','机甲':'科幻',
  '悬疑推理':'悬疑','推理':'悬疑','侦探':'悬疑','刑侦':'悬疑',
  '灵异鬼怪':'灵异','鬼怪':'灵异','盗墓':'灵异','恐怖':'灵异','诡异':'灵异',
  '体育竞技':'体育','竞技':'体育','足球':'体育','篮球':'体育',
  '轻文':'轻小说','日本轻小说':'轻小说',
  '现实生活':'现实','职场':'现实','商战':'现实','社会':'现实','现实主义':'现实',
}
const STD = ['玄幻','奇幻','武侠','仙侠','都市','言情','历史','军事','游戏','科幻','悬疑','灵异','体育','轻小说','现实']
function norm(n) {
  n = (n || '').trim()
  if (!n) return ''
  if (ALIASES[n]) return ALIASES[n]
  if (STD.includes(n)) return n
  for (const s of STD) { if (n.length > s.length && n.includes(s)) return s }
  return n
}

async function main() {
  const cats = await db.category.findMany({ orderBy: { sortOrder: 'asc' } })
  console.log('合并前:', cats.length, '个分类')
  for (const c of cats) console.log('  ', c.sortOrder, c.name)

  const toMerge = []
  for (const c of cats) {
    const normed = norm(c.name)
    if (normed !== c.name) toMerge.push({ id: c.id, old: c.name, new: normed })
  }
  console.log('需合并:', toMerge.length, '个')
  for (const m of toMerge) console.log('  ', m.old, '→', m.new)

  for (const m of toMerge) {
    let std = await db.category.findUnique({ where: { name: m.new } })
    if (!std) {
      std = await db.category.create({ data: { name: m.new, sortOrder: STD.indexOf(m.new) >= 0 ? STD.indexOf(m.new) : 0 } })
    }
    const r = await db.book.updateMany({ where: { categoryId: m.id }, data: { categoryId: std.id } })
    console.log('  迁移', m.old, '→', m.new, ':', r.count, '本书')
    await db.category.delete({ where: { id: m.id } })
  }

  const after = await db.category.findMany({ orderBy: { sortOrder: 'asc' } })
  console.log('合并后:', after.length, '个分类')
  after.forEach(c => console.log('  ', c.sortOrder, c.name))
  await db.$disconnect()
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
