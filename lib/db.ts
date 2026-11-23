import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { createInquiryNumber } from "./inquiry-number";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const globalForDb = globalThis as unknown as { inquiryDb?: DatabaseSync };
export const db = globalForDb.inquiryDb ?? new DatabaseSync(path.join(dataDir, "inquiries.db"));
if (process.env.NODE_ENV !== "production") globalForDb.inquiryDb = db;

db.exec("PRAGMA busy_timeout = 10000;");
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('LEADER','SALES')),
    level TEXT NOT NULL DEFAULT 'NEW',
    assignable INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    primary_email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT,
    company TEXT,
    country TEXT,
    phone TEXT,
    alternate_emails TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inquiry_no TEXT UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    source TEXT NOT NULL CHECK(source IN ('GOOGLE_ADS','ORGANIC','LIVE_CHAT')),
    product_category TEXT NOT NULL,
    requirement TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'UNASSIGNED',
    owner_id INTEGER REFERENCES users(id),
    assigned_at TEXT,
    next_follow_up_at TEXT,
    reminder_overdue_at TEXT,
    deal_amount REAL,
    currency TEXT DEFAULT 'USD',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS follow_ups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inquiry_id INTEGER NOT NULL REFERENCES inquiries(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    method TEXT NOT NULL,
    content TEXT NOT NULL,
    customer_reply TEXT,
    next_follow_up_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS inquiry_user_flags (
    inquiry_id INTEGER NOT NULL REFERENCES inquiries(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0,1)),
    important INTEGER NOT NULL DEFAULT 0 CHECK(important IN (0,1)),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY(inquiry_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS smtp_accounts (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    email TEXT NOT NULL,
    password_encrypted TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_email_templates_user ON email_templates(user_id,id);
  CREATE TABLE IF NOT EXISTS email_send_attempts (
    inquiry_id INTEGER PRIMARY KEY REFERENCES inquiries(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
    from_email TEXT NOT NULL,
    to_email TEXT NOT NULL,
    cc_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('SENDING','ACCEPTED','PARTIAL','FAILED','UNKNOWN')),
    message_id TEXT,
    smtp_response TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS email_send_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inquiry_id INTEGER NOT NULL REFERENCES inquiries(id),
    stage INTEGER NOT NULL CHECK(stage IN (1,2,3)),
    user_id INTEGER NOT NULL REFERENCES users(id),
    template_id INTEGER REFERENCES email_templates(id) ON DELETE SET NULL,
    from_email TEXT NOT NULL,
    to_email TEXT NOT NULL,
    cc_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('SENDING','ACCEPTED','PARTIAL','FAILED','UNKNOWN')),
    message_id TEXT,
    smtp_response TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    completed_at TEXT,
    UNIQUE(inquiry_id,stage)
  );
  INSERT OR IGNORE INTO email_send_events
    (inquiry_id,stage,user_id,template_id,from_email,to_email,cc_email,subject,body,status,message_id,smtp_response,error_message,started_at,completed_at)
    SELECT inquiry_id,1,user_id,template_id,from_email,to_email,cc_email,subject,body,status,message_id,smtp_response,error_message,started_at,completed_at FROM email_send_attempts;
  CREATE TRIGGER IF NOT EXISTS lock_inquiry_during_email_send_v2
  BEFORE UPDATE OF owner_id ON inquiries
  WHEN OLD.owner_id IS NOT NEW.owner_id
    AND EXISTS (SELECT 1 FROM email_send_events e WHERE e.inquiry_id=OLD.id
      AND e.status IN ('SENDING','UNKNOWN','PARTIAL'))
  BEGIN
    SELECT RAISE(ABORT, '开发信发送结果待核查，暂不能转交或重新分配');
  END;
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    summary TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS crm_user_mappings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    crm_username TEXT NOT NULL,
    crm_password TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS crm_syncs (
    inquiry_id INTEGER PRIMARY KEY REFERENCES inquiries(id),
    crm_customer_id INTEGER,
    crm_contact_created INTEGER NOT NULL DEFAULT 0,
    synced_by INTEGER REFERENCES users(id),
    synced_at TEXT,
    last_error TEXT
  );
  CREATE TABLE IF NOT EXISTS inbound_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_system TEXT NOT NULL,
    external_id TEXT NOT NULL,
    site TEXT,
    page_url TEXT,
    name TEXT,
    email TEXT,
    company TEXT,
    country TEXT,
    phone TEXT,
    product TEXT,
    message TEXT NOT NULL,
    submitted_at TEXT,
    raw_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','IMPORTED','IGNORED')),
    inquiry_id INTEGER REFERENCES inquiries(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(source_system, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_inbound_status ON inbound_submissions(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_inquiry_owner ON inquiries(owner_id);
  CREATE INDEX IF NOT EXISTS idx_inquiry_customer ON inquiries(customer_id);
  CREATE INDEX IF NOT EXISTS idx_follow_inquiry ON follow_ups(inquiry_id);
  CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type,entity_id,id);
`);
db.exec("DROP TRIGGER IF EXISTS lock_inquiry_during_email_send");

function ensureInquiryColumn(sql: string) {
  try { db.exec(sql); }
  catch (error) { if (!String(error).includes("duplicate column name")) throw error; }
}
ensureInquiryColumn("ALTER TABLE inquiries ADD COLUMN accepted_at TEXT");
ensureInquiryColumn("ALTER TABLE inquiries ADD COLUMN reminder_overdue_at TEXT");
ensureInquiryColumn("ALTER TABLE inquiries ADD COLUMN accept_method TEXT");
ensureInquiryColumn("ALTER TABLE users ADD COLUMN last_login_at TEXT");
ensureInquiryColumn("ALTER TABLE users ADD COLUMN assignable INTEGER NOT NULL DEFAULT 1");
ensureInquiryColumn("ALTER TABLE crm_syncs ADD COLUMN crm_pool_synced_at TEXT");
ensureInquiryColumn("ALTER TABLE crm_syncs ADD COLUMN crm_pool_last_error TEXT");
ensureInquiryColumn("ALTER TABLE email_templates ADD COLUMN stage INTEGER NOT NULL DEFAULT 1");

db.exec("BEGIN IMMEDIATE");
try {
  const observerMigration = db.prepare("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES('think1023_observer_v1','complete',datetime('now','localtime'))").run();
  if (observerMigration.changes > 0) {
    const observer = db.prepare("SELECT id FROM users WHERE username='think1023' AND role='SALES'").get() as {id:number}|undefined;
    if (observer) {
      db.prepare("UPDATE users SET assignable=0 WHERE id=?").run(observer.id);
      db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,summary,created_at) VALUES(?,'AUTO_UPDATE','USER',?,'将 think1023 设为不可接收分配的观察账号',datetime('now','localtime'))")
        .run(observer.id,observer.id);
    }
  }
  const timeMigration = db.prepare("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES('local_time_migration_v1','running',datetime('now','localtime'))").run();
  if (timeMigration.changes > 0) {
    db.exec(`
      UPDATE users SET created_at=datetime(created_at,'+8 hours');
      UPDATE customers SET created_at=datetime(created_at,'+8 hours');
      UPDATE inquiries SET created_at=datetime(created_at,'+8 hours');
      UPDATE follow_ups SET created_at=datetime(created_at,'+8 hours');
      UPDATE audit_logs SET created_at=datetime(created_at,'+8 hours');
      UPDATE app_settings SET value='complete',updated_at=datetime('now','localtime') WHERE key='local_time_migration_v1';
    `);
  }
  const poolAuditMigration = db.prepare("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES('manual_pool_sync_audit_v1','complete',datetime('now','localtime'))").run();
  if (poolAuditMigration.changes > 0) {
    db.exec(`UPDATE crm_syncs SET crm_pool_synced_at=(
      SELECT MAX(al.created_at) FROM audit_logs al
      WHERE al.entity_type='INQUIRY' AND al.entity_id=crm_syncs.inquiry_id
        AND al.action='CRM_SYNC' AND al.summary LIKE '同步到悟空CRM公海%'
    )
    WHERE crm_pool_synced_at IS NULL AND EXISTS (
      SELECT 1 FROM audit_logs al WHERE al.entity_type='INQUIRY'
        AND al.entity_id=crm_syncs.inquiry_id AND al.action='CRM_SYNC'
        AND al.summary LIKE '同步到悟空CRM公海%'
    )`);
  }
  const communicationMigration = db.prepare("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES('communication_flow_v1','complete',datetime('now','localtime'))").run();
  if (communicationMigration.changes > 0) {
    db.exec(`
      UPDATE inquiries SET status='ONGOING'
        WHERE status IN ('CONTACTING','TECHNICAL','QUOTED','NEGOTIATING','WAITING','PAUSED')
          AND owner_id IS NOT NULL AND accepted_at IS NOT NULL;
      UPDATE inquiries SET status='NEW',next_follow_up_at=NULL
        WHERE status IN ('CONTACTING','TECHNICAL','QUOTED','NEGOTIATING','WAITING','PAUSED')
          AND owner_id IS NOT NULL AND accepted_at IS NULL;
      UPDATE inquiries SET reminder_overdue_at=next_follow_up_at
        WHERE owner_id IS NOT NULL AND accepted_at IS NOT NULL
          AND status='ONGOING' AND next_follow_up_at IS NOT NULL;
    `);
  }
  const oldContactMigration = db.prepare("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES('communication_old_contact_v2','complete',datetime('now','localtime'))").run();
  if (oldContactMigration.changes > 0) {
    db.exec(`UPDATE inquiries SET status='ONGOING',reminder_overdue_at=next_follow_up_at
      WHERE status='CONTACTING' AND accepted_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM audit_logs al WHERE al.entity_type='INQUIRY'
            AND al.entity_id=inquiries.id AND al.action='ACCEPT'
            AND al.summary='确认第一次开发邮件已发送，接受询盘'
        )`);
  }
  const missingReminderMigration = db.prepare("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES('communication_missing_reminder_v3','complete',datetime('now','localtime'))").run();
  if (missingReminderMigration.changes > 0) {
    db.exec(`UPDATE inquiries SET next_follow_up_at=datetime('now','localtime','+5 days'),
      reminder_overdue_at=datetime('now','localtime','+5 days')
      WHERE status='ONGOING' AND owner_id IS NOT NULL AND accepted_at IS NOT NULL
        AND next_follow_up_at IS NULL`);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const legacyInquiryNumbers = db.prepare("SELECT id,inquiry_no,created_at FROM inquiries").all() as Array<{ id:number; inquiry_no:string|null; created_at:string }>;
const updateInquiryNumber = db.prepare("UPDATE inquiries SET inquiry_no=? WHERE id=?");
for (const inquiry of legacyInquiryNumbers) {
  if (inquiry.inquiry_no && /^INQ-\d{4}-\d+$/.test(inquiry.inquiry_no)) {
    let next = createInquiryNumber(inquiry.created_at);
    while (db.prepare("SELECT 1 FROM inquiries WHERE inquiry_no=?").get(next)) next = createInquiryNumber(inquiry.created_at);
    updateInquiryNumber.run(next, inquiry.id);
  }
}

{
  const insert = db.prepare("INSERT OR IGNORE INTO users(username,display_name,password_hash,role,level) VALUES(?,?,?,?,?)");
  const seedUsers = [
    ["leader", "领导", "admin123", "LEADER", "SENIOR"],
    ["jane", "Jane", "123456", "SALES", "SENIOR"],
    ["justin", "Justin", "123456", "SALES", "SENIOR"],
    ["angel", "Angel", "123456", "SALES", "SENIOR"],
    ["shana", "Shana", "123456", "SALES", "SENIOR"],
    ["clarence", "Clarence", "123456", "SALES", "SENIOR"]
  ];
  for (const u of seedUsers) insert.run(u[0], u[1], bcrypt.hashSync(u[2], 10), u[3], u[4]);
}

export function rows<T>(sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function row<T>(sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function audit(userId: number, action: string, entityType: string, entityId: number | null, summary: string, details?: unknown) {
  db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,summary,details,created_at) VALUES(?,?,?,?,?,?,datetime('now','localtime'))")
    .run(userId, action, entityType, entityId, summary, details ? JSON.stringify(details) : null);
}
