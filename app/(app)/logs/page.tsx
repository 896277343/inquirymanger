import Link from "next/link";
import { requireLeader } from "@/lib/auth";
import { row, rows } from "@/lib/db";

type Log = {id:number;created_at:string;display_name:string|null;action:string;entity_type:string;entity_id:number|null;summary:string;details:string|null};
const PAGE_SIZE = 100;

export default async function Logs({searchParams}:{searchParams:Promise<{page?:string}>}) {
  await requireLeader();
  const search = await searchParams;
  const total = row<{count:number}>("SELECT COUNT(*) count FROM audit_logs")?.count || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(search.page || "1", 10) || 1));
  const logs = rows<Log>(`SELECT l.*,u.display_name FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT ? OFFSET ?`, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  return <><div className="topline"><div><div className="title">操作日志</div><p className="subtle">共 {total} 条，按时间倒序；每页 {PAGE_SIZE} 条，可翻页查看全部历史记录。</p></div></div><section className="panel"><table className="table"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>说明</th><th>变更详情</th></tr></thead><tbody>{logs.map(l=><tr key={l.id}><td>{l.created_at}</td><td>{l.action.startsWith("AUTO_")?"系统自动任务":l.display_name||"系统"}</td><td>{l.action}</td><td>{l.entity_type} #{l.entity_id||"—"}</td><td>{l.summary}</td><td>{l.details&&<details><summary>查看</summary><pre style={{whiteSpace:"pre-wrap",maxWidth:420}}>{l.details}</pre></details>}</td></tr>)}</tbody></table>{logs.length===0&&<p className="subtle">暂无操作记录。</p>}{pages>1&&<nav aria-label="操作日志分页" className="actions" style={{justifyContent:"center",marginTop:18}}>{page>1&&<Link className="btn" href={`/logs?page=${page-1}`}>上一页</Link>}<span>第 {page} / {pages} 页</span>{page<pages&&<Link className="btn" href={`/logs?page=${page+1}`}>下一页</Link>}</nav>}</section></>;
}
