import crypto from "node:crypto";
import { syncPublicPoolBatch } from "@/lib/public-pool-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let running = false;

export async function POST(request: Request) {
  const secret = process.env.CRM_POOL_SYNC_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "未配置定时任务密钥" }, { status: 503 });
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return Response.json({ error: "未授权" }, { status: 401 });
  }
  if (running) return Response.json({ error: "上一轮同步仍在运行" }, { status: 409 });
  running = true;
  try {
    return Response.json(await syncPublicPoolBatch());
  } catch (error) {
    console.error("Public pool CRM sync failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 500 });
  } finally {
    running = false;
  }
}
