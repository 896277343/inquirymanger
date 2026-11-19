import Link from "next/link";
import { InquiryTableRow } from "@/components/inquiry-table-row";
import { requireSession } from "@/lib/auth";
import { row, rows } from "@/lib/db";
import { sources, statuses } from "@/lib/labels";
import { toggleInquiryFlag } from "./flag-actions";

type Item = {
  id: number; inquiry_no: string; primary_email: string; name: string | null;
  company: string | null; country: string | null; product_category: string;
  source: string; status: string; owner_id: number | null; owner_name: string | null;
  created_at: string; next_follow_up_at: string | null; pinned: number; important: number; is_overdue: number;
};
type Salesperson = { id: number; display_name: string };
type Search = { owner?: string; status?: string; q?: string; country?: string; view?: string; page?: string };
const PAGE_SIZE = 30;
const OWNER_COLORS = ["#f3f8ff", "#fff8ed", "#f1fbf5", "#fff3f6", "#f7f3ff", "#f2fbfc"];
const salesViews = { all: "全部询盘", pending: "待接受", due: "提醒已到期", overdue: "跟进已逾期", pinned: "已置顶", important: "重点标记" };

function pageHref(search: Search, page: number) {
  const params = new URLSearchParams();
  for (const key of ["owner", "status", "q", "country", "view"] as const) {
    if (search[key]) params.set(key, search[key]);
  }
  params.set("page", String(page));
  return `/inquiries?${params.toString()}`;
}

export default async function Inquiries({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireSession();
  const search = await searchParams;
  const isSales = session.role === "SALES";
  const salespeople = !isSales ? rows<Salesperson>("SELECT id,display_name FROM users WHERE role='SALES' AND active=1 ORDER BY id") : [];
  const countries = isSales ? rows<{ country: string }>(`SELECT DISTINCT trim(c.country) country
    FROM inquiries i JOIN customers c ON c.id=i.customer_id
    WHERE i.owner_id=? AND trim(COALESCE(c.country,''))<>''
    ORDER BY country COLLATE NOCASE`, session.id) : [];
  const join = "JOIN customers c ON c.id=i.customer_id LEFT JOIN inquiry_user_flags f ON f.inquiry_id=i.id AND f.user_id=?";
  const conditions: string[] = [];
  const values: Array<string | number> = [session.id];
  if (isSales) {
    conditions.push("i.owner_id=?");
    values.push(session.id);
  } else if (search.owner === "public_pool") {
    conditions.push("i.owner_id IS NULL AND i.status IN ('NO_REPLY','PUBLIC_POOL')");
  } else if (search.owner === "unassigned") {
    conditions.push("i.owner_id IS NULL AND i.status NOT IN ('NO_REPLY','PUBLIC_POOL')");
  } else if (search.owner && /^\d+$/.test(search.owner)) {
    conditions.push("i.owner_id=?");
    values.push(Number(search.owner));
  }
  if (search.status && search.status in statuses) {
    conditions.push("i.status=?");
    values.push(search.status);
  }
  const view = search.view && search.view in salesViews && (isSales || search.view === "overdue") ? search.view : "all";
  if (view === "pending") conditions.push("i.accepted_at IS NULL AND i.status NOT IN ('WON','LOST')");
  if (view === "due") conditions.push("i.accepted_at IS NOT NULL AND i.next_follow_up_at IS NOT NULL AND i.next_follow_up_at<=datetime('now','localtime') AND i.status!='WON'");
  if (view === "overdue") conditions.push("i.accepted_at IS NOT NULL AND COALESCE(i.reminder_overdue_at,i.next_follow_up_at) IS NOT NULL AND COALESCE(i.reminder_overdue_at,i.next_follow_up_at)<=datetime('now','localtime') AND i.status NOT IN ('WON','LOST')");
  if (view === "pinned") conditions.push("f.pinned=1");
  if (view === "important") conditions.push("f.important=1");
  const keyword = (search.q || "").trim().slice(0, 100);
  if (keyword) {
    conditions.push(`(instr(lower(COALESCE(i.inquiry_no,'')),lower(?))>0
      OR instr(lower(c.primary_email),lower(?))>0
      OR instr(lower(COALESCE(c.name,'')),lower(?))>0
      OR instr(lower(COALESCE(c.company,'')),lower(?))>0
      OR instr(lower(COALESCE(c.country,'')),lower(?))>0
      OR instr(lower(COALESCE(c.phone,'')),lower(?))>0
      OR instr(lower(COALESCE(c.alternate_emails,'')),lower(?))>0
      OR instr(lower(i.product_category),lower(?))>0
      OR instr(lower(i.requirement),lower(?))>0)`);
    values.push(...Array(9).fill(keyword));
  }
  const country = (search.country || "").trim().slice(0, 100);
  if (isSales && country) {
    conditions.push("trim(c.country)=?");
    values.push(country);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = row<{ count: number }>(`SELECT COUNT(*) count FROM inquiries i ${join} ${where}`, ...values)?.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requestedPage = Math.max(1, Number.parseInt(search.page || "1", 10) || 1);
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const order = !isSales ? "i.created_at DESC,i.id DESC"
    : view === "pending" ? "COALESCE(f.pinned,0) DESC,i.assigned_at ASC,i.id ASC"
    : view === "due" || view === "overdue" ? "COALESCE(f.pinned,0) DESC,i.next_follow_up_at ASC,i.id ASC"
    : "COALESCE(f.pinned,0) DESC,i.created_at DESC,i.id DESC";
  const list = rows<Item>(`SELECT i.*,c.primary_email,c.name,c.company,c.country,
    u.display_name owner_name,COALESCE(f.pinned,0) pinned,COALESCE(f.important,0) important,
    CASE WHEN COALESCE(i.reminder_overdue_at,i.next_follow_up_at)<=datetime('now','localtime')
      AND i.status NOT IN ('WON','LOST') THEN 1 ELSE 0 END is_overdue
    FROM inquiries i ${join} LEFT JOIN users u ON u.id=i.owner_id ${where}
    ORDER BY ${order}
    LIMIT ? OFFSET ?`, ...values, PAGE_SIZE, offset);

  return <>
    <div className="topline"><div><div className="title">询盘管理</div>
      <p className="subtle">{isSales ? "仅显示你当前负责的询盘；可按国家、进度、提醒和个人标记查找" : "查看并分配全部正式询盘；点击表格任意位置进入详情"}</p>
    </div>{!isSales && <div className="actions"><form method="post" action="/inquiries/export">
      <input type="hidden" name="owner" value={search.owner || ""}/><input type="hidden" name="status" value={search.status || ""}/>
      <input type="hidden" name="q" value={keyword}/><button className="btn" type="submit">导出 CSV</button>
    </form><Link className="btn btn-primary" href="/inquiries/new">＋ 录入询盘</Link></div>}</div>
    <section className="panel">
      <form method="get" className="inquiry-filters">
        <label className="field">搜索询盘<input name="q" type="search" defaultValue={keyword} placeholder="编号、邮箱、客户、国家、电话、产品或需求" maxLength={100}/></label>
        {isSales ? <>
          <label className="field">国家/地区<select name="country" defaultValue={country}>
            <option value="">全部国家/地区</option>{countries.map(item=><option key={item.country} value={item.country}>{item.country}</option>)}
          </select></label>
          <label className="field">查看范围<select name="view" defaultValue={view}>
            {Object.entries(salesViews).map(([value,label])=><option key={value} value={value}>{label}</option>)}
          </select></label>
        </> : <label className="field">负责人<select name="owner" defaultValue={search.owner || ""}>
          <option value="">全部负责人</option><option value="public_pool">公海</option><option value="unassigned">待分配</option>
          {salespeople.map(person=><option key={person.id} value={person.id}>{person.display_name}</option>)}
        </select></label>}
        {!isSales&&<label className="field">跟进提醒<select name="view" defaultValue={view}>
          <option value="all">全部</option><option value="overdue">已逾期</option>
        </select></label>}
        <label className="field">状态<select name="status" defaultValue={search.status || ""}>
          <option value="">全部状态</option>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        <button className="btn btn-primary">搜索 / 筛选</button><Link className="btn" href="/inquiries">清除</Link>
        <span className="subtle">共 {total} 条，每页 {PAGE_SIZE} 条</span>
      </form>
      <div style={{overflowX:"auto"}}><table className="table"><thead><tr>
        {isSales && <th>我的标记</th>}<th>编号</th><th>客户/邮箱</th><th>国家/地区</th><th>产品</th><th>来源</th><th>负责人</th><th>状态</th><th>下次提醒</th><th>录入时间</th>
      </tr></thead><tbody>{list.map(item=><InquiryTableRow key={item.id} href={`/inquiries/${item.id}`}
        style={{background:item.important?"#fff4d9":item.owner_id?OWNER_COLORS[item.owner_id%OWNER_COLORS.length]:"#f4f5f7"}}>
        {isSales && <td><div className="flag-actions">
          <form action={toggleInquiryFlag}><input type="hidden" name="inquiryId" value={item.id}/><input type="hidden" name="flag" value="pinned"/>
            <button className={`btn flag-button ${item.pinned?"flag-active":""}`} type="submit" aria-label={item.pinned?"取消置顶":"置顶"} title={item.pinned?"取消置顶":"置顶"}>{item.pinned?"📌 已置顶":"📌 置顶"}</button></form>
          <form action={toggleInquiryFlag}><input type="hidden" name="inquiryId" value={item.id}/><input type="hidden" name="flag" value="important"/>
            <button className={`btn flag-button ${item.important?"flag-active":""}`} type="submit" aria-label={item.important?"取消重点标记":"标记重点"} title={item.important?"取消重点标记":"标记重点"}>{item.important?"★ 重点":"☆ 标记"}</button></form>
        </div></td>}
        <td><strong>{item.inquiry_no}</strong></td>
        <td>{item.company||item.name||item.primary_email}<br/><small className="subtle">{item.primary_email}</small></td>
        <td>{item.country||"—"}</td><td>{item.product_category}</td><td>{sources[item.source]}</td>
        <td>{item.status==="NO_REPLY"||item.status==="PUBLIC_POOL"?"公海":item.owner_name||"待分配"}</td>
        <td><span className="badge">{statuses[item.status]}</span></td>
        <td>{item.next_follow_up_at?.slice(0,16)||"—"} {Boolean(item.is_overdue)&&<span className="badge">已逾期</span>}</td><td>{item.created_at.slice(0,16)}</td>
      </InquiryTableRow>)}</tbody></table></div>
      {list.length===0&&<p className="subtle">暂无符合条件的询盘。</p>}
      {totalPages>1&&<nav aria-label="询盘分页" className="actions" style={{justifyContent:"center",alignItems:"center",marginTop:18}}>
        {currentPage>1&&<Link className="btn" href={pageHref(search,currentPage-1)}>上一页</Link>}
        <span className="subtle">第 {currentPage} / {totalPages} 页</span>
        {currentPage<totalPages&&<Link className="btn" href={pageHref(search,currentPage+1)}>下一页</Link>}
      </nav>}
    </section>
  </>;
}
