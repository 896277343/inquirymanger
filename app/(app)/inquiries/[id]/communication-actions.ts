"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireLeader, requireSession } from "@/lib/auth";
import { audit, db, row } from "@/lib/db";

const methods = ["邮件", "WhatsApp", "邮件 + WhatsApp", "电话", "在线聊天", "视频会议", "其他"];
type OwnedInquiry = { id: number; inquiry_no: string; owner_id: number | null; status: string; accepted_at: string | null };

function refresh(id: number) {
  revalidatePath(`/inquiries/${id}`);
  revalidatePath("/inquiries");
  revalidatePath("/dashboard");
}

export async function acceptInquiry(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "SALES") throw new Error("请由负责业务员确认首次邮件");
  const id = Number(formData.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("询盘编号不正确");
  db.exec("BEGIN IMMEDIATE");
  try {
    const inquiry = row<OwnedInquiry>("SELECT id,inquiry_no,owner_id,status,accepted_at FROM inquiries WHERE id=?", id);
    if (!inquiry || inquiry.owner_id !== session.id || inquiry.status !== "NEW" || inquiry.accepted_at) {
      throw new Error("该询盘已接受或不归你负责");
    }
    const attempt = row<{ status: string }>("SELECT status FROM email_send_attempts WHERE inquiry_id=?", id);
    if (attempt && ["SENDING", "UNKNOWN", "PARTIAL"].includes(attempt.status)) throw new Error("该询盘有待核查的开发信发送记录，请先核查发信结果");
    db.prepare(`UPDATE inquiries SET accepted_at=datetime('now','localtime'),accept_method='邮件',
      status='CONTACTING',next_follow_up_at=datetime('now','localtime','+3 days'),
      reminder_overdue_at=datetime('now','localtime','+5 days'),
      updated_at=datetime('now','localtime') WHERE id=? AND owner_id=?`).run(id, session.id);
    audit(session.id, "ACCEPT", "INQUIRY", id, "确认第一次开发邮件已发送，接受询盘",
      { before: { status: "NEW" }, after: { status: "CONTACTING" }, reminderDays: 3, overdueDays: 5 });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  refresh(id);
}

export async function recordCommunication(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "SALES") throw new Error("请由负责业务员记录沟通");
  const id = Number(formData.get("id"));
  const method = String(formData.get("method") || "");
  const note = String(formData.get("note") || "").trim();
  if (!Number.isSafeInteger(id) || id <= 0 || !methods.includes(method)) throw new Error("沟通信息不正确");
  if (note.length > 2000) throw new Error("沟通说明最多 2000 字");
  db.exec("BEGIN IMMEDIATE");
  try {
    const inquiry = row<OwnedInquiry>("SELECT id,inquiry_no,owner_id,status,accepted_at FROM inquiries WHERE id=?", id);
    if (!inquiry || inquiry.owner_id !== session.id || !inquiry.accepted_at) throw new Error("请先接受自己负责的询盘");
    const transition: Record<string, { status: string; label: string; days: number }> = {
      CONTACTING: { status: "SECOND_CONTACT", label: "第二次沟通", days: 3 },
      SECOND_CONTACT: { status: "THIRD_CONTACT", label: "第三次沟通", days: 5 },
      THIRD_CONTACT: { status: "ONGOING", label: "持续沟通", days: 5 },
      ONGOING: { status: "ONGOING", label: "持续沟通", days: 5 }
    };
    const next = transition[inquiry.status];
    if (!next) throw new Error("当前阶段不能记录下一次沟通");
    db.prepare(`UPDATE inquiries SET status=?,next_follow_up_at=datetime('now','localtime',?),
      reminder_overdue_at=datetime('now','localtime','+5 days'),updated_at=datetime('now','localtime')
      WHERE id=? AND owner_id=?`).run(next.status, `+${next.days} days`, id, session.id);
    const content = `${next.label}：${note || `已通过${method}联系客户`}`;
    const follow = db.prepare(`INSERT INTO follow_ups(inquiry_id,user_id,method,content,next_follow_up_at)
      VALUES(?,?,?,?,datetime('now','localtime',?))`).run(id, session.id, method, content, `+${next.days} days`);
    audit(session.id, "FOLLOW_UP", "INQUIRY", id, `${next.label}：${method}`,
      { followUpId: Number(follow.lastInsertRowid), before: { status: inquiry.status },
        after: { status: next.status }, reminderDays: next.days, overdueDays: 5 });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  refresh(id);
}

export async function moveNoReplyToPool(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "SALES") throw new Error("请由负责业务员确认无回复");
  if (formData.get("confirmed") !== "yes") throw new Error("请先确认客户仍未回复");
  const id = Number(formData.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("询盘编号不正确");
  db.exec("BEGIN IMMEDIATE");
  try {
    const inquiry = row<OwnedInquiry>("SELECT id,inquiry_no,owner_id,status,accepted_at FROM inquiries WHERE id=?", id);
    if (!inquiry || inquiry.owner_id !== session.id || !inquiry.accepted_at ||
        !["THIRD_CONTACT", "ONGOING"].includes(inquiry.status)) {
      throw new Error("完成第三次沟通后才能标记无回复并转入公海");
    }
    db.prepare(`UPDATE inquiries SET status='NO_REPLY',owner_id=NULL,next_follow_up_at=NULL,
      reminder_overdue_at=NULL,updated_at=datetime('now','localtime')
      WHERE id=? AND owner_id=?`).run(id, session.id);
    audit(session.id, "UPDATE", "INQUIRY", id, "三次沟通无回复，转入公海",
      { before: { status: inquiry.status, owner_id: session.id },
        after: { status: "NO_REPLY", owner_id: null } });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  refresh(id);
  redirect("/inquiries");
}

export async function markInquiryWon(formData: FormData) {
  const session = await requireSession();
  const id = Number(formData.get("id"));
  const rawAmount = String(formData.get("amount") || "").trim();
  const amount = rawAmount ? Number(rawAmount) : null;
  if (!Number.isSafeInteger(id) || id <= 0 || (amount !== null && (!Number.isFinite(amount) || amount < 0))) {
    throw new Error("成交金额不正确");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const inquiry = row<OwnedInquiry>("SELECT id,inquiry_no,owner_id,status,accepted_at FROM inquiries WHERE id=?", id);
    if (!inquiry || !inquiry.owner_id || !inquiry.accepted_at ||
        (session.role === "SALES" && inquiry.owner_id !== session.id) ||
        ["NO_REPLY", "PUBLIC_POOL", "WON", "LOST"].includes(inquiry.status)) {
      throw new Error("当前询盘不能标记已成交");
    }
    db.prepare(`UPDATE inquiries SET status='WON',deal_amount=?,next_follow_up_at=NULL,
      reminder_overdue_at=NULL,updated_at=datetime('now','localtime') WHERE id=?`).run(amount, id);
    audit(session.id, "UPDATE", "INQUIRY", id, "标记已成交",
      { before: { status: inquiry.status }, after: { status: "WON", deal_amount: amount } });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  refresh(id);
}

export async function reopenWonInquiry(formData: FormData) {
  const leader = await requireLeader();
  const id = Number(formData.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("询盘编号不正确");
  db.exec("BEGIN IMMEDIATE");
  try {
    const inquiry = row<OwnedInquiry>("SELECT id,inquiry_no,owner_id,status,accepted_at FROM inquiries WHERE id=?", id);
    if (!inquiry || inquiry.status !== "WON" || !inquiry.owner_id) throw new Error("只有已成交且有负责人的询盘可恢复");
    const status = inquiry.accepted_at ? "ONGOING" : "NEW";
    db.prepare(`UPDATE inquiries SET status=?,deal_amount=NULL,
      next_follow_up_at=CASE WHEN ?='ONGOING' THEN datetime('now','localtime','+5 days') ELSE NULL END,
      reminder_overdue_at=CASE WHEN ?='ONGOING' THEN datetime('now','localtime','+5 days') ELSE NULL END,
      updated_at=datetime('now','localtime') WHERE id=?`).run(status, status, status, id);
    audit(leader.id, "UPDATE", "INQUIRY", id, "撤销已成交，恢复跟进",
      { before: { status: "WON" }, after: { status } });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  refresh(id);
}
