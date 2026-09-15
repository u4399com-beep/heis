// Verify themes.ts post R10-1A
import { THEMES, getTheme, getThemeById } from '/home/z/my-project/src/lib/crawl/themes'

console.log('THEMES.length =', THEMES.length)  // 期望 9
for (const t of THEMES) console.log('  ', t.id, '|', t.name, '|', t.layout)
console.log('default:', getTheme(undefined).id)  // 期望 clone-aijjxs
const expectedIds = ['clone-aijjxs', 'clone-ddyueshu', 'clone-pilishuwu', 'clone-23qb', 'clone-101kks', 'clone-huangjinwu', 'clone-ggd66', 'clone-shipsay', 'clone-x2552']
for (const id of expectedIds) {
  const t = getThemeById(id)
  console.log('  ', id, ':', t ? `OK primary=${t.vars.primary} layout=${t.layout}` : 'FAIL')
}
// Verify combos no longer exist
console.log('combo-lookup (should be undefined):', getThemeById('violet-aurora-shelf-home'))
console.log('combo-lookup-2 (should be undefined):', getThemeById('sunset-cyberpunk-biquge-home'))
