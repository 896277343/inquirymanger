type Json = Record<string, any>;

import { statuses } from "@/lib/labels";

type CrmField = {
  field: string;
  name: string;
  form_type?: string;
  setting?: string[];
};

type SyncConfig = {
  base: string;
  username: string;
  password: string;
  customerId?: number | null;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  country: string;
  source: string;
  product: string;
  requirement: string;
  inquiryNo: string;
  status: string;
  putInPool?: boolean;
};

function apiUrl(base: string, path: string) {
  const clean = base.trim().replace(/\/+$/, "");
  return `${clean.toLowerCase().endsWith("index.php") ? clean : `${clean}/index.php`}/${path}`;
}

async function post(
  base: string,
  path: string,
  data: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const response = await fetch(apiUrl(base, path), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", ...headers },
    body: new URLSearchParams(data),
    signal: AbortSignal.timeout(30000),
  });
  const json = (await response.json().catch(() => null)) as Json | null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!json || json.code !== 200) throw new Error(json?.error || "悟空CRM返回格式异常");
  return json.data;
}

async function getCustomerFields(base: string, auth: Record<string, string>) {
  const data = await post(
    base,
    "admin/field/getField",
    { module: "crm", controller: "customer", action: "save", types: "crm_customer" },
    auth,
  );
  return Array.isArray(data) ? (data as CrmField[]) : [];
}

function addNumericSuffix(email: string, index: number) {
  return `${email}+${index}`;
}

export async function syncToWukong(config: SyncConfig) {
  const login = await post(config.base, "admin/base/login", {
    username: config.username,
    password: config.password,
  });
  const auth = { authKey: String(login.authKey), sessionId: String(login.sessionId) };
  let customerId = config.customerId || null;
  let crmEmail = config.email;

  if (!customerId) {
    const fields = await getCustomerFields(config.base, auth);
    const productField = fields.find((field) => field.name.trim() === "需求型号");
    const statusField = fields.find((field) => field.name.trim() === "目前状态");
    const emailField = fields.find((field) => field.name.trim() === "邮件");
    if (!productField) throw new Error("悟空CRM客户字段中未找到“需求型号”，请先在CRM中创建该字段");
    if (!statusField) throw new Error("悟空CRM客户字段中未找到“目前状态”，请先在CRM中创建该字段");
    if (!emailField) throw new Error("悟空CRM客户字段中未找到“邮件”，请确认该字段已启用");
    if (statusField.form_type !== "text") {
      throw new Error("悟空CRM“目前状态”必须是单行文本字段");
    }
    if (
      ["select", "radio"].includes(productField.form_type || "") &&
      Array.isArray(productField.setting) &&
      productField.setting.length > 0 &&
      !productField.setting.includes(config.product)
    ) {
      throw new Error(`悟空CRM“需求型号”中没有选项“${config.product}”，请先保持两边选项一致`);
    }

    const source: Record<string, string> = {
      GOOGLE_ADS: "广告",
      ORGANIC: "搜索引擎",
      LIVE_CHAT: "线上询价",
    };
    const remark = `询盘编号：${config.inquiryNo}\n客户邮箱：${config.email}\n国家：${config.country}\n产品：${config.product}\n需求：${config.requirement}`;
    const customerData: Record<string, string> = {
      name: config.name,
      telephone: config.phone,
      source: source[config.source] || "线上询价",
      deal_status: "未成交",
      remark,
      [productField.field]: config.product,
      [statusField.field]: statuses[config.status] || config.status,
      [emailField.field]: crmEmail,
    };
    let created = null;
    for (let suffix = 0; suffix <= 1000; suffix += 1) {
      crmEmail = suffix === 0 ? config.email : addNumericSuffix(config.email, suffix);
      customerData[emailField.field] = crmEmail;
      try {
        created = await post(config.base, "crm/customer/save", customerData, auth);
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/重复|已存在|唯一/.test(message)) throw error;
      }
    }
    if (!created) throw new Error("悟空CRM邮件重复次数过多，已停止自动编号");
    customerId = Number(created.customer_id);
  }

  try {
    await post(
      config.base,
      "crm/contacts/save",
      {
        name: config.contactName || config.email,
        customer_id: String(customerId),
        email: crmEmail,
        mobile: config.phone,
        telephone: config.phone,
        remark: `来源：${config.inquiryNo}`,
      },
      auth,
    );
    if (config.putInPool) {
      await post(config.base, "crm/customer/putInPool", { "customer_id[]": String(customerId) }, auth);
    }
  } catch (error) {
    (error as any).customerId = customerId;
    throw error;
  }
  return { customerId };
}
