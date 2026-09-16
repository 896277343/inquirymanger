"use server";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireLeader,requireSession } from "@/lib/auth";
import { audit,db,row } from "@/lib/db";

function validate(password:string,confirm:string){if(password.length<6)throw new Error("新密码至少需要6位");if(password!==confirm)throw new Error("两次输入的新密码不一致")}

export async function changeOwnPassword(formData:FormData){const s=await requireSession();const oldPassword=String(formData.get("oldPassword")||""),newPassword=String(formData.get("newPassword")||""),confirm=String(formData.get("confirmPassword")||"");validate(newPassword,confirm);const user=row<{password_hash:string}>("SELECT password_hash FROM users WHERE id=?",s.id);if(!user||!bcrypt.compareSync(oldPassword,user.password_hash))throw new Error("当前密码不正确");db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(newPassword,10),s.id);audit(s.id,"PASSWORD_CHANGE","USER",s.id,"修改自己的登录密码");revalidatePath("/settings/password")}

export async function resetUserPassword(formData:FormData){const s=await requireLeader();const userId=Number(formData.get("userId")),newPassword=String(formData.get("newPassword")||""),confirm=String(formData.get("confirmPassword")||"");validate(newPassword,confirm);const target=row<{display_name:string}>("SELECT display_name FROM users WHERE id=?",userId);if(!target)throw new Error("账号不存在");db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(bcrypt.hashSync(newPassword,10),userId);audit(s.id,"PASSWORD_RESET","USER",userId,`重置 ${target.display_name} 的登录密码`);revalidatePath("/settings/password")}
