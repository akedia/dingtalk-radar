import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DingTalk Radar",
  description: "Local-first DingTalk group intelligence dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
