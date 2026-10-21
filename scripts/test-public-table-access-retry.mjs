import assert from 'node:assert/strict';
import {
  getPublicTableAccessRefreshTarget,
  shouldRefreshPublicTableAccess,
} from '../src/lib/public-table-access-retry.ts';

const qrOrder = {
  origin: 'qr',
  tableId: '6',
  clientRequestId: 'order_same_key_after_retry',
  publicAccessToken: '',
};

assert.deepEqual(getPublicTableAccessRefreshTarget(qrOrder), { tableId: '6' });
assert.deepEqual(getPublicTableAccessRefreshTarget({
  origin: 'qr',
  sourceTableId: '6',
  sourceTableNumber: 6,
  customerTabId: 'tab-1',
}), { tableId: '6', tableNumber: 6 });
assert.equal(getPublicTableAccessRefreshTarget({ origin: 'pdv', tableId: '6' }), null);

assert.equal(shouldRefreshPublicTableAccess({
  path: '/api/orders/send-to-kitchen',
  status: 401,
  error: 'Token público da mesa inválido ou ausente.',
  body: qrOrder,
}), true);
assert.equal(shouldRefreshPublicTableAccess({
  path: '/api/orders/send-to-kitchen',
  status: 500,
  error: 'Token público da mesa inválido ou ausente.',
  body: qrOrder,
}), false);
assert.equal(shouldRefreshPublicTableAccess({
  path: '/api/table-access-token',
  status: 401,
  error: 'Token público da mesa inválido ou ausente.',
  body: qrOrder,
}), false);
assert.equal(shouldRefreshPublicTableAccess({
  path: '/api/orders/send-to-kitchen',
  status: 401,
  error: 'Acesso à comanda não autorizado.',
  body: qrOrder,
}), false);

console.log('Public table access retry tests passed.');
