/** mm 轮: 引擎内路径复现 — parseRuleConfig→buildFetch→fetchPage, 观察是否走桥 */
import { parseRuleConfig } from '../src/lib/crawl/types'
import { fetchPage } from '../src/lib/crawl/fetcher'

const r = await fetch('http://localhost:3000/api/admin/rules/cmtlefjho025hqjh4yzuenady')
const j = await r.json()
const raw = j.data.config as string
const rule = parseRuleConfig(raw)
console.log('parsed fetchMode:', rule.fetch.fetchMode, '| engine:', rule.fetch.engine, '| bridgeUrl:', (rule.fetch as any).scraplingBridgeUrl)

const cfg = { ...rule.fetch }
const res = await fetchPage('https://www.pilishuwu.com/5/2951/info.html', cfg)
console.log('result: engine=', res.engine, 'len=', res.html.length, 'blocked=', res.blocked)
console.log('has works-intro-title:', res.html.includes('works-intro-title'))
process.exit(0)
