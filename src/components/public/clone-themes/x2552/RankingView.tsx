'use client'
import type { RankingViewProps } from '../shared'
import { usePublic } from '../../ctx'
import { bookNavProps } from '../../bits'
const C = {"id":"x2552","bg":"#fafafa","surface":"#fff","text":"#666","muted":"#999","primary":"#2f468f","accent":"#ff6600","border":"#eee","radius":"3px","font":"\"Microsoft YaHei\",sans-serif","maxW":1200}
export function RankingView({ books, loading, tab, onTabChange, page, total, size, onPage }: RankingViewProps) {
  const { navigate } = usePublic()
  const TABS = [{id:'allvisit',name:'总点击'},{id:'allvote',name:'总推荐'},{id:'size',name:'字数榜'},{id:'lastupdate',name:'最近更新'}]
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontFamily: C.font }}>加载中...</div>
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20, fontFamily: C.font, color: C.text }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>排行榜</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(t => <button key={t.id} onClick={() => onTabChange(t.id)} style={{ padding: '6px 16px', background: tab === t.id ? C.primary : C.surface, color: tab === t.id ? '#fff' : C.text, border: '1px solid ' + C.border, borderRadius: C.radius, cursor: 'pointer', fontSize: 14 }}>{t.name}</button>)}
      </div>
      <ol style={{ listStyle: 'none', padding: 0 }}>
        {books.map((b, i) => (
          <li key={b.id} {...bookNavProps(navigate, b.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, marginBottom: 4, background: C.surface, border: '1px solid ' + C.border, borderRadius: C.radius, cursor: 'pointer' }}>
            <span style={{ width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, background: i < 3 ? C.accent : C.border, color: i < 3 ? '#fff' : C.muted, flexShrink: 0 }}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{b.name}</span>
              <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>{b.author} · {b.category}</span>
            </div>
          </li>
        ))}
      </ol>
      {total > size && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          {page > 1 && <button onClick={() => onPage(page - 1)} style={{ padding: '6px 16px', border: '1px solid ' + C.border, borderRadius: C.radius, cursor: 'pointer' }}>上一页</button>}
          <span style={{ padding: '6px 12px' }}>第 {page} 页</span>
          {page * size < total && <button onClick={() => onPage(page + 1)} style={{ padding: '6px 16px', border: '1px solid ' + C.border, borderRadius: C.radius, cursor: 'pointer' }}>下一页</button>}
        </div>
      )}
    </div>
  )
}