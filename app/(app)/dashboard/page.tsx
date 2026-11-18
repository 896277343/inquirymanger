import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { row, rows } from "@/lib/db";
import { sources, statuses } from "@/lib/labels";

type Item = { id:number; inquiry_no:string; primary_email:string; company:string|null; product_category:string; source:string; status:string; owner_name:string|null; updated_at:string; assigned_at?:string; accepted_at?:string; accept_method?:string; next_follow_up_at?:string; last_follow_up_at?:string; acceptance_deadline?:string; is_overdue?:number };
type SalesSummary = { id:number; display_name:string; total:number; fresh:number; active:number; quoted:number; won:number; overdue:number };
type SalesFlow = { id:number; display_name:string; received:number; retained:number; followed:number; unfollowed:number; transferred:number; unaccepted_transfers:number; pool_out:number; auto_returned:number };
type WeeklyOverall = { new_count:number; assigned_count:number; follow_count:number; quoted_count:number; won_count:number; won_amount:number };
type WeeklyRow = { label:string; inquiries:number; followups:number; quoted:number; won:number };

export default async function Dashboard() {
  const s = await requireSession();
  const scope = s.role === "LEADER" ? "1=1" : "i.owner_id=?";
  const args = s.role === "LEADER" ? [] : [s.id];
  const stats = row<any>(`SELECT COUNT(*) total,
    SUM(CASE WHEN status='UNASSIGNED' THEN 1 ELSE 0 END) unassigned,
    SUM(CASE WHEN status='NEW' THEN 1 ELSE 0 END) fresh,
    SUM(CASE WHEN owner_id IS NOT NULL AND accepted_at IS NULL AND status NOT IN ('WON','LOST') THEN 1 ELSE 0 END) unaccepted,
    SUM(CASE WHEN owner_id IS NOT NULL AND accepted_at IS NULL AND assigned_at <= datetime('now','localtime','-48 hours') AND status NOT IN ('WON','LOST') THEN 1 ELSE 0 END) acceptance_overdue,
    SUM(CASE WHEN accepted_at IS NOT NULL AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= datetime('now','localtime') AND status!='WON' THEN 1 ELSE 0 END) reminder_due,
    SUM(CASE WHEN next_follow_up_at IS NOT NULL AND next_follow_up_at < datetime('now','localtime') AND status NOT IN ('WON','LOST') THEN 1 ELSE 0 END) overdue
    FROM inquiries i WHERE ${scope}`, ...args) || {};
  const recent = rows<Item>(`SELECT i.*,c.primary_email,c.company,u.display_name owner_name FROM inquiries i JOIN customers c ON c.id=i.customer_id LEFT JOIN users u ON u.id=i.owner_id WHERE ${scope} ORDER BY i.updated_at DESC LIMIT 8`, ...args);
  const firstFollowOverdue = s.role === "LEADER" ? rows<Item>(`SELECT i.*,c.primary_email,c.company,u.display_name owner_name FROM inquiries i JOIN customers c ON c.id=i.customer_id JOIN users u ON u.id=i.owner_id WHERE i.assigned_at IS NOT NULL AND i.assigned_at <= datetime('now','localtime','-48 hours') AND i.accepted_at IS NULL AND i.status NOT IN ('WON','LOST') ORDER BY i.assigned_at ASC`) : [];
  const autoReturns = s.role === "LEADER" ? rows<{id:number;entity_id:number;created_at:string;summary:string}>("SELECT id,entity_id,created_at,summary FROM audit_logs WHERE action='AUTO_RETURN' ORDER BY id DESC LIMIT 10") : [];
  const pendingAcceptance = s.role === "SALES" ? rows<Item>(`SELECT i.*,c.primary_email,c.company,u.display_name owner_name,datetime(i.assigned_at,'+48 hours') acceptance_deadline,CASE WHEN i.assigned_at<=datetime('now','localtime','-48 hours') THEN 1 ELSE 0 END is_overdue FROM inquiries i JOIN customers c ON c.id=i.customer_id JOIN users u ON u.id=i.owner_id WHERE i.owner_id=? AND i.accepted_at IS NULL AND i.status NOT IN ('WON','LOST') ORDER BY i.assigned_at ASC`,s.id) : [];
  const progressReminders = s.role === "SALES" ? rows<Item>(`SELECT i.*,c.primary_email,c.company,u.display_name owner_name,CASE WHEN i.next_follow_up_at<=datetime('now','localtime') THEN 1 ELSE 0 END is_overdue FROM inquiries i JOIN customers c ON c.id=i.customer_id JOIN users u ON u.id=i.owner_id WHERE i.owner_id=? AND i.accepted_at IS NOT NULL AND i.next_follow_up_at IS NOT NULL AND i.status!='WON' ORDER BY i.next_follow_up_at ASC`,s.id) : [];
  const dormant = s.role === "LEADER" ? rows<Item>(`SELECT i.*,c.primary_email,c.company,u.display_name owner_name,MAX(f.created_at) last_follow_up_at FROM inquiries i JOIN customers c ON c.id=i.customer_id JOIN users u ON u.id=i.owner_id JOIN follow_ups f ON f.inquiry_id=i.id WHERE i.status NOT IN ('WON','LOST') GROUP BY i.id HAVING MAX(f.created_at) <= datetime('now','localtime','-3 months') ORDER BY last_follow_up_at ASC`) : [];
  const salesSummary = s.role === "LEADER" ? rows<SalesSummary>(`SELECT u.id,u.display_name,
    COUNT(i.id) total,
    SUM(CASE WHEN i.status='NEW' THEN 1 ELSE 0 END) fresh,
    SUM(CASE WHEN i.status IN ('CONTACTING','TECHNICAL','NEGOTIATING','WAITING','PAUSED') THEN 1 ELSE 0 END) active,
    SUM(CASE WHEN i.status='QUOTED' THEN 1 ELSE 0 END) quoted,
    SUM(CASE WHEN i.status='WON' THEN 1 ELSE 0 END) won,
    SUM(CASE WHEN i.next_follow_up_at IS NOT NULL AND i.next_follow_up_at < datetime('now','localtime') AND i.status NOT IN ('WON','LOST') THEN 1 ELSE 0 END) overdue
    FROM users u LEFT JOIN inquiries i ON i.owner_id=u.id
    WHERE u.role='SALES' AND u.active=1 AND u.assignable=1 GROUP BY u.id ORDER BY u.id`) : [];
  const salesFlow = s.role === "LEADER" ? rows<SalesFlow>(`WITH received AS (
      SELECT u.id user_id, al.entity_id inquiry_id
      FROM users u JOIN audit_logs al ON al.entity_type='INQUIRY' AND al.action='ASSIGN'
        AND (json_extract(al.details,'$.ownerId')=u.id
          OR (al.details IS NULL AND al.summary='分配给 ' || u.display_name))
      UNION
      SELECT json_extract(al.details,'$.toOwnerId') user_id, al.entity_id inquiry_id
      FROM audit_logs al WHERE al.entity_type='INQUIRY' AND al.action='TRANSFER'
        AND json_extract(al.details,'$.toOwnerId') IS NOT NULL
      UNION
      SELECT owner_id user_id, id inquiry_id FROM inquiries WHERE owner_id IS NOT NULL
    ), activity AS (
      SELECT user_id,entity_id inquiry_id FROM audit_logs
        WHERE entity_type='INQUIRY' AND action='ACCEPT'
      UNION
      SELECT user_id,inquiry_id FROM follow_ups
      UNION
      SELECT owner_id user_id,id inquiry_id FROM inquiries
        WHERE owner_id IS NOT NULL AND accepted_at IS NOT NULL
    )
    SELECT u.id,u.display_name,
      (SELECT COUNT(*) FROM received r WHERE r.user_id=u.id) received,
      (SELECT COUNT(*) FROM inquiries i WHERE i.owner_id=u.id) retained,
      (SELECT COUNT(*) FROM received r WHERE r.user_id=u.id AND EXISTS (
        SELECT 1 FROM activity a WHERE a.user_id=u.id AND a.inquiry_id=r.inquiry_id)) followed,
      (SELECT COUNT(*) FROM received r WHERE r.user_id=u.id AND NOT EXISTS (
        SELECT 1 FROM activity a WHERE a.user_id=u.id AND a.inquiry_id=r.inquiry_id)) unfollowed,
      (SELECT COUNT(*) FROM audit_logs al WHERE al.user_id=u.id AND al.action='TRANSFER'
        AND al.entity_type='INQUIRY') transferred,
      (SELECT COUNT(*) FROM audit_logs al WHERE al.user_id=u.id AND al.action='TRANSFER'
        AND al.entity_type='INQUIRY' AND json_extract(al.details,'$.before.accepted_at') IS NULL) unaccepted_transfers,
      (SELECT COUNT(*) FROM audit_logs al WHERE al.user_id=u.id AND al.action='UPDATE'
        AND al.entity_type='INQUIRY' AND json_extract(al.details,'$.after.status')='NO_REPLY') pool_out,
      (SELECT COUNT(*) FROM audit_logs al WHERE al.user_id=u.id AND al.action='AUTO_RETURN'
        AND al.entity_type='INQUIRY') auto_returned
    FROM users u WHERE u.role='SALES' AND u.active=1 AND u.assignable=1 ORDER BY u.id`) : [];
  const poolSync = s.role === "LEADER" ? row<{pending:number;synced:number;failed:number}>(`SELECT
    SUM(CASE WHEN cs.crm_pool_synced_at IS NULL THEN 1 ELSE 0 END) pending,
    SUM(CASE WHEN cs.crm_pool_synced_at IS NOT NULL THEN 1 ELSE 0 END) synced,
    SUM(CASE WHEN cs.crm_pool_last_error IS NOT NULL AND cs.crm_pool_synced_at IS NULL THEN 1 ELSE 0 END) failed
    FROM inquiries i LEFT JOIN crm_syncs cs ON cs.inquiry_id=i.id
    WHERE i.owner_id IS NULL AND i.status IN ('NO_REPLY','PUBLIC_POOL')`) : undefined;
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
    FROM users u LEFT JOIN inquiries i ON i.owner_id=u.id WHERE u.role='SALES' AND u.active=1 AND u.assignable=1 GROUP BY u.id ORDER BY u.id`):[];
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
    <section className="cards"><div className="card"><span className="subtle">全部询盘</span><div className="value">{stats.total || 0}</div></div>{s.role==="LEADER"?<><div className="card"><span className="subtle">待分配</span><div className="value">{stats.unassigned || 0}</div></div><div className="card"><span className="subtle">待首次跟进</span><div className="value">{stats.fresh || 0}</div></div><div className="card"><span className="subtle">已逾期</span><div className="value">{stats.overdue || 0}</div></div></>:<><div className="card"><span className="subtle">待接受</span><div className="value">{stats.unaccepted || 0}</div></div><div className="card"><span className="subtle">48小时未接受</span><div className="value">{stats.acceptance_overdue || 0}</div></div><div className="card"><span className="subtle">提醒已到期</span><div className="value">{stats.reminder_due || 0}</div></div></>}</section>
    {s.role === "LEADER" && <section className="panel"><div className="toolbar"><strong>业务员询盘流转与跟进</strong><span className="subtle">累计口径；每15秒自动同步</span></div>
      <div style={{overflowX:"auto"}}><table className="table"><thead><tr><th>业务员</th><th>累计收到</th><th>当前留存</th><th>已跟进</th><th>未跟进</th><th>转交同事</th><th>其中未接受就转交</th><th>转入公海</th><th>48小时自动退回</th></tr></thead>
        <tbody>{salesFlow.map(x=><tr key={x.id}><td><strong>{x.display_name}</strong></td><td>{x.received}</td><td><Link href={`/inquiries?owner=${x.id}`}>{x.retained}</Link></td><td>{x.followed}</td><td>{x.unfollowed}</td><td>{x.transferred}</td><td>{x.unaccepted_transfers}</td><td>{x.pool_out}</td><td>{x.auto_returned}</td></tr>)}</tbody>
      </table></div>
      <p className="subtle">累计收到按不同询盘去重；已跟进指该业务员曾接受询盘或写过跟进记录，未跟进为收到后从未做过这两项。当前留存按现负责人计算；转交、公海和自动退回按操作次数计算，因此各列不应直接相减。</p>
    </section>}
    {s.role === "LEADER" && <section className="panel"><div className="toolbar"><strong>业务员当前进度</strong><span className="subtle">仅统计当前归属该业务员的询盘</span></div><table className="table"><thead><tr><th>业务员</th><th>当前负责</th><th>待首次跟进</th><th>跟进中</th><th>已报价</th><th>已成交</th><th>跟进逾期</th></tr></thead><tbody>{salesSummary.map(x => <tr key={x.id}><td><strong>{x.display_name}</strong></td><td>{x.total || 0}</td><td>{x.fresh || 0}</td><td>{x.active || 0}</td><td>{x.quoted || 0}</td><td>{x.won || 0}</td><td>{x.overdue || 0}</td></tr>)}</tbody></table></section>}
    {s.role === "LEADER" && <section className="panel"><div className="toolbar"><strong>CRM 公海自动同步</strong><span className="subtle">每日任务需在发布服务器配置；每次最多处理 50 条</span></div><p>当前公海：{(poolSync?.pending || 0)+(poolSync?.synced || 0)} 条 · 待同步：{poolSync?.pending || 0} 条 · 已入 CRM 公海：{poolSync?.synced || 0} 条 · 上次失败待重试：{poolSync?.failed || 0} 条</p><p className="subtle">仅处理当前归属公海的询盘；失败保留在待同步中，下一次自动重试。</p></section>}
    {s.role === "LEADER" && <section className="panel"><div className="toolbar"><strong>本周经营分析</strong><span className="subtle">统计周期：本周一至现在</span></div><div className="cards"><div className="card"><span className="subtle">新增询盘</span><div className="value">{weeklyOverall.new_count}</div></div><div className="card"><span className="subtle">本周分配</span><div className="value">{weeklyOverall.assigned_count}</div></div><div className="card"><span className="subtle">跟进记录</span><div className="value">{weeklyOverall.follow_count}</div></div><div className="card"><span className="subtle">报价 / 成交</span><div className="value">{weeklyOverall.quoted_count} / {weeklyOverall.won_count}</div></div></div><div className="grid2">
      <div><h3>按业务员</h3><table className="table"><thead><tr><th>业务员</th><th>分配</th><th>跟进</th><th>报价</th><th>成交</th></tr></thead><tbody>{weeklySales.map(x=><tr key={x.label}><td>{x.label}</td><td>{x.inquiries||0}</td><td>{x.followups||0}</td><td>{x.quoted||0}</td><td>{x.won||0}</td></tr>)}</tbody></table></div>
      <div><h3>按询盘来源</h3><table className="table"><thead><tr><th>来源</th><th>新增</th><th>跟进</th><th>当前报价</th><th>当前成交</th></tr></thead><tbody>{weeklySources.map(x=><tr key={x.label}><td>{sources[x.label]||x.label}</td><td>{x.inquiries||0}</td><td>{x.followups||0}</td><td>{x.quoted||0}</td><td>{x.won||0}</td></tr>)}</tbody></table></div>
      <div><h3>按产品分类</h3><table className="table"><thead><tr><th>产品</th><th>新增</th><th>跟进</th><th>当前报价</th><th>当前成交</th></tr></thead><tbody>{weeklyProducts.map(x=><tr key={x.label}><td>{x.label}</td><td>{x.inquiries||0}</td><td>{x.followups||0}</td><td>{x.quoted||0}</td><td>{x.won||0}</td></tr>)}</tbody></table></div>
      <div><h3>最近8周趋势</h3><table className="table"><thead><tr><th>周开始日期</th><th>询盘</th><th>跟进</th><th>成交</th></tr></thead><tbody>{weeklyTrend.map(x=><tr key={x.label}><td>{x.label}</td><td>{x.inquiries||0}</td><td>{x.followups||0}</td><td>{x.won||0}</td></tr>)}</tbody></table></div>
    </div>{weeklyOverall.won_amount>0&&<p className="subtle">本周成交询盘金额合计：USD {weeklyOverall.won_amount}</p>}</section>}
    {s.role === "LEADER" && <section className="panel"><div className="toolbar"><strong>领导提醒</strong><span className="subtle">分配后48小时未接受会由定时任务退回待分配，并记录日志</span></div><div className="grid2">
      <div><h3>分配后48小时未接受（{firstFollowOverdue.length}）</h3>{firstFollowOverdue.length === 0 ? <p className="subtle">目前没有超时询盘。</p> : <table className="table"><tbody>{firstFollowOverdue.map(x => <tr key={x.id}><td><Link href={`/inquiries/${x.id}`}>{x.inquiry_no}</Link></td><td>{x.company || x.primary_email}</td><td>{x.owner_name}</td><td>{x.assigned_at?.slice(0,16)}</td></tr>)}</tbody></table>}</div>
      <div><h3>超过3个月未继续跟进（{dormant.length}）</h3>{dormant.length === 0 ? <p className="subtle">目前没有长期沉默询盘。</p> : <table className="table"><tbody>{dormant.map(x => <tr key={x.id}><td><Link href={`/inquiries/${x.id}`}>{x.inquiry_no}</Link></td><td>{x.company || x.primary_email}</td><td>{x.owner_name}</td><td>{x.last_follow_up_at?.slice(0,16)}</td></tr>)}</tbody></table>}</div>
    </div><div style={{marginTop:18}}><h3>最近自动退回待分配</h3>{autoReturns.length===0?<p className="subtle">暂无自动退回记录。</p>:<table className="table"><thead><tr><th>时间</th><th>询盘</th><th>原因</th></tr></thead><tbody>{autoReturns.map(x=><tr key={x.id}><td>{x.created_at}</td><td><Link href={`/inquiries/${x.entity_id}`}>查看询盘</Link></td><td>{x.summary}</td></tr>)}</tbody></table>}</div></section>}
    {s.role === "SALES" && <section className="panel"><div className="toolbar"><strong>我的业务提醒</strong><span className="subtle">先接受询盘，再按进度自动提醒</span></div><div className="grid2">
      <div><h3>待接受询盘（{pendingAcceptance.length}）</h3>{pendingAcceptance.length===0?<p className="subtle">没有待接受询盘。</p>:<table className="table"><thead><tr><th>询盘</th><th>客户</th><th>接受期限</th></tr></thead><tbody>{pendingAcceptance.map(x=><tr key={x.id}><td><Link href={`/inquiries/${x.id}`}><strong>{x.inquiry_no}</strong></Link></td><td>{x.company||x.primary_email}</td><td>{x.acceptance_deadline?.slice(0,16)} {Boolean(x.is_overdue)&&<span className="badge">已超时</span>}</td></tr>)}</tbody></table>}</div>
      <div><h3>进度提醒（{progressReminders.length}）</h3>{progressReminders.length===0?<p className="subtle">没有待提醒询盘。</p>:<table className="table"><thead><tr><th>询盘</th><th>进度</th><th>提醒时间</th></tr></thead><tbody>{progressReminders.map(x=><tr key={x.id}><td><Link href={`/inquiries/${x.id}`}><strong>{x.inquiry_no}</strong></Link></td><td>{statuses[x.status]}</td><td>{x.next_follow_up_at?.slice(0,16)} {Boolean(x.is_overdue)&&<span className="badge">已到期</span>}</td></tr>)}</tbody></table>}</div>
    </div><div className="reminder-rules"><strong>提醒规则</strong><p>分配后48小时未接受：自动退回待分配并通知领导；接受询盘：自动设置3天后提醒。</p><p>需求确认3天 · 技术沟通3天 · 已报价3天 · 商务谈判4天 · 已成交不再提醒。</p></div></section>}
    <section className="panel"><div className="toolbar"><strong>最近更新</strong><Link className="subtle" href="/inquiries">查看全部 →</Link></div><table className="table"><thead><tr><th>编号</th><th>客户</th><th>产品</th><th>来源</th><th>负责人</th><th>状态</th></tr></thead><tbody>{recent.map(x => <tr key={x.id}><td><Link href={`/inquiries/${x.id}`}>{x.inquiry_no}</Link></td><td>{x.company || x.primary_email}</td><td>{x.product_category}</td><td>{sources[x.source]}</td><td>{x.owner_name || "—"}</td><td><span className="badge">{statuses[x.status]}</span></td></tr>)}</tbody></table></section>
  </>;
}
