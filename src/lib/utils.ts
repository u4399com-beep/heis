import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 异步 sleep: 返回在 ms 毫秒后 resolve 的 Promise。
 * 仅供服务端使用(不要打到客户端 bundle); 多文件共用, 替代各 crawl 模块内的本地副本。
 * 用 unref 让定时器不阻止 Node.js 进程退出。
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    if (typeof t.unref === 'function') t.unref()
  })
}
