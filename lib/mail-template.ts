export const mailVariables = ["客户姓名", "公司名称", "产品分类", "客户需求", "业务员姓名", "客户邮箱", "询盘编号"] as const;

export type MailContext = Record<(typeof mailVariables)[number], string>;

export function unknownMailVariables(value: string) {
  const allowed = new Set<string>(mailVariables);
  return [...new Set([...value.matchAll(/\{([^{}]+)\}/g)]
    .map(match => match[1]).filter(name => !allowed.has(name)))];
}

export function renderMailText(value: string, context: MailContext) {
  return value.replace(/\{([^{}]+)\}/g, (full, name: string) =>
    Object.prototype.hasOwnProperty.call(context, name) ? context[name as keyof MailContext] : full);
}

export function mailContext(input: {
  customerName: string | null; company: string | null; product: string;
  requirement: string; senderName: string; email: string; inquiryNo: string;
}): MailContext {
  return {
    客户姓名: input.customerName?.trim() || "Customer",
    公司名称: input.company?.trim() || "",
    产品分类: input.product,
    客户需求: input.requirement,
    业务员姓名: input.senderName,
    客户邮箱: input.email,
    询盘编号: input.inquiryNo
  };
}
