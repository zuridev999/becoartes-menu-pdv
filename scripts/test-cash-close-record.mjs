import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { persistCashClosure, listCashClosureCounts } from '../server/cash-close-record.mjs';
import { SCHEMA_MIGRATIONS } from '../server/migrations/schema.mjs';

const testDir = mkdtempSync(join(tmpdir(), 'beco-cash-close-'));
const db = createClient({ url: `file:${join(testDir, 'cash.db')}` });
await db.execute("CREATE TABLE caixa_diario (id TEXT PRIMARY KEY, empresa_id TEXT, data TEXT, created_at INTEGER, valor_caixa_final REAL, status TEXT, observacoes TEXT, updated_at INTEGER)");
await db.execute("CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT, details TEXT, origin TEXT, author_id TEXT, author_name TEXT, timestamp TEXT)");
const migration = SCHEMA_MIGRATIONS.find((item) => item.id === '20261004_0001_cash_closure_counts');
for (const step of migration.steps) await db.execute(step.sql);
await db.execute("INSERT INTO caixa_diario (id, empresa_id, data, created_at, valor_caixa_final, status) VALUES ('cash-1', 'beco', '2026-10-04', 100, 0, 'Aberto')");

let sequence = 0;
const closure = (overrides = {}) => persistCashClosure({
  db, cashTable: 'caixa_diario',
  cash: { id: 'cash-1', data: '2026-10-04', created_at: 100, observacoes: '', openingCents: 5000, cashSalesCents: 1000, manualInCents: 0, manualOutCents: 0, blockingShortage: false, adminOverride: false, sandbox: false },
  empresaId: 'beco', closingCents: 4150, expectedCents: 6000,
  cashCount: { note_200: 0, note_100: 0, note_50: 0, note_20: 2, note_10: 0, note_5: 0, note_2: 0, coin_1: 0, coin_50: 3, coin_25: 0, coin_10: 0, coin_5: 0 },
  notes: 'Conferido', actor: { id: 'operator-1', name: 'Operador' }, createId: () => `id-${++sequence}`, now: 200,
  ...overrides,
});

await closure();
const closed = (await db.execute("SELECT status, valor_caixa_final FROM caixa_diario WHERE id = 'cash-1'")).rows[0];
assert.equal(closed.status, 'Fechado');
assert.equal(closed.valor_caixa_final, 41.5);
let counts = await listCashClosureCounts({ db, empresaId: 'beco' });
assert.equal(counts.length, 1);
assert.equal(counts[0].counts.note_20, 2);
assert.equal(counts[0].counts.coin_50, 3);
assert.equal(counts[0].total, 41.5);
assert.equal(counts[0].difference, -18.5);
assert.equal((await db.execute("SELECT count(*) AS n FROM audit_logs WHERE action = 'cash_closed'")).rows[0].n, 1);
await assert.rejects(() => closure(), /já foi fechado/);
assert.equal((await listCashClosureCounts({ db, empresaId: 'beco' })).length, 1);
await db.execute("UPDATE caixa_diario SET status = 'Aberto' WHERE id = 'cash-1'");
await assert.rejects(() => closure({ closingCents: 4151 }), /não confere/);
assert.equal((await db.execute("SELECT status FROM caixa_diario WHERE id = 'cash-1'")).rows[0].status, 'Aberto');

await db.execute("UPDATE caixa_diario SET created_at = 300 WHERE id = 'cash-1'");
const reopenedCash = { id: 'cash-1', data: '2026-10-04', created_at: 300, observacoes: '', openingCents: 5000, cashSalesCents: 1000, manualInCents: 0, manualOutCents: 0, blockingShortage: false, adminOverride: false, sandbox: false };
const concurrent = await Promise.allSettled([closure({ cash: reopenedCash }), closure({ cash: reopenedCash })]);
assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1, 'only one concurrent close may succeed');
assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
counts = await listCashClosureCounts({ db, empresaId: 'beco', from: '2026-10-04', to: '2026-10-04' });
assert.equal(counts.length, 2, 'reopening the same business date must preserve both counts');
assert.equal((await listCashClosureCounts({ db, empresaId: 'other' })).length, 0, 'tenant isolation');

await db.execute("UPDATE caixa_diario SET status = 'Aberto' WHERE id = 'cash-1'");
await assert.rejects(() => closure({ createId: () => 'id-1' }), /UNIQUE constraint/);
assert.equal((await db.execute("SELECT status FROM caixa_diario WHERE id = 'cash-1'")).rows[0].status, 'Aberto', 'failed count insert must roll back cash close');

await closure({ cashCount: undefined, closingCents: 4150 });
assert.equal((await listCashClosureCounts({ db, empresaId: 'beco' })).length, 2, 'legacy close without count must not create a false snapshot');
await db.execute("UPDATE caixa_diario SET status = 'Aberto' WHERE id = 'cash-1'");
await closure({ cash: { ...reopenedCash, sandbox: true } });
assert.equal((await listCashClosureCounts({ db, empresaId: 'beco' })).length, 2, 'sandbox count must not appear in production history');
assert.equal((await listCashClosureCounts({ db, empresaId: 'beco', sandboxMode: true })).length, 1);
await assert.rejects(() => listCashClosureCounts({ db, empresaId: 'beco', from: 'bad' }), /inválido/);
db.close();
rmSync(testDir, { recursive: true, force: true });
console.log('cash close record: atomic persistence, duplicate guard, reopening, tenant scope, rollback and legacy compatibility passed');
