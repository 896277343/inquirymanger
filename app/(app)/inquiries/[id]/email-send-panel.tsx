"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MailContext, renderMailText } from "@/lib/mail-template";
import { sendFirstDevelopmentEmail } from "./email-actions";

const DEVELOPMENT_CC = "sales@sf6relations.com";

type Template = { id: number; name: string; subject: string; body: string };
type Attempt = { status: string; from_email: string; to_email: string; subject: string; started_at: string; completed_at: string | null; error_message: string | null };

export function EmailSendPanel({ id, fromEmail, toEmail, templates, context, attempt }:
  { id: number; fromEmail: string | null; toEmail: string; templates: Template[]; context: MailContext; attempt: Attempt | null }) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(templates[0]?.id || 0);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const template = templates.find(item => item.id === templateId);
  const locked = Boolean(attempt && attempt.status !== "FAILED");

  return <section className="panel">
    <div className="toolbar"><strong>一键发送第一封开发信</strong><Link href="/settings/email">我的开发信设置</Link></div>
    {attempt && <div className={attempt.status === "ACCEPTED" ? "subtle" : "error"}>
      发信记录：{({ SENDING: "发送处理中，请勿重复发送", UNKNOWN: "发送结果不确定，请先核查企业邮箱已发送记录并联系领导", PARTIAL: "部分地址被接收，请联系领导核查", ACCEPTED: "客户邮件已由邮箱服务器接收", FAILED: "发送失败，修正后可重试" } as Record<string, string>)[attempt.status] || attempt.status}
      {attempt.error_message && <p>{attempt.error_message}</p>}
      <p>{attempt.started_at?.slice(0, 16)} · {attempt.from_email} → {attempt.to_email}</p>
    </div>}
    {!locked && <>
      {!fromEmail && <p className="error">请先在“我的开发信设置”保存企业邮箱及客户端专用密码。</p>}
      {templates.length === 0 && <p className="error">请先创建至少一套开发信模板。</p>}
      {fromEmail && templates.length > 0 && <>
        <label className="field">选择模板<select value={templateId} onChange={event => { setTemplateId(Number(event.target.value)); setConfirmed(false); }}>
          {templates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <div className="field"><strong>发送前预览</strong>
          <p>发件人：{fromEmail}<br/>收件人：{toEmail}<br/>固定抄送：{DEVELOPMENT_CC}</p>
          <p>主题：{template && renderMailText(template.subject, context)}</p>
          <div style={{whiteSpace:"pre-wrap", border:"1px solid #dbe3eb", borderRadius:8, padding:16}}>{template && renderMailText(template.body, context)}</div>
        </div>
        <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> 我已检查收件人、抄送及正文，确认发送</label>
        <div style={{marginTop:12}}><button className="btn btn-primary" type="button" disabled={!confirmed || pending} onClick={() => startTransition(async () => {
          const data = new FormData(); data.set("id", String(id)); data.set("templateId", String(templateId));
          const result = await sendFirstDevelopmentEmail(data);
          setMessage(result.message); setConfirmed(false); router.refresh();
        })}>{pending ? "发送中…" : "发送开发信并接受询盘"}</button></div>
        {message && <p className="subtle">{message}</p>}
      </>}
    </>}
  </section>;
}
