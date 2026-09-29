"use client";

import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";

export function InquiryTableRow({ href, children, className = "", style }: { href: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  const router = useRouter();
  return <tr className={`clickable-row ${className}`} style={{cursor:"pointer",...style}} tabIndex={0} role="link" onClick={() => router.push(href)} onKeyDown={event => {
    if (event.key === "Enter" || event.key === " ") router.push(href);
  }}>{children}</tr>;
}
