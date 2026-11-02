import Link from "next/link";
import { requireLeader } from "@/lib/auth";
import { row, rows } from "@/lib/db";
import { products, sources } from "@/lib/labels";
import { ignoreSubmission, importSubmission } from "./actions";

type Submission = { id:number; external_id:string; site:string; page_url:string; name:string; email:string; company:string; country:string; phone:string; product:string; message:string; submitted_at:string; created_at:string; status:string; inquiry_id:number|null };

export default async function InboundPage({searchParams}:{searchParams:Promise<{page?:string;status?:string}>}) {
  await requireLeader();
  const search = await searchParams;
  const status = search.status === "IMPORTED" || search.status === "IGNORED" ? search.status : "PENDING";
  const total = row<{n:number}>("SELECT COUNT(*) n FROM inbound_submissions WHERE status=?", status)?.n || 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  const page = Math.min(pages, Math.max(1, Number.parseInt(search.page || "1", 10) || 1));
  const items = rows<Submission>("SELECT * FROM inbound_submissions WHERE status=? ORDER BY id DESC LIMIT 20 OFFSET ?", status, (page-1)*20);
  return <>
    <div className="topline"><div><div className="title">网站留言待审核</div><p className="subtle">旧系统正常留言自动进入此处；确认后才成为正式询盘。</p></div></div>
    <section className="panel">
      <div className="actions" style={{marginBottom:18}}><Link className="btn" href="/inbound">待审核</Link><Link className="btn" href="/inbound?status=IMPORTED">已录入</Link><Link className="btn" href="/inbound?status=IGNORED">已忽略</Link><span className="subtle">当前 {total} 条</span></div>
      {items.map(item=><div key={item.id} className="panel" style={{marginBottom:16}}>
        <div className="toolbar"><strong>{item.name || "未填姓名"} · {item.email || "未填邮箱"}</strong><span className="subtle">旧系统 #{item.external_id} · {item.submitted_at || item.created_at}</span></div>
        <p className="subtle">来源：{item.site || "未标记"}{/^https?:\/\//i.test(item.page_url || "") && <> · <a href={item.page_url} target="_blank" rel="noreferrer">提交页面</a></>}</p>
        <p style={{whiteSpace:"pre-wrap"}}>{item.message}</p>
        <p className="subtle">公司：{item.company || "—"} · 国家：{item.country || "—"} · 电话：{item.phone || "—"} · 原产品：{item.product || "—"}</p>
        {status === "PENDING" ? <div className="actions" style={{alignItems:"end",flexWrap:"wrap"}}>
          <form action={importSubmission} className="actions" style={{alignItems:"end",flexWrap:"wrap"}}><input type="hidden" name="id" value={item.id}/><label className="field">客户邮箱<input type="email" name="email" defaultValue={item.email} required/></label><label className="field">产品分类<select name="product" defaultValue={products.includes(item.product)?item.product:"其他"}>{products.map(p=><option key={p}>{p}</option>)}</select></label><label className="field">营销来源<select name="source" defaultValue="" required><option value="">请选择</option>{Object.entries(sources).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button className="btn btn-primary">确认录入</button></form>
          <form action={ignoreSubmission}><input type="hidden" name="id" value={item.id}/><button className="btn">忽略</button></form>
        </div> : item.inquiry_id ? <Link href={`/inquiries/${item.inquiry_id}`}>查看正式询盘</Link> : null}
      </div>)}
      {items.length===0 && <p className="subtle">暂无留言。</p>}
      {pages>1 && <div className="actions" style={{justifyContent:"center"}}>{page>1&&<Link className="btn" href={`/inbound?status=${status}&page=${page-1}`}>上一页</Link>}<span>第 {page} / {pages} 页</span>{page<pages&&<Link className="btn" href={`/inbound?status=${status}&page=${page+1}`}>下一页</Link>}</div>}
    </section>
  </>;
}
