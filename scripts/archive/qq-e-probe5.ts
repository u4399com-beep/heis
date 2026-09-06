// qq-e 探针5: mock.module 可行性 + NextResponse 在 bun 的可用性 + playwright 可用性
// qq-e2 补丁: 项目 tsconfig 未装 bun 类型(auto-include 仅 @types/*), 声明最小面保 tsc 干净
declare module 'bun:test' {
  export function mock(moduleName: string, factory: () => unknown): void
}
import { mock } from 'bun:test'

mock.module('@/lib/db', () => ({
  db: {
    book: {
      findUniqueOrThrow: async () => ({
        id: 'bk_probe', name: 'qq-e探针书', author: '作者', intro: '简介', status: 'completed',
        wordCount: 100, chapters: [
          { idx: 1, title: '第1章 甲', content: '<p>正文甲</p>', storage: 'db', filePath: null, volume: '第一卷' },
          { idx: 2, title: '第2章 乙', content: '<p>正文乙</p>', storage: 'db', filePath: null, volume: '' },
          { idx: 3, title: '第3章 丙', content: '<p>正文丙</p>', storage: 'db', filePath: null, volume: '第一卷' },
          { idx: 4, title: '第4章 丁', content: '<p>正文丁</p>', storage: 'db', filePath: null, volume: '第二卷' },
        ],
      }),
    },
  },
}))

const { generateBookTxt } = await import('../src/lib/crawl/downloader')
const res = await generateBookTxt('bk_probe', { siteInfo: false, insertAds: false, obfuscate: false }, '站名', 'https://x.example')
console.log('--- 生成结果 ---')
console.log('rel =', res.rel, 'chapters =', res.chapters)
const { readFile, unlink } = await import('fs/promises')
const txt = await readFile('data/' + res.rel, 'utf-8')
console.log('--- TXT 内容 ---')
console.log(txt)
await unlink('data/' + res.rel)
console.log('已清理成品文件')
process.exit(0)
