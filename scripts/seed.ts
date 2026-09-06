// 种子数据: 分类/站点/规则/演示书籍与章节(含生成式webp封面)
// 定位说明(ss-c 清扫轮注): 本脚本 = 全新库演示数据种子(分类15 + 默认站点 + 示例规则3条 + 演示书6本),
// 与真实站点规则体系互补: seed-rule-*.ts = 单站真实规则幂等入库(34条), seed-rules-v2.ts = 真实站点批量入库。
// 三者均幂等可重复执行; 演示数据仅在空库时写入(siteCount/bookCount=0 守卫)。
import { db } from '../src/lib/db'
import sharp from 'sharp'
import { promises as fs } from 'fs'
import path from 'path'
import { defaultRuleConfig } from '../src/lib/crawl/types'

const COVERS_DIR = path.join(process.cwd(), 'data', 'covers')

const CATEGORIES = ['玄幻', '奇幻', '武侠', '仙侠', '都市', '言情', '历史', '军事', '游戏', '科幻', '悬疑', '灵异', '体育', '轻小说', '现实']

const DEMO_BOOKS = [
  {
    name: '星海尘缘录', author: '墨染千城', cat: '科幻', status: 'completed',
    intro: '公元3021年，人类文明踏入星海时代。少年陆尘在废弃空间站捡到一枚神秘芯片，从此卷入横跨七大星域的文明博弈。机械与血脉共鸣，上古舰队苏醒，他要在这片浩瀚星海中，找回被抹去的家园坐标。',
    keywords: '星海尘缘录,星海尘缘录最新章节,星海尘缘录全文阅读',
    theme: ['#0f2a4a', '#38bdf8', '#fbbf24'],
  },
  {
    name: '九霄丹帝', author: '青莲剑仙', cat: '仙侠', status: 'ongoing',
    intro: '一念成丹，一念成帝。被家族除名的废柴少年萧尘偶得上古丹帝传承，从此丹道通神。家族？宗门？帝国？在他眼中不过是脚下的阶石。这一次，他要踏碎九霄，重塑仙途！',
    keywords: '九霄丹帝,九霄丹帝最新章节,九霄丹帝无弹窗',
    theme: ['#3b1f2b', '#e11d48', '#d4a853'],
  },
  {
    name: '巷尾面馆日常', author: '一碗清汤', cat: '现实', status: 'ongoing',
    intro: '老城区的巷子深处有一家不起眼的面馆，老板周叙每天只卖一百碗面。来的客人有深夜加班的白领、失恋的学生、退休的老教师……一晚一碗面，一段人间事。治愈系都市日常，献给每个认真生活的人。',
    keywords: '巷尾面馆日常,巷尾面馆日常小说,治愈系小说推荐',
    theme: ['#4a2c1a', '#f97316', '#16a34a'],
  },
  {
    name: '长夜烛火', author: '北窗听雨', cat: '悬疑', status: 'completed',
    intro: '连环失踪案震动江城，所有线索都指向二十年前一场大火。刑警队长程野重启旧档，却发现档案室的每一页纸都被人调换过。当真相开始浮现，他才发现自己也许就是谜题的一部分。',
    keywords: '长夜烛火,长夜烛火最新章节,悬疑推理小说',
    theme: ['#1a2430', '#94a3b8', '#ef4444'],
  },
  {
    name: '草原上的骑兵', author: '铁马冰河', cat: '历史', status: 'completed',
    intro: '元末乱世，少年巴图从草原最不起眼的牧奴，成长为横扫漠北的传奇骑兵统帅。铁骑踏过之处，命运改写。这是一个关于勇气、背叛与家国天下的大漠史诗。',
    keywords: '草原上的骑兵,历史军事小说,草原上的骑兵全文',
    theme: ['#3a3325', '#d97706', '#65a30d'],
  },
  {
    name: '我的伪声优女友', author: '软糖不甜', cat: '轻小说', status: 'ongoing',
    intro: '平凡大学生林晚在配音社团遇见了网络人气声优"星野"——现实里却是高冷学霸。线上甜糯，线下高冷，双重声线的少女背后藏着怎样的秘密？青春校园恋爱喜剧开幕！',
    keywords: '我的伪声优女友,轻小说推荐,校园恋爱小说',
    theme: ['#2d2440', '#a78bfa', '#f472b6'],
  },
]

function chapterText(bookIdx: number, chIdx: number, title: string): string {
  const scenes = [
    '夜色如墨，星光被厚重的云层吞没。远处的地平线上，一道微弱的光芒正在缓缓升起，像是某种沉睡已久的意志苏醒的征兆。',
    '风从旷野的尽头吹来，带着潮湿的水汽与铁锈的气味。他握紧手中那枚温热的芯片，指节因为用力而微微发白。',
    '「你终于来了。」苍老的声音从黑暗中传来，带着一种奇异的平静，仿佛已经在此等候了千年万年。',
    '空气骤然凝滞。所有人的目光都集中在广场中央那道年轻身影上——那件洗得发白的外套之下，藏着足以颠覆整个格局的力量。',
    '记忆像潮水一样涌来。破碎的画面里，有燃烧的天空，有倾倒的高塔，还有母亲最后的微笑。他猛地睁开眼，额头全是冷汗。',
    '铜钟被撞响，回声在山谷间层层荡开。年轻弟子们迅速列队，每个人的脸上都写满了紧张与期待——今天是十年一度的论道大会。',
    '雨下得很大，敲打在旧铁皮屋顶上，像无数细密的鼓点。面馆的灯还亮着，暖黄的光晕里，一碗热汤面冒着白色的雾气。',
    '「证据链对不上。」程野把三份卷宗并排摊开，指腹重重按在其中一页上，「二十年前的大火，不可能同时出现在两个地方。」',
    '草原的黎明来得格外早。第一缕阳光刺破云层时，千军万马已在山坡下列阵，马蹄踏碎的露水里映射出金属的冷光。',
    '她清了清嗓子，对着麦克风轻轻开口。声音通过网络传向千里之外，那一刻，无数耳机里的世界安静了下来。',
  ]
  const parts: string[] = []
  parts.push(scenes[(bookIdx + chIdx) % scenes.length])
  parts.push(scenes[(bookIdx * 3 + chIdx * 2 + 1) % scenes.length])
  parts.push(
    `这一切来得太快，快到让人来不及反应。${title.replace(/第.*?[章节回]?\s*/, '')}的背后，是一张早已编织好的网。他能做的，只有向前走。`
  )
  parts.push(scenes[(bookIdx * 2 + chIdx + 4) % scenes.length])
  parts.push('夜风掠过窗棂，烛火轻轻摇晃。故事的下一页，正在黑暗中缓缓翻动。（本章完）')
  return parts.map((p) => `<p>${p}</p>`).join('')
}

async function makeCover(title: string, colors: string[], fileName: string) {
  const shortTitle = title.length > 6 ? title.slice(0, 6) : title
  const chars = shortTitle.split('')
  const textSpans = chars
    .map((c, i) => `<text x="200" y="${150 + i * 58}" font-size="48" font-weight="bold" fill="#ffffff" text-anchor="middle" font-family="serif">${c}</text>`)
    .join('')
  const svg = `<svg width="400" height="533" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${colors[0]}"/>
      <stop offset="60%" stop-color="${colors[1]}"/>
      <stop offset="100%" stop-color="${colors[2]}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="533" fill="url(#g)"/>
  <circle cx="340" cy="80" r="120" fill="rgba(255,255,255,0.08)"/>
  <circle cx="60" cy="460" r="90" fill="rgba(255,255,255,0.06)"/>
  ${textSpans}
  <text x="200" y="510" font-size="20" fill="rgba(255,255,255,0.75)" text-anchor="middle" font-family="sans-serif">${title.length > 6 ? title : ''}</text>
</svg>`
  const buf = await sharp(Buffer.from(svg)).webp({ quality: 85 }).toBuffer()
  await fs.mkdir(COVERS_DIR, { recursive: true })
  await fs.writeFile(path.join(COVERS_DIR, fileName), buf)
  return `covers/${fileName}`
}

async function main() {
  console.log('== 开始种子数据 ==')
  for (let i = 0; i < CATEGORIES.length; i++) {
    await db.category.upsert({
      where: { name: CATEGORIES[i] },
      create: { name: CATEGORIES[i], sortOrder: i },
      update: { sortOrder: i },
    })
  }
  console.log('分类:', CATEGORIES.length)

  const siteCount = await db.site.count()
  if (siteCount === 0) {
    await db.site.create({
      data: {
        name: '书海文摘',
        domain: 'localhost:3000',
        themeId: 'aurora',
        title: '书海文摘 - 精品小说在线阅读',
        description: '书海文摘提供玄幻、仙侠、都市、言情等全类型小说在线阅读，每日更新，支持全文缓存与TXT下载。',
        keywords: '小说,小说阅读,玄幻小说,都市小说,在线阅读',
        isDefault: true,
      },
    })
    console.log('默认站点: 书海文摘')
  }

  const ruleCount = await db.rule.count()
  if (ruleCount === 0) {
    const cfg1 = defaultRuleConfig()
    cfg1.list.urlTemplate = 'https://www.example-novel-site.com/sort/{page}/'
    cfg1.list.itemSelector = { type: 'css', expression: 'ul.li li', attr: 'text' }
    cfg1.list.fields = {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    }
    cfg1.book.fields = {
      name: { type: 'css', expression: '#maininfo h1', attr: 'text' },
      author: { type: 'css', expression: '#maininfo p:first-of-type a', attr: 'text' },
      category: { type: 'regex', expression: '分类[：:]([^<\\s]+)', attr: '1' },
      intro: { type: 'css', expression: '#intro', attr: 'text' },
      cover: { type: 'css', expression: '#fmimg img', attr: 'src' },
      latestChapter: { type: 'css', expression: '#info-latest a', attr: 'text' },
    }
    cfg1.toc.itemSelector = { type: 'css', expression: '#list dl dd', attr: 'text' }
    cfg1.toc.fields = {
      title: { type: 'css', expression: 'a', attr: 'text' },
      url: { type: 'css', expression: 'a', attr: 'href' },
    }
    cfg1.toc.pagination = { enabled: true, maxPages: 20, nextLink: { type: 'css', expression: 'a:contains("下一页")', attr: 'href' }, joinWith: '' }
    cfg1.content.fields = { content: { type: 'css', expression: '#content', attr: 'html' } }
    cfg1.content.pagination = { enabled: true, maxPages: 10, nextLink: { type: 'css', expression: 'a:contains("下一页")', attr: 'href' }, joinWith: '<br/>' }
    await db.rule.create({
      data: {
        name: '通用小说站(CSS选择器示例)',
        description: '适配常见笔趣阁系站点: CSS选择器 + 自动翻页 + 广告清洗模板',
        config: JSON.stringify(cfg1),
      },
    })

    const cfg2 = defaultRuleConfig()
    cfg2.list.itemSelector = { type: 'xpath', expression: '//ul[@class="book-list"]/li', attr: '.' }
    cfg2.list.fields = {
      title: { type: 'xpath', expression: './/a/text()', attr: 'text' },
      url: { type: 'xpath', expression: './/a/@href', attr: 'href' },
    }
    cfg2.book.fields = {
      name: { type: 'xpath', expression: '//h1[@class="book-title"]/text()', attr: 'text' },
      author: { type: 'xpath', expression: '//meta[@name="author"]/@content', attr: 'text' },
      intro: { type: 'xpath', expression: '//div[@class="desc"]//text()', attr: 'text' },
    }
    cfg2.toc.itemSelector = { type: 'xpath', expression: '//div[@class="chapter-list"]//li/a', attr: '.' }
    cfg2.toc.fields = {
      title: { type: 'xpath', expression: 'text()', attr: 'text' },
      url: { type: 'xpath', expression: '@href', attr: 'href' },
    }
    cfg2.content.fields = { content: { type: 'xpath', expression: '//div[@id="booktxt"]', attr: 'html' } }
    await db.rule.create({
      data: {
        name: 'XPath结构化站点示例',
        description: '适合结构清晰的站点: XPath表达式示例模板',
        config: JSON.stringify(cfg2),
      },
    })

    const cfg3 = defaultRuleConfig()
    cfg3.book.fields = { name: { type: 'regex', expression: '<title>([^<]+?)[_\\-|]', attr: '1' } }
    cfg3.content.fields = { content: { type: 'regex', expression: '<div[^>]*id="content"[^>]*>([\\s\\S]*?)</div>', attr: '1' } }
    await db.rule.create({
      data: {
        name: '正则表达式示例',
        description: '页面结构混乱时的兜底方案: 正则捕获组提取',
        config: JSON.stringify(cfg3),
      },
    })
    console.log('示例规则: 3条')
  }

  const bookCount = await db.book.count()
  if (bookCount === 0) {
    for (let bi = 0; bi < DEMO_BOOKS.length; bi++) {
      const b = DEMO_BOOKS[bi]
      const cat = await db.category.findUnique({ where: { name: b.cat } })
      const cover = await makeCover(b.name, b.theme, `demo_${bi + 1}.webp`)
      const chapterCount = 24 + bi * 6
      const latest = `第${chapterCount}章 风起于萍末`
      const book = await db.book.create({
        data: {
          name: b.name,
          author: b.author,
          categoryId: cat?.id,
          intro: b.intro,
          cover,
          status: b.status,
          keywords: b.keywords.split(',')[0],
          latestChapter: latest,
          wordCount: chapterCount * 3200,
          sourceUrl: '',
          collectedAt: new Date(),
        },
      })
      const rows: any[] = []
      for (let ci = 1; ci <= chapterCount; ci++) {
        const title = ci === 1 ? '第一章 命运的齿轮' : `第${ci}章 ${['风起', '暗流', '交锋', '破局', '余波', '新的征程'][ci % 6]}`
        const text = chapterText(bi, ci, title)
        rows.push({
          bookId: book.id,
          idx: ci,
          title,
          content: text,
          storage: 'db',
          wordCount: text.replace(/<[^>]+>/g, '').length,
          fetched: true,
        })
      }
      await db.chapter.createMany({ data: rows })
      const tagWords = [
        `${b.name}最新章节`, `${b.name}全文阅读`, `${b.name}txt下载`,
        `${b.author}的小说`, `${b.name}结局`, `${b.cat}小说推荐`,
      ]
      for (const t of tagWords) {
        await db.bookTag.create({ data: { bookId: book.id, tag: t, source: 'suggest', hits: Math.floor(Math.random() * 50) } }).catch(() => {})
      }
      console.log(`演示书籍: 《${b.name}》 ${chapterCount}章`)
    }
  }

  await db.setting.upsert({
    where: { key: 'download' },
    create: { key: 'download', value: JSON.stringify({ siteName: '书海文摘', siteUrl: 'https://localhost:3000' }) },
    update: {},
  })
  console.log('== 种子完成 ==')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })

export {}
