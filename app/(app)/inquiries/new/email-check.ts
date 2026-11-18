"use server";

import { requireLeader } from "@/lib/auth";
import { db, row } from "@/lib/db";

export async function checkExistingEmail(emailInput: string) {
  await requireLeader();
  const email = emailInput.trim().toLowerCase();
  if (!email.includes("@")) return { count: 0, inquiries: [] };
  const customer = row<{ id: number }>("SELECT id FROM customers WHERE primary_email=? COLLATE NOCASE", email);
  if (!customer) return { count: 0, inquiries: [] };
  const count = row<{ count: number }>("SELECT COUNT(*) count FROM inquiries WHERE customer_id=?", customer.id)?.count || 0;
  const inquiries = db.prepare("SELECT id,inquiry_no,product_category,created_at FROM inquiries WHERE customer_id=? ORDER BY id DESC LIMIT 5")
    .all(customer.id) as { id: number; inquiry_no: string; product_category: string; created_at: string }[];
  return { count, inquiries };
}
