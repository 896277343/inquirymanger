import { audit, db, row, rows } from "./db";
import { decryptSecret } from "./secrets";
import { putWukongCustomerInPool, syncToWukong } from "./wukong";

type PoolInquiry = {
  id: number; inquiry_no: string; primary_email: string; contact_name: string | null;
  company: string | null; country: string | null; phone: string | null;
  source: string; product_category: string; requirement: string; status: string;
  crm_customer_id: number | null; crm_contact_created: number | null;
};

export async function syncPublicPoolBatch(limit = 50) {
  const leader = row<{id:number}>("SELECT id FROM users WHERE role='LEADER' AND active=1 ORDER BY id LIMIT 1");
  const base = row<{value:string}>("SELECT value FROM app_settings WHERE key='crm_base_url'")?.value;
  const mapping = leader && row<{crm_username:string;crm_password:string}>("SELECT crm_username,crm_password FROM crm_user_mappings WHERE user_id=?", leader.id);
  if (!leader || !base || !mapping?.crm_username || !mapping.crm_password) {
    throw new Error("请先在悟空CRM配置页面填写领导账号和CRM地址");
  }
  const password = decryptSecret(mapping.crm_password);
  const inquiries = rows<PoolInquiry>(`SELECT i.id,i.inquiry_no,i.source,i.product_category,i.requirement,i.status,
    c.primary_email,c.name contact_name,c.company,c.country,c.phone,
    cs.crm_customer_id,cs.crm_contact_created
    FROM inquiries i JOIN customers c ON c.id=i.customer_id
    LEFT JOIN crm_syncs cs ON cs.inquiry_id=i.id
    WHERE i.owner_id IS NULL AND i.status IN ('NO_REPLY','PUBLIC_POOL')
      AND cs.crm_pool_synced_at IS NULL
    ORDER BY CASE WHEN cs.crm_pool_last_error IS NULL THEN 0 ELSE 1 END, i.id ASC LIMIT ?`, Math.min(Math.max(1, limit), 50));
  let synced = 0;
  let failed = 0;
  for (const inquiry of inquiries) {
    let customerId = inquiry.crm_customer_id;
    try {
      // A previously created CRM customer needs only the pool transfer, not another contact.
      if (customerId && inquiry.crm_contact_created) {
        await putWukongCustomerInPool(base, mapping.crm_username, password, customerId);
      } else {
        const result = await syncToWukong({
          base, username: mapping.crm_username, password, customerId,
          name: inquiry.company || inquiry.contact_name || inquiry.primary_email,
          contactName: inquiry.contact_name || inquiry.primary_email,
          email: inquiry.primary_email, phone: inquiry.phone || "", country: inquiry.country || "",
          source: inquiry.source, product: inquiry.product_category,
          requirement: inquiry.requirement, inquiryNo: inquiry.inquiry_no,
          status: inquiry.status, putInPool: true,
          onCustomerCreated: (newId) => {
            db.prepare(`INSERT INTO crm_syncs(inquiry_id,crm_customer_id,crm_contact_created,synced_by)
              VALUES(?,?,0,?) ON CONFLICT(inquiry_id) DO UPDATE SET crm_customer_id=excluded.crm_customer_id`)
              .run(inquiry.id, newId, leader.id);
          },
          onContactCreated: (newId) => {
            db.prepare(`INSERT INTO crm_syncs(inquiry_id,crm_customer_id,crm_contact_created,synced_by)
              VALUES(?,?,1,?) ON CONFLICT(inquiry_id) DO UPDATE SET crm_customer_id=excluded.crm_customer_id,crm_contact_created=1`)
              .run(inquiry.id, newId, leader.id);
          },
        });
        customerId = result.customerId;
      }
      db.prepare(`INSERT INTO crm_syncs(inquiry_id,crm_customer_id,crm_contact_created,synced_by,synced_at,last_error,crm_pool_synced_at,crm_pool_last_error)
        VALUES(?,?,1,?,datetime('now','localtime'),NULL,datetime('now','localtime'),NULL)
        ON CONFLICT(inquiry_id) DO UPDATE SET crm_customer_id=excluded.crm_customer_id,
        crm_contact_created=1,synced_by=excluded.synced_by,synced_at=excluded.synced_at,
        last_error=NULL,crm_pool_synced_at=excluded.crm_pool_synced_at,crm_pool_last_error=NULL`)
        .run(inquiry.id, customerId, leader.id);
      audit(leader.id, "CRM_POOL_SYNC", "INQUIRY", inquiry.id, `自动导入悟空CRM公海 #${customerId}`);
      synced++;
    } catch (error) {
      const partial = error as {customerId?:number;contactCreated?:boolean};
      customerId = partial?.customerId || customerId;
      const message = error instanceof Error ? error.message : "同步失败";
      db.prepare(`INSERT INTO crm_syncs(inquiry_id,crm_customer_id,crm_contact_created,synced_by,last_error,crm_pool_last_error)
        VALUES(?,?,?,?,?,?) ON CONFLICT(inquiry_id) DO UPDATE SET
        crm_customer_id=excluded.crm_customer_id,crm_contact_created=MAX(crm_syncs.crm_contact_created,excluded.crm_contact_created),synced_by=excluded.synced_by,
        last_error=excluded.last_error,crm_pool_last_error=excluded.crm_pool_last_error`)
        .run(inquiry.id, customerId, partial?.contactCreated || inquiry.crm_contact_created ? 1 : 0, leader.id, message, message);
      audit(leader.id, "CRM_POOL_SYNC_FAILED", "INQUIRY", inquiry.id, `自动导入CRM公海失败：${message}`);
      failed++;
    }
  }
  const remaining = row<{n:number}>(`SELECT COUNT(*) n FROM inquiries i LEFT JOIN crm_syncs cs ON cs.inquiry_id=i.id
    WHERE i.owner_id IS NULL AND i.status IN ('NO_REPLY','PUBLIC_POOL') AND cs.crm_pool_synced_at IS NULL`)?.n || 0;
  return { attempted: inquiries.length, synced, failed, remaining };
}
