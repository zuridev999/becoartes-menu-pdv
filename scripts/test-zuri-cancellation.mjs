import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { createZuriCancellationServices } from '../server/zuri-cancellation.mjs';

const db = createClient({ url: 'file::memory:' });
await db.execute('CREATE TABLE tables (id TEXT PRIMARY KEY, number INTEGER)');
await db.execute('CREATE TABLE table_payments (id TEXT, table_id TEXT, status TEXT)');
await db.execute('CREATE TABLE orders (id TEXT PRIMARY KEY, table_id TEXT, status TEXT, created_at TEXT)');
await db.execute('CREATE TABLE menu (id TEXT PRIMARY KEY, name TEXT)');
await db.execute('CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, product_id TEXT, quantity INTEGER, price_at_time REAL, selected_modifiers TEXT)');
await db.execute("INSERT INTO tables VALUES ('t6', 6)");
await db.execute("INSERT INTO orders VALUES ('o6', 't6', 'pending', '2026-10-18T00:00:00Z')");
await db.execute("INSERT INTO orders VALUES ('o-old', 't6', 'closed', '2026-10-17T00:00:00Z')");
await db.execute("INSERT INTO menu VALUES ('p1', 'Heineken')");
await db.execute("INSERT INTO order_items VALUES ('i1', 'o6', 'p1', 1, 18, '[]')");
await db.execute("INSERT INTO order_items VALUES ('i-old', 'o-old', 'p1', 4, 18, '[]')");

const calls = [];
const services = createZuriCancellationServices({
  db, token: 'test-secret', safeSecretEqual: (a, b) => a === b,
  cancelItem: async (input, session) => {
    calls.push({ input, session });
    return { orderId: 'o6' };
  },
});
const req = { headers: { 'x-zuri-pdv-token': 'test-secret' } };
await assert.rejects(services.lookup({ tableNumber: 6, requesterPhone: '5561983440871' }, { headers: {} }), /Acesso não autorizado/);
await assert.rejects(services.lookup({ tableNumber: 6, requesterPhone: '5511999999999' }, req), /não habilitado/);
const found = await services.lookup({ tableNumber: 6, requesterPhone: '5561983440871' }, req);
assert.equal(found.items[0].name, 'Heineken');
assert.equal(found.items.length, 1);
assert.equal(found.items[0].orderedAt, '2026-10-18T00:00:00Z');
assert.equal(found.items[0].unitPrice, 18);
assert.equal(found.currentTotal, 18);
const ownerFound = await services.lookup({ tableNumber: 6, requesterPhone: '5511974717013' }, req);
assert.equal(ownerFound.currentTotal, 18);
await assert.rejects(services.commit({ tableNumber: 6, itemId: 'i1', reasonNotes: 'Cliente desistiu',
  requesterPhone: '5561983440871', sourceMessageId: 'in-1' }, req), /Motivo insuficiente/);
await assert.rejects(services.commit({ tableNumber: 6, itemId: 'i1', reasonNotes: 'Achou caro e não quis alternativa',
  requesterPhone: '5511999999999', sourceMessageId: 'in-1' }, req), /não habilitado/);
assert.equal(calls.length, 0);
const cancelled = await services.commit({ tableNumber: 6, itemId: 'i1',
  reasonNotes: 'Cliente achou caro e recusou outra opção',
  requesterPhone: '5561983440871', sourceMessageId: 'in-2' }, req);
assert.equal(cancelled.cancelled, true);
assert.equal(calls[0].input.itemId, 'i1');
assert.equal(calls[0].session.name, 'Matheus Alencar via Zuri');
await db.execute("INSERT INTO table_payments VALUES ('pay1','t6','active')");
await assert.rejects(services.lookup({ tableNumber: 6, requesterPhone: '5561983440871' }, req), /pagamento lançado/);
db.close();
console.log('Zuri cancellation endpoint tests passed');
