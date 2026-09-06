// smoke-n3 辅助: 统计 tmp 目录下 fetchViaCurl 临时头文件残留(验证无泄漏)
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function tmpDirListCurlHdr(): Promise<string[]> {
  try {
    const files = await readdir(tmpdir())
    return files.filter((f) => f.startsWith('novel-curl-') && f.endsWith('.hdr')).map((f) => join(tmpdir(), f))
  } catch {
    return []
  }
}

export {}
