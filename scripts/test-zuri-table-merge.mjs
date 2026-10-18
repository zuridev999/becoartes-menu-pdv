import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { createZuriTableMergeServices, zuriTableMergeSchema } from '../server/zuri-table-merge.mjs';

const db = createClient({ url: 'file::memory:' });
for (const sql of [
  `CREATE TABLE tables (id TEXT PRIMARY KEY, number TEXT, status TEXT,
    qr_flow_override TEXT, qr_session_revision INTEGER, current_seller_id TEXT)`,
  'CREATE TABLE orders (id TEXT PRIMARY KEY, table_id TEXT, status TEXT)',
  'CREATE TABLE service_requests (id TEXT PRIMARY KEY, table_id TEXT, status TEXT)',
  'CREATE TABLE table_payments (id TEXT PRIMARY KEY, table_id TEXT, status TEXT)',
  'CREATE TABLE customer_tabs (id TEXT PRIMARY KEY, table_id TEXT, status TEXT)',
  `CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT, details TEXT, table_number TEXT,
    origin TEXT, author_id TEXT, author_name TEXT, timestamp TEXT)`,
  ...zuriTableMergeSchema,
]) await db.execute(sql);
await db.execute("INSERT INTO tables VALUES ('3','3','ordering','mesa',1,'staff-1')");
await db.execute("INSERT INTO tables VALUES ('6','6','ordering',NULL,1,NULL)");
await db.execute("INSERT INTO orders VALUES ('open-3','3','pending')");
await db.execute("INSERT INTO orders VALUES ('closed-3','3','closed')");
await db.execute("INSERT INTO orders VALUES ('open-6','6','pending')");
await db.execute("INSERT INTO service_requests VALUES ('request-3','3','pending')");

const service = createZuriTableMergeServices({ db, token: 'test-secret', safeSecretEqual: (a, b) => a === b });
const req = { headers: { 'x-zuri-pdv-token': 'test-secret' } };
await assert.rejects(service.lookup({ firstNumber: 3, secondNumber: 6 }, { headers: {} }), /Acesso não autorizado/);
assert.equal((await service.lookup({ firstNumber: 3, secondNumber: 6 }, req)).tables[0].openOrders, 1);
await assert.rejects(service.commit({ firstNumber: 3, secondNumber: 6, keepNumber: 9,
  requesterPhone: '5561983440871', sourceMessageId: 'in-1' }, req), /não está no par/);
await assert.rejects(service.commit({ firstNumber: 3, secondNumber: 6, keepNumber: 6,
  requesterPhone: '5511999999999', sourceMessageId: 'in-1' }, req), /não habilitado/);
await db.execute("INSERT INTO table_payments VALUES ('p1','3','active')");
await assert.rejects(service.commit({ firstNumber: 3, secondNumber: 6, keepNumber: 6,
  requesterPhone: '5561983440871', sourceMessageId: 'in-1' }, req), /pagamento ou comanda/);
await db.execute("DELETE FROM table_payments WHERE id='p1'");
await db.execute("INSERT INTO customer_tabs VALUES ('tab-1','6','open')");
await assert.rejects(service.lookup({ firstNumber: 3, secondNumber: 6 }, req), /pagamento ou comanda/);
await db.execute("DELETE FROM customer_tabs WHERE id='tab-1'");

const result = await service.commit({ firstNumber: 3, secondNumber: 6, keepNumber: 6,
  requesterPhone: '5561983440871', sourceMessageId: 'in-1' }, req);
assert.equal(result.merged, true);
assert.equal(result.ordersMoved, 1);
assert.equal(result.requestsMoved, 1);
assert.equal(result.reviewRequired, false);
assert.equal((await db.execute("SELECT table_id FROM orders WHERE id='open-3'")).rows[0].table_id, '6');
assert.equal((await db.execute("SELECT table_id FROM orders WHERE id='closed-3'")).rows[0].table_id, '3');
assert.equal((await db.execute("SELECT table_id FROM service_requests WHERE id='request-3'")).rows[0].table_id, '6');
assert.equal((await db.execute("SELECT qr_session_revision FROM tables WHERE id='3'")).rows[0].qr_session_revision, 2);
assert.equal((await db.execute("SELECT COUNT(*) AS n FROM audit_logs WHERE action='table_merge_via_zuri'")).rows[0].n, 1);
const duplicate = await service.commit({ firstNumber: 3, secondNumber: 6, keepNumber: 6,
  requesterPhone: '5561983440871', sourceMessageId: 'in-1' }, req);
assert.equal(duplicate.alreadyMerged, true);
assert.equal((await db.execute("SELECT COUNT(*) AS n FROM audit_logs WHERE action='table_merge_via_zuri'")).rows[0].n, 1);
await assert.rejects(service.commit({ firstNumber: 3, secondNumber: 6, keepNumber: 3,
  requesterPhone: '5561983440871', sourceMessageId: 'in-1' }, req), /outra união/);
const noWork = await service.commit({ firstNumber: 3, secondNumber: 6, keepNumber: 6,
  requesterPhone: '5561983440871', sourceMessageId: 'in-2' }, req);
assert.equal(noWork.noOpenWork, true);
assert.equal((await db.execute("SELECT qr_session_revision FROM tables WHERE id='3'")).rows[0].qr_session_revision, 3);
assert.equal((await db.execute("SELECT COUNT(*) AS n FROM audit_logs WHERE action='table_merge_via_zuri'")).rows[0].n, 2);
assert.equal((await service.commit({ firstNumber: 3, secondNumber: 6, keepNumber: 6,
  requesterPhone: '5561983440871', sourceMessageId: 'in-2' }, req)).noOpenWork, true);
db.close();
console.log('Zuri table merge tests passed');
