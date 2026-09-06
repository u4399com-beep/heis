// ============================================================
// 种子脚本: 番茄小说聚合API (fq.taijiwang.top) 采集规则 (Task cc-c)
// 用法: bun run scripts/seed-rule-fanqie.ts
// 幂等: 同名规则先删后建; export{} + import.meta.main 守卫(可被 verify 脚本 import 规则配置)
//
// ================= 结构依据(书源 JSON 反编译, 非实测) =================
// 参考 scripts/archive/reference-shuyuan-7724.json — "阅读(legado)"书源 🍅番茄小说聚合API V3.2
// (2026.8.20 by 艳阳, bookSourceUrl=https://fq.taijiwang.top, header 内 Android 移动 UA)。
// ★ API 可达性: 2026-08-31 主控侦察与本轮 502 矩阵(裸域 fq.taijiwang.top 全路径
//   502 nginx Bad Gateway 552B, http/https 同; www 子域不解析; 根域/api. 子域拒绝连接;
//   书源全文仅此一域名无镜像线索) → 【API 暂不可达, 本规则未实测】, 结构按 legado JS
//   逐行翻译, 真实响应形状若有出入优先核对 itemSelector 的 book_data 层。
//
// 四层端点(legado 原文):
//  1) searchUrl: /api/search?key={key}&tab_type=3(小说)&offset=(page-1)*10
//     响应 d.data.search_tabs[] 内 tab_type==3 项的 data[] 是分组数组, 每组 g.book_data[]
//     才是书数组(book_name/author/thumb_url/book_id/abstract/category)
//     → 引擎扩展: map-collect(跨数组元素取属性展平) + [k=v] 过滤: search_tabs[tab_type=3].data.book_data
//  2) book 详情: /api/detail?book_id={book_id}(legado ruleBookInfo $.data.data.*),
//     字段 book_name/author/category/tags/abstract/thumb_url/creation_status('0'=连载中否则完结)
//  3) toc: /api/book?book_id={book_id}&bid={book_id}(legado tocUrl: detail→book + &bid=),
//     响应 d.data.data.chapterListWithVolume =【数组的数组】(卷→章), volumeNameList 卷名
//     → 引擎扩展: `*` 递归展平段 chapterListWithVolume.* → 章节平面(itemId/title)
//     注: 卷标题行(isVolume)需合成无URL条目, 引擎目录条目必须持有效章节链接, 卷名不表达(留档)
//  4) content: /api/content?tab=%E5%B0%8F%E8%AF%B4(=小说, legado TAB())&item_id={itemId}&bid={bid},
//     响应 d.data.content 纯文本 \n 分段 → clean.plainText 模式成段
//     注: 主控任务书曾写 content tab=3, 与 legado 原文(TAB()=URL编码的"小说")不一致,
//     按 legado 原文实现; API 恢复后如 404 可一键改 const 模板为 tab=3 再验
// itemId 为长数字, legado 亦 JSON.parse 直用(源可用) → 视为字符串安全范围, mock 按字符串
// ============================================================
export {}
export const RULE_NAME = '番茄小说聚合API (fq.taijiwang.top)'

export const ruleConfig = {
  list: {
    enabled: true,
    // 搜索词按任务口径固定"剑"(URL编码防传输层歧义); {offset:10}=runner cc-c 扩展 (page-1)*10
    urlTemplate: 'https://fq.taijiwang.top/api/search?key=%E5%89%91&tab_type=3&offset={offset:10}',
    // 三层嵌套一次下钻: 先按 tab_type==3 过滤频道, 再跨 tab.data 与组.book_data 两级 map-collect 展平
    itemSelector: { type: 'json', expression: 'data.search_tabs[tab_type=3].data.book_data' },
    fields: {
      name: { type: 'json', expression: 'book_name' },
      author: { type: 'json', expression: 'author' },
      intro: { type: 'json', expression: 'abstract' },
      category: { type: 'json', expression: 'category' },
      cover: { type: 'json', expression: 'thumb_url' },
      // book_id 命中纯数字才合成详情API URL(分组残片等脏项 book_id 为空 → 字段全空被丢弃)
      // 相对路径模板: parseList 对 urlFields 做 absolutize(按列表页URL), 与 host 无关
      // (mock 验证/真实域名/换镜像域都通, 引擎统一补全 scheme+host)
      bookUrl: {
        type: 'json',
        expression: 'book_id',
        replaceFrom: '^(\\d+)$',
        replaceTo: '/api/detail?book_id=$1',
      },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: 'json', expression: 'data.data.book_name' },
      author: { type: 'json', expression: 'data.data.author' },
      category: { type: 'json', expression: 'data.data.category' },
      keywords: { type: 'json', expression: 'data.data.tags' },
      intro: { type: 'json', expression: 'data.data.abstract' },
      cover: { type: 'json', expression: 'data.data.thumb_url' },
      // creation_status '0'=连载中(legado 口径); 完结值未知→保持原值交 smartCompleteDetect 词表兜底
      status: { type: 'json', expression: 'data.data.creation_status', replaceFrom: '^0$', replaceTo: '连载中' },
    },
  },
  toc: {
    enabled: true,
    // legado tocUrl: 书籍URL detail→book + &bid=book_id; {q.book_id} 取书籍详情URL查询参数。
    // 相对路径模板: runner.extractToc 对 tocLink 结果做 absolutize(按书籍页URL)补全 host
    tocLink: { type: 'const', expression: '/api/book?book_id={q.book_id}&bid={q.book_id}' },
    // 数组的数组递归展平 → 章节对象平面(itemId/title)
    itemSelector: { type: 'json', expression: 'data.data.chapterListWithVolume.*' },
    fields: {
      title: { type: 'json', expression: 'title' },
      // 供 const url 模板引用(parseToc JSON 模式两阶段提取, cc-c 扩展)
      itemId: { type: 'json', expression: 'itemId' },
      // 相对路径模板: parseToc 对章节URL做 absolutize(按目录页URL)补全 host。
      // tab 取值按 legado 原文 TAB()=%E5%B0%8F%E8%AF%B4(URL编码的"小说"), 非 tab_type=3;
      // API 恢复后如 404 可一键改本模板为 tab=3 再验
      url: {
        type: 'const',
        expression: '/api/content?tab=%E5%B0%8F%E8%AF%B4&item_id={itemId}&bid={q.book_id}',
      },
    },
    // 目录API单次全量返回(数组的数组), 无HTML翻页
    pagination: { enabled: false, maxPages: 1 },
  },
  content: {
    enabled: true,
    fields: {
      content: { type: 'json', expression: 'data.content' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  fetch: {
    engine: 'http',
    // 书源 header 的 Android 移动 UA(SearchCraft/3.6.5)
    uaMode: 'custom',
    customUa:
      'Mozilla/5.0 (Linux; Android 10; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/78.0.3904.108 Mobile Safari/537.36 SearchCraft/3.6.5 (Baidu; P1 9.0)',
    headers: { Accept: 'application/json' },
    autoCookie: true,
    referer: true,
    timeout: 20000,
    retries: 2,
    waitMs: 500,
    hostGateLimit: 3,
  },
  clean: {
    removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
    adPatterns: [
      '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
      '一秒记住.*?免费读',
      '请记住本书.*?域名',
    ],
    whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u'],
    // API 正文为纯文本 \n 分段: plainText 剥标签保段落, 存库即干净文本(bqg713 同范式)
    normalize: true,
    plainText: true,
  },
}

const BASE = 'http://localhost:3000'

async function main() {
  // 幂等: 同名规则先删后建(GET /api/admin/rules 信封 data 直为数组)
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`)
  const listJson = (await listRes.json()) as { ok: boolean; data?: unknown }
  const rules = (Array.isArray(listJson.data) ? listJson.data : []) as { id: string; name: string }[]
  const existing = rules.find((r) => r.name === RULE_NAME)
  if (existing) {
    const del = await fetch(`${BASE}/api/admin/rules/${existing.id}`, { method: 'DELETE' })
    const delJson = (await del.json()) as { ok: boolean }
    console.log('旧规则已删除:', existing.id, delJson.ok)
  }
  const res = await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: RULE_NAME,
      description:
        '番茄小说聚合API(fq.taijiwang.top)四层JSON采集: search(tab_type=3嵌套数组过滤+map-collect展平)/detail/book(数组的数组*展平)/content。' +
        '结构依据 legado 书源 V3.2 反译。⚠ API 于 2026-08-31 全路径 502 暂不可达, 规则未实测, 恢复后请四段复验。' +
        '引擎依赖: cc-c jsonGet [n]/[k=v]/*/map-collect + parseToc 两阶段vars + runner {offset:N}。',
      enabled: true,
      config: ruleConfig,
    }),
  })
  const json = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)
}

if (import.meta.main) main()
