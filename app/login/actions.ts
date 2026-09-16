"use server";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
export async function login(_: string | undefined, formData: FormData) {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const user = db.prepare("SELECT id,username,display_name,password_hash,role,active FROM users WHERE username=?").get(username) as any;
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) return "账号或密码错误";
  await createSession({ id: user.id, username:user.username, name:user.display_name, role:user.role });
  redirect("/dashboard");
}
