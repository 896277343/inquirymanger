"use server";

import { revalidatePath } from "next/cache";
import { requireLeader } from "@/lib/auth";
import { audit, db, row } from "@/lib/db";
import { createInquiryNumber } from "@/lib/inquiry-number";
import { products, sources } from "@/lib/labels";

export async function importSubmission(formData: FormData) {
  const leader = await requireLeader();
  const id = Number(formData.get("id"));
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const product = String(formData.get("product") || "");
  const source = String(formData.get("source") || "");
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("留言编号不正确");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new Error("请填写有效客户邮箱");
  if (!products.includes(product) || !(source in sources)) throw new Error("请选择正确的产品分类和来源");

  db.exec("BEGIN IMMEDIATE");
  try {
    const inbound = row<{status:string;name:string;company:string;country:string;phone:string;message:string;site:string;page_url:string;external_id:string}>(
      "SELECT * FROM inbound_submissions WHERE id=?", id);
    if (!inbound || inbound.status !== "PENDING") throw new Error("该留言已处理，请刷新页面");
    let customer = row<{id:number}>("SELECT id FROM customers WHERE primary_email=? COLLATE NOCASE", email);
    if (!customer) {
      const created = db.prepare("INSERT INTO customers(primary_email,name,company,country,phone) VALUES(?,?,?,?,?)")
        .run(email, inbound.name || null, inbound.company || null, inbound.country || null, inbound.phone || null);
      customer = { id: Number(created.lastInsertRowid) };
      audit(leader.id, "CREATE", "CUSTOMER", customer.id, `网站留言创建客户 ${email}`);
    }
    let number = createInquiryNumber();
    while (row("SELECT 1 FROM inquiries WHERE inquiry_no=?", number)) number = createInquiryNumber();
    const requirement = [inbound.message, inbound.site ? `来源网站：${inbound.site}` : "", inbound.page_url ? `提交页面：${inbound.page_url}` : ""].filter(Boolean).join("\n\n");
    const inquiry = db.prepare("INSERT INTO inquiries(inquiry_no,customer_id,source,product_category,requirement,created_by) VALUES(?,?,?,?,?,?)")
      .run(number, customer.id, source, product, requirement, leader.id);
    const inquiryId = Number(inquiry.lastInsertRowid);
    db.prepare("UPDATE inbound_submissions SET status='IMPORTED',inquiry_id=? WHERE id=?").run(inquiryId, id);
    audit(leader.id, "CREATE", "INQUIRY", inquiryId, `网站留言转为询盘 ${number}`, { inboundId:id, externalId:inbound.external_id });
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  revalidatePath("/inbound");
  revalidatePath("/inquiries");
  revalidatePath("/dashboard");
}

export async function ignoreSubmission(formData: FormData) {
  const leader = await requireLeader();
  const id = Number(formData.get("id"));
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("留言编号不正确");
  const result = db.prepare("UPDATE inbound_submissions SET status='IGNORED' WHERE id=? AND status='PENDING'").run(id);
  if (result.changes) audit(leader.id, "UPDATE", "INBOUND_SUBMISSION", id, "忽略网站留言");
  revalidatePath("/inbound");
}
