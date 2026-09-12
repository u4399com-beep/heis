import type { NextConfig } from "next";
import { pseudoStaticRewrites } from "./src/lib/pseudostatic";

const nextConfig: NextConfig = {
  output: "standalone",
  /* 关闭 X-Powered-By 响应头 (middleware 也会兜底删除) */
  poweredByHeader: false,
  /* SEO: 伪静态路径 + /sitemap.xml 转发到查询串风格, 由 PublicSite.parseViewPath 解析 */
  async rewrites() {
    return pseudoStaticRewrites();
  },
  /* 强制类型检查 (Task 2-a: 重新启用生产构建类型门禁) */
  typescript: {
    ignoreBuildErrors: false,
  },
  /* 开发模式安全检查 (Task 2-a: 开启 React StrictMode) */
  reactStrictMode: true,
};

export default nextConfig;
