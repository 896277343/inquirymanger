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
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    deal_amount REAL,
    currency TEXT DEFAULT 'USD',
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS follow_ups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inquiry_id INTEGER NOT NULL REFERENCES inquiries(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    method TEXT NOT NULL,
    content TEXT NOT NULL,
    customer_reply TEXT,
    next_follow_up_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    summary TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS crm_user_mappings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    crm_username TEXT NOT NULL,
    crm_password TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS crm_syncs (
    inquiry_id INTEGER PRIMARY KEY REFERENCES inquiries(id),
    crm_customer_id INTEGER,
    crm_contact_created INTEGER NOT NULL DEFAULT 0,
    synced_by INTEGER REFERENCES users(id),
    synced_at TEXT,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_inquiry_owner ON inquiries(owner_id);
  CREATE INDEX IF NOT EXISTS idx_inquiry_customer ON inquiries(customer_id);
  CREATE INDEX IF NOT EXISTS idx_follow_inquiry ON follow_ups(inquiry_id);
`);

function ensureInquiryColumn(sql: string) {
  try { db.exec(sql); }
  catch (error) { if (!String(error).includes("duplicate column name")) throw error; }
}
ensureInquiryColumn("ALTER TABLE inquiries ADD COLUMN accepted_at TEXT");
ensureInquiryColumn("ALTER TABLE inquiries ADD COLUMN accept_method TEXT");

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
  db.prepare("INSERT INTO audit_logs(user_id,action,entity_type,entity_id,summary,details) VALUES(?,?,?,?,?,?)")
    .run(userId, action, entityType, entityId, summary, details ? JSON.stringify(details) : null);
}
