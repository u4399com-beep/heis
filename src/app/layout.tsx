import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "小说在线阅读",
  description: "精品小说在线阅读，支持站群主题、检索与TXT下载。",
  keywords: ["小说", "在线阅读", "TXT下载"],
  authors: [{ name: "Z.ai Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
