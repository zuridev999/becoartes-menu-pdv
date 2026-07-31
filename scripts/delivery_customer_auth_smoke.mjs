import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const webhookPort = Number(process.env.DELIVERY_AUTH_SMOKE_WEBHOOK_PORT || 19091);
const runId = Date.now();
const db = createClient({ url: dbUrl });
const received = [];

const webhook = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    received.push(JSON.parse(body || '{}'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});

await new Promise((resolve) => webhook.listen(webhookPort, '127.0.0.1', resolve));

const fail = (message, details = null) => {
  console.error(message);
  if (details) console.error(JSON.stringify(details, null, 2));
  webhook.close();
  process.exit(1);
};

const requestRaw = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
};

const requestJson = async (path, options = {}) => {
  const result = await requestRaw(path, options);
  if (!result.response.ok || !result.payload?.ok) {
    fail(`Request failed: ${options.method || 'GET'} ${path}`, result.payload || { status: result.response.status });
  }
  return result.payload.data;
};

const assertNoCodeInResponse = (label, value) => {
  const serialized = JSON.stringify(value || {});
  if (/"code"\s*:|"codePreview"\s*:/i.test(serialized)) {
    fail(`${label} leaked a recovery/verification code`, value);
  }
};

const latestWebhookCode = (type) => {
  const event = [...received].reverse().find((entry) => entry.type === type);
  const match = String(event?.message || '').match(/\b(\d{6})\b/);
  if (!match) fail(`Expected ${type} code at the external webhook`, event || received);
  return match[1];
};

const customer = {
  name: 'Cliente Auth Smoke',
  phone: `11988${String(runId).slice(-7)}`,
  email: `delivery-auth-${runId}@example.com`,
  street: 'Rua Auth',
  number: '10',
  neighborhood: 'Centro',
  city: 'Sao Paulo',
  state: 'SP',
  postalCode: '01001000',
  complement: '',
  reference: '',
  notes: '',
  fulfillment: 'delivery',
  paymentMethod: 'pagbank',
  coupon: '',
  joinClub: true,
};

const getCustomerPasswordHash = async (email) => {
  const res = await db.execute({
    sql: "SELECT password_hash FROM delivery_customers WHERE email = ? LIMIT 1",
    args: [email],
  });
  return String(res.rows[0]?.password_hash || '');
};

const latestPersistedNotification = async (customerId, type) => {
  const res = await db.execute({
    sql: "SELECT payload FROM delivery_notifications WHERE customer_id = ? AND type = ? ORDER BY rowid DESC LIMIT 1",
    args: [customerId, type],
  });
  return String(res.rows[0]?.payload || '');
};

const legacyPasswordHash = (password, salt) => {
  const hash = createHash('sha256').update(`${salt}:${password}:becoartes_delivery_2026`).digest('hex');
  return `${salt}:${hash}`;
};

await requestJson('/api/app/init?view=delivery');

const registered = await requestJson('/api/delivery/customer/register', {
  method: 'POST',
  body: JSON.stringify({ customer, password: 'senha123' }),
});
assertNoCodeInResponse('register', registered);
if (registered.session) fail('Registration must not create a privileged session before verification', registered);
const verificationCode = latestWebhookCode('verify_account');
const registeredHash = await getCustomerPasswordHash(customer.email);
if (!registeredHash.startsWith('scrypt:')) fail('Expected new delivery customer password to use scrypt hash', { passwordHashPrefix: registeredHash.slice(0, 12) });

const persistedVerification = await latestPersistedNotification(registered.customer.id, 'verify_account');
if (persistedVerification.includes(verificationCode) || /codePreview/i.test(persistedVerification)) {
  fail('Persisted verification notification must redact the code', persistedVerification);
}

const duplicateEmail = await requestRaw('/api/delivery/customer/register', {
  method: 'POST',
  body: JSON.stringify({
    customer: { ...customer, phone: `11877${String(runId).slice(-7)}` },
    password: 'invasor-email',
  }),
});
if (duplicateEmail.response.status !== 409) fail('Duplicate email must return 409', duplicateEmail.payload);
assertNoCodeInResponse('duplicate email', duplicateEmail.payload);
if (await getCustomerPasswordHash(customer.email) !== registeredHash) fail('Duplicate email changed the existing password hash');

const duplicatePhone = await requestRaw('/api/delivery/customer/register', {
  method: 'POST',
  body: JSON.stringify({
    customer: { ...customer, email: `delivery-other-${runId}@example.com` },
    password: 'invasor-phone',
  }),
});
if (duplicatePhone.response.status !== 409) fail('Duplicate phone must return 409', duplicatePhone.payload);
assertNoCodeInResponse('duplicate phone', duplicatePhone.payload);
if (await getCustomerPasswordHash(customer.email) !== registeredHash) fail('Duplicate phone changed the existing password hash');

const verified = await requestJson('/api/delivery/customer/verify-code', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email, code: verificationCode }),
});
if (!verified.customer.emailVerified || !verified.customer.phoneVerified) fail('Expected verified customer', verified);
if (!verified.session?.token) fail('Verification must create the first customer session', verified);

const reusedVerification = await requestRaw('/api/delivery/customer/verify-code', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email, code: verificationCode }),
});
if (reusedVerification.response.status !== 400) fail('Verification code must be single-use', reusedVerification.payload);

const logged = await requestJson('/api/delivery/customer/login', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email, password: 'senha123' }),
});
if (!logged.session?.token) fail('Expected session token on login', logged);
const sessionRemainingMs = Date.parse(String(logged.session.expiresAt || '')) - Date.now();
if (
  !Number.isFinite(sessionRemainingMs)
  || sessionRemainingMs <= 0
  || sessionRemainingMs > 15 * 24 * 60 * 60 * 1000
) {
  fail('Customer session must expire within the configured 14-day window', {
    expiresAt: logged.session.expiresAt || null,
  });
}

const session = await requestJson('/api/delivery/customer/session', {
  headers: { 'X-Beco-Delivery-Session': logged.session.token },
});
if (session.customer?.email !== customer.email) fail('Expected current customer session', session);

const forgotExisting = await requestJson('/api/delivery/customer/forgot-password', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email }),
});
assertNoCodeInResponse('forgot existing', forgotExisting);
const firstResetCode = latestWebhookCode('reset_password');

const forgotMissing = await requestJson('/api/delivery/customer/forgot-password', {
  method: 'POST',
  body: JSON.stringify({ identity: `missing-${runId}@example.com` }),
});
assertNoCodeInResponse('forgot missing', forgotMissing);
if (JSON.stringify(forgotExisting) !== JSON.stringify(forgotMissing)) {
  fail('Forgot-password response must not reveal whether the account exists', { forgotExisting, forgotMissing });
}

let secondResetCode = firstResetCode;
for (let retry = 0; retry < 5 && secondResetCode === firstResetCode; retry += 1) {
  await requestJson('/api/delivery/customer/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ identity: customer.email }),
  });
  secondResetCode = latestWebhookCode('reset_password');
}
if (secondResetCode === firstResetCode) fail('Expected a fresh reset code after repeated generation');

const invalidatedReset = await requestRaw('/api/delivery/customer/reset-password', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email, code: firstResetCode, password: 'nao-deve-salvar' }),
});
if (invalidatedReset.response.status !== 400) fail('A new reset code must invalidate the previous code', invalidatedReset.payload);

const reset = await requestJson('/api/delivery/customer/reset-password', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email, code: secondResetCode, password: 'nova123' }),
});
assertNoCodeInResponse('reset', reset);
if (!reset.session?.token) fail('Expected session token after reset', reset);
const revokedSession = await requestJson('/api/delivery/customer/session', {
  headers: { 'X-Beco-Delivery-Session': logged.session.token },
});
if (revokedSession.customer) fail('Password reset must revoke every previous customer session', revokedSession);

const reusedReset = await requestRaw('/api/delivery/customer/reset-password', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email, code: secondResetCode, password: 'replay123' }),
});
if (reusedReset.response.status !== 400) fail('Reset code must be single-use', reusedReset.payload);

await requestJson('/api/delivery/customer/forgot-password', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email }),
});
const expiredResetCode = latestWebhookCode('reset_password');
await db.execute({
  sql: "UPDATE delivery_customers SET reset_code_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
  args: [registered.customer.id],
});
const expiredReset = await requestRaw('/api/delivery/customer/reset-password', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email, code: expiredResetCode, password: 'expirado123' }),
});
if (expiredReset.response.status !== 400) fail('Expired reset code must be rejected', expiredReset.payload);

let rateLimited = false;
for (let attempt = 0; attempt < 8; attempt += 1) {
  const response = await requestRaw('/api/delivery/customer/reset-password', {
    method: 'POST',
    body: JSON.stringify({ identity: customer.email, code: '000000', password: 'tentativa123' }),
  });
  if (response.response.status === 429) {
    rateLimited = true;
    break;
  }
}
if (!rateLimited) fail('Excessive reset attempts must be rate limited');

const orders = await requestJson('/api/delivery/customer/orders', {
  headers: { 'X-Beco-Delivery-Session': reset.session.token },
});
if (!Array.isArray(orders.orders)) fail('Expected orders array', orders);

const legacyCustomer = {
  id: `legacy_auth_${runId}`,
  name: 'Cliente Legacy Auth',
  phone: `11977${String(runId).slice(-7)}`,
  email: `delivery-auth-legacy-${runId}@example.com`,
};
await db.execute({
  sql: `
    INSERT INTO delivery_customers (id, name, phone, email, street, number, neighborhood, city, state, postal_code, join_club, password_hash, email_verified)
    VALUES (?, ?, ?, ?, 'Rua Legacy', '20', 'Centro', 'Sao Paulo', 'SP', '01001000', 1, ?, 1)
  `,
  args: [legacyCustomer.id, legacyCustomer.name, legacyCustomer.phone, legacyCustomer.email, legacyPasswordHash('legacy123', `legacy_salt_${runId}`)],
});
const legacyBeforeHash = await getCustomerPasswordHash(legacyCustomer.email);
if (legacyBeforeHash.startsWith('scrypt:')) fail('Legacy smoke setup should start with legacy hash', { passwordHashPrefix: legacyBeforeHash.slice(0, 12) });

const legacyLogin = await requestJson('/api/delivery/customer/login', {
  method: 'POST',
  body: JSON.stringify({ identity: legacyCustomer.email, password: 'legacy123' }),
});
if (!legacyLogin.session?.token) fail('Expected legacy customer session token on login', legacyLogin);
const legacyAfterHash = await getCustomerPasswordHash(legacyCustomer.email);
if (!legacyAfterHash.startsWith('scrypt:')) fail('Expected legacy delivery password to be rehashed to scrypt after login', { passwordHashPrefix: legacyAfterHash.slice(0, 12) });

webhook.close();
console.log(JSON.stringify({
  ok: true,
  baseUrl,
  customerId: reset.customer.id,
  emailVerified: reset.customer.emailVerified,
  phoneVerified: reset.customer.phoneVerified,
  orders: orders.orders.length,
  duplicateIdentityBlocked: true,
  responseCodeLeak: false,
  persistedCodeLeak: false,
  resetReplayBlocked: true,
  resetRateLimited: true,
  passwordHash: 'scrypt',
  legacyRehash: 'scrypt',
}, null, 2));
