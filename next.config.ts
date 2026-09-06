import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* 关闭 X-Powered-By 响应头 (middleware 也会兜底删除) */
  poweredByHeader: false,
  /* SEO: /sitemap.xml 与 /robots.txt 直接可用 */
  async rewrites() {
    return [
      { source: "/sitemap.xml", destination: "/api/public/sitemap" },
    ];
  },
  /* 强制类型检查 (Task 2-a: 重新启用生产构建类型门禁) */
  typescript: {
    ignoreBuildErrors: false,
  },
  /* 开发模式安全检查 (Task 2-a: 开启 React StrictMode) */
  reactStrictMode: true,
};

export default nextConfig;
