import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { redirect } from "next/navigation";

const key = new TextEncoder().encode(process.env.AUTH_SECRET || "sf6-inquiry-local-secret-change-me");
export type Session = { id: number; username: string; name: string; role: "LEADER" | "SALES" };

export async function createSession(session: Session) {
  const token = await new SignJWT(session).setProtectedHeader({ alg: "HS256" }).setExpirationTime("12h").sign(key);
  (await cookies()).set("sf6_session", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 43200 });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get("sf6_session")?.value;
  if (!token) return null;
  try { return (await jwtVerify(token, key)).payload as unknown as Session; } catch { return null; }
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireLeader() {
  const session = await requireSession();
  if (session.role !== "LEADER") redirect("/dashboard");
  return session;
}
