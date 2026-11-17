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
  const idText = new URL(request.url).searchParams.get("inquiryId");
  const inquiryId = idText === null ? undefined : Number(idText);
  if (idText !== null && (!/^[1-9]\d*$/.test(idText) || !Number.isSafeInteger(inquiryId))) {
    return Response.json({ error: "询盘 ID 不正确" }, { status: 400 });
  }
  if (running) return Response.json({ error: "上一轮同步仍在运行" }, { status: 409 });
  running = true;
  try {
    const result = await syncPublicPoolBatch(inquiryId === undefined ? 50 : 1, inquiryId);
    if (inquiryId !== undefined && result.attempted === 0) {
      return Response.json({ error: "该询盘不在待同步公海中，或已经同步成功" }, { status: 404 });
    }
    return Response.json({ inquiryId: inquiryId ?? null, ...result });
  } catch (error) {
    console.error("Public pool CRM sync failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "同步失败" }, { status: 500 });
  } finally {
    running = false;
  }
}
