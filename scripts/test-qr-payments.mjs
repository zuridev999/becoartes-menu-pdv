import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { createQrPaymentServices, qrPaymentSchema, qrPaymentActiveIndex } from '../server/payments/qr-payments.mjs';

const db = createClient({ url: ':memory:' });
await db.batch([
  qrPaymentSchema, qrPaymentActiveIndex,
  'CREATE TABLE tables (id TEXT PRIMARY KEY, number INTEGER)',
  'CREATE TABLE table_payments (id TEXT PRIMARY KEY,table_id TEXT,table_number INTEGER,seller_id TEXT,seller_name TEXT,method TEXT,amount REAL,status TEXT,created_at TEXT)',
  'CREATE TABLE customer_tabs (id TEXT PRIMARY KEY,status TEXT,paid_at TEXT)',
  'CREATE TABLE audit_logs (id TEXT PRIMARY KEY,action TEXT,details TEXT,table_number TEXT,origin TEXT,author_name TEXT,timestamp TEXT)',
  "INSERT INTO tables VALUES ('demo',6)",
  "INSERT INTO customer_tabs VALUES ('tab','open',NULL)",
], 'write');
let items = [{ id: 'water', name: 'Água', price: 7.99, quantity: 1 }, { id: 'fries', name: 'Batata', price: 32.99, quantity: 1 }];
const authorize = async input => { if (input.accessToken !== 'own-table') throw Object.assign(new Error('Acesso inválido'), { statusCode: 403 }); return { tableId: 'demo', tabId: 'tab' }; };
const dependencies = { db, authorize, getItems: async () => items, getSettings: async () => ({ serviceTax: 13 }), getPublicKey: async () => ({ publicKey: 'fake' }), localDatabase: true };
const service = createQrPaymentServices({ ...dependencies, provider: 'simulator' });
const context = { accessToken: 'own-table' };
const input = { ...context, method: 'pix', expectedAmount: 46.31, customer: { name: 'Cliente Teste', email: 'teste@example.com', taxId: '52998224725' } };
await assert.rejects(service.summary({}), /Acesso inválido/);
await assert.rejects(service.create({ ...input, expectedAmount: 1 }), /atualizada/);
assert.throws(() => createQrPaymentServices({ ...dependencies, localDatabase: false, provider: 'simulator' }), /banco local/);
const summary = await service.summary(context);
assert.equal(summary.subtotal, 40.98);
assert.equal(summary.serviceFee, 5.33);
assert.equal(summary.balance, 46.31);
const first = await service.create(input);
const duplicate = await service.create(input);
assert.equal(first.id, duplicate.id);
assert.equal((await service.simulate({ ...context, intentId: first.id, outcome: 'authorized' })).status, 'pending');
assert.equal((await db.execute('SELECT COUNT(*) n FROM table_payments')).rows[0].n, 0);
await Promise.all([service.simulate({ ...context, intentId: first.id, outcome: 'paid' }), service.simulate({ ...context, intentId: first.id, outcome: 'paid' })]);
await service.simulate({ ...context, intentId: first.id, outcome: 'paid' });
assert.equal((await db.execute('SELECT COUNT(*) n FROM table_payments')).rows[0].n, 1);
assert.equal((await service.summary(context)).balance, 0);
assert.equal((await db.execute("SELECT status FROM customer_tabs WHERE id='tab'")).rows[0].status, 'paid');
await db.execute('DELETE FROM table_payments');
await db.execute('DELETE FROM qr_payment_intents');
const declined = await service.create({ ...input, method: 'credit', encryptedCard: 'ENCRYPTED_TEST' });
assert.equal((await service.simulate({ ...context, intentId: declined.id, outcome: 'declined' })).status, 'failed');
const retry = await service.create(input);
assert.notEqual(retry.id, declined.id);
items = [];
assert.equal((await service.simulate({ ...context, intentId: retry.id, outcome: 'paid' })).status, 'review');
assert.equal((await db.execute('SELECT COUNT(*) n FROM table_payments')).rows[0].n, 0);
assert.equal((await service.create(input)).id, retry.id, 'Reviewed captured payment must block a second charge');
assert.equal((await service.summary(context)).intent.status, 'review');
await db.execute('DELETE FROM qr_payment_intents');
items = [{ id: 'new', name: 'Nova conta', price: 10, quantity: 1 }];
let authoritative = null;
let calls = 0;
const real = createQrPaymentServices({ ...dependencies, provider: 'pagbank', token: 'test-token', apiBase: 'https://sandbox.api.pagseguro.com', fetchImpl: async (url, options) => {
  calls++;
  if (options.method === 'POST') {
    const payload = JSON.parse(options.body);
    assert.ok(url.endsWith('/orders'));
    assert.equal(options.headers['x-idempotency-key'], payload.reference_id);
    assert.equal(payload.qr_codes[0].amount.value, 1130);
    authoritative = { id: 'ORDE_TEST', reference_id: payload.reference_id, charges: [] };
  }
  return { ok: true, json: async () => authoritative };
} });
const order = await real.create({ ...input, expectedAmount: 11.30 });
authoritative.charges = [{ status: 'PAID', amount: { value: 100, currency: 'BRL' }, payment_method: { type: 'PIX' } }];
assert.equal((await real.webhook({ reference_id: order.id, status: 'PAID', amount: 1130 })).status, 'review');
assert.equal(calls, 2, 'Webhook must re-fetch the provider order');
assert.equal((await db.execute('SELECT COUNT(*) n FROM table_payments')).rows[0].n, 0);
assert.equal((await db.execute("SELECT COUNT(*) n FROM qr_payment_intents WHERE snapshot LIKE '%52998224725%' OR snapshot LIKE '%ENCRYPTED_TEST%'")).rows[0].n, 0);
db.close();
console.log('QR payments: totals, possession, immutable amount, duplicate clicks/events, capture, refusal, stale table and provider recheck passed.');
