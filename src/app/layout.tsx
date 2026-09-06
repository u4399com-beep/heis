import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// feat-round-11 B1: PWA manifest + theme-color + apple-touch-icon 元数据
// (Next 16 Metadata API: manifest/themeColor/appleWebApp 字段会自动注入对应 <link>/<meta>)
export const metadata: Metadata = {
  title: "小说在线阅读",
  description: "精品小说在线阅读，支持站群主题、检索与TXT下载。",
  keywords: ["小说", "在线阅读", "TXT下载"],
  authors: [{ name: "Z.ai Team" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "小说阅读",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg" },
      // feat-round-11 B1: 同图标 SVG 也作为 PWA favicon(浏览器 tab 图标)
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon.svg",
  },
  openGraph: {
    title: "小说在线阅读",
    description: "精品小说在线阅读，支持站群主题、检索与TXT下载。",
    siteName: "小说站群",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "小说在线阅读",
    description: "精品小说在线阅读，支持站群主题、检索与TXT下载。",
  },
};

// feat-round-11 B1: theme-color 单独走 Viewport API(Next 16 推荐方式)
// (metadata.themeColor 在 Next 14+ 已弃用, 迁移至 viewport.themeColor)
export const viewport: Viewport = {
  themeColor: "#7c3aed",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* feat-round-11 B1: apple-touch-icon( iOS 主屏图标, SVG 是兼容性兜底) */}
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        {/* feat-round-11 B2: SW 注册(dev 模式跳过, 避免缓存干扰 HMR) */}
        <PwaRegister />
      </body>
    </html>
  );
}
