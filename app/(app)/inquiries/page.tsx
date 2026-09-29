import Link from "next/link";
import { InquiryTableRow } from "@/components/inquiry-table-row";
import { requireSession } from "@/lib/auth";
import { row, rows } from "@/lib/db";
import { sources, statuses } from "@/lib/labels";

type Item = { id:number; inquiry_no:string; primary_email:string; name:string|null; company:string|null; product_category:string; source:string; status:string; owner_id:number|null; owner_name:string|null; created_at:string };
type Salesperson = { id:number; display_name:string };
type Search = { owner?:string; status?:string; page?:string };
const PAGE_SIZE = 30;
const OWNER_COLORS = ["#f3f8ff","#fff8ed","#f1fbf5","#fff3f6","#f7f3ff","#f2fbfc"];

function pageHref(search:Search,page:number){const params=new URLSearchParams();if(search.owner)params.set("owner",search.owner);if(search.status)params.set("status",search.status);params.set("page",String(page));return `/inquiries?${params.toString()}`}

export default async function Inquiries({searchParams}:{searchParams:Promise<Search>}){
  const session=await requireSession(),search=await searchParams;
  const salespeople=session.role==="LEADER"?rows<Salesperson>("SELECT id,display_name FROM users WHERE role='SALES' AND active=1 ORDER BY id"):[];
  const conditions:string[]=[],values:Array<string|number>=[];
  if(session.role==="SALES"){conditions.push("i.owner_id=?");values.push(session.id)}else{
    if(search.owner==="public_pool")conditions.push("i.owner_id IS NULL AND i.status='NO_REPLY'");else if(search.owner==="unassigned")conditions.push("i.owner_id IS NULL AND i.status<>'NO_REPLY'");else if(search.owner&&/^\d+$/.test(search.owner)){conditions.push("i.owner_id=?");values.push(Number(search.owner))}
    if(search.status&&search.status in statuses){conditions.push("i.status=?");values.push(search.status)}
  }
  const where=conditions.length?`WHERE ${conditions.join(" AND ")}`:"";
  const total=row<{count:number}>(`SELECT COUNT(*) count FROM inquiries i ${where}`,...values)?.count||0,totalPages=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const requestedPage=Math.max(1,Number.parseInt(search.page||"1",10)||1),currentPage=Math.min(requestedPage,totalPages),offset=(currentPage-1)*PAGE_SIZE;
  const list=rows<Item>(`SELECT i.*,c.primary_email,c.name,c.company,u.display_name owner_name FROM inquiries i JOIN customers c ON c.id=i.customer_id LEFT JOIN users u ON u.id=i.owner_id ${where} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,...values,PAGE_SIZE,offset);
  return <><div className="topline"><div><div className="title">询盘管理</div><p className="subtle">{session.role==="SALES"?"仅显示分配给你的询盘；点击表格任意位置进入详情":"查看并分配全部正式询盘；点击表格任意位置进入详情"}</p></div>{session.role==="LEADER"&&<Link className="btn btn-primary" href="/inquiries/new">＋ 录入询盘</Link>}</div>
  <section className="panel">{session.role==="LEADER"&&<form method="get" style={{display:"flex",alignItems:"end",gap:12,flexWrap:"wrap",marginBottom:16}}><label className="field" style={{margin:0}}>负责人<select name="owner" defaultValue={search.owner||""}><option value="">全部负责人</option><option value="public_pool">公海</option><option value="unassigned">待分配</option>{salespeople.map(person=><option key={person.id} value={person.id}>{person.display_name}</option>)}</select></label><label className="field" style={{margin:0}}>状态<select name="status" defaultValue={search.status||""}><option value="">全部状态</option>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button className="btn btn-primary">筛选</button><Link className="btn" href="/inquiries">清除</Link><span className="subtle">共 {total} 条，每页 {PAGE_SIZE} 条</span></form>}
  <div style={{overflowX:"auto"}}><table className="table"><thead><tr><th>编号</th><th>客户/邮箱</th><th>产品</th><th>来源</th><th>负责人</th><th>状态</th><th>录入时间</th></tr></thead><tbody>{list.map(item=><InquiryTableRow key={item.id} href={`/inquiries/${item.id}`} style={{background:item.owner_id?OWNER_COLORS[item.owner_id%OWNER_COLORS.length]:"#f4f5f7"}}><td><strong>{item.inquiry_no}</strong></td><td>{item.company||item.name||item.primary_email}<br/><small className="subtle">{item.primary_email}</small></td><td>{item.product_category}</td><td>{sources[item.source]}</td><td>{item.status==="NO_REPLY"?"公海":item.owner_name||"待分配"}</td><td><span className="badge">{statuses[item.status]}</span></td><td>{item.created_at.slice(0,16)}</td></InquiryTableRow>)}</tbody></table></div>
  {list.length===0&&<p className="subtle">暂无符合条件的询盘。</p>}{totalPages>1&&<nav aria-label="询盘分页" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginTop:18}}>{currentPage>1&&<Link className="btn" href={pageHref(search,currentPage-1)}>上一页</Link>}<span className="subtle">第 {currentPage} / {totalPages} 页</span>{currentPage<totalPages&&<Link className="btn" href={pageHref(search,currentPage+1)}>下一页</Link>}</nav>}</section></>
}
