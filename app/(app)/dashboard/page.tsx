import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { row, rows } from "@/lib/db";
import { sources, statuses } from "@/lib/labels";

type Item = { id:number; inquiry_no:string; primary_email:string; company:string|null; product_category:string; source:string; status:string; owner_name:string|null; updated_at:string; assigned_at?:string; last_follow_up_at?:string };
type SalesSummary = { id:number; display_name:string; total:number; fresh:number; active:number; quoted:number; won:number; overdue:number };
type WeeklyOverall = { new_count:number; assigned_count:number; follow_count:number; quoted_count:number; won_count:number; won_amount:number };
type WeeklyRow = { label:string; inquiries:number; followups:number; quoted:number; won:number };

export default async function Dashboard() {
  const s = await requireSession();
  const scope = s.role === "LEADER" ? "1=1" : "i.owner_id=?";
  const args = s.role === "LEADER" ? [] : [s.id];
  const stats = row<any>(`SELECT COUNT(*) total,
    SUM(CASE WHEN status='UNASSIGNED' THEN 1 ELSE 0 END) unassigned,
    SUM(CASE WHEN status='NEW' THEN 1 ELSE 0 END) fresh,
    SUM(CASE WHEN next_follow_up_at IS NOT NULL AND next_follow_up_at < datetime('now','localtime') AND status NOT IN ('WON','LOST') THEN 1 ELSE 0 END) overdue
    FROM inquiries i WHERE ${scope}`, ...args) || {};
  const recent = rows<Item>(`SELECT i.*,c.primary_email,c.company,u.display_name owner_name FROM inquiries i JOIN customers c ON c.id=i.customer_id LEFT JOIN users u ON u.id=i.owner_id WHERE ${scope} ORDER BY i.updated_at DESC LIMIT 8`, ...args);
  const firstFollowOverdue = s.role === "LEADER" ? rows<Item>(`SELECT i.*,c.primary_email,c.company,u.display_name owner_name FROM inquiries i JOIN customers c ON c.id=i.customer_id JOIN users u ON u.id=i.owner_id WHERE i.assigned_at IS NOT NULL AND i.assigned_at <= datetime('now','localtime','-48 hours') AND i.status NOT IN ('WON','LOST') AND NOT EXISTS (SELECT 1 FROM follow_ups f WHERE f.inquiry_id=i.id) ORDER BY i.assigned_at ASC`) : [];
  const dormant = s.role === "LEADER" ? rows<Item>(`SELECT i.*,c.primary_email,c.company,u.display_name owner_name,MAX(f.created_at) last_follow_up_at FROM inquiries i JOIN customers c ON c.id=i.customer_id JOIN users u ON u.id=i.owner_id JOIN follow_ups f ON f.inquiry_id=i.id WHERE i.status NOT IN ('WON','LOST') GROUP BY i.id HAVING MAX(f.created_at) <= datetime('now','localtime','-3 months') ORDER BY last_follow_up_at ASC`) : [];
  const salesSummary = s.role === "LEADER" ? rows<SalesSummary>(`SELECT u.id,u.display_name,
    COUNT(i.id) total,
    SUM(CASE WHEN i.status='NEW' THEN 1 ELSE 0 END) fresh,
    SUM(CASE WHEN i.status IN ('CONTACTING','TECHNICAL','NEGOTIATING','WAITING','PAUSED') THEN 1 ELSE 0 END) active,
    SUM(CASE WHEN i.status='QUOTED' THEN 1 ELSE 0 END) quoted,
    SUM(CASE WHEN i.status='WON' THEN 1 ELSE 0 END) won,
    SUM(CASE WHEN i.next_follow_up_at IS NOT NULL AND i.next_follow_up_at < datetime('now','localtime') AND i.status NOT IN ('WON','LOST') THEN 1 ELSE 0 END) overdue
    FROM users u LEFT JOIN inquiries i ON i.owner_id=u.id
    WHERE u.role='SALES' AND u.active=1 GROUP BY u.id ORDER BY u.id`) : [];
  const weekStart=`date('now','localtime','-' || ((CAST(strftime('%w','now','localtime') AS INTEGER)+6)%7) || ' days')`;
  const weeklyOverall=s.role==="LEADER"?row<WeeklyOverall>(`SELECT
    (SELECT COUNT(*) FROM inquiries WHERE created_at>=${weekStart}) new_count,
    (SELECT COUNT(*) FROM inquiries WHERE assigned_at>=${weekStart}) assigned_count,
    (SELECT COUNT(*) FROM follow_ups WHERE created_at>=${weekStart}) follow_count,
    (SELECT COUNT(DISTINCT entity_id) FROM audit_logs WHERE entity_type='INQUIRY' AND action='UPDATE' AND created_at>=${weekStart} AND json_extract(details,'$.after.status')='QUOTED') quoted_count,
    (SELECT COUNT(DISTINCT entity_id) FROM audit_logs WHERE entity_type='INQUIRY' AND action='UPDATE' AND created_at>=${weekStart} AND json_extract(details,'$.after.status')='WON') won_count,
    (SELECT COALESCE(SUM(i.deal_amount),0) FROM inquiries i WHERE i.id IN (SELECT DISTINCT entity_id FROM audit_logs WHERE entity_type='INQUIRY' AND action='UPDATE' AND created_at>=${weekStart} AND json_extract(details,'$.after.status')='WON')) won_amount`)||{new_count:0,assigned_count:0,follow_count:0,quoted_count:0,won_count:0,won_amount:0}:{new_count:0,assigned_count:0,follow_count:0,quoted_count:0,won_count:0,won_amount:0};
  const weeklySales=s.role==="LEADER"?rows<WeeklyRow>(`SELECT u.display_name label,
    SUM(CASE WHEN i.assigned_at>=${weekStart} THEN 1 ELSE 0 END) inquiries,
    (SELECT COUNT(*) FROM follow_ups f WHERE f.user_id=u.id AND f.created_at>=${weekStart}) followups,
    (SELECT COUNT(DISTINCT l.entity_id) FROM audit_logs l JOIN inquiries iq ON iq.id=l.entity_id WHERE iq.owner_id=u.id AND l.action='UPDATE' AND l.created_at>=${weekStart} AND json_extract(l.details,'$.after.status')='QUOTED') quoted,
    (SELECT COUNT(DISTINCT l.entity_id) FROM audit_logs l JOIN inquiries iq ON iq.id=l.entity_id WHERE iq.owner_id=u.id AND l.action='UPDATE' AND l.created_at>=${weekStart} AND json_extract(l.details,'$.after.status')='WON') won
    FROM users u LEFT JOIN inquiries i ON i.owner_id=u.id WHERE u.role='SALES' AND u.active=1 GROUP BY u.id ORDER BY u.id`):[];
  const weeklySources=s.role==="LEADER"?rows<WeeklyRow>(`SELECT source label,COUNT(*) inquiries,
    (SELECT COUNT(*) FROM follow_ups f JOIN inquiries fi ON fi.id=f.inquiry_id WHERE fi.source=i.source AND f.created_at>=${weekStart}) followups,
    SUM(CASE WHEN status='QUOTED' THEN 1 ELSE 0 END) quoted,SUM(CASE WHEN status='WON' THEN 1 ELSE 0 END) won
    FROM inquiries i WHERE created_at>=${weekStart} GROUP BY source ORDER BY inquiries DESC`):[];
  const weeklyProducts=s.role==="LEADER"?rows<WeeklyRow>(`SELECT product_category label,COUNT(*) inquiries,
    (SELECT COUNT(*) FROM follow_ups f JOIN inquiries fi ON fi.id=f.inquiry_id WHERE fi.product_category=i.product_category AND f.created_at>=${weekStart}) followups,
    SUM(CASE WHEN status='QUOTED' THEN 1 ELSE 0 END) quoted,SUM(CASE WHEN status='WON' THEN 1 ELSE 0 END) won
    FROM inquiries i WHERE created_at>=${weekStart} GROUP BY product_category ORDER BY inquiries DESC`):[];
  const weeklyTrend=s.role==="LEADER"?rows<any>(`WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<7), w AS (SELECT x,date(${weekStart},((0-x)*7)||' days') start_date,date(${weekStart},((1-x)*7)||' days') end_date FROM n) SELECT start_date label,(SELECT COUNT(*) FROM inquiries i WHERE date(i.created_at)>=w.start_date AND date(i.created_at)<w.end_date) inquiries,(SELECT COUNT(*) FROM follow_ups f WHERE date(f.created_at)>=w.start_date AND date(f.created_at)<w.end_date) followups,(SELECT COUNT(DISTINCT entity_id) FROM audit_logs l WHERE l.action='UPDATE' AND date(l.created_at)>=w.start_date AND date(l.created_at)<w.end_date AND json_extract(l.details,'$.after.status')='WON') won FROM w ORDER BY start_date DESC`):[];

  return <>
    <div className="topline"><div><div className="title">{s.name}，今天好</div><p className="subtle">查看询盘处理进度和近期任务</p></div>{s.role === "LEADER" && <Link className="btn btn-primary" href="/inquiries/new">＋ 录入询盘</Link>}</div>
    <section className="cards"><div className="card"><span className="subtle">全部询盘</span><div className="value">{stats.total || 0}</div></div><div className="card"><span className="subtle">待分配</span><div className="value">{stats.unassigned || 0}</div></div><div className="card"><span className="subtle">待首次跟进</span><div className="value">{stats.fresh || 0}</div></div><div className="card"><span className="subtle">已逾期</span><div className="value">{stats.overdue || 0}</div></div></section>
    {s.role === "LEADER" && <section className="panel"><div className="toolbar"><strong>业务员分配概况</strong><span className="subtle">数据每15秒自动同步</span></div><table className="table"><thead><tr><th>业务员</th><th>已分配</th><th>待首次跟进</th><th>跟进中</th><th>已报价</th><th>已成交</th><th>跟进逾期</th></tr></thead><tbody>{salesSummary.map(x => <tr key={x.id}><td><strong>{x.display_name}</strong></td><td>{x.total || 0}</td><td>{x.fresh || 0}</td><td>{x.active || 0}</td><td>{x.quoted || 0}</td><td>{x.won || 0}</td><td>{x.overdue || 0}</td></tr>)}</tbody></table></section>}
    {s.role === "LEADER" && <section className="panel"><div className="toolbar"><strong>本周经营分析</strong><span className="subtle">统计周期：本周一至现在</span></div><div className="cards"><div className="card"><span className="subtle">新增询盘</span><div className="value">{weeklyOverall.new_count}</div></div><div className="card"><span className="subtle">本周分配</span><div className="value">{weeklyOverall.assigned_count}</div></div><div className="card"><span className="subtle">跟进记录</span><div className="value">{weeklyOverall.follow_count}</div></div><div className="card"><span className="subtle">报价 / 成交</span><div className="value">{weeklyOverall.quoted_count} / {weeklyOverall.won_count}</div></div></div><div className="grid2">
      <div><h3>按业务员</h3><table className="table"><thead><tr><th>业务员</th><th>分配</th><th>跟进</th><th>报价</th><th>成交</th></tr></thead><tbody>{weeklySales.map(x=><tr key={x.label}><td>{x.label}</td><td>{x.inquiries||0}</td><td>{x.followups||0}</td><td>{x.quoted||0}</td><td>{x.won||0}</td></tr>)}</tbody></table></div>
      <div><h3>按询盘来源</h3><table className="table"><thead><tr><th>来源</th><th>新增</th><th>跟进</th><th>当前报价</th><th>当前成交</th></tr></thead><tbody>{weeklySources.map(x=><tr key={x.label}><td>{sources[x.label]||x.label}</td><td>{x.inquiries||0}</td><td>{x.followups||0}</td><td>{x.quoted||0}</td><td>{x.won||0}</td></tr>)}</tbody></table></div>
      <div><h3>按产品分类</h3><table className="table"><thead><tr><th>产品</th><th>新增</th><th>跟进</th><th>当前报价</th><th>当前成交</th></tr></thead><tbody>{weeklyProducts.map(x=><tr key={x.label}><td>{x.label}</td><td>{x.inquiries||0}</td><td>{x.followups||0}</td><td>{x.quoted||0}</td><td>{x.won||0}</td></tr>)}</tbody></table></div>
      <div><h3>最近8周趋势</h3><table className="table"><thead><tr><th>周开始日期</th><th>询盘</th><th>跟进</th><th>成交</th></tr></thead><tbody>{weeklyTrend.map(x=><tr key={x.label}><td>{x.label}</td><td>{x.inquiries||0}</td><td>{x.followups||0}</td><td>{x.won||0}</td></tr>)}</tbody></table></div>
    </div>{weeklyOverall.won_amount>0&&<p className="subtle">本周成交询盘金额合计：USD {weeklyOverall.won_amount}</p>}</section>}
    {s.role === "LEADER" && <section className="panel"><div className="toolbar"><strong>领导提醒</strong><span className="subtle">仅作提醒，不自动改变负责人或状态</span></div><div className="grid2">
      <div><h3>分配后48小时未首次跟进（{firstFollowOverdue.length}）</h3>{firstFollowOverdue.length === 0 ? <p className="subtle">目前没有超时询盘。</p> : <table className="table"><tbody>{firstFollowOverdue.map(x => <tr key={x.id}><td><Link href={`/inquiries/${x.id}`}>{x.inquiry_no}</Link></td><td>{x.company || x.primary_email}</td><td>{x.owner_name}</td><td>{x.assigned_at?.slice(0,16)}</td></tr>)}</tbody></table>}</div>
      <div><h3>超过3个月未继续跟进（{dormant.length}）</h3>{dormant.length === 0 ? <p className="subtle">目前没有长期沉默询盘。</p> : <table className="table"><tbody>{dormant.map(x => <tr key={x.id}><td><Link href={`/inquiries/${x.id}`}>{x.inquiry_no}</Link></td><td>{x.company || x.primary_email}</td><td>{x.owner_name}</td><td>{x.last_follow_up_at?.slice(0,16)}</td></tr>)}</tbody></table>}</div>
    </div></section>}
    <section className="panel"><div className="toolbar"><strong>最近更新</strong><Link className="subtle" href="/inquiries">查看全部 →</Link></div><table className="table"><thead><tr><th>编号</th><th>客户</th><th>产品</th><th>来源</th><th>负责人</th><th>状态</th></tr></thead><tbody>{recent.map(x => <tr key={x.id}><td><Link href={`/inquiries/${x.id}`}>{x.inquiry_no}</Link></td><td>{x.company || x.primary_email}</td><td>{x.product_category}</td><td>{sources[x.source]}</td><td>{x.owner_name || "—"}</td><td><span className="badge">{statuses[x.status]}</span></td></tr>)}</tbody></table></section>
  </>;
}
