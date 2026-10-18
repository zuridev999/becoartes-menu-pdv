import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { cancellationAlertSchema, createOrderCancellationAlertService } from '../server/order-cancellation-alerts.mjs';

const makeDb = () => {
  const audits = [{
    id: 'audit-1', action: 'order_item_cancelled', table_number: '6',
    author_name: 'Operador', details: JSON.stringify({
      ownerAlertVersion: 1, itemName: 'Heineken', quantity: 1,
      reasonLabel: 'Cliente desistiu', reasonNotes: 'Achou caro',
    }),
  }];
  const alerts = new Map();
  const execute = async ({ sql, args = [] }) => {
    if (sql.includes('LEFT JOIN order_cancellation_alerts')) {
      return { rows: audits.filter(row => !alerts.has(row.id)).map(row => ({ id: row.id })) };
    }
    if (sql.includes('INSERT OR IGNORE INTO order_cancellation_alerts')) {
      if (!alerts.has(args[0])) alerts.set(args[0], { status: 'pending', attempts: 0 });
      return { rowsAffected: 1 };
    }
    if (sql.includes("n.status = 'pending'")) {
      return { rows: audits.filter(row => alerts.get(row.id)?.status === 'pending')
        .map(row => ({ ...row, audit_id: row.id })) };
    }
    if (sql.includes("status = 'sent'")) {
      Object.assign(alerts.get(args[1]), { status: 'sent', messageId: args[0] });
      return { rowsAffected: 1 };
    }
    if (sql.includes("status = 'uncertain'")) {
      Object.assign(alerts.get(args[1]), { status: 'uncertain', error: args[0] });
      return { rowsAffected: 1 };
    }
    if (sql.includes("status = 'sending'")) {
      const alert = alerts.get(args[0]);
      if (alert.status !== 'pending') return { rowsAffected: 0 };
      alert.status = 'sending';
      alert.attempts += 1;
      return { rowsAffected: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  return { db: { execute }, alerts };
};

{
  const { db, alerts } = makeDb();
  const sent = [];
  const service = createOrderCancellationAlertService({ db, bridge: { bridgeUrl: 'http://test' },
    ownerPhone: '5511974717013', send: async input => {
      sent.push(input);
      return { messageId: 'wamid-1' };
    } });
  assert.deepEqual(await service.dispatch(), { sent: 1, scanned: 1 });
  assert.match(sent[0].message, /mesa 6, 1x Heineken/);
  assert.match(sent[0].message, /Achou caro/);
  assert.equal(alerts.get('audit-1').messageId, 'wamid-1');
  await service.dispatch();
  assert.equal(sent.length, 1, 'same cancellation must not send twice');
}

{
  const { db, alerts } = makeDb();
  let calls = 0;
  const service = createOrderCancellationAlertService({ db, bridge: { bridgeUrl: 'http://test' },
    ownerPhone: '5511974717013', logger: { error() {} }, send: async () => {
      calls += 1;
      throw new Error('timeout after possible send');
    } });
  assert.deepEqual(await service.dispatch(), { sent: 0, scanned: 1 });
  assert.equal(alerts.get('audit-1').status, 'uncertain');
  await service.dispatch();
  assert.equal(calls, 1, 'uncertain transport must not resend blindly');
}

{
  const { db } = makeDb();
  const service = createOrderCancellationAlertService({ db, bridge: {}, ownerPhone: '',
    logger: { error() {} }, send: async () => assert.fail('must not send') });
  assert.deepEqual(await service.dispatch(), { sent: 0, blocked: true });
}

{
  const db = createClient({ url: 'file::memory:' });
  await db.execute(`CREATE TABLE audit_logs (
    id TEXT PRIMARY KEY, action TEXT NOT NULL, details TEXT,
    table_number TEXT, author_name TEXT, timestamp TEXT
  )`);
  for (const sql of cancellationAlertSchema) await db.execute(sql);
  await db.execute({
    sql: 'INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?)',
    args: ['real-1', 'order_modifier_cancelled', JSON.stringify({ ownerAlertVersion: 1,
      itemName: 'batata', quantity: 1, reasonLabel: 'Cliente pediu sem batata', reasonNotes: 'Retirado antes do preparo',
    }), '5', 'Superadmin', new Date().toISOString()],
  });
  let calls = 0;
  const service = createOrderCancellationAlertService({ db, bridge: { bridgeUrl: 'http://test' },
    ownerPhone: '5511974717013', send: async () => {
      calls += 1;
      return { messageId: 'wamid-real' };
    } });
  assert.equal((await service.dispatch()).sent, 1);
  assert.equal((await service.dispatch()).sent, 0);
  assert.equal(calls, 1);
  const status = await db.execute({
    sql: 'SELECT status, message_id FROM order_cancellation_alerts WHERE audit_id = ?',
    args: ['real-1'],
  });
  assert.equal(status.rows[0].status, 'sent');
  assert.equal(status.rows[0].message_id, 'wamid-real');
  db.close();
}

console.log('order cancellation alert tests passed');
