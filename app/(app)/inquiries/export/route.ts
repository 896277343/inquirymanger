import { requireLeader } from "@/lib/auth";
import { rows } from "@/lib/db";
import { sources, statuses } from "@/lib/labels";

type ExportRow = {
  inquiry_no:string; primary_email:string; name:string|null; company:string|null; country:string|null; phone:string|null;
  source:string; product_category:string; requirement:string; status:string; owner_name:string|null;
  assigned_at:string|null; accepted_at:string|null; next_follow_up_at:string|null; created_at:string;
};

function csvCell(value:unknown){
  let text=String(value??"").replace(/\r?\n/g," ");
  if(/^[=+\-@]/.test(text))text=`'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}

export async function GET(request:Request){
  await requireLeader();
  const url=new URL(request.url),owner=url.searchParams.get("owner")||"",status=url.searchParams.get("status")||"";
  const conditions:string[]=[],values:Array<string|number>=[];
  if(owner==="public_pool")conditions.push("i.owner_id IS NULL AND i.status='NO_REPLY'");
  else if(owner==="unassigned")conditions.push("i.owner_id IS NULL AND i.status<>'NO_REPLY'");
  else if(/^\d+$/.test(owner)){conditions.push("i.owner_id=?");values.push(Number(owner))}
  if(status&&status in statuses){conditions.push("i.status=?");values.push(status)}
  const where=conditions.length?`WHERE ${conditions.join(" AND ")}`:"";
  const data=rows<ExportRow>(`SELECT i.inquiry_no,c.primary_email,c.name,c.company,c.country,c.phone,i.source,i.product_category,i.requirement,i.status,u.display_name owner_name,i.assigned_at,i.accepted_at,i.next_follow_up_at,i.created_at FROM inquiries i JOIN customers c ON c.id=i.customer_id LEFT JOIN users u ON u.id=i.owner_id ${where} ORDER BY i.created_at DESC`,...values);
  const header=["询盘编号","客户邮箱","联系人","公司名称","国家/地区","电话/WhatsApp","询盘来源","产品分类","客户需求","负责人","当前状态","分配时间","接受时间","下次跟进","录入时间"];
  const body=data.map(item=>[
    item.inquiry_no,item.primary_email,item.name,item.company,item.country,item.phone,sources[item.source]||item.source,item.product_category,item.requirement,
    item.status==="NO_REPLY"?"公海":item.owner_name||"待分配",statuses[item.status]||item.status,item.assigned_at,item.accepted_at,item.next_follow_up_at,item.created_at,
  ].map(csvCell).join(","));
  const csv=`\uFEFF${header.map(csvCell).join(",")}\r\n${body.join("\r\n")}`;
  const stamp=new Date().toISOString().slice(0,10).replace(/-/g,"");
  return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="inquiries-${stamp}.csv"`,"Cache-Control":"no-store"}});
}
