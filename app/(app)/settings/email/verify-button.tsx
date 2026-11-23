"use client";

import { useState, useTransition } from "react";
import { verifySmtpAccount } from "./actions";

export function VerifySmtpButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  return <div className="actions" style={{alignItems:"center",marginTop:12}}>
    <button type="button" className="btn" disabled={pending} onClick={() => startTransition(async () => {
      const result = await verifySmtpAccount();
      setOk(result.ok);
      setMessage(result.message);
    })}>{pending ? "正在验证…" : "测试 SMTP 连接（不发信）"}</button>
    {message && <span className={ok ? "subtle" : "error"}>{message}</span>}
  </div>;
}
