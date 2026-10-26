import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ['src/lib/billing.ts', 'src/lib/totals.ts', 'src/lib/online-payment.ts']
  .map(path => readFileSync(path, 'utf8').replace(/^import .*;\n/gm, '')).join('\n');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { isOnlinePaidAwaitingConference } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const table = { status: 'ordering', orders: [{ price: 40.98, quantity: 1 }], payments: [{ id: 'qr_qrpay_test', method: 'pix', amount: 46.31, status: 'active' }] };
assert.equal(isOnlinePaidAwaitingConference(table, 13), true);
assert.equal(isOnlinePaidAwaitingConference({ ...table, payments: [{ ...table.payments[0], amount: 40.98 }] }, 13), false, 'Service fee must also be covered');
assert.equal(isOnlinePaidAwaitingConference({ ...table, payments: [{ ...table.payments[0], id: 'manual-payment' }] }, 13), false, 'Manual payment is not customer online payment');
assert.equal(isOnlinePaidAwaitingConference({ ...table, payments: [{ ...table.payments[0], status: 'cancelled' }] }, 13), false);
assert.equal(isOnlinePaidAwaitingConference({ ...table, status: 'available', orders: [] }, 13), false, 'Finalized table must stop pulsing');
assert.equal(isOnlinePaidAwaitingConference({ ...table, orders: [...table.orders, { price: 5, quantity: 1 }] }, 13), false, 'New unpaid order must stop fully-paid signal');
console.log('Online payment conference: captured receipt, full balance with service, partial/manual/cancelled payments, new orders and finalized table passed.');
