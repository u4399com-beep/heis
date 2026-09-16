# R13-1A: multi-search-engine PSEO 书籍页生成

## 任务总览
用 multi-search-engine 获取搜索引擎下拉词，生成 PSEO 形式的书籍页。
基于已有 7 引擎 suggest 实现，新增 PSEO 长尾词程序化生成入口 + LRU 缓存 + BookView/KeywordView UI 增强。

## 修改的文件列表

### 后端 (src/lib + src/app/api)
1. **src/lib/crawl/suggest.ts** — 新增 PSEO 入口 + LRU 缓存
   - `PSEOKeyword` 接口
   - `fetchSuggestKeywordsForBook(bookName, author, limit, category)` 异步聚合 7 引擎
   - `generatePSEOKeywords(bookName, author, category, limit)` 同步(本地兜底)
   - `generatePSEOKeywordsAsync(...)` 异步入口(走引擎聚合)
   - `clearPSEOCache()` 清空缓存
   - LRU 缓存: Map + TTL(24h) + MAX(200), cacheRead 命中后刷新顺序, cacheWrite 超 MAX 淘汰
   - `isLowQualityKeyword()`: 6 类敏感词正则 + 长度/纯数字/纯英文过滤
   - `buildBookQueries()`: 5 个查询词构造
   - 向后兼容: `fetchSuggestKeywords` 和 `mergeSuggestWords` 签名不变

2. **src/app/api/public/keyword/route.ts** — 新增 ?book= 参数模式
   - `?book={bookId}` → 调用 `fetchSuggestKeywordsForBook` 返回 PSEO 关键词 Top 10
   - 主响应新增 `source` 字段 (hits[0].source || 'suggest')

3. **src/app/api/public/keyword/suggest/route.ts** — 新文件
   - `GET ?kw={kw}` → 调用 `fetchSuggestKeywords + mergeSuggestWords` 返回 Top 12 相关词
   - 用于 KeywordView 底部"相关搜索"区块

4. **src/app/api/admin/books/[id]/pseo/route.ts** — 新文件
   - GET: 返回已入库的 PSEO 关键词列表 + 本地模板兜底词
   - POST: 调用 `generatePSEOKeywordsAsync` 跑 7 引擎聚合
     - 默认 limit=30, persist=true (写入 BookTag source='pseo')
     - force=true 时清缓存重抓
     - 引擎失败回退本地模板
     - upsert 原子化写入(避免并发撞 P2003)

### 前端 (src/components/public)
5. **src/components/public/BookView.tsx** — 新增 PSEOKeywordsSection 组件
   - 调用 `fetchBookPSEOKeywords` 拉取该书 PSEO 关键词 Top 10
   - 加载中渲染 8 个骨架圆角块; 失败静默降级 return null
   - 每个词作为 `<a href="/?view=keyword&tag=...&site=...">` (dofollow)
   - onClick 拦截左键 → 客户端 navigate (Ctrl/Cmd 保留浏览器默认)
   - aria-label + title 标注关键词与来源引擎

6. **src/components/public/KeywordView.tsx** — PSEO 落地页模式
   - `isPSEO = source='suggest'|'pseo'|undefined` 时切到 PSEO 模式
   - H1: `"${tag}" 相关小说推荐` (PSEO 模式)
   - meta description: `"${tag}" 相关小说在线阅读, "${tag}" 全文免费阅读, "${tag}" TXT 下载 - ${site.name}`
   - 顶部新增"搜索其他关键词"搜索框 (form + input + 搜索按钮)
   - 底部新增"相关搜索"区块 (调用 `fetchRelatedKeywords` 走 suggest 引擎聚合)
   - JSON-LD name 同步改为 PSEO 模式

7. **src/components/public/data.ts** — 新增 fetch 函数
   - `fetchBookPSEOKeywords(bookId)` → 调用 `/api/public/keyword?book={bookId}`
   - `fetchRelatedKeywords(keyword)` → 调用 `/api/public/keyword/suggest?kw={kw}`

8. **src/components/public/types.ts** — 新增类型
   - `BookPSEOData` 接口 (book + pseoKeywords)
   - `KeywordData.source` 字段 (可选, 'suggest'|'manual'|'pseo')

## 新增的 API 端点

| Method | Path | 用途 |
|--------|------|------|
| GET | `/api/public/keyword?book={bookId}` | 返回该书 PSEO 关键词 Top 10 |
| GET | `/api/public/keyword/suggest?kw={kw}` | 返回某词的引擎聚合相关词 Top 12 |
| GET | `/api/admin/books/[id]/pseo` | 返回该书已入库的 PSEO 关键词 + 本地模板兜底词 |
| POST | `/api/admin/books/[id]/pseo` | 批量生成并入库 PSEO 关键词 (source='pseo') |

## 验证

- **tsc**: `bunx tsc --noEmit` → 0 errors (排除 examples/skills)
- **lint**: `bun run lint` → 0 errors / 0 warnings
- **测试脚本** `/tmp/test-pseo.ts`:
  - `fetchSuggestKeywordsForBook('凡人修仙传', '忘语')`: 返回 30 条
    - Top1 "凡人修仙传小说" source=baidu count=6 score=105
    - Top2-7 多条 bing 引擎命中 (仙界篇/笔趣阁/电视剧/小说仙界篇等)
    - 主源引擎分布: baidu(6) > bing(2) > so360(1)
  - `generatePSEOKeywords` (缓存命中): 返回 30 条 (与异步聚合同源)
  - 缓存未命中场景 (诡秘之主): 走本地模板 10 条
  - 低质量词过滤: 无纯数字 / 无敏感词

## PSEO 关键词生成测试结果

```
=== 测试 fetchSuggestKeywordsForBook (7 引擎聚合) ===
书名: 凡人修仙传 / 作者: 忘语 / 分类: 玄幻
book suggest count: 30
Top 10 关键词:
  凡人修仙传小说 | source=baidu | count=6 | score=105
  凡人修仙传电视剧 | source=bing | count=3 | score=75
  凡人修仙传仙界篇 | source=bing | count=3 | score=75
  凡人修仙传小说笔趣阁 | source=bing | count=3 | score=75
  凡人修仙传小说仙界篇 | source=bing | count=3 | score=75
  凡人修仙传忘语在线阅读 | source=baidu | count=3 | score=75
  凡人修仙传忘语笔趣阁最新 | source=baidu | count=3 | score=75
  凡人修仙传 | source=bing | count=2 | score=70
  凡人修仙传小说在线阅读全本 | source=baidu | count=2 | score=50
  凡人修仙传在线观看 | source=bing | count=2 | score=50

=== 测试 generatePSEOKeywords (本地模板兜底) ===
pseo count: 30 (缓存命中, 与异步聚合同源)

=== 测试缓存命中(再次同步调用 generatePSEOKeywords) ===
缓存后 count: 30
是否来自引擎聚合(应 > 0): ✓ 是

=== 测试无作者场景 ===
无作者 count: 10 (走本地模板)
  诡秘之主 小说 | source=local | score=60
  诡秘之主 全文阅读 | source=local | score=55
  ...

=== 测试低质量词过滤 ===
短书名 count: 10
是否含纯数字: ✓ 通过
是否含敏感词: ✓ 通过
```
