import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createAccessGuards,
  createRouteAccessEnforcer,
  PERMISSION_BY_ROUTE,
} from '../server/routes/access-policy.mjs';
import { createRouteHandlers } from '../server/routes/handlers.mjs';
import { hashPin, normalizeStoredPin, verifyPin } from '../server/auth/pins.mjs';
import { getPdvPublishBlockers } from '../server/catalog/product-lifecycle.mjs';
import {
  centsToMoney,
  formatMoneyBRL,
  moneyToCents,
  normalizePaymentsFingerprint,
} from '../server/domain/money.mjs';

const bffSource = readFileSync(new URL('../server/bff.mjs', import.meta.url), 'utf8');
assert.equal(moneyToCents('R$ 1.234,56'), 123456);
assert.equal(moneyToCents(19.999), 2000);
assert.equal(centsToMoney(123456), 1234.56);
assert.equal(formatMoneyBRL(12.5), 'R$ 12,50');
assert.equal(
  normalizePaymentsFingerprint([
    { method: 'pix', amount: 10 },
    { method: 'credit', amount: '20,00' },
  ]),
  normalizePaymentsFingerprint([
    { method: 'credit', amount: 20 },
    { method: 'pix', amount: '10,00' },
  ]),
);
assert.match(bffSource, /typ:\s*'delivery_order_tracking'/, 'Delivery orders must use signed tracking credentials.');
assert.match(bffSource, /customerOwnsOrder/, 'Delivery customer sessions must be checked against order ownership.');
assert.match(bffSource, /Acesso ao pedido não autorizado/, 'Delivery order reads must fail closed.');
assert.match(bffSource, /typ:\s*'customer_tab_access'/, 'Customer tabs must use signed possession credentials.');
assert.match(bffSource, /verifyCustomerTabAccessToken/, 'Customer tab reads and payments must verify possession.');
assert.doesNotMatch(
  bffSource,
  /const recoverCustomerTab = async \(\{ cpf \}\)/,
  'CPF alone must not recover a customer tab.',
);

const hashedPin = hashPin('9071');
assert.match(hashedPin, /^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/);
assert.deepEqual(verifyPin('9071', hashedPin), { ok: true, needsRehash: false });
assert.deepEqual(verifyPin('0000', hashedPin), { ok: false, needsRehash: false });
assert.match(normalizeStoredPin('9071'), /^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/);

const calls = [];
const services = new Proxy({}, {
  get: (_target, name) => async (...args) => {
    calls.push({ name, args });
    return { service: name, args };
  },
});
const handlers = createRouteHandlers(services);

assert.equal(Object.keys(handlers).length, 88, 'route registry lost or duplicated operational endpoints');
for (const route of [
  'GET /api/app/init',
  'POST /api/pdv-terminal/challenge',
  'POST /api/pdv-terminal/authorize',
  'POST /api/orders/send-to-kitchen',
  'POST /api/bills/close',
  'POST /api/counter-sales/close',
  'POST /api/delivery/checkout',
  'POST /api/catalog/product/delete',
  'POST /api/catalog/product/cmv',
  'POST /api/inventory/reconcile-pending',
]) {
  assert.equal(typeof handlers[route], 'function', `missing handler ${route}`);
}

const initContext = {
  url: new URL('http://localhost/api/app/init?view=bar'),
  session: { id: 'admin' },
  operationAccessAllowed: true,
};
await handlers['GET /api/app/init']({}, initContext);
assert.deepEqual(calls.at(-1), {
  name: 'getAppSnapshotWithRetry',
  args: [{
    includeCatalog: true,
    includeAuditLimit: 50,
    view: 'bar',
    session: initContext.session,
    operationAccessAllowed: true,
  }],
});

const deliveryContext = {
  url: new URL('http://localhost/api/delivery/order?orderId=delivery_owner_test'),
  req: {
    headers: {
      'x-beco-delivery-session': 'customer-session',
      'x-beco-delivery-tracking': 'tracking-token',
    },
  },
  session: { id: 'operator' },
};
await handlers['GET /api/delivery/order']({}, deliveryContext);
assert.deepEqual(calls.at(-1), {
  name: 'getDeliveryOrder',
  args: [{
    orderId: 'delivery_owner_test',
    session: deliveryContext.session,
    customerSessionToken: 'customer-session',
    trackingToken: 'tracking-token',
  }],
});

await handlers['POST /api/customer-tabs/payment-link'](
  { tabId: 'tab-owner-test', accessToken: 'tab-token' },
  deliveryContext,
);
assert.deepEqual(calls.at(-1), {
  name: 'createCustomerTabPaymentLink',
  args: [{ tabId: 'tab-owner-test', accessToken: 'tab-token' }, deliveryContext.session],
});

const allowedPermissions = new Set();
let publicTableTokenValid = false;
let ipRestrictionCalls = 0;
const { requireSession, requirePermission } = createAccessGuards({
  canSessionWithSettings: (_session, permission) => allowedPermissions.has(permission),
});
const enforce = createRouteAccessEnforcer({
  verifyPublicTableToken: async () => publicTableTokenValid ? { ok: true } : null,
  canAccessOutsideOperationIp: (session) => Boolean(session?.allowRemote),
  throwIpRestricted: () => {
    ipRestrictionCalls += 1;
    const error = new Error('IP não autorizado.');
    error.statusCode = 403;
    throw error;
  },
  getSettings: async () => ({ permissions: true }),
  requireSession,
  requirePermission,
});

await enforce('GET /api/delivery/config', {}, null);
await assert.rejects(
  () => enforce('POST /api/sellers', {}, null),
  (error) => error.statusCode === 401,
);
await assert.rejects(
  () => enforce('POST /api/sellers', {}, { id: 'operator' }),
  (error) => error.statusCode === 403,
);
allowedPermissions.add('managePDVUsers');
await enforce('POST /api/sellers', {}, { id: 'admin' });
assert.equal(PERMISSION_BY_ROUTE['POST /api/sellers'], 'managePDVUsers');
assert.equal(PERMISSION_BY_ROUTE['POST /api/inventory/reconcile-pending'], 'manageSettings');

publicTableTokenValid = true;
await enforce('POST /api/service-requests', {
  origin: 'qr',
  publicAccessToken: 'signed',
  tableId: '1',
}, null);

await assert.rejects(
  () => enforce('GET /api/cash/status', {}, null, { operationAccessAllowed: false }),
  (error) => error.statusCode === 403,
);
assert.equal(ipRestrictionCalls, 1);

assert.deepEqual(getPdvPublishBlockers({
  name: 'Black Label 50ml',
  price: 39.9,
  categoryFound: true,
  directStockFound: true,
}), []);

assert.deepEqual(getPdvPublishBlockers({
  name: 'Caipirinha',
  price: 32.9,
  categoryFound: true,
  directStockFound: false,
  recipeId: 'ficha-caipirinha',
  ingredientCount: 4,
  unlinkedIngredientCount: 0,
  invalidQuantityCount: 0,
}), []);

assert.deepEqual(getPdvPublishBlockers({
  name: 'Produto incompleto',
  price: 0,
  categoryFound: false,
  directStockFound: false,
  recipeId: '',
}), [
  'Informe um preço de venda maior que zero.',
  'Vincule o produto a uma categoria válida.',
  'Vincule um estoque direto ou cadastre a ficha técnica do produto.',
]);

console.log(JSON.stringify({
  ok: true,
  covered: [
    'route_registry_contract',
    'route_context_forwarding',
    'delivery_order_owner_credentials',
    'customer_tab_owner_credentials',
    'public_customer_routes',
    'permission_by_route',
    'public_table_token',
    'operation_ip_restriction',
    'pin_hash_and_verification',
    'product_publish_lifecycle',
  ],
}, null, 2));
