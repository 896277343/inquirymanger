import Link from "next/link";
import { requireLeader } from "@/lib/auth";
import { rows } from "@/lib/db";
import { createAdminAccount, createSalesAccount, setSalesAssignable } from "./actions";

type TeamUser = {
  id: number;
  username: string;
  display_name: string;
  role: string;
  level: string;
  active: number;
  assignable: number;
  inquiries: number;
  won: number;
  amount: number;
};

export default async function Team() {
  await requireLeader();
  const users = rows<TeamUser>(`SELECT u.id,u.username,u.display_name,u.role,u.level,u.active,u.assignable,
    COUNT(i.id) inquiries,SUM(CASE WHEN i.status='WON' THEN 1 ELSE 0 END) won,
    COALESCE(SUM(CASE WHEN i.status='WON' THEN i.deal_amount ELSE 0 END),0) amount
    FROM users u LEFT JOIN inquiries i ON i.owner_id=u.id
    GROUP BY u.id ORDER BY u.role DESC,u.id`);
  const sales = users.filter((user) => user.role === "SALES");
  const admins = users.filter((user) => user.role === "LEADER");

  return <>
    <div className="topline"><div><div className="title">人员管理</div><p className="subtle">观察账号保留业务员界面，但不会出现在分配和内部转交目标中。</p></div></div>
    <section className="panel">
      <strong>业务与观察账号</strong>
      <table className="table"><thead><tr><th>姓名</th><th>登录账号</th><th>类型</th><th>现负责询盘</th><th>成交数</th><th>成交金额</th><th>状态</th><th>接收询盘</th></tr></thead>
        <tbody>{sales.map((user) => <tr key={user.id}>
          <td><strong>{user.display_name}</strong></td><td>{user.username}</td>
          <td>{user.assignable ? (user.level === "SENIOR" ? "资深业务员" : "业务员") : "观察账号"}</td>
          <td><Link href={`/inquiries?owner=${user.id}`}>{user.inquiries} 条</Link></td><td>{user.won || 0}</td><td>USD {user.amount || 0}</td>
          <td>{user.active ? "启用" : "停用"}</td>
          <td>{user.active ? <form action={setSalesAssignable}><input type="hidden" name="id" value={user.id}/><input type="hidden" name="assignable" value={user.assignable ? "0" : "1"}/><button className="btn" type="submit">{user.assignable ? "设为观察账号" : "允许接收"}</button></form> : "—"}</td>
        </tr>)}</tbody>
      </table>
      <p className="subtle">现有询盘不会自动转出观察账号；点击“现负责询盘”可查看并重新分配。</p>
    </section>
    <section className="panel"><strong>管理员账号</strong>
      <table className="table"><thead><tr><th>姓名</th><th>登录账号</th><th>状态</th></tr></thead>
        <tbody>{admins.map((user) => <tr key={user.id}><td>{user.display_name}</td><td>{user.username}</td><td>{user.active ? "启用" : "停用"}</td></tr>)}</tbody>
      </table>
      <p className="subtle">管理员拥有与当前领导账号相同的完整权限。请自行设置独立密码。</p>
      <form action={createAdminAccount} className="grid2">
        <label className="field">管理员登录账号<input name="username" required minLength={3} maxLength={32}/></label>
        <label className="field">显示名称<input name="displayName" required maxLength={80}/></label>
        <label className="field">初始密码<input name="password" type="password" minLength={8} required autoComplete="new-password"/></label>
        <div className="field"><span>&nbsp;</span><button className="btn btn-primary">创建管理员</button></div>
      </form>
    </section>
    <section className="panel"><strong>新建业务账号</strong><p className="subtle">新账号只能查看分配给自己的询盘。</p>
      <form action={createSalesAccount} className="grid2">
        <label className="field">登录账号<input name="username" required minLength={3} maxLength={32}/></label>
        <label className="field">显示名称<input name="displayName" required maxLength={80}/></label>
        <label className="field">初始密码<input name="password" type="password" minLength={8} required autoComplete="new-password"/></label>
        <div className="field"><span>&nbsp;</span><button className="btn btn-primary">创建业务账号</button></div>
      </form>
    </section>
  </>;
}
