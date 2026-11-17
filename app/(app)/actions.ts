"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/db";
export async function logout(){ const session=await getSession();if(session)audit(session.id,"LOGOUT","USER",session.id,"退出登录");(await cookies()).delete("sf6_session"); redirect("/login"); }
