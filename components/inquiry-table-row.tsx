"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

export function InquiryTableRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return <tr className="clickable-row" tabIndex={0} role="link" onClick={() => router.push(href)} onKeyDown={event => {
    if (event.key === "Enter" || event.key === " ") router.push(href);
  }}>{children}</tr>;
}
