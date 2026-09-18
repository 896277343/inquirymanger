import { randomBytes } from "node:crypto";

export function createInquiryNumber(dateValue = new Date().toISOString()) {
  const date = dateValue.slice(0, 10).replaceAll("-", "");
  const random = randomBytes(5).toString("hex").toUpperCase();
  return `INQ-${date}-${random}`;
}
