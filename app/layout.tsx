import "./globals.css";
export const metadata = { title: "SF6 询盘管理", description: "局域网询盘状态追踪系统" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
