"use server";

import { revalidatePath } from "next/cache";
import { requireLeader, requireSession } from "@/lib/auth";
import { audit, db, row } from "@/lib/db";
import { mailContext, renderMailText } from "@/lib/mail-template";
import { decryptSecret } from "@/lib/secrets";
import { createSmtpTransport, DEVELOPMENT_CC, validMailAddress } from "@/lib/smtp";

type InquiryMail = {
  id: number; inquiry_no: string; owner_id: number | null; status: string; accepted_at: string | null;
  primary_email: string; customer_name: string | null; company: string | null;
  product_category: string; requirement: string;
};
type Attempt = { status: string };

function refresh(id: number) {
  revalidatePath(`/inquiries/${id}`);
  revalidatePath("/inquiries");
  revalidatePath("/dashboard");
}

function safeFailure(error: unknown) {
  const code = (error as { code?: string }).code || "";
  return ["EAUTH", "EENVELOPE", "ETLS", "ECONFIG", "EDNS"].includes(code) ? "FAILED" : "UNKNOWN";
}

export async function sendFirstDevelopmentEmail(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "SALES") return { ok: false, message: "只有负责业务员可以发送开发信" };
  const id = Number(formData.get("id"));
  const templateId = Number(formData.get("templateId"));
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(templateId) || templateId <= 0) {
    return { ok: false, message: "请先选择开发信模板" };
  }
  let fromEmail = "";
  let toEmail = "";
  let password = "";
  let subject = "";
  let body = "";
  let templateName = "";
  let reserved = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    const inquiry = row<InquiryMail>(`SELECT i.id,i.inquiry_no,i.owner_id,i.status,i.accepted_at,
      c.primary_email,c.name customer_name,c.company,i.product_category,i.requirement
      FROM inquiries i JOIN customers c ON c.id=i.customer_id WHERE i.id=?`, id);
    if (!inquiry || inquiry.owner_id !== session.id || inquiry.status !== "NEW" || inquiry.accepted_at) {
      throw new Error("该询盘已接受或不归你负责");
    }
    toEmail = inquiry.primary_email.trim().toLowerCase();
    if (!validMailAddress(toEmail)) throw new Error("客户邮箱格式不正确，请由领导先修改询盘邮箱");
    const account = row<{ email: string; password_encrypted: string }>(
      "SELECT email,password_encrypted FROM smtp_accounts WHERE user_id=?", session.id);
    if (!account || !validMailAddress(account.email)) throw new Error("请先在“我的开发信设置”配置企业邮箱");
    fromEmail = account.email;
    password = decryptSecret(account.password_encrypted);
    const template = row<{ name: string; subject: string; body: string }>(
      "SELECT name,subject,body FROM email_templates WHERE id=? AND user_id=?", templateId, session.id);
    if (!template) throw new Error("模板不存在或不属于你");
    templateName = template.name;
    const context = mailContext({
      customerName: inquiry.customer_name, company: inquiry.company,
      product: inquiry.product_category, requirement: inquiry.requirement,
      senderName: session.name, email: toEmail, inquiryNo: inquiry.inquiry_no
    });
    subject = renderMailText(template.subject, context).replace(/[\r\n]+/g, " ").trim();
    body = renderMailText(template.body, context).trim();
    if (!subject || !body || subject.length > 500 || body.length > 30000) throw new Error("模板替换后的邮件内容无效");
    const previous = row<Attempt>("SELECT status FROM email_send_attempts WHERE inquiry_id=?", id);
    if (previous && previous.status !== "FAILED") {
      throw new Error("该询盘已有发送记录，请先核查状态，系统不会重复发送");
    }
    if (previous) {
      db.prepare(`UPDATE email_send_attempts SET user_id=?,template_id=?,from_email=?,to_email=?,cc_email=?,
        subject=?,body=?,status='SENDING',message_id=NULL,smtp_response=NULL,error_message=NULL,
        started_at=datetime('now','localtime'),completed_at=NULL WHERE inquiry_id=?`)
        .run(session.id, templateId, fromEmail, toEmail, DEVELOPMENT_CC, subject, body, id);
    } else {
      db.prepare(`INSERT INTO email_send_attempts
        (inquiry_id,user_id,template_id,from_email,to_email,cc_email,subject,body,status)
        VALUES(?,?,?,?,?,?,?,?,'SENDING')`)
        .run(id, session.id, templateId, fromEmail, toEmail, DEVELOPMENT_CC, subject, body);
    }
    audit(session.id, "EMAIL_SEND_START", "INQUIRY", id, `开始发送开发信：${toEmail}`,
      { templateId, templateName, cc: DEVELOPMENT_CC });
    db.exec("COMMIT");
    reserved = true;
  } catch (error) {
    if (!reserved) { try { db.exec("ROLLBACK"); } catch {} }
    return { ok: false, message: error instanceof Error ? error.message : "发送准备失败" };
  }

  const transport = createSmtpTransport(fromEmail, password);
  try {
    const info = await transport.sendMail({
      from: { name: session.name, address: fromEmail },
      to: toEmail,
      cc: DEVELOPMENT_CC,
      subject,
      text: body
    });
    const accepted = info.accepted.map(address => address.toLowerCase());
    const customerAccepted = accepted.includes(toEmail);
    const ccAccepted = accepted.includes(DEVELOPMENT_CC);
    const status = customerAccepted ? "ACCEPTED" : "PARTIAL";
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE email_send_attempts SET status=?,message_id=?,smtp_response=?,
        error_message=?,completed_at=datetime('now','localtime') WHERE inquiry_id=?`)
        .run(status, info.messageId, info.response.slice(0, 500),
          !customerAccepted || !ccAccepted ? "收件人或固定抄送有一方未被 SMTP 服务器接受，请核查" : null, id);
      audit(session.id, customerAccepted && ccAccepted ? "EMAIL_SENT" : "EMAIL_PARTIAL", "INQUIRY", id,
        customerAccepted && ccAccepted ? `开发信已提交邮箱服务器：${toEmail}，抄送 ${DEVELOPMENT_CC}` :
          `开发信部分接收：客户 ${customerAccepted ? "已接收" : "未接收"}，抄送 ${ccAccepted ? "已接收" : "未接收"}`,
        { messageId: info.messageId, templateId, accepted: info.accepted, rejected: info.rejected });
      if (customerAccepted) {
        const changed = db.prepare(`UPDATE inquiries SET accepted_at=datetime('now','localtime'),
          accept_method='邮件',status='CONTACTING',
          next_follow_up_at=datetime('now','localtime','+3 days'),
          reminder_overdue_at=datetime('now','localtime','+5 days'),
          updated_at=datetime('now','localtime')
          WHERE id=? AND owner_id=? AND status='NEW' AND accepted_at IS NULL`).run(id, session.id);
        if (changed.changes === 1) audit(session.id, "ACCEPT", "INQUIRY", id,
          "确认第一次开发邮件已发送，接受询盘（SMTP）",
          { before: { status: "NEW" }, after: { status: "CONTACTING" }, messageId: info.messageId });
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    refresh(id);
    return customerAccepted
      ? { ok: true, message: ccAccepted ? "邮件服务器已接收客户邮件和固定抄送，询盘已自动接受" :
          "客户邮件已被服务器接收，抄送未成功；询盘已接受，请通知领导核查抄送" }
      : { ok: false, message: "客户邮箱未被服务器接收，但抄送可能已发送；请核查后再处理" };
  } catch (error) {
    const status = safeFailure(error);
    const message = error instanceof Error ? error.message.slice(0, 300) : "SMTP 发送失败";
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(`UPDATE email_send_attempts SET status=?,error_message=?,
        completed_at=datetime('now','localtime') WHERE inquiry_id=? AND status='SENDING'`)
        .run(status, message, id);
      audit(session.id, status === "FAILED" ? "EMAIL_SEND_FAILED" : "EMAIL_SEND_UNKNOWN",
        "INQUIRY", id, status === "FAILED" ? "开发信发送失败，未被邮件服务器接受" :
          "开发信发送结果不确定，禁止自动重试", { code: (error as { code?: string }).code || null });
      db.exec("COMMIT");
    } catch {
      try { db.exec("ROLLBACK"); } catch {}
    }
    refresh(id);
    return { ok: false, message: status === "FAILED" ?
      `SMTP 发送失败：${message}。修正后可重试` :
      `发送结果不确定：${message}。请先核查企业邮箱“已发送”，勿重复发送` };
  } finally {
    transport.close();
  }
}

export async function resolveEmailSendAttempt(formData: FormData) {
  const leader = await requireLeader();
  const id = Number(formData.get("id"));
  const resolution = String(formData.get("resolution"));
  const note = String(formData.get("note") || "").trim();
  if (!Number.isSafeInteger(id) || id <= 0 || !["sent", "not_sent"].includes(resolution) || note.length < 5) {
    throw new Error("请选择核查结果，并填写至少 5 字说明");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const attempt = row<{ status: string; user_id: number; to_email: string; started_at: string }>(
      "SELECT status,user_id,to_email,started_at FROM email_send_attempts WHERE inquiry_id=?", id);
    if (!attempt || !["SENDING", "UNKNOWN", "PARTIAL"].includes(attempt.status)) {
      throw new Error("该记录不需要人工核查");
    }
    if (attempt.status === "SENDING" && row<{ recent: number }>(
      "SELECT datetime(?) > datetime('now','localtime','-2 minutes') recent", attempt.started_at)?.recent) {
      throw new Error("邮件发送可能仍在进行，请稍后再核查");
    }
    const status = resolution === "sent" ? "ACCEPTED" : "FAILED";
    db.prepare(`UPDATE email_send_attempts SET status=?,error_message=?,
      completed_at=datetime('now','localtime') WHERE inquiry_id=?`).run(status, `领导核查：${note}`, id);
    if (resolution === "sent") {
      const changed = db.prepare(`UPDATE inquiries SET accepted_at=datetime('now','localtime'),
        accept_method='邮件',status='CONTACTING',
        next_follow_up_at=datetime('now','localtime','+3 days'),
        reminder_overdue_at=datetime('now','localtime','+5 days'),
        updated_at=datetime('now','localtime')
        WHERE id=? AND owner_id=? AND status='NEW' AND accepted_at IS NULL`).run(id, attempt.user_id);
      if (changed.changes === 1) audit(leader.id, "ACCEPT", "INQUIRY", id,
        "领导核实第一次开发邮件已发送，接受询盘",
        { before: { status: "NEW" }, after: { status: "CONTACTING" } });
    }
    audit(leader.id, "EMAIL_SEND_REVIEW", "INQUIRY", id,
      `领导核查开发信：${resolution === "sent" ? "客户邮件已发送" : "确认未发送，可重新尝试"}`,
      { previousStatus: attempt.status, toEmail: attempt.to_email, note });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  refresh(id);
}
