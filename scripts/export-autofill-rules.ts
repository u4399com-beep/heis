// ============================================================
// scripts/export-autofill-rules.ts — Docker 自动填充规则清单导出器 (ss-a)
// ============================================================
// 用法: bun run scripts/export-autofill-rules.ts
// 产出: docker/autofill-rules.json —— docker/autofill.mjs 在容器首启后读取的
//       规则+任务模板清单([{key, name, rule:{name,description,config,enabled}, task}])
//
// payload 来源(与 seed 脚本逐字段一致, 唯一事实源原则):
//   fanqie / qimao / deqixs : 直接 import 对应 seed-rule-*.ts 的导出 ruleConfig
//     (三脚本均为 import.meta.main 守卫, import 无副作用; 描述串在 main() 内未导出, 拷贝字面量);
//   bqg713 / 80ge / jhssd / ttkan / pili : 源脚本(seed-rule-bqg713.ts / seed-rule-80ge.ts /
//     archive/probe-qq-b2-jhssd-rule.ts / archive/probe-qq-b2-ttkan-rule.ts /
//     archive/probe-mm-pili-rule.ts)顶层即执行网络调用, import 有副作用 →
//     config/描述字面量整段拷入本文件(逐字段核对过)。
//
// 任务模板: 全部取 seed/run-task 脚本与生产任务用过的实测书目 ——
//   番茄=剑仙(生产任务口径) / 七猫=万古神帝(生产任务口径) / 得奇=捞尸人 /books/126/
//   / bqg713=万相之王 id=2530(ss-a 真网复核 200) / 80ge=修仙从绑定名师课程开始
//   / jhssd=野花满山村 / ttkan=万相之王 / pili=全球高考。
//   公共参数: single 模式 + db 存储 + 温和线程/间隔(与任务书一致) + autoRefresh 30min
//   (完成后每 30 分钟自动增量续采, 容器重启由 recoverOnBoot 重排定时)。
// ============================================================
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export {} // module 守卫(bun 顶层代码 + tsc 惯例)

// ---- 可干净 import 的三份 seed 配置(单一事实源) ----
import { ruleConfig as fanqieConfig, RULE_NAME as FANQIE_NAME } from './seed-rule-fanqie'
import { ruleConfig as qimaoConfig, RULE_NAME as QIMAO_NAME } from './seed-rule-qimao'
import { ruleConfig as deqixsConfig, RULE_NAME as DEQIXS_NAME } from './seed-rule-deqixs'
import { ruleConfig as xjpConfig, RULE_NAME as XJP_NAME } from './seed-rule-xjp'

// ---- 公共任务参数(与既有实测/生产任务口径一致) ----
const THREAD = { threadMin: 2, threadMax: 2, intervalMin: 300, intervalMax: 600 } as const
const COMMON_TASK = {
  mode: 'single',
  recrawlMode: 'incremental',
  storageMode: 'db',
  smartCategory: false,
  smartComplete: false,
  autoSuggest: false,
  autoRefresh: true,
  refreshIntervalMin: 30,
} as const

// 覆写参用宽化结构类型(THREAD 是 as const 字面量, Partial<typeof THREAD> 会把覆写值撞成字面量类型)
type ThreadOverride = { threadMin?: number; threadMax?: number; intervalMin?: number; intervalMax?: number }
function task(name: string, bookUrl: string, over?: ThreadOverride): Record<string, unknown> {
  return { name, bookUrl, ...COMMON_TASK, ...THREAD, ...over }
}

const entries = [
  // ── 1. 番茄小说聚合API (任务书点名; 聚合 API 直连, 无本地代理依赖) ──
  {
    key: 'fanqie',
    name: FANQIE_NAME,
    rule: {
      name: FANQIE_NAME,
      description:
        '番茄小说聚合API(fq.taijiwang.top)四层JSON采集: search(tab_type=3嵌套数组过滤+map-collect展平)/detail/book(数组的数组*展平)/content。' +
        '结构依据 legado 书源 V3.2 反译。⚠ API 于 2026-08-31 全路径 502 暂不可达, 规则未实测, 恢复后请四段复验。' +
        '引擎依赖: cc-c jsonGet [n]/[k=v]/*/map-collect + parseToc 两阶段vars + runner {offset:N}。',
      config: fanqieConfig,
    },
    task: task('自动填充·番茄小说聚合API·剑仙', 'https://fq.taijiwang.top/api/detail?book_id=6511963569901276163', { threadMin: 2, threadMax: 3, intervalMin: 200, intervalMax: 500 }),
  },
  // ── 2. 七猫官方API (任务书点名; 依赖共置代理 3013) ──
  {
    key: 'qimao',
    name: QIMAO_NAME,
    rule: {
      name: QIMAO_NAME,
      description:
        '七猫官方API(api-bc/api-ks.wtzw.com)四层JSON采集: rank发现页/detail/toc/content。' +
        '结构依据 Legado 书源 yckceo 7698.json「⭐七猫[官方]v3.1✨」反译并真网实测。' +
        '⚠ 依赖本机签名代理 mini-services/qimao-proxy(端口3013, MD5双签名+正文AES-128-CBC解密, key=242ccb8230d709e1): ' +
        '上游全端点强制逐请求验签, 声明式规则无法表达 → 六段指向代理(引擎 json/const 型)。' +
        'list=leader-board大热榜男频50本(上游忽略page分页禁用, /search 通道留代理); 出版书(source非空)正文为EPUB如实报错。' +
        '代理启动: cd mini-services/qimao-proxy && bun run start; /health 自检 selfTestOk/apiReachable。',
      config: qimaoConfig,
    },
    // 生产七猫任务实锚: 万古神帝 bid=1649137, 经代理详情 URL(与规则 const 模板同形态)
    task: task('自动填充·七猫官方API·万古神帝', 'http://127.0.0.1:3013/detail?bid=1649137', { threadMin: 2, threadMax: 2, intervalMin: 200, intervalMax: 500 }),
  },
  // ── 3. 得奇小说网 (依赖共置代理 3014) ──
  {
    key: 'deqixs',
    name: DEQIXS_NAME,
    rule: {
      name: DEQIXS_NAME,
      description:
        '得奇小说网(deqixs.cc)杰奇系 GBK 站: list/book/toc 三段直连 + content 段走外置签名代理。' +
        '正文层双墙: 章节页 SSR 空(懒加载渲染) + 真实内容走 chapter.js.php 三参数(token/timestamp/nonce)→ajax2.php GBK JSON; ' +
        'ajax2 三重校验(XRW/Referer 头, token 与签发 referrer 绑定, timestamp 限时) → 每章动态三参数超出声明式引擎表达力(rr-a 真网实测)。 ' +
        '⚠ 依赖本机转换代理 mini-services/deqixs-proxy(端口 3014, 三参数签发+GBK 解码+HTML→纯文本): ' +
        'toc url 字段以 replaceFrom ^ 前置 http://127.0.0.1:3014/content?u= 指向代理, 代理只接受 deqixs /books/{aid}/{cid}.html 章节形态。 ' +
        'toc 在书页单 dl.chapterlist 两段(最新12倒序+全量正序), dd.visible-xs"查看全部章节"死锚以 :not() 排除, ' +
        '文档序乱序由引擎 reorderToc 去重+章号排序自愈。 ' +
        '代理启动: cd mini-services/deqixs-proxy && bun run start; /health 自检 selfTestOk/upstreamReachable。',
      config: deqixsConfig,
    },
    task: task('自动填充·得奇小说网·捞尸人', 'https://www.deqixs.cc/books/126/', { threadMin: 1, threadMax: 2, intervalMin: 300, intervalMax: 600 }),
  },
  // ── 4. 笔趣阁bqg713 (依赖共置代理 3010; 字面量拷自 seed-rule-bqg713.ts) ──
  {
    key: 'bqg713',
    name: '笔趣阁bqg713(www.bqg713.cc)·纯JSON API站采集',
    rule: {
      name: '笔趣阁bqg713(www.bqg713.cc)·纯JSON API站采集',
      description:
        'www.bqg713.cc 纯JSON API站(SPA壳+hash路由无SSR)。列表 /api/index 并集路径(hotlist,sort1~6)/书籍 /api/book/目录 /api/booklist(纯章节名数组, chapterid=下标+1, const模板合成章节API URL)/正文 apibi.cc/api/chapter(txt字段, AES-CBC token 参数)。' +
        '正文段经外置转换代理 mini-services/bqg713-proxy:3010 对接引擎 tokenUrl {url} 钩子(按章签发AES token), 章节 URL 指向站点真实 API 域名 apibi.cc(www 域 /api/chapter 被 WAF 403 属历史误配)。' +
        'dd-b: fetch.mirrorDomains 配三备援域 apibi.cc,apiqu.cc,apige.cc(主域网络错误/超时/403/5xx 引擎自动切镜像, token 按镜像域重签)。',
      config: {
        list: {
          enabled: true,
          urlTemplate: 'https://www.bqg713.cc/api/index?sort=all',
          itemSelector: { type: 'json', expression: 'hotlist,sort1,sort2,sort3,sort4,sort5,sort6' },
          fields: {
            id: { type: 'json', expression: 'id' },
            title: { type: 'json', expression: 'title' },
            author: { type: 'json', expression: 'author' },
            intro: { type: 'json', expression: 'intro' },
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
            status: { type: 'json', expression: 'full' },
            latestChapter: { type: 'json', expression: 'lastchapter' },
          },
        },
        toc: {
          enabled: true,
          tocLink: { type: 'const', expression: 'https://www.bqg713.cc/api/booklist?id={q.id}' },
          itemSelector: { type: 'json', expression: 'list' },
          fields: {
            title: { type: 'json', expression: '.' },
            url: { type: 'const', expression: 'https://apibi.cc/api/chapter?id={q.id}&chapterid={index}' },
          },
          pagination: { enabled: false, maxPages: 1 },
        },
        content: {
          enabled: true,
          fields: {
            title: { type: 'json', expression: 'chaptername' },
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
          tokenUrl: 'http://127.0.0.1:3010/rewrite?url={url}',
          tokenPattern: 'token',
          tokenInjection: 'url',
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
          normalize: true,
          plainText: true,
        },
      },
    },
    task: task('自动填充·笔趣阁bqg713·万相之王', 'https://www.bqg713.cc/api/book?id=2530'),
  },
  // ── 5. 八零电子书 (直连; 字面量拷自 seed-rule-80ge.ts) ──
  {
    key: '80ge',
    name: '八零电子书 (80ge.info)·wap正文·直连',
    rule: {
      name: '八零电子书 (80ge.info)·wap正文·直连',
      description:
        '80ge.info 八零电子书(TXT下载老站, XHTML utf-8, 零反爬直连)。qq-a2 轮: 姊妹站 qiushu.info(www 目录页章节链接指向它)对本沙箱出口 IP TCP 拉黑(2026-09 实测), 应急转场 wap.80ge.info 手机版(同 bookId/chapterId 体系, 第1章同为 76636828)。架构: list/book=www 桌面页, toc/content=wap 页; tocLink 把书籍页 txtml_{id} 链接改写为 wap/{id}/page-1.html(每页40章, 多页书走 select 下拉引擎不可表达=已知边界)。章节页 div#nr1 章内分页(_2/_3), 末页导航变\'下一章\'无\'下一页\'锚 → content 翻页无 nextLink 兜底自然收敛。单一桌面 UA 全站通用。探测样本: 修仙从绑定名师课程开始 /txtxz/225637.html(28章, 全3页/章, ~4400字/章)。',
      config: {
        list: {
          enabled: true,
          urlTemplate: 'http://www.80ge.info/top/lastupdate/{page}.html',
          itemSelector: { type: 'css', expression: 'div#list_art_2013' },
          fields: {
            name: { type: 'css', expression: 'div.book_bg a', attr: 'text', replaceFrom: '\\s*TXT下载\\s*$', replaceTo: '' },
            bookUrl: { type: 'css', expression: 'div.book_bg a', attr: 'href' },
            author: { type: 'css', expression: "div.book_cont a[href*='/author/']", attr: 'text' },
            intro: { type: 'css', expression: 'div.book_jj', attr: 'text' },
            cover: { type: 'css', expression: 'div.book_pic img', attr: 'src' },
            status: { type: 'css', expression: 'div.book_rg span.strong', attr: 'text' },
          },
          pagination: { enabled: false, maxPages: 1 },
        },
        book: {
          enabled: true,
          fields: {
            name: { type: 'css', expression: '#soft_info_para h1', attr: 'text', replaceFrom: 'TXT全集下载$', replaceTo: '' },
            author: { type: 'css', expression: "div.soft_info_r a[href*='/author/']", attr: 'text' },
            cover: { type: 'css', expression: 'img.info_img', attr: 'src' },
            status: { type: 'css', expression: 'li:contains("写作进度") strong', attr: 'text' },
            intro: {
              type: 'css', expression: '#mainSoftIntro p', attr: 'text',
              replaceFrom: '^.*?分享推荐给你的朋友！\\s*|更多.*$', replaceTo: '',
            },
          },
        },
        toc: {
          enabled: true,
          tocLink: {
            type: 'css', expression: "a[href*='txtml_']", attr: 'href',
            replaceFrom: '^http://www\\.80ge\\.info/txtml_(\\d+)\\.html$',
            replaceTo: 'http://wap.80ge.info/$1/page-1.html',
          },
          itemSelector: { type: 'css', expression: 'div.book_last dd' },
          fields: {
            title: { type: 'css', expression: 'a', attr: 'text', replaceFrom: '^\\d+、', replaceTo: '' },
            url: { type: 'css', expression: 'a', attr: 'href' },
          },
          pagination: { enabled: true, maxPages: 5 },
        },
        content: {
          enabled: true,
          fields: {
            title: { type: 'css', expression: 'h1', attr: 'text' },
            content: { type: 'css', expression: 'div#nr1', attr: 'html' },
          },
          pagination: { enabled: true, maxPages: 10 },
        },
        fetch: {
          engine: 'http',
          uaMode: 'custom',
          customUa: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          autoCookie: false,
          referer: true,
          timeout: 30000,
          retries: 1,
          waitMs: 200,
          hostGateLimit: 3,
        },
        clean: {
          removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
          adPatterns: ['（?本章未完[^）<>]{0,40}）?', '请记住本站[^<>]*', '本站所收录[^<>]*', '一秒记住[^<>]*'],
        },
      },
    },
    task: task('自动填充·八零电子书·修仙从绑定名师课程开始', 'http://www.80ge.info/txtxz/225637.html'),
  },
  // ── 6. 精华书阁移动版 (直连; 字面量拷自 archive/probe-qq-b2-jhssd-rule.ts) ──
  {
    key: 'jhssd',
    name: '精华书阁移动版 (m.jhsssd.com)·直连干净站',
    rule: {
      name: '精华书阁移动版 (m.jhsssd.com)·直连干净站',
      description:
        'qq-b2轮: jhssd.com 301→m.jhsssd.com, 零反爬UTF-8直连; 列表=list/{1-9}.html 单页; 书页含og:meta全字段+目录20章/页 index_{page} 翻页140页上限; 正文 div#nr1 带页内翻页 _N.html(a#pb_next) 引擎翻页合并; html5接口清单: list分类/书og:meta/toc ul.chapter/content nr1',
      config: {
        list: {
          enabled: true,
          urlTemplate: 'https://m.jhsssd.com/list/3.html',
          itemSelector: { type: 'css', expression: 'ul.xbk' },
          fields: {
            name: { type: 'css', expression: 'li.tjxs span.xsm a', attr: 'text' },
            bookUrl: { type: 'css', expression: 'li.tjimg a', attr: 'href' },
            author: { type: 'regex', expression: '</a>\\(([^)]{1,30})\\)', attr: '1' },
            intro: { type: 'css', expression: 'li.tjxs span.xsm + span', attr: 'text', replaceFrom: '^简介：', replaceTo: '' },
            cover: { type: 'css', expression: 'li.tjimg img', attr: 'src' },
            status: { type: 'css', expression: 'li.tjxs span.tjrs i', attr: 'text' },
            category: { type: 'const', expression: '都市' },
          },
          pagination: { enabled: false, maxPages: 1 },
        },
        book: {
          enabled: true,
          fields: {
            name: { type: 'css', expression: 'meta[property="og:novel:book_name"]', attr: 'content' },
            author: { type: 'css', expression: 'meta[property="og:novel:author"]', attr: 'content' },
            intro: { type: 'css', expression: 'meta[property="og:description"]', attr: 'content' },
            cover: { type: 'css', expression: 'meta[property="og:image"]', attr: 'content' },
            status: { type: 'css', expression: 'meta[property="og:novel:status"]', attr: 'content' },
            category: { type: 'css', expression: 'meta[property="og:novel:category"]', attr: 'content' },
          },
        },
        toc: {
          enabled: true,
          itemSelector: { type: 'css', expression: 'ul.chapter li' },
          fields: {
            title: { type: 'css', expression: 'a', attr: 'text' },
            url: { type: 'css', expression: 'a', attr: 'href' },
          },
          pagination: { enabled: true, nextLink: { type: 'css', expression: 'div.listpage span.right a', attr: 'href' }, maxPages: 140 },
        },
        content: {
          enabled: true,
          fields: {
            title: { type: 'css', expression: 'div#nr_title', attr: 'text', replaceFrom: '\\(\\d+/\\d+\\)', replaceTo: '' },
            content: { type: 'css', expression: 'div#nr1', attr: 'html' },
          },
          pagination: { enabled: true, nextLink: { type: 'css', expression: 'a#pb_next:contains("下一页")', attr: 'href' }, maxPages: 12 },
        },
        fetch: {
          engine: 'http',
          uaMode: 'mobile',
          referer: true,
          refererChain: true,
          autoCookie: false,
          timeout: 20000,
          retries: 1,
          hostGateLimit: 3,
        },
        clean: {
          removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
          adPatterns: [
            '阅读提示：[^<>]*',
            '本章未完[^<>]*',
            '请记住本站[^<>]*',
            '最新章节首发更新地址[^<>]*',
            '精华书阁[^<>]{0,40}阅读',
            '天才一秒记住[^<>]*',
          ],
        },
      },
    },
    task: task('自动填充·精华书阁·野花满山村', 'https://m.jhsssd.com/114604/'),
  },
  // ── 7. 天天看小说 (直连; 字面量拷自 archive/probe-qq-b2-ttkan-rule.ts) ──
  {
    key: 'ttkan',
    name: '天天看小说 (cn.ttkan.co)·Nuxt-SSR直连站',
    rule: {
      name: '天天看小说 (cn.ttkan.co)·Nuxt-SSR直连站',
      description:
        'qq-b2轮: Nuxt/AMP 站但全 SSR, 零反爬直连; 列表 /novel/class/{cat}(18本/页, 字母分组 _abcd.._xyz 替代数字翻页故 pagination 关) + 书页即目录页 /novel/chapters/{slug}(og:novel:* meta + div.description 简介 + 全量章节 a[href*=pagea] 单页1838章) + 正文 /novel/pagea/{slug}_{n}.html(div.content 首段p为章题重复, regex 越过至 div_content_end) ; 前任疑SPA动态渲染实为 SSR 无需浏览器',
      config: {
        list: {
          enabled: true,
          urlTemplate: 'https://cn.ttkan.co/novel/class/xuanhuan',
          itemSelector: { type: 'css', expression: 'div.novel_cell' },
          fields: {
            name: { type: 'css', expression: 'h3', attr: 'text' },
            bookUrl: { type: 'css', expression: 'a', attr: 'href' },
            author: { type: 'css', expression: 'ul li:nth-child(2)', attr: 'text', replaceFrom: '^作者：', replaceTo: '' },
            intro: { type: 'css', expression: 'ul li:nth-child(3)', attr: 'text', replaceFrom: '^简介：', replaceTo: '' },
            cover: { type: 'css', expression: 'amp-img', attr: 'src', replaceFrom: '\\?.*$', replaceTo: '' },
          },
          pagination: { enabled: false, maxPages: 1 },
        },
        book: {
          enabled: true,
          fields: {
            name: { type: 'css', expression: 'meta[name="og:novel:book_name"]', attr: 'content' },
            author: { type: 'css', expression: 'meta[name="og:novel:author"]', attr: 'content' },
            intro: { type: 'css', expression: 'div.description p', attr: 'text' },
            cover: { type: 'css', expression: "amp-img[src*='ttkan.co/cover']", attr: 'src', replaceFrom: '\\?.*$', replaceTo: '' },
            status: { type: 'css', expression: 'meta[name="og:novel:status"]', attr: 'content' },
            category: { type: 'css', expression: 'meta[name="og:novel:category"]', attr: 'content' },
          },
        },
        toc: {
          enabled: true,
          itemSelector: { type: 'css', expression: "a[href*='/novel/pagea/']" },
          fields: {
            title: { type: 'css', expression: 'a', attr: 'text' },
            url: { type: 'css', expression: 'a', attr: 'href' },
          },
          pagination: { enabled: false, maxPages: 1 },
        },
        content: {
          enabled: true,
          fields: {
            title: { type: 'css', expression: 'h1', attr: 'text' },
            content: { type: 'regex', expression: 'class="content">[\\s\\S]{0,500}?<p>[^<]{0,120}</p>([\\s\\S]*?)<div id="div_content_end"', attr: '1' },
          },
          pagination: { enabled: false, maxPages: 1 },
        },
        fetch: {
          engine: 'http',
          uaMode: 'desktop',
          referer: true,
          refererChain: true,
          autoCookie: false,
          timeout: 20000,
          retries: 1,
          hostGateLimit: 3,
        },
        clean: {
          removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
          adPatterns: ['章节报错[^<>]*', '添加书签[^<>]*'],
        },
      },
    },
    task: task('自动填充·天天看小说·万相之王', 'https://cn.ttkan.co/novel/chapters/wanxiangzhiwang-tiancantudou'),
  },
  // ── 8. 霹雳书屋 (CF 挑战站, 依赖 scrapling 桥 —— 默认清单不含, profile stealthy 可选; 字面量拷自 archive/probe-mm-pili-rule.ts) ──
  {
    key: 'pili',
    name: '霹雳书屋 (pilishuwu.com)·CF挑战站·stealthy',
    rule: {
      name: '霹雳书屋 (pilishuwu.com)·CF挑战站·stealthy',
      description: 'mm轮新增: Cloudflare Managed Challenge 站, fetchMode=scrapling-stealthy(patchright自动求解); 四段=分类列表/详情/完整目录menu/正文read; HTML需stealthy, 静态资产可直连',
      config: {
        list: {
          enabled: true,
          urlTemplate: 'https://www.pilishuwu.com/1/list/{page}.html',
          itemSelector: { type: 'css', expression: 'li.ret-search-item' },
          fields: {
            name: { type: 'css', expression: 'h3.ret-works-title a', attr: 'text' },
            bookUrl: { type: 'css', expression: 'h3.ret-works-title a', attr: 'href' },
            author: { type: 'css', expression: 'p.ret-works-author', attr: 'text', replaceFrom: '^作者[：:]', replaceTo: '' },
            category: { type: 'css', expression: 'p.ret-works-tags a', attr: 'text', replaceFrom: '^分类[：:]', replaceTo: '' },
            intro: { type: 'css', expression: 'p.ret-works-decs', attr: 'text' },
            cover: { type: 'css', expression: 'a.mod-cover-list-thumb img', attr: 'src' },
          },
          pagination: { enabled: false, maxPages: 1 },
        },
        book: {
          enabled: true,
          fields: {
            name: { type: 'css', expression: 'h2.works-intro-title strong', attr: 'text' },
            author: { type: 'regex', expression: '（作者：([^）]{1,30})）' },
            intro: { type: 'css', expression: 'p.works-intro-short', attr: 'text' },
            cover: { type: 'css', expression: 'div.works-cover img', attr: 'src' },
            status: { type: 'css', expression: 'label.works-intro-status', attr: 'text' },
            category: { type: 'css', expression: 'a.works-intro-tags-item', attr: 'text' },
          },
        },
        toc: {
          enabled: true,
          tocLink: { type: 'css', expression: "a[href*='/menu/']", attr: 'href' },
          itemSelector: { type: 'css', expression: 'span.works-chapter-item' },
          fields: {
            title: { type: 'css', expression: 'a', attr: 'text' },
            url: { type: 'css', expression: 'a', attr: 'href' },
          },
          pagination: { enabled: false, maxPages: 1 },
        },
        content: {
          enabled: true,
          fields: {
            title: { type: 'css', expression: 'h3.j_chapterName span.content-wrap', attr: 'text' },
            content: { type: 'css', expression: 'div.read-content', attr: 'html' },
          },
          pagination: { enabled: false, maxPages: 1 },
        },
        fetch: {
          engine: 'http',
          fetchMode: 'scrapling-stealthy',
          uaMode: 'custom',
          customUa: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          autoCookie: false,
          referer: true,
          timeout: 90000,
          retries: 1,
          waitMs: 300,
          hostGateLimit: 2,
        },
        clean: {
          removeSelectors: ['script', 'style', 'iframe', 'ins', 'noscript'],
          adPatterns: ['请记住本站[^<>]*', '本站所收录[^<>]*', '最快更新[^<>]*'],
        },
      },
    },
    task: task('自动填充·霹雳书屋·全球高考', 'https://www.pilishuwu.com/5/2951/info.html', { threadMin: 2, threadMax: 2, intervalMin: 200, intervalMax: 500 }),
  },
  // ── 9. 新键盘小说网 (依赖共置代理 3015 var c 解密; 默认清单不含 — 单书 6254 章体量大, AUTO_FILL_RULES 显式加 xjp 启用; 直 import seed 导出) ──
  {
    key: 'xjp',
    name: XJP_NAME,
    rule: {
      name: XJP_NAME,
      description:
        '新键盘小说网(xinjianpan.com) biquge2023 仿站: list/book/toc 三段直连 + content 段走外置解密代理。' +
        '正文层双层: #chaptercontent SSR 前半 + var c(base64, 每章恒定) 加密后半由 get20260103.js 客户端解密注入; ' +
        '解密算法已破(s=atob(c); n=parseInt(s[8:11]); payload=s[11+n:len-n]; 减号→PHA+, 下划线→8L3A+ 标记膨胀; atob→UTF-8), ' +
        '超出声明式引擎表达力 → mini-services/xjp-proxy(端口 3015)承载(章节页抓取+双层合并+HTML→纯文本)。 ' +
        '⚠ 依赖共置代理 3015(Docker 镜像已内置); adPatterns 为行级模式(引擎 removeAdLines 的 `.*?$` 形态对正文中部广告无效)。' +
        '代理启动: cd mini-services/xjp-proxy && bun run start; /health 自检 selfTestOk/upstreamReachable。',
      config: xjpConfig,
    },
    // ss-b3 生产实测书目: 修罗武神 6254 章, 温和线程
    task: task('自动填充·新键盘小说网·修罗武神', 'https://www.xinjianpan.com/txt/oaa/', { threadMin: 1, threadMax: 2, intervalMin: 800, intervalMax: 1500 }),
  },
]

// ---- 结构自检 + 落盘 ----
function assertShape(entry: (typeof entries)[number]) {
  const cfg = entry.rule.config as Record<string, unknown>
  for (const seg of ['list', 'book', 'toc', 'content', 'fetch', 'clean']) {
    if (!cfg[seg]) throw new Error(`${entry.key}: 缺少 ${seg} 段`)
  }
  const taskName = entry.task.name
  if (!entry.key || !entry.name || !entry.rule.name || typeof taskName !== 'string' || !taskName.startsWith('自动填充·')) {
    throw new Error(`${entry.key}: key/name/task.name(自动填充·前缀) 形态非法`)
  }
  if (entry.task.mode !== 'single' || !entry.task.bookUrl) {
    throw new Error(`${entry.key}: task 模板缺 single bookUrl`)
  }
}
for (const e of entries) assertShape(e)

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docker')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'autofill-rules.json')
writeFileSync(outFile, JSON.stringify(entries, null, 2) + '\n', 'utf8')

console.log(`已导出 ${entries.length} 条规则清单 → docker/autofill-rules.json`)
console.log(`key 清单: ${entries.map((e) => e.key).join(', ')}`)
console.log('默认执行(不含 pili): fanqie,qimao,deqixs,80ge,jhssd,ttkan,bqg713')
