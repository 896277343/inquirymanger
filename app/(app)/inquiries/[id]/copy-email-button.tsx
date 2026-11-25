"use client";

import { useState } from "react";

export function CopyEmailButton({ email }: { email: string }) {
  const [message, setMessage] = useState("");

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
      } else {
        const input = document.createElement("textarea");
        input.value = email;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("copy failed");
      }
      setMessage("已复制");
    } catch {
      setMessage("复制失败，请手动复制");
    }
  }

  return <>
    <button type="button" className="btn btn-small" onClick={copy}>复制邮箱</button>
    {message && <span className="subtle" role="status">{message}</span>}
  </>;
}
