import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* SEO: /sitemap.xml 与 /robots.txt 直接可用 */
  async rewrites() {
    return [
      { source: "/sitemap.xml", destination: "/api/public/sitemap" },
    ];
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
