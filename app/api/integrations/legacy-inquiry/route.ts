import crypto from "node:crypto";
import { db, row } from "@/lib/db";

export const runtime = "nodejs";

type Payload = {
  externalId?: unknown; type?: unknown; site?: unknown; pageUrl?: unknown;
  name?: unknown; email?: unknown; company?: unknown; country?: unknown;
  phone?: unknown; product?: unknown; message?: unknown; submittedAt?: unknown;
};

const field = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const response = (body: object, status: number) => Response.json(body, { status });

export async function POST(request: Request) {
  const secret = process.env.LEGACY_INQUIRY_SYNC_SECRET;
  if (!secret || secret.length < 32) return response({ error: "接收接口尚未配置" }, 503);

  const timestamp = request.headers.get("x-inquiry-timestamp") || "";
  const signature = request.headers.get("x-inquiry-signature") || "";
  const seconds = Number(timestamp);
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - seconds) > 300 || !/^[a-f0-9]{64}$/i.test(signature)) {
    return response({ error: "签名无效或请求已过期" }, 401);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65536) return response({ error: "请求内容过大" }, 413);
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"))) return response({ error: "签名不匹配" }, 401);

  let input: Payload;
  try { input = JSON.parse(raw) as Payload; }
  catch { return response({ error: "JSON格式不正确" }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return response({ error: "请求格式不正确" }, 400);
  if (input.type !== "inquiry") return response({ error: "只接收正常留言" }, 422);

  const externalId = field(input.externalId, 80);
  const message = field(input.message, 10000);
  if (!/^\d+$/.test(externalId) || !message) return response({ error: "旧留言编号或内容缺失" }, 422);
  const existing = row<{ id: number }>("SELECT id FROM inbound_submissions WHERE source_system='LEGACY_INQUIRY' AND external_id=?", externalId);
  if (existing) return response({ ok: true, id: existing.id, duplicate: true }, 200);

  try {
    const result = db.prepare(`INSERT INTO inbound_submissions
      (source_system,external_id,site,page_url,name,email,company,country,phone,product,message,submitted_at,raw_json)
      VALUES ('LEGACY_INQUIRY',?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      externalId, field(input.site, 255), field(input.pageUrl, 2000),
      field(input.name, 255), field(input.email, 320).toLowerCase(),
      field(input.company, 255), field(input.country, 255), field(input.phone, 255),
      field(input.product, 500), message, field(input.submittedAt, 32), raw
    );
    return response({ ok: true, id: Number(result.lastInsertRowid), duplicate: false }, 201);
  } catch (error) {
    // A retry can arrive at the same time as the first request.
    const duplicate = row<{ id: number }>("SELECT id FROM inbound_submissions WHERE source_system='LEGACY_INQUIRY' AND external_id=?", externalId);
    if (duplicate) return response({ ok: true, id: duplicate.id, duplicate: true }, 200);
    console.error("Legacy inquiry intake failed", error);
    return response({ error: "保存失败" }, 500);
  }
}
