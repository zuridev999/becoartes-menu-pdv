import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const runId = Date.now();
const email = `delivery-fail-closed-${runId}@example.com`;
const phone = `11966${String(runId).slice(-7)}`;
const db = createClient({ url: dbUrl });

const post = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json().catch(() => null) };
};

const forgot = await post('/api/delivery/customer/forgot-password', { identity: email });
assert.equal(forgot.response.status, 503, 'mock providers must fail password recovery closed');
assert.doesNotMatch(JSON.stringify(forgot.payload || {}), /"code"\s*:|codePreview/i, '503 response must not leak a code');

const registration = await post('/api/delivery/customer/register', {
  customer: {
    name: 'Cliente Fail Closed',
    email,
    phone,
    street: 'Rua Segura',
    number: '1',
    neighborhood: 'Centro',
    city: 'Sao Paulo',
    state: 'SP',
    postalCode: '01001000',
  },
  password: 'senha123',
});
assert.equal(registration.response.status, 503, 'mock providers must fail registration closed before writing');
assert.doesNotMatch(JSON.stringify(registration.payload || {}), /"code"\s*:|codePreview/i, 'registration 503 must not leak a code');

const customer = await db.execute({
  sql: "SELECT id FROM delivery_customers WHERE email = ? LIMIT 1",
  args: [email],
});
assert.equal(customer.rows.length, 0, 'fail-closed registration must not leave an orphan account');

console.log(JSON.stringify({
  ok: true,
  mockRecoveryStatus: forgot.response.status,
  mockRegistrationStatus: registration.response.status,
  orphanAccount: false,
  codeLeak: false,
}, null, 2));
