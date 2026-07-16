import assert from 'node:assert/strict';
import {
  createAccessGuards,
  createRouteAccessEnforcer,
  PERMISSION_BY_ROUTE,
} from '../server/routes/access-policy.mjs';
import { createRouteHandlers } from '../server/routes/handlers.mjs';
import { hashPin, normalizeStoredPin, verifyPin } from '../server/auth/pins.mjs';

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

assert.equal(Object.keys(handlers).length, 83, 'route registry lost or duplicated operational endpoints');
for (const route of [
  'GET /api/app/init',
  'POST /api/orders/send-to-kitchen',
  'POST /api/bills/close',
  'POST /api/counter-sales/close',
  'POST /api/delivery/checkout',
  'POST /api/catalog/product/delete',
  'POST /api/catalog/product/cmv',
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

console.log(JSON.stringify({
  ok: true,
  covered: [
    'route_registry_contract',
    'route_context_forwarding',
    'public_customer_routes',
    'permission_by_route',
    'public_table_token',
    'operation_ip_restriction',
    'pin_hash_and_verification',
  ],
}, null, 2));
