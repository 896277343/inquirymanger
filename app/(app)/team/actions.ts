"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireLeader } from "@/lib/auth";
import { audit, db, row } from "@/lib/db";

export async function createSalesAccount(formData: FormData) {
  const leader = await requireLeader();
  const username = String(formData.get("username") || "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") || "").trim();
  const password = String(formData.get("password") || "");
  if (!/^[a-z][a-z0-9_-]{2,31}$/.test(username)) throw new Error("账号需为3-32位英文字母、数字、下划线或短横线");
  if (!displayName || displayName.length > 80) throw new Error("请填写显示名称（不超过80字）");
  if (password.length < 8) throw new Error("初始密码至少需要8位");
  if (row("SELECT 1 FROM users WHERE username=?", username)) throw new Error("账号已存在");
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare("INSERT INTO users(username,display_name,password_hash,role,level,assignable) VALUES(?,?,?,'SALES','SENIOR',?)")
      .run(username, displayName, bcrypt.hashSync(password, 10), username === "think1023" ? 0 : 1);
    audit(leader.id, "CREATE", "USER", Number(result.lastInsertRowid), `创建业务账号 ${username}（${displayName}）`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  revalidatePath("/team");
  revalidatePath("/settings/password");
}

export async function createAdminAccount(formData: FormData) {
  const leader = await requireLeader();
  const username = String(formData.get("username") || "").trim().toLowerCase();
  const displayName = String(formData.get("displayName") || "").trim();
  const password = String(formData.get("password") || "");
  if (!/^[a-z][a-z0-9_-]{2,31}$/.test(username)) throw new Error("账号需为3-32位英文字母、数字、下划线或短横线");
  if (!displayName || displayName.length > 80) throw new Error("请填写显示名称（不超过80字）");
  if (password.length < 8) throw new Error("初始密码至少需要8位");
  if (row("SELECT 1 FROM users WHERE username=?", username)) throw new Error("账号已存在");
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare("INSERT INTO users(username,display_name,password_hash,role,level,assignable) VALUES(?,?,?,'LEADER','SENIOR',0)")
      .run(username, displayName, bcrypt.hashSync(password, 10));
    audit(leader.id, "CREATE", "USER", Number(result.lastInsertRowid), `创建管理员账号 ${username}（${displayName}）`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  revalidatePath("/team");
  revalidatePath("/settings/password");
}

export async function setSalesAssignable(formData: FormData) {
  const leader = await requireLeader();
  const id = Number(formData.get("id"));
  const assignable = String(formData.get("assignable")) === "1" ? 1 : 0;
  const user = row<{ username: string; assignable: number }>("SELECT username,assignable FROM users WHERE id=? AND role='SALES' AND active=1", id);
  if (!user) throw new Error("业务账号不存在或已停用");
  if (user.assignable === assignable) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE users SET assignable=? WHERE id=?").run(assignable, id);
    audit(leader.id, "UPDATE", "USER", id, `${user.username} ${assignable ? "允许接收询盘" : "改为观察账号，禁止接收询盘"}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  revalidatePath("/team");
  revalidatePath("/inquiries");
  revalidatePath("/dashboard");
}
