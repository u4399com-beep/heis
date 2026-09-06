// 种子脚本: 笔趣阁 bqg713 (www.bqg713.cc) 纯JSON API站采集规则
// 用法: bun run scripts/seed-rule-bqg713.ts
// 需要 src/lib/crawl 引擎的 json/const 字段类型扩展(Task aa-c), 旧引擎会把 json/const 消毒丢弃
//
// ================= API 侦察结论(2026-08-30 实测) =================
// 站点形态: SPA壳(/ 返回1449字节空壳HTML) + hash路由(#/book/{id}/{chapterid}), 页面无SSR内容;
// 数据全部来自 GET JSON API(www 域名自身可直连, curl 通; UA随意):
//  1) GET /api/index?sort=all
//     → {"hotlist":[{id,title,author,intro}]×4, "toplist":[{id,title,author,sortname}]×9,
//        "sort1".."sort6":[{id,title,author,sortname,intro}]×9/栏,
//        "uplist":[{id,title,author,sortname,lastchapterid,lastchapter,uptime}]×30,
//        "addlist":[{id,title,author,sortname}]×30}
//     → 列表发现用并集路径 hotlist,sort1..sort6(58项且多带intro); uplist/addlist/toplist 无intro
//  2) GET /api/book?id={id}
//     → {id,title,sortname,author,full,intro,lastchapterid,lastchapter,lastupdate,dirid}
//     → dirid 实测≡id(5本抽样); SPA 取目录用 dirid(get_booklist(data.dirid))
//     → full: "连载"/"已经完本" → smartCompleteDetect 词表直接命中(连载→ongoing/完本→completed)
//  3) GET /api/booklist?id={dirid}
//     → {"list":["第1章 我有三个相宫","第二章 ...",...]} 纯章节名字符串数组(无章节id)
//     → 章节URL规律: chapterid = 数组下标+1(1基), 全量单次返回无分页
//  4) GET /api/chapter?id={id}&chapterid={n}
//     → {id,chapterid,dirid,title,author,chaptername,cs,ck,txt}  正文=txt(纯文本\n分段), 章名=chaptername
//     → ★ 明文参数形式被 Cloudflare WAF 403(全部API域名 apibi.cc/apiqu.cc/apige.cc 一致;
//       pct编码/参数换序/加垃圾参数/换UA/伪造googlebot 均无效; token=非法值也403)
//     → SPA 实际调用(js/read.js 混淆还原): get_api(name,params) = gethost()+'/api/'+name
//       +'?token='+encodeURIComponent(enaes(JSON.stringify(params)))
//       enaes: code=MD5('book@token.html') 十六进制, iv=Utf8(code前16字符), key=Utf8(code后16字符),
//              AES-CBC-Pkcs7(JSON.stringify({id,chapterid}), key, iv) → base64
//       (逆向+真网 200 双重验证见 mini-services/bqg713-proxy/index.ts 头注释与 worklog cc-d)
//     → ★★ cc-d 重大发现: 章节正文真实 API 域名是站点 JS 内置三域名轮换
//       apibi.cc / apiqu.cc / apige.cc —— www.bqg713.cc/api/chapter 本身被 CF WAF 403
//       属规则侧历史误配(www 域无 /api/chapter 放行规则); 章节请求携带合法 token 时
//       明文 id/chapterid 参数可共存, 纯明文 → 403
//     → cc-d2 收尾对接: mini-services/bqg713-proxy(端口3010)提供 /rewrite?url=<目标URL>
//       外置转换代理 —— 解析目标 URL 的 id/chapterid → AES 合成 token → 返回改写后 URL。
//       采集引擎 bb-d tokenUrl {url} 占位符钩子直接对接: content 段 fetch 配置
//       tokenUrl=http://127.0.0.1:3010/rewrite?url={url} + tokenPattern=token
//       + tokenInjection=url(无 {token} 占位符时引擎自动追加 &token=<enc> 查询参数);
//       list/book/toc 段 URL 无 id/chapterid 双参数 → proxy 404 → 引擎预取静默降级直连,
//       三段明文 API 行为不变。备援域名 apiqu.cc/apige.cc 同算法同 WAF 口径。
//     → dd-b 落置: 引擎级镜像故障切换 mirrorDomains 上线(transport 层失败驱动 host 重写:
//       网络错误/超时/403/5xx 换组内下一镜像重试, 404/2xx/3xx 不触发; token 预取按重写后
//       URL 重签), fetch.mirrorDomains 配三备援域(顺序=优先级)。2026-08-31 dd-b 真网探测
//       三域全活(同章同 token 链路 200+同长 txt), 规则由此钉死单域的历史遗留闭环
//
// 引擎侧配套(Task aa-c): types.ts FieldRule.type 增加 'json'(JSON点路径)/'const'(常量模板
// {字段名}/{index}/{q.查询参数}), itemSelector json 数组路径支持逗号并集; sanitize 白名单同步;
// parseList/parseToc JSON模式; runner/test路由 tocLink 传 urlVars —— 语法契约见 types.ts 头注释
export {}
const BASE = 'http://localhost:3000'

interface RuleSeed {
  name: string
  description: string
  enabled: boolean
  config: unknown
}

const rule: RuleSeed = {
  name: '笔趣阁bqg713(www.bqg713.cc)·纯JSON API站采集',
  description:
    'www.bqg713.cc 纯JSON API站(SPA壳+hash路由无SSR)。列表 /api/index 并集路径(hotlist,sort1~6)/书籍 /api/book/目录 /api/booklist(纯章节名数组, chapterid=下标+1, const模板合成章节API URL)/正文 apibi.cc/api/chapter(txt字段, AES-CBC token 参数)。' +
    '正文段经外置转换代理 mini-services/bqg713-proxy:3010 对接引擎 tokenUrl {url} 钩子(按章签发AES token), 章节 URL 指向站点真实 API 域名 apibi.cc(www 域 /api/chapter 被 WAF 403 属历史误配)。' +
    'dd-b: fetch.mirrorDomains 配三备援域 apibi.cc,apiqu.cc,apige.cc(主域网络错误/超时/403/5xx 引擎自动切镜像, token 按镜像域重签)。',
  enabled: true,
  config: {
    list: {
      enabled: true,
      // /api/index 单次返回全部榜单, 无 {page} 分页(单页58本: hotlist4 + sort1~6 各9)
      urlTemplate: 'https://www.bqg713.cc/api/index?sort=all',
      // json 数组路径并集: 各榜单顺序拼接; toplist/uplist/addlist 无 intro 故未并入
      itemSelector: { type: 'json', expression: 'hotlist,sort1,sort2,sort3,sort4,sort5,sort6' },
      fields: {
        id: { type: 'json', expression: 'id' },
        title: { type: 'json', expression: 'title' },
        author: { type: 'json', expression: 'author' },
        intro: { type: 'json', expression: 'intro' },
        // bookUrl 存书籍API URL(fetcher可直接抓到JSON), 不存SPA hash URL(#/book/{id} 抓回空壳)
        bookUrl: { type: 'const', expression: 'https://www.bqg713.cc/api/book?id={id}' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    book: {
      enabled: true,
      fields: {
        name: { type: 'json', expression: 'title' },
        author: { type: 'json', expression: 'author' },
        category: { type: 'json', expression: 'sortname' },
        intro: { type: 'json', expression: 'intro' },
        // "连载"/"已经完本" 原文透传 → runner smartCompleteDetect 词表命中(ongoing/completed)
        status: { type: 'json', expression: 'full' },
        latestChapter: { type: 'json', expression: 'lastchapter' },
      },
    },
    toc: {
      enabled: true,
      // tocLink: const 模板, {q.id} 取书籍页URL查询参数(dirid 实测≡id)
      // (runner/测试路由里以 urlVars(书籍页URL) 注入 {q.*} 后合成目录API地址)
      tocLink: { type: 'const', expression: 'https://www.bqg713.cc/api/booklist?id={q.id}' },
      // 纯章节名字符串数组: title 用 '.' 取数组项本身; url 用 const 模板合成正文API URL
      itemSelector: { type: 'json', expression: 'list' },
      fields: {
        title: { type: 'json', expression: '.' },
        // {q.id}=目录页(/api/booklist?id=xxx)查询参数; {index}=1基序号(=chapterid)
        // cc-d2: 章节正文改指站点真实 API 域名 apibi.cc(www 域被 WAF 403);
        // 保留明文 id/chapterid 参数形态 —— 外置代理按其合成 token, 引擎注入后带 token 同发
        url: { type: 'const', expression: 'https://apibi.cc/api/chapter?id={q.id}&chapterid={index}' },
      },
      // JSON目录API单次全量返回, 无HTML翻页
      pagination: { enabled: false, maxPages: 1 },
    },
    content: {
      enabled: true,
      fields: {
        // 章节名=chaptername( runner 以目录title入库, 此字段供测试面板/后续对账 )
        title: { type: 'json', expression: 'chaptername' },
        // 正文=txt(纯文本\n分段) — 章节URL已改指 apibi.cc + token 注入(cc-d2)
        content: { type: 'json', expression: 'txt' },
      },
      pagination: { enabled: false, maxPages: 1 },
    },
    fetch: {
      engine: 'http',
      uaMode: 'rotate',
      autoCookie: true,
      referer: true,
      timeout: 20000,
      retries: 2,
      waitMs: 500,
      browserFallbackStatus: [403, 429, 503],
      // ── cc-d2: AES-token 外置转换代理对接(bb-d tokenUrl {url} 占位符钩子) ──
      // 预取 /rewrite?url=<enc(当前请求URL)> → JSON .token 字段(按章 AES-CBC 签发)
      // → tokenInjection=url 无占位符时引擎自动追加 &token=<enc> 查询参数。
      // list/book/toc 段 URL 无 id/chapterid 双参数 → proxy 404 → 引擎静默降级直连(明文API不受影响);
      // 预取带 30s 进程内缓存且缓存键含 real URL(bb-g 修复), 逐章 token 不串台
      tokenUrl: 'http://127.0.0.1:3010/rewrite?url={url}',
      tokenPattern: 'token',
      tokenInjection: 'url',
      // ── dd-b: 镜像域名自动故障切换(引擎级, transport 层) ──
      // URL host + 本列表构成镜像组; 主域网络错误/超时/403/5xx 时按序重写 host 重试
      // (404/2xx/3xx 不触发, 至多组大小次); 每个 host 走完整 fetch 流程,
      // token 预取 {url} 占位符自动拿到重写后 URL → 逐章 token 按镜像域重签。
      // 2026-08-31 dd-b 真网探测三域全活(同章 200 + 同长 txt)后落置
      mirrorDomains: 'apibi.cc,apiqu.cc,apige.cc',
    },
    clean: {
      removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
      adPatterns: [
        '(www\\.)?bqg7[0-9]{1,2}\\.(cc|com)\\S*',
        '(www\\.)?[a-z0-9-]+\\.(com|net|cc|org|info|top|xyz|vip|site)(\\/\\S*)?',
        '请收藏本站.*?手机版',
        '一秒记住.*?免费读',
        '本站所有小说为转载作品.*?$',
      ],
      whitelist: ['p', 'br', 'b', 'strong', 'em', 'i', 'u', 'h1', 'h2', 'h3'],
      // API正文为纯文本\n分段: plainText 模式剥标签保段落, 存库即干净文本
      normalize: true,
      plainText: true,
    },
  },
}

async function main() {
  // 幂等: 同名规则先删后建
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`)
  const listJson = (await listRes.json()) as { ok: boolean; data?: { rules?: { id: string; name: string }[] } }
  const existing = (Array.isArray(listJson.data) ? listJson.data : listJson.data?.rules || []).find((r) => r.name === rule.name)
  if (existing) {
    const del = await fetch(`${BASE}/api/admin/rules/${existing.id}`, { method: 'DELETE' })
    const delJson = (await del.json()) as { ok: boolean }
    console.log('旧规则已删除:', existing.id, delJson.ok)
  }
  const res = await fetch(`${BASE}/api/admin/rules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  })
  const json = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)
}

main()
