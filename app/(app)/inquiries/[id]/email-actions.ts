"use server";

import { revalidatePath } from "next/cache";
import { requireLeader, requireSession } from "@/lib/auth";
import { audit, db, row } from "@/lib/db";
import { mailContext, plainTextToHtml, renderMailHtml, renderMailText } from "@/lib/mail-template";
import { cleanMailHtml } from "@/lib/mail-html";
import { emailStageName, nextEmailStage } from "@/lib/email-stage";
import { decryptSecret } from "@/lib/secrets";
import { createSmtpTransport, DEVELOPMENT_CC, validMailAddress } from "@/lib/smtp";

type InquiryMail = {
  id: number; inquiry_no: string; owner_id: number | null; status: string; accepted_at: string | null;
  primary_email: string; customer_name: string | null; company: string | null;
  product_category: string; requirement: string;
};
type Attempt = { status: string };

function completeEmailStage(id: number, userId: number, stage: number, messageId: string | null, subject: string, actorId: number) {
  const current = row<{ status: string }>("SELECT status FROM inquiries WHERE id=? AND owner_id=?", id, userId);
  const before = current?.status || "";
  if (stage === 1 ? !["ACCEPTED", "CONTACTING"].includes(before) :
    stage === 4 ? !["THIRD_CONTACT", "ONGOING"].includes(before) :
    before !== (stage === 2 ? "CONTACTING" : "SECOND_CONTACT")) {
    throw new Error("邮件已发送，但询盘阶段发生变化，请领导核查");
  }
  const after = stage === 1 ? "CONTACTING" : stage === 2 ? "SECOND_CONTACT" : stage === 3 ? "THIRD_CONTACT" : "ONGOING";
  const days = stage >= 3 ? 5 : 3;
  const changed = db.prepare(`UPDATE inquiries SET status=?,accept_method='邮件',
    next_follow_up_at=datetime('now','localtime',?),
    reminder_overdue_at=datetime('now','localtime','+5 days'),updated_at=datetime('now','localtime')
    WHERE id=? AND owner_id=? AND accepted_at IS NOT NULL AND status=?`)
    .run(after, `+${days} days`, id, userId, before);
  if (changed.changes !== 1) throw new Error("邮件已发送，但询盘负责人或阶段发生变化，请领导核查");
  const follow = db.prepare(`INSERT INTO follow_ups(inquiry_id,user_id,method,content,next_follow_up_at,created_at)
    VALUES(?,?, '邮件', ?,datetime('now','localtime',?),datetime('now','localtime'))`)
    .run(id, userId, `${emailStageName[stage]}已通过企业邮箱发送；主题：${subject}`, `+${days} days`);
  audit(actorId, "FOLLOW_UP", "INQUIRY", id, `${emailStageName[stage]}：邮件自动记录`,
    { followUpId: Number(follow.lastInsertRowid), before: {status: before}, after: {status: after}, messageId, reminderDays: days });
}

function refresh(id: number) {
  revalidatePath(`/inquiries/${id}`);
  revalidatePath("/inquiries");
  revalidatePath("/dashboard");
}

function safeFailure(error: unknown) {
  const code = (error as { code?: string }).code || "";
  return ["EAUTH", "EENVELOPE", "ETLS", "ECONFIG", "EDNS"].includes(code) ? "FAILED" : "UNKNOWN";
}

export async function sendDevelopmentEmail(formData: FormData) {
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
  let bodyHtml = "";
  let ccRecipients: string[] = [];
  let templateName = "";
  let stage = 0;
  let repeatId = 0;
  let reserved = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    const inquiry = row<InquiryMail>(`SELECT i.id,i.inquiry_no,i.owner_id,i.status,i.accepted_at,
      c.primary_email,c.name customer_name,c.company,i.product_category,i.requirement
      FROM inquiries i JOIN customers c ON c.id=i.customer_id WHERE i.id=?`, id);
    if (!inquiry || inquiry.owner_id !== session.id) throw new Error("该询盘不归你负责");
    stage = nextEmailStage(id, inquiry.status, inquiry.accepted_at) || 0;
    if (!stage) throw new Error("请先接受询盘，或当前阶段不属于前三次邮件沟通");
    toEmail = inquiry.primary_email.trim().toLowerCase();
    if (!validMailAddress(toEmail)) throw new Error("客户邮箱格式不正确，请由领导先修改询盘邮箱");
    const account = row<{ email: string; password_encrypted: string }>(
      "SELECT email,password_encrypted FROM smtp_accounts WHERE user_id=?", session.id);
    if (!account || !validMailAddress(account.email)) throw new Error("请先在“我的开发信设置”配置企业邮箱");
    fromEmail = account.email;
    ccRecipients = [...new Set([DEVELOPMENT_CC, fromEmail].map(address => address.toLowerCase()))];
    password = decryptSecret(account.password_encrypted);
    const template = row<{ name: string; subject: string; body: string; body_html: string | null }>(
      stage === 4 ? "SELECT name,subject,body,body_html FROM email_templates WHERE id=? AND user_id=?" :
        "SELECT name,subject,body,body_html FROM email_templates WHERE id=? AND user_id=? AND stage=?",
      ...(stage === 4 ? [templateId, session.id] : [templateId, session.id, stage]));
    if (!template) throw new Error("模板不存在或不属于你");
    templateName = template.name;
    const context = mailContext({
      customerName: inquiry.customer_name, company: inquiry.company,
      product: inquiry.product_category, requirement: inquiry.requirement,
      senderName: session.name, email: toEmail, inquiryNo: inquiry.inquiry_no
    });
    subject = renderMailText(template.subject, context).replace(/[\r\n]+/g, " ").trim();
    body = renderMailText(template.body, context).trim();
    bodyHtml = cleanMailHtml(renderMailHtml(cleanMailHtml(template.body_html || plainTextToHtml(template.body)), context));
    if (!subject || !body || !bodyHtml || subject.length > 500 || body.length > 30000 || bodyHtml.length > 60000) throw new Error("模板替换后的邮件内容无效");
    const previous = stage === 4 ? row<Attempt>("SELECT status FROM email_repeat_events WHERE inquiry_id=? AND status IN ('SENDING','UNKNOWN','PARTIAL') LIMIT 1", id) :
      row<Attempt>("SELECT status FROM email_send_events WHERE inquiry_id=? AND stage=?", id, stage);
    if (previous && (stage === 4 || previous.status !== "FAILED")) {
      throw new Error("该询盘已有发送记录，请先核查状态，系统不会重复发送");
    }
    if (stage === 4) {
      if (row("SELECT 1 FROM email_repeat_events WHERE inquiry_id=? AND status='ACCEPTED' AND completed_at>datetime('now','localtime','-1 minute') LIMIT 1", id)) {
        throw new Error("该客户刚刚发送过沟通邮件，请稍后再发，避免重复");
      }
      repeatId = Number(db.prepare(`INSERT INTO email_repeat_events
        (inquiry_id,user_id,template_id,from_email,to_email,cc_email,subject,body,body_html,status)
        VALUES(?,?,?,?,?,?,?,?,?,'SENDING')`)
        .run(id,session.id,templateId,fromEmail,toEmail,ccRecipients.join(", "),subject,body,bodyHtml).lastInsertRowid);
    } else if (previous) {
      db.prepare(`UPDATE email_send_events SET user_id=?,template_id=?,from_email=?,to_email=?,cc_email=?,
        subject=?,body=?,body_html=?,status='SENDING',message_id=NULL,smtp_response=NULL,error_message=NULL,
        started_at=datetime('now','localtime'),completed_at=NULL WHERE inquiry_id=? AND stage=?`)
        .run(session.id, templateId, fromEmail, toEmail, ccRecipients.join(", "), subject, body, bodyHtml, id, stage);
    } else {
      db.prepare(`INSERT INTO email_send_events
        (inquiry_id,stage,user_id,template_id,from_email,to_email,cc_email,subject,body,body_html,status)
        VALUES(?,?,?,?,?,?,?,?,?,?,'SENDING')`)
        .run(id, stage, session.id, templateId, fromEmail, toEmail, ccRecipients.join(", "), subject, body, bodyHtml);
    }
    audit(session.id, "EMAIL_SEND_START", "INQUIRY", id, `开始发送${emailStageName[stage]}：${toEmail}`,
      { stage, templateId, templateName, cc: ccRecipients });
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
      cc: ccRecipients,
      subject,
      text: body,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">${bodyHtml}</div>`
    });
    const accepted = info.accepted.map(address => address.toLowerCase());
    const customerAccepted = accepted.includes(toEmail);
    const missingCc = ccRecipients.filter(address => !accepted.includes(address));
    const ccAccepted = missingCc.length === 0;
    const status = customerAccepted ? "ACCEPTED" : "PARTIAL";
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE ${stage === 4 ? "email_repeat_events" : "email_send_events"} SET status=?,message_id=?,smtp_response=?,
        error_message=?,completed_at=datetime('now','localtime') WHERE ${stage === 4 ? "id=?" : "inquiry_id=? AND stage=?"}`)
        .run(status, info.messageId, info.response.slice(0, 500),
          !customerAccepted ? "客户邮箱未被 SMTP 服务器接受，请核查" :
            missingCc.length ? `抄送未被 SMTP 服务器接受：${missingCc.join("、")}` : null,
          ...(stage === 4 ? [repeatId] : [id, stage]));
      audit(session.id, customerAccepted && ccAccepted ? "EMAIL_SENT" : "EMAIL_PARTIAL", "INQUIRY", id,
        customerAccepted && ccAccepted ? `${emailStageName[stage]}已提交邮箱服务器：${toEmail}，抄送 ${ccRecipients.join("、")}` :
          `${emailStageName[stage]}部分接收：客户 ${customerAccepted ? "已接收" : "未接收"}，抄送 ${ccAccepted ? "已接收" : "未接收"}`,
        { stage, repeatId: stage === 4 ? repeatId : null, messageId: info.messageId, templateId, accepted: info.accepted, rejected: info.rejected });
      if (customerAccepted) {
        completeEmailStage(id, session.id, stage, info.messageId, subject, session.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    refresh(id);
    return customerAccepted
      ? { ok: true, message: ccAccepted ? `${emailStageName[stage]}已发送并自动记录沟通，已抄送公司和自己` :
          `${emailStageName[stage]}已发送并记录沟通，但以下抄送未成功：${missingCc.join("、")}` }
      : { ok: false, message: "客户邮箱未被服务器接收，但抄送可能已发送；请核查后再处理" };
  } catch (error) {
    const status = safeFailure(error);
    const message = error instanceof Error ? error.message.slice(0, 300) : "SMTP 发送失败";
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(`UPDATE ${stage === 4 ? "email_repeat_events" : "email_send_events"} SET status=?,error_message=?,
        completed_at=datetime('now','localtime') WHERE ${stage === 4 ? "id=?" : "inquiry_id=? AND stage=?"} AND status='SENDING'`)
        .run(status, message, ...(stage === 4 ? [repeatId] : [id, stage]));
      audit(session.id, status === "FAILED" ? "EMAIL_SEND_FAILED" : "EMAIL_SEND_UNKNOWN",
        "INQUIRY", id, status === "FAILED" ? "开发信发送失败，未被邮件服务器接受" :
          "开发信发送结果不确定，禁止自动重试", { stage, repeatId: stage === 4 ? repeatId : null, code: (error as { code?: string }).code || null });
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
  const stage = Number(formData.get("stage"));
  const repeatId = Number(formData.get("repeatId"));
  const resolution = String(formData.get("resolution"));
  const note = String(formData.get("note") || "").trim();
  if (!Number.isSafeInteger(id) || id <= 0 || ![1,2,3,4].includes(stage) ||
      (stage === 4 && (!Number.isSafeInteger(repeatId) || repeatId <= 0)) ||
      !["sent", "not_sent"].includes(resolution) || note.length < 5) {
    throw new Error("请选择核查结果，并填写至少 5 字说明");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const attempt = row<{ status: string; user_id: number; to_email: string; started_at: string; message_id: string | null; subject: string }>(
      stage === 4 ? "SELECT status,user_id,to_email,started_at,message_id,subject FROM email_repeat_events WHERE inquiry_id=? AND id=?" :
        "SELECT status,user_id,to_email,started_at,message_id,subject FROM email_send_events WHERE inquiry_id=? AND stage=?",
      id, stage === 4 ? repeatId : stage);
    if (!attempt || !["SENDING", "UNKNOWN", "PARTIAL"].includes(attempt.status)) {
      throw new Error("该记录不需要人工核查");
    }
    if (attempt.status === "SENDING" && row<{ recent: number }>(
      "SELECT datetime(?) > datetime('now','localtime','-2 minutes') recent", attempt.started_at)?.recent) {
      throw new Error("邮件发送可能仍在进行，请稍后再核查");
    }
    const status = resolution === "sent" ? "ACCEPTED" : "FAILED";
    db.prepare(`UPDATE ${stage === 4 ? "email_repeat_events" : "email_send_events"} SET status=?,error_message=?,
      completed_at=datetime('now','localtime') WHERE inquiry_id=? AND ${stage === 4 ? "id=?" : "stage=?"}`)
      .run(status, `领导核查：${note}`, id, stage === 4 ? repeatId : stage);
    if (resolution === "sent") {
      completeEmailStage(id, attempt.user_id, stage, attempt.message_id, attempt.subject, leader.id);
    }
    audit(leader.id, "EMAIL_SEND_REVIEW", "INQUIRY", id,
      `领导核查开发信：${resolution === "sent" ? "客户邮件已发送" : "确认未发送，可重新尝试"}`,
      { stage, repeatId: stage === 4 ? repeatId : null, previousStatus: attempt.status, toEmail: attempt.to_email, note });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  refresh(id);
}
