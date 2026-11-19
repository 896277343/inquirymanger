"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { audit, db, row } from "@/lib/db";

export async function toggleInquiryFlag(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "SALES") throw new Error("只有业务员可以设置个人标记");
  const inquiryId = Number(formData.get("inquiryId"));
  const flag = String(formData.get("flag"));
  if (!Number.isSafeInteger(inquiryId) || inquiryId <= 0 || !["pinned", "important"].includes(flag)) {
    throw new Error("标记参数不正确");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const owned = row<{ inquiry_no: string }>("SELECT inquiry_no FROM inquiries WHERE id=? AND owner_id=?", inquiryId, session.id);
    if (!owned) throw new Error("只能标记自己当前负责的询盘");
    db.prepare("INSERT OR IGNORE INTO inquiry_user_flags(inquiry_id,user_id) VALUES(?,?)").run(inquiryId, session.id);
    db.prepare(`UPDATE inquiry_user_flags SET ${flag}=1-${flag},updated_at=datetime('now','localtime')
      WHERE inquiry_id=? AND user_id=?`).run(inquiryId, session.id);
    const value = row<{ value: number }>(`SELECT ${flag} value FROM inquiry_user_flags WHERE inquiry_id=? AND user_id=?`, inquiryId, session.id)?.value;
    audit(session.id, "UPDATE", "INQUIRY", inquiryId,
      `${value ? "设置" : "取消"}${flag === "pinned" ? "置顶" : "重点标记"}：${owned.inquiry_no}`,
      { flag, value });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  revalidatePath("/inquiries");
  revalidatePath(`/inquiries/${inquiryId}`);
}
