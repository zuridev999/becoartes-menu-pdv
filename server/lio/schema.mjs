// Explicit, additive migration. Never run from BFF startup.
export const LIO_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS lio_devices (
    id TEXT PRIMARY KEY, terminal TEXT UNIQUE NOT NULL, token_hash TEXT UNIQUE,
    enrollment_hash TEXT UNIQUE, enrollment_expires INTEGER, active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lio_operators (
    seller_id TEXT PRIMARY KEY, pin_lookup TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lio_sessions (
    token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, seller_id TEXT NOT NULL,
    expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lio_intents (
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL, seller_id TEXT NOT NULL, table_id TEXT NOT NULL,
    method TEXT NOT NULL, amount INTEGER NOT NULL, received INTEGER NOT NULL,
    quote TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
    cielo_order_id TEXT UNIQUE, transaction_id TEXT UNIQUE, result TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lio_one_pending_per_table ON lio_intents(table_id)
    WHERE status IN ('pending','verified','recorded')`,
  `CREATE TABLE IF NOT EXISTS lio_audit (
    id TEXT PRIMARY KEY, actor TEXT NOT NULL, device TEXT, event TEXT NOT NULL,
    subject TEXT NOT NULL, created_at INTEGER NOT NULL)`,
];
export async function migrateLio(db) { await db.batch(LIO_SCHEMA, 'write'); }
