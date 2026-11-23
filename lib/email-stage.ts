import { row } from "./db";

export function firstEmailSent(inquiryId: number) {
  return Boolean(row<{ id: number }>(`SELECT id FROM email_send_events
    WHERE inquiry_id=? AND stage=1 AND status='ACCEPTED'`, inquiryId));
}

export function nextEmailStage(inquiryId: number, status: string, acceptedAt: string | null) {
  if (!acceptedAt) return null;
  if (status === "ACCEPTED") return 1;
  if (status === "CONTACTING") return firstEmailSent(inquiryId) ? 2 : 1;
  if (status === "SECOND_CONTACT") return 3;
  return null;
}

export const emailStageName: Record<number, string> = {
  1: "第一次开发信", 2: "第二次沟通邮件", 3: "第三次沟通邮件"
};
