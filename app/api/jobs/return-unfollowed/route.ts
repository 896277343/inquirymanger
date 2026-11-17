import crypto from "node:crypto";
import { audit, db, row, rows } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Candidate = { id:number; inquiry_no:string; owner_id:number; assigned_at:string; accepted_at:string|null };
const dueWhere = `i.owner_id IS NOT NULL AND i.assigned_at IS NOT NULL
  AND i.assigned_at <= datetime('now','localtime','-48 hours')
  AND i.status NOT IN ('WON','LOST')
  AND i.accepted_at IS NULL`;

export async function POST(request: Request) {
  const secret = process.env.CRM_POOL_SYNC_SECRET;
  if (!secret || secret.length < 32) return Response.json({error:"未配置任务密钥"},{status:503});
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const expected = Buffer.from(secret), actual = Buffer.from(provided);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return Response.json({error:"未授权"},{status:401});
  if (new URL(request.url).searchParams.get("dryRun") === "1") {
    const count = row<{n:number}>(`SELECT COUNT(*) n FROM inquiries i WHERE ${dueWhere}`)?.n || 0;
    return Response.json({dryRun:true,wouldReturn:count});
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const candidates = rows<Candidate>(`SELECT i.id,i.inquiry_no,i.owner_id,i.assigned_at,i.accepted_at FROM inquiries i
      WHERE ${dueWhere}
      ORDER BY i.assigned_at ASC LIMIT 100`);
    let returned = 0;
    for (const item of candidates) {
      const result = db.prepare(`UPDATE inquiries SET owner_id=NULL,status='UNASSIGNED',assigned_at=NULL,
        accepted_at=NULL,accept_method=NULL,next_follow_up_at=NULL,updated_at=datetime('now','localtime')
        WHERE id=? AND owner_id=? AND assigned_at=?`).run(item.id,item.owner_id,item.assigned_at);
      if (result.changes) {
        audit(item.owner_id,"AUTO_RETURN","INQUIRY",item.id,`分配后48小时未接受，自动退回待分配：${item.inquiry_no}`,
          {previousOwnerId:item.owner_id,assignedAt:item.assigned_at,acceptedAt:item.accepted_at});
        returned++;
      }
    }
    db.exec("COMMIT");
    return Response.json({checked:candidates.length,returned});
  } catch (error) {
    db.exec("ROLLBACK");
    console.error("Automatic inquiry return failed", error);
    return Response.json({error:"自动退回失败"},{status:500});
  }
}
