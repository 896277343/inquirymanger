import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { AutoSync } from "@/components/auto-sync";
import { logout } from "./actions";
export const dynamic = "force-dynamic";
export default async function AppLayout({children}:{children:React.ReactNode}){
  const s=await requireSession();
  return <div className="shell"><AutoSync/><aside className="sidebar"><div className="brand">SF6 询盘管理</div><nav className="nav"><Link href="/dashboard">工作台</Link><Link href="/inquiries">询盘管理</Link>{s.role==="LEADER"&&<><Link href="/inquiries/new">AI录入询盘</Link><Link href="/team">业务员管理</Link><Link href="/logs">操作日志</Link><Link href="/settings/ai">AI接口配置</Link></>}<Link href="/settings/crm">{s.role==="LEADER"?"悟空CRM配置":"我的CRM账号"}</Link><Link href="/settings/password">账号与密码</Link></nav><div className="userbox"><strong>{s.name}</strong><p className="subtle">{s.role==="LEADER"?"领导账号":"业务员账号"}</p><form action={logout}><button className="btn">退出登录</button></form></div></aside><main className="main">{children}</main></div>;
}
