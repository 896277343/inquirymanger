"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { analyzeInquiry, createInquiry } from "./actions";
import { checkExistingEmail } from "./email-check";
import { products, sources } from "@/lib/labels";

const empty = { email: "", name: "", company: "", country: "", phone: "", product: products[0], requirement: "", note: "" };
type Existing = Awaited<ReturnType<typeof checkExistingEmail>>;

export function InquiryForm() {
  const [raw, setRaw] = useState("");
  const [form, setForm] = useState(empty);
  const [message, setMessage] = useState("");
  const [existing, setExisting] = useState<Existing | null>(null);
  const [checking, setChecking] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (key: string, value: string) => setForm((valueBefore) => ({ ...valueBefore, [key]: value }));

  useEffect(() => {
    const email = form.email.trim();
    setExisting(null);
    if (!email.includes("@")) {
      setChecking(false);
      return;
    }
    setChecking(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await checkExistingEmail(email);
        if (!cancelled) setExisting(result);
      } catch {
        if (!cancelled) setExisting(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.email]);

  function analyze() {
    setMessage("");
    startTransition(async () => {
      const result = await analyzeInquiry(raw);
      if (result.ok) {
        setForm(result.data);
        setMessage("识别完成，请核对后保存。");
      } else setMessage(result.error);
    });
  }

  return <>
    <section className="panel">
      <div className="toolbar"><strong>第一步：粘贴询盘原文</strong><span className="subtle">邮件正文或在线聊天内容均可</span></div>
      <textarea style={{ width: "100%", minHeight: 180, padding: 12, border: "1px solid #ccd5e0", borderRadius: 8 }} value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="粘贴完整询盘内容，包括发件人邮箱、签名和客户需求……" />
      <p className="subtle">点击识别后，以上内容会发送到你在“AI接口配置”中设置的服务商。</p>
      <button type="button" className="btn btn-primary" onClick={analyze} disabled={pending}>{pending ? "AI正在识别…" : "AI识别并填写"}</button>
      {message && <p className={message.startsWith("识别完成") ? "subtle" : "error"}>{message}</p>}
    </section>
    <form action={createInquiry} className="panel">
      <div className="toolbar"><strong>第二步：核对并保存</strong><span className="subtle">AI不会直接创建询盘</span></div>
      <div className="grid2">
        <label className="field">客户邮箱 *<input name="email" type="email" required value={form.email} onChange={(event) => set("email", event.target.value)} /></label>
        <label className="field">联系人<input name="name" value={form.name} onChange={(event) => set("name", event.target.value)} /></label>
        <label className="field">公司名称<input name="company" value={form.company} onChange={(event) => set("company", event.target.value)} /></label>
        <label className="field">国家/地区<input name="country" value={form.country} onChange={(event) => set("country", event.target.value)} /></label>
        <label className="field">联系电话 / WhatsApp<input name="phone" value={form.phone} onChange={(event) => set("phone", event.target.value)} /></label>
        <label className="field">询盘来源<select name="source">{Object.entries(sources).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="field">产品分类<select name="product" value={form.product} onChange={(event) => set("product", event.target.value)}>{products.map((product) => <option key={product}>{product}</option>)}</select></label>
      </div>
      {checking && <p className="subtle">正在检查邮箱历史询盘…</p>}
      {!checking && existing && existing.count > 0 && <div className="panel" style={{ background: "#fff8e8", marginBottom: 16 }}>
        <strong>已有客户：此邮箱已有 {existing.count} 条询盘</strong>
        <p className="subtle">请核对是否为同一客户的新需求。保存后会新增一条询盘，并关联到这个客户。</p>
        <ul>{existing.inquiries.map((inquiry) => <li key={inquiry.id}>
          <Link href={`/inquiries/${inquiry.id}`} target="_blank" rel="noopener noreferrer">{inquiry.inquiry_no}</Link>
          {" · "}{inquiry.product_category}{" · "}{inquiry.created_at.slice(0, 16)}
        </li>)}</ul>
      </div>}
      <label className="field">客户明确需求 *<textarea name="requirement" required value={form.requirement} onChange={(event) => set("requirement", event.target.value)} /></label>
      <label className="field">客户备注<textarea name="note" value={form.note} onChange={(event) => set("note", event.target.value)} /></label>
      <button className="btn btn-primary">确认并保存询盘</button>
    </form>
  </>;
}
