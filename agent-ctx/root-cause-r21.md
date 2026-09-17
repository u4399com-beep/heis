# 主题不是 1:1 克隆的根因分析 (R21)

## 根因 1: clone-themes 组件是通用模板，不是 1:1 克隆

**现状**: 所有 10 套主题的 8 个组件都是同一个通用模板，只是 `const C` 配色对象不同：
```tsx
// aijjxs/HomeClone.tsx — 只是换了颜色的通用网格
const C = { bg: "#f3efe7", primary: "#0f766e", ... }
export function HomeClone({ books, loading }) {
  return <div style={{ background: C.bg, ... }}>
    <header><h1>{site.name}</h1></header>
    <div style={{ display: 'grid', ... }}>{books.map(b => <卡片/>)}</div>
  </div>
}
```

**源站 aijjxs.com 实际 DOM**:
```
.top-float > nav.top-float-nav (16个分类链接) + .top-float-auth (登录/注册)
.wrap > header.top > .top-1 > h1.logo + form.search + .search-history (热搜词)
     > main.layout (grid 1fr 330px) > section > article.panel.latest-upload
     > aside > article.panel (排行榜)
     > footer.foot (友情链接)
```

**差距**: 我们的代码完全没有复刻源站的 DOM 结构(class名/层级/元素)。

## 根因 2: BookView/CategoryView/ReadView 没有接线 clone-themes

- HomeView: 13 处 clone-themes 引用 ✓
- BookView: 0 处 ✗ (用通用内联 BookInfoComponent)
- CategoryView: 0 处 ✗ (用通用内联 CatListComponent)
- ReadView: 0 处 ✗ (用通用内联 ReadChromeComponent)

## 根因 3: 没有加载源站 CSS

源站 CSS 已抓到 `agent-ctx/probe-html2/probe-*.css`，但没有复制到 `public/clone-css/` 让组件用源站 class 名。

## 修复方案

1. 复制源站 CSS 到 `public/clone-css/`
2. 创建 CloneCSSLoader 按主题加载 CSS
3. 重写 aijjxs/HomeClone 为真正 1:1 克隆（复刻 .top-float/.wrap/.panel DOM）
4. 接线 BookView/CategoryView/ReadView 使用 clone-themes
5. 修复最新章节 = 全书倒数12章
