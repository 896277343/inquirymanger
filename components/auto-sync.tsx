"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoSync() {
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [router]);

  return null;
}
