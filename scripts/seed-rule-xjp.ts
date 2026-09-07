// ============================================================
// 种子脚本: 新键盘小说网 (xinjianpan.com) 采集规则 (Task ss-b2 建, ss-b3 收尾规范化)
// 用法: bun run scripts/seed-rule-xjp.ts
// 幂等: 同名规则 PUT 原位更新(id 稳定); export{} + import.meta.main 守卫(可被 verify 脚本 import 规则配置)
//
// ================= 结构依据(ss-b 探针 + ss-b2 真网复核, 2026-09-04) =================
// 站点: biquge2023 仿站(类名带部署哈希尾缀 -84c1078c, 选择器一律 [class^=] 前缀匹配防尾缀轮换),
//       UTF-8, 桌面/移动 UA 的 HTML 字节级一致, 列表/书页/目录直连零反爬(本轮 9 请求全 200)。
//       正文层"双层": 章节页 #chaptercontent SSR 前半 + <div id="morecontent"> 占位;
//       后半正文加密在页内内嵌 var c(base64 大串, 每章恒定非每请求随机), 由
//       /public/js/get20260103.js(jsjiami.com.v7 RC4 字符串混淆) 客户端解密注入
//       (仅 isMobile() + 10s 倒计时后; console 反调试+debugger 陷阱, 采集侧无需触发)。
// ★解密算法(ss-b2 对真实样本离线复现 100% 还原, 与 ss-b 反混淆产物 tmp/xjp-get-deobfuscated.js 对齐):
//     s       = atob(c)
//     n       = parseInt(s.substring(8, 11), 10)    // 3 位数字, 100..999
//     payload = s.substring(11 + n, s.length - n)   // 掐头(11+n)去尾(n)
//     payload = payload.replace(/-/g,'PHA+').replace(/_/g,'8L3A+')
//             // 标记膨胀: '-' 还原为 base64 组 'PHA+'(=字节 '<p>'), '_' 还原为 '8L3A+'
//     part2   = utf8(atob(payload))                 // <p>分段 HTML
//   → 声明式引擎不可表达 → 外置转换代理 mini-services/xjp-proxy(端口 3015, deqixs-proxy 3014 同形态)
//     承载"章节页抓取→前半SSR+后半解密→合并→HTML→纯文本"全链路。
//
// 六段设计:
//   list   = 直连 /sort/{cat}-{page}.html(玄幻, dl[class^=list-item]×36/页,
//            div[class^=pages] li.next a 翻页; 封面在 a.cover img 的 lazy data-src)
//   book   = 直连书页 /txt/{code}/(h1 标题 + p:contains 定位 作者/状态/最新章节 三行 + bookintro)
//   toc    = tocLink 取书页"章节目录"钮(list-1.html), 目录页 100 章/页 ul>li[class^=list-item],
//            章节锚 href="javascript:;" + onclick="location.href='/txt/{code}/{pg}.html'" →
//            url 字段 attr=onclick + replaceFrom 提取路径并前置代理前缀;
//            翻页锚同为 onclick 形态(span.right a), 末页"没有了"无 onclick → 引擎空值停翻
//   content= 指向代理 /content?u={章节URL}; toc url 字段 replaceFrom '^location\.href=' 前置
//            http://127.0.0.1:3015/content?u=https://www.xinjianpan.com(相对链一次拼成绝对,
//            与 deqixs '^' 前置同思路); 代理侧只接受 xinjianpan /txt/{code}/{page}.html 形态(防开放代理)
//   fetch  = engine http(纯直连+本地代理, 无浏览器面), hostGate 2 保守, waitMs 300 温和
//   clean  = 站点头尾广告行(天才一秒记住/转载请注明来源)+通用尾巴; 代理已输出纯文本, plainText 归一
// ============================================================
export {}
export const RULE_NAME = '新键盘小说网 (xinjianpan.com)·直连+var c解密代理正文'
export const PROXY_BASE = 'http://127.0.0.1:3015'

export const ruleConfig = {
  list: {
    enabled: true,
    // 分类页: /sort/{cat}-{page}.html(cat: xuanhuan/xianxia/dushi/lishi/wangyou/kehuan/lingyi/yanqing/qita)
    // 此处取玄幻; 换分类改 URL 即可
    urlTemplate: 'https://www.xinjianpan.com/sort/xuanhuan-{page}.html',
    itemSelector: { type: 'css', expression: 'dl[class^="list-item"]' },
    fields: {
      // dt a 文本带"(完)"完结标记后缀, 剥离(状态字段另有全本/连载)
      name: { type: 'css', expression: 'dt a', replaceFrom: '\\s*\\(完\\)$', replaceTo: '' },
      bookUrl: { type: 'css', expression: 'dt a', attr: 'href' },
      // 第1个 dd=简介(站方截断形态, 原样保留), 第2个 dd=作者+全本+字数+分类
      intro: { type: 'css', expression: 'dd:nth-of-type(1)', stripTags: true },
      author: { type: 'css', expression: 'dd:nth-of-type(2) a', attr: 'text' },
      status: { type: 'css', expression: 'dd:nth-of-type(2) span:nth-of-type(1)', attr: 'text', replaceFrom: '^全本$', replaceTo: '完结' },
      // lazy 封面: src 为 nocover.svg 占位, 真实封面在 data-src
      cover: { type: 'css', expression: 'a.cover img', attr: 'data-src' },
    },
    pagination: {
      enabled: true,
      nextLink: { type: 'css', expression: 'div[class^="pages"] li.next a', attr: 'href' },
      maxPages: 5,
    },
  },
  book: {
    enabled: true,
    fields: {
      name: { type: 'css', expression: 'h1', attr: 'text' },
      author: { type: 'css', expression: 'p:contains("作者：") a', attr: 'text' },
      // 状态行: <b>状态：</b><span>连载</span> | 2185万字 | 4.66万人在看
      status: { type: 'css', expression: 'p:contains("状态：") span', attr: 'text', replaceFrom: '^连载$', replaceTo: '连载中' },
      latestChapter: { type: 'css', expression: 'p:contains("最新章节：") a', attr: 'text' },
      cover: { type: 'css', expression: 'img[src*="bookimg"]', attr: 'src' },
      intro: { type: 'css', expression: 'div.bookintro p', attr: 'text', replaceFrom: '^小说简介：', replaceTo: '' },
    },
    // 书页"章节目录"钮(另有一处 morechapter 同链, 任取首个)
    tocLink: { type: 'css', expression: 'a[href$="list-1.html"]', attr: 'href' },
  },
  toc: {
    enabled: true,
    // 目录页 100 章/页: <li class="list-item-{hash}"><a href="javascript:;" onclick="location.href='/txt/oaa/xx.html'" title="…">
    itemSelector: { type: 'css', expression: 'li[class^="list-item"]' },
    fields: {
      title: { type: 'css', expression: 'a', attr: 'text' },
      // onclick 值形如 location.href='/txt/oaa/jz7.html' → 捕获路径并前置代理前缀拼成绝对
      // (相对链一次到位, 等价 deqixs '^' 前置思路; 代理侧 parseChapterUrl 只接受
      //  xinjianpan /txt/{code}/{page}.html 形态, 防开放代理滥用)
      url: {
        type: 'css',
        expression: 'a',
        attr: 'onclick',
        replaceFrom: "^location\\.href='(.+)'$",
        replaceTo: 'http://127.0.0.1:3015/content?u=https://www.xinjianpan.com$1',
      },
    },
    // 目录翻页锚同为 onclick 形态: <span class="right"><a onclick="location.href='/txt/oaa/list-N.html'">下一页</a></span>
    // 末页"没有了"无 onclick → 提取空 → absolutize 过滤空 → 停翻(自引用锚也被引擎同源同路径守卫拦)
    pagination: {
      enabled: true,
      nextLink: { type: 'css', expression: 'span.right a', attr: 'onclick', replaceFrom: "^location\\.href='(.+)'$", replaceTo: '$1' },
      maxPages: 130,
    },
  },
  content: {
    enabled: true,
    fields: {
      // 代理已完成 前半SSR+var c 解密后半 合并并输出纯文本(\n 分段)
      content: { type: 'json', expression: 'content' },
    },
    pagination: { enabled: false, maxPages: 1 },
  },
  fetch: {
    engine: 'http',
    // 桌面/移动 UA 的 HTML 字节级一致(ss-b2 diff 实证) → 固定桌面 UA 全段通用
    uaMode: 'custom',
    customUa: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    headers: { Accept: 'application/json,text/html;q=0.9,*/*;q=0.8' },
    autoCookie: false,
    referer: true,
    timeout: 30000,
    retries: 1,
    waitMs: 300,
    // list/book/toc 直连 + content 每章 1 次代理串行上游请求, 同站(=代理)在飞钳 2 保守起步
    hostGateLimit: 2,
  },
  clean: {
    removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
    // 站点章节页头尾广告行(真实样本取证) + 占位残留兜底 + 通用尾巴
    adPatterns: [
      // ss-b3: 行级广告模式 — 引擎 removeAdLines 用 new RegExp(p,'gi') 全文替换, `$` 不带 m
      // 标志只匹配全文末尾, 正文中部广告行用 `.*?$` 永不匹配(实测: 首两章站名广告漏网)。
      // 广告均为独立行, 用 [^\n]* 圈定整行, 清空行由段落归一吸收。
      '[^\\n]*一秒记住[^\\n]*',
      '[^\\n]*第一时间更新[^\\n]*',
      '[^\\n]*xinjianpan\\.com[^\\n]*',
      '《[^\\n]*》转载请注明来源[^\\n]*',
      '更多内容加载中[^\\n]*',
      '请关闭浏览器的阅读模式[^\\n]*',
      '本站只支持手机浏览器访问[^\\n]*',
    ],
    // 代理已输出纯文本 \n 分段: plainText 剥标签保段落, 存库即干净文本
    normalize: true,
    plainText: true,
  },
}

// 127.0.0.1 显式 IPv4: 本环境 next dev 仅监听 IPv4(bun fetch localhost 会先试 ::1 → ConnectionRefused)
const BASE = 'http://127.0.0.1:3000'

async function main() {
  // 幂等: 同名规则 PUT 原位更新(id 稳定) — 删旧建新会让引用该规则的任务 ruleId 悬空
  // (ss-b3 实锤: 任务运行中 DELETE 受保护返回 ok:false, 随后 POST 造成同名重复行)
  const listRes = await fetch(`${BASE}/api/admin/rules?take=100`)
  const listJson = (await listRes.json()) as { ok: boolean; data?: unknown }
  const rules = (Array.isArray(listJson.data) ? listJson.data : []) as { id: string; name: string }[]
  const existing = rules.find((r) => r.name === RULE_NAME)
  const payload = JSON.stringify({
    name: RULE_NAME,
    description:
      '新键盘小说网(xinjianpan.com) biquge2023 仿站: list/book/toc 三段直连 + content 段走外置解密代理。' +
      '正文层双层: #chaptercontent SSR 前半 + var c(base64, 每章恒定) 加密后半由 get20260103.js 客户端解密注入; ' +
      '解密算法已破(s=atob(c); n=parseInt(s[8:11]); payload=s[11+n:len-n]; \'-\'→PHA+, \'_\'→8L3A+ 标记膨胀; atob→UTF-8), ' +
      '超出声明式引擎表达力 → mini-services/xjp-proxy(端口 3015)承载(章节页抓取+双层合并+HTML→纯文本)。 ' +
      'toc url 字段以 attr=onclick + replaceFrom 前置代理前缀(站点章节锚为 javascript:;+onclick 形态, 引擎 javascript: 过滤器要求必须先提取); ' +
      '代理只接受 xinjianpan /txt/{code}/{page}.html 形态(防开放代理)。类名带部署哈希尾缀, 选择器一律 [class^=] 前缀匹配。 ' +
      '代理启动: cd mini-services/xjp-proxy && bun run start; /health 自检 selfTestOk/upstreamReachable。',
    enabled: true,
    config: ruleConfig,
  })
  let res: Response
  if (existing) {
    res = await fetch(`${BASE}/api/admin/rules/${existing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
  } else {
    res = await fetch(`${BASE}/api/admin/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
  }
  const json = (await res.json()) as { ok: boolean; data?: { id?: string }; message?: string }
  console.log('入库结果:', json.ok ? `OK id=${json.data?.id}` : json.message)
  if (!json.ok) process.exit(1)
}

if (import.meta.main) main()
