import type { NextConfig } from "next";

// R43-1C: 旧 src/lib/pseudostatic (R42-1C 删 src/ 时已删) 引用清除, rewrites 改为空.
// 当前 Next.js 端仅占位首页 (src/app/page.tsx), 业务流量走 Go 后端 heis-backend.
const nextConfig: NextConfig = {
  output: "standalone",
  /* 关闭 X-Powered-By 响应头 (middleware 也会兜底删除) */
  poweredByHeader: false,
  /* 强制类型检查 (Task 2-a: 重新启用生产构建类型门禁) */
  typescript: {
    ignoreBuildErrors: false,
  },
  /* 开发模式安全检查 (Task 2-a: 开启 React StrictMode) */
  reactStrictMode: true,
};

export default nextConfig;
