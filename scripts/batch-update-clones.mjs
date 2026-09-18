// Batch-update 34 clone-themes page components to accept initialCategories prop
import { readFileSync, writeFileSync } from 'node:fs'

const files = [
  'pilishuwu/RankingView', 'pilishuwu/BookInfo', 'pilishuwu/KeywordView',
  'pilishuwu/CategoryList', 'pilishuwu/FulltextView', 'pilishuwu/SearchView',
  'trxsw/RankingView', 'trxsw/BookInfo', 'trxsw/KeywordView',
  'trxsw/CategoryList', 'trxsw/FulltextView', 'trxsw/SearchView',
  'aijjxs/ReadChrome', 'aijjxs/RankingView', 'aijjxs/BookInfo',
  'x2552/RankingView', 'aijjxs/KeywordView', 'aijjxs/CategoryList',
  'x2552/BookInfo', 'x2552/KeywordView', 'x2552/CategoryList',
  'x2552/FulltextView', 'x2552/SearchView', 'aijjxs/FulltextView',
  'aijjxs/SearchView', 'ggd66/ReadChrome', 'ggd66/RankingView',
  'ggd66/BookInfo', 'ggd66/KeywordView', 'ggd66/CategoryList',
  'ggd66/FulltextView', 'ggd66/SearchView',
  'huangjinwu/CategoryList', 'huangjinwu/FulltextView',
]

const ROOT = '/home/z/my-project/src/components/public/clone-themes/'

let ok = 0, fail = 0
for (const f of files) {
  const path = ROOT + f + '.tsx'
  let src
  try { src = readFileSync(path, 'utf8') } catch (e) { console.error(`MISS: ${f}`); fail++; continue }
  const before = src

  // 1. Add `initialCategories` to function signature
  src = src.replace(/(\w)\s*\}:\s*(BookInfoProps|CategoryListProps|RankingViewProps|FulltextViewProps|SearchViewProps|KeywordViewProps|ReadChromeProps)\s*\)\s*\{/,
    (_, last, p) => `${last}, initialCategories }: ${p}) {`)

  // 2. Replace `useState<Cat[]>([])` with initialCategories mapped version
  src = src.replace(
    'const [cats, setCats] = useState<Cat[]>([])',
    "const [cats, setCats] = useState<Cat[]>(() => (initialCategories || []).map((c: any) => ({ id: c.id || c.slug || c.name, name: c.name || c.title || String(c) })))"
  )

  // 3. Insert `if (cats.length > 0) return` as first line inside useEffect
  src = src.replace(
    /useEffect\(\(\)\s*=>\s*\{\n(\s+)let aborted = false\n\1fetch\('\/api\/public\/categories\?limit=60'\)/,
    (m, indent) => `useEffect(() => {\n${indent}if (cats.length > 0) return\n${indent}let aborted = false\n${indent}fetch('/api/public/categories?limit=60')`
  )

  // 4. Change deps `}, [])` to `}, [cats.length])` ONLY for the categories-fetching effect.
  src = src.replace(
    /\.catch\(\(\)\s*=>\s*\{\s*if\s*\(!aborted\)\s*setCats\(DEFAULT_NAV\)\s*\}\)\n(\s*)return \(\) => \{ aborted = true \}\n(\s*)\}, \[\]\)/,
    (m) => m.replace('}, [])', '}, [cats.length])')
  )

  if (src === before) {
    console.error(`NOCHANGE: ${f}`)
    fail++
    continue
  }
  writeFileSync(path, src)
  ok++
}

console.log(`\nDone: ${ok} ok / ${fail} fail`)
