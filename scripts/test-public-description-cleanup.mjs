import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { cleanPublicDescriptions, corrections } from './catalog/clean-public-descriptions.mjs';

const folder = await mkdtemp(join(tmpdir(), 'beco-catalog-cleanup-test-'));
const db = createClient({ url: `file:${join(folder, 'test.db')}` });
try {
await db.batch([
  'CREATE TABLE menu(id TEXT PRIMARY KEY,description TEXT,price REAL,cost REAL,visible INTEGER,remote_stock_id TEXT)',
  'CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)',
  'CREATE TABLE audit_logs(id TEXT PRIMARY KEY,action TEXT,details TEXT,origin TEXT,author_name TEXT)',
]);
for (const row of corrections) await db.execute({ sql: 'INSERT INTO menu VALUES (?,?,21.99,0,1,?)', args: [row.id, row.before, `stock-${row.id}`] });
const before = (await db.execute('SELECT id,price,cost,visible,remote_stock_id FROM menu ORDER BY id')).rows;
assert.equal((await cleanPublicDescriptions(db)).changed.length, corrections.length);
assert.deepEqual((await db.execute('SELECT id,price,cost,visible,remote_stock_id FROM menu ORDER BY id')).rows, before);
assert.equal((await cleanPublicDescriptions(db)).changed.length, 0);
assert.equal((await db.execute('SELECT COUNT(*) n FROM audit_logs')).rows[0].n, 1);
const log = JSON.parse((await db.execute('SELECT details FROM audit_logs')).rows[0].details);
assert.equal(log.changes[0].before, corrections[0].before, 'Preserve internal notes in the audit history');
await db.execute({ sql: 'UPDATE menu SET description=? WHERE id=?', args: ['Descrição revisada pela equipe', corrections[0].id] });
assert.equal((await cleanPublicDescriptions(db)).changed.length, 0, 'Do not overwrite a subsequent staff edit');
} finally { db.close(); await rm(folder, { recursive: true, force: true }); }
console.log('Public descriptions: exact replacement, stock/prices preserved, audit and idempotency passed.');
