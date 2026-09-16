import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
export default async function Login(){
  if(await getSession()) redirect("/dashboard");
  return <main className="login-shell"><section className="login-card"><div className="brand">SF6 询盘管理</div><LoginForm/></section></main>;
}
