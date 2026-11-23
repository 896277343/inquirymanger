"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { audit, db, row } from "@/lib/db";
import { unknownMailVariables } from "@/lib/mail-template";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { createSmtpTransport, validMailAddress } from "@/lib/smtp";

async function requireSalesUser() {
  const session = await requireSession();
  if (session.role !== "SALES") throw new Error("只有业务员可配置自己的发信邮箱");
  return session;
}

export async function saveSmtpAccount(formData: FormData) {
  const session = await requireSalesUser();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!validMailAddress(email)) throw new Error("请填写完整的企业邮箱地址");
  if (password.length > 512) throw new Error("客户端专用密码过长");
  const previous = row<{ email: string; password_encrypted: string }>(
    "SELECT email,password_encrypted FROM smtp_accounts WHERE user_id=?", session.id);
  if (!password && (!previous || previous.email !== email)) {
    throw new Error("首次配置或修改邮箱地址时，请填写该邮箱的客户端专用密码");
  }
  db.prepare(`INSERT INTO smtp_accounts(user_id,email,password_encrypted,updated_at)
    VALUES(?,?,?,datetime('now','localtime'))
    ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,
      password_encrypted=excluded.password_encrypted,updated_at=excluded.updated_at`)
    .run(session.id, email, password ? encryptSecret(password) : previous!.password_encrypted);
  audit(session.id, "UPDATE", "USER", session.id, "更新自己的 SMTP 发信账号",
    { email, passwordChanged: Boolean(password) });
  revalidatePath("/settings/email");
}

export async function verifySmtpAccount() {
  const session = await requireSalesUser();
  const account = row<{ email: string; password_encrypted: string }>(
    "SELECT email,password_encrypted FROM smtp_accounts WHERE user_id=?", session.id);
  if (!account) return { ok: false, message: "请先保存企业邮箱和客户端专用密码" };
  let password: string;
  try { password = decryptSecret(account.password_encrypted); }
  catch { return { ok: false, message: "密码无法解密，请重新保存客户端专用密码" }; }
  const transport = createSmtpTransport(account.email, password);
  try {
    await transport.verify();
    audit(session.id, "SMTP_VERIFY", "USER", session.id, "SMTP 连接与身份验证成功");
    return { ok: true, message: "连接与身份验证成功；此测试没有发送邮件" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "连接失败";
    audit(session.id, "SMTP_VERIFY_FAILED", "USER", session.id, "SMTP 连接或身份验证失败",
      { code: (error as { code?: string }).code || null });
    return { ok: false, message: `连接失败：${message}` };
  } finally {
    transport.close();
  }
}

export async function saveEmailTemplate(formData: FormData) {
  const session = await requireSalesUser();
  const id = Number(formData.get("id") || 0);
  const name = String(formData.get("name") || "").trim();
  const subject = String(formData.get("subject") || "").trim();
  const body = String(formData.get("body") || "").trim();
  if (!name || name.length > 80) throw new Error("模板名称需为 1–80 字");
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject)) throw new Error("邮件主题需为单行且不超过 200 字");
  if (!body || body.length > 10000) throw new Error("邮件正文需为 1–10000 字");
  const unknown = unknownMailVariables(subject + "\n" + body);
  if (unknown.length) throw new Error(`未知模板变量：${unknown.join("、")}`);
  if (id) {
    const result = db.prepare(`UPDATE email_templates SET name=?,subject=?,body=?,
      updated_at=datetime('now','localtime') WHERE id=? AND user_id=?`)
      .run(name, subject, body, id, session.id);
    if (result.changes !== 1) throw new Error("只能修改自己的模板");
    audit(session.id, "UPDATE", "EMAIL_TEMPLATE", id, `更新开发信模板：${name}`);
  } else {
    const count = row<{ count: number }>("SELECT COUNT(*) count FROM email_templates WHERE user_id=?", session.id)?.count || 0;
    if (count >= 10) throw new Error("每个业务员最多保存 10 套模板");
    const result = db.prepare("INSERT INTO email_templates(user_id,name,subject,body) VALUES(?,?,?,?)")
      .run(session.id, name, subject, body);
    audit(session.id, "CREATE", "EMAIL_TEMPLATE", Number(result.lastInsertRowid), `创建开发信模板：${name}`);
  }
  revalidatePath("/settings/email");
}

export async function deleteEmailTemplate(formData: FormData) {
  const session = await requireSalesUser();
  const id = Number(formData.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("模板编号不正确");
  const template = row<{ name: string }>("SELECT name FROM email_templates WHERE id=? AND user_id=?", id, session.id);
  if (!template) throw new Error("模板不存在");
  db.prepare("DELETE FROM email_templates WHERE id=? AND user_id=?").run(id, session.id);
  audit(session.id, "DELETE", "EMAIL_TEMPLATE", id, `删除开发信模板：${template.name}`);
  revalidatePath("/settings/email");
}
