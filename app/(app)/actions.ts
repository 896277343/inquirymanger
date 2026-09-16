"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
export async function logout(){ (await cookies()).delete("sf6_session"); redirect("/login"); }
