import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Article DB — AI 驱动的文章情报平台",
  description: "从 46 个信息源自动聚合、AI 评估、每日精选高质量 AI 领域文章",
  openGraph: {
    title: "Article DB — AI 驱动的文章情报平台",
    description: "从 46 个信息源自动聚合、AI 评估、每日精选高质量 AI 领域文章",
    url: "https://article-db.stringzhao.life",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
