import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { row, rows } from "@/lib/db";
import { mailVariables } from "@/lib/mail-template";
import { DEVELOPMENT_CC, SMTP_HOST, SMTP_PORT } from "@/lib/smtp";
import { deleteEmailTemplate, saveEmailTemplate, saveSmtpAccount } from "./actions";
import { VerifySmtpButton } from "./verify-button";

type Template = { id: number; name: string; subject: string; body: string };

export default async function EmailSettings() {
  const session = await requireSession();
  if (session.role !== "SALES") redirect("/dashboard");
  const account = row<{ email: string }>("SELECT email FROM smtp_accounts WHERE user_id=?", session.id);
  const templates = rows<Template>("SELECT id,name,subject,body FROM email_templates WHERE user_id=? ORDER BY id", session.id);

  return <>
    <div className="topline"><div><div className="title">我的开发信设置</div>
      <p className="subtle">每位业务员只配置自己的企业邮箱和开发信模板。</p></div></div>
    <section className="panel"><strong>腾讯企业邮箱 SMTP</strong>
      <p className="subtle">服务器固定为 {SMTP_HOST}:{SMTP_PORT}（SSL）；每封信固定抄送 {DEVELOPMENT_CC}。请填写客户端专用密码，网页扫码登录不等于已开启 SMTP。</p>
      <form action={saveSmtpAccount} className="grid2">
        <label className="field">企业邮箱完整地址<input name="email" type="email" required defaultValue={account?.email || ""} autoComplete="email"/></label>
        <label className="field">客户端专用密码<input name="password" type="password" placeholder={account ? "已保存，留空表示不修改" : "填写客户端专用密码"} autoComplete="new-password"/></label>
        <div><button className="btn btn-primary">保存发信账号</button></div>
      </form>
      <VerifySmtpButton/>
      <p className="subtle">密码加密存储，不在页面、操作日志或发信记录中显示。测试连接仅检查网络与身份验证，不会向客户发送邮件。</p>
    </section>
    <section className="panel"><strong>开发信模板（最多 10 套）</strong>
      <p className="subtle">可用变量：{mailVariables.map(name=>`{${name}}`).join("、")}。模板按纯文本发送，发送前会展示替换后的主题和正文。</p>
      <form action={saveEmailTemplate}>
        <div className="grid2">
          <label className="field">模板名称<input name="name" required maxLength={80} placeholder="例如：SF6分析仪初次开发"/></label>
          <label className="field">邮件主题<input name="subject" required maxLength={200} placeholder="Regarding your inquiry about {产品分类}"/></label>
        </div>
        <label className="field">邮件正文<textarea name="body" required maxLength={10000} style={{minHeight:200}} placeholder={"Dear {客户姓名},\n\nThank you for your inquiry about {产品分类}.\n\nBest regards,\n{业务员姓名}"}/></label>
        <button className="btn btn-primary">新增模板</button>
      </form>
    </section>
    {templates.map(template=><section className="panel" key={template.id}>
      <details><summary style={{cursor:"pointer",fontWeight:700}}>{template.name}</summary>
        <form action={saveEmailTemplate}>
          <input type="hidden" name="id" value={template.id}/>
          <div className="grid2">
            <label className="field">模板名称<input name="name" required maxLength={80} defaultValue={template.name}/></label>
            <label className="field">邮件主题<input name="subject" required maxLength={200} defaultValue={template.subject}/></label>
          </div>
          <label className="field">邮件正文<textarea name="body" required maxLength={10000} style={{minHeight:200}} defaultValue={template.body}/></label>
          <button className="btn btn-primary">保存修改</button>
        </form>
        <form action={deleteEmailTemplate} style={{marginTop:12}}>
          <input type="hidden" name="id" value={template.id}/>
          <button className="btn btn-danger">删除模板</button>
        </form>
      </details>
    </section>)}
  </>;
}
