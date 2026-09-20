import "./globals.css";
import "./interactions.css";
export const metadata = { title: "智仪询盘管理系统", description: "智仪询盘状态追踪系统" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
