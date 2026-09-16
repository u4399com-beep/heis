import { THEMES, getTheme, getThemeById } from '/home/z/my-project/src/lib/crawl/themes'

console.log('THEMES.length =', THEMES.length) // 期望 10
for (const t of THEMES) {
  console.log('  ', t.id, '|', t.name, '|', t.vars.primary, '|', t.layout, '|', t.contentSelector)
}
console.log('default:', getTheme(undefined).id) // 期望 clone-aijjxs

const expectedIds = [
  'clone-aijjxs',
  'clone-ddyueshu',
  'clone-pilishuwu',
  'clone-23qb',
  'clone-101kks',
  'clone-huangjinwu',
  'clone-ggd66',
  'clone-shipsay',
  'clone-x2552',
  'clone-trxsw',
]

for (const id of expectedIds) {
  const t = getThemeById(id)
  console.log('  ', id, ':', t ? `OK primary=${t.vars.primary} contentSelector=${t.contentSelector}` : 'FAIL')
}
