import { createHash } from 'node:crypto';
import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const runId = Date.now();
const db = createClient({ url: dbUrl });

const fail = (message, details = null) => {
  console.error(message);
  if (details) console.error(JSON.stringify(details, null, 2));
  process.exit(1);
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    fail(`Request failed: ${options.method || 'GET'} ${path}`, payload || { status: response.status });
  }
  return payload.data;
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

const legacyPasswordHash = (password, salt) => {
  const hash = createHash('sha256').update(`${salt}:${password}:becoartes_delivery_2026`).digest('hex');
  return `${salt}:${hash}`;
};

await requestJson('/api/app/init?view=delivery');

const registered = await requestJson('/api/delivery/customer/register', {
  method: 'POST',
  body: JSON.stringify({ customer, password: 'senha123' }),
});
if (!registered.session?.token) fail('Expected session token on register', registered);
if (!registered.verification?.code) fail('Expected mock verification code', registered);
const registeredHash = await getCustomerPasswordHash(customer.email);
if (!registeredHash.startsWith('scrypt:')) fail('Expected new delivery customer password to use scrypt hash', { passwordHashPrefix: registeredHash.slice(0, 12) });

const verified = await requestJson('/api/delivery/customer/verify-code', {
  method: 'POST',
  body: JSON.stringify({ token: registered.session.token, code: registered.verification.code }),
});
if (!verified.customer.emailVerified || !verified.customer.phoneVerified) fail('Expected verified customer', verified);

const logged = await requestJson('/api/delivery/customer/login', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email, password: 'senha123' }),
});
if (!logged.session?.token) fail('Expected session token on login', logged);

const session = await requestJson('/api/delivery/customer/session', {
  headers: { 'X-Beco-Delivery-Session': logged.session.token },
});
if (session.customer?.email !== customer.email) fail('Expected current customer session', session);

const forgot = await requestJson('/api/delivery/customer/forgot-password', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email }),
});
if (!forgot.code) fail('Expected mock reset code', forgot);

const reset = await requestJson('/api/delivery/customer/reset-password', {
  method: 'POST',
  body: JSON.stringify({ identity: customer.email, code: forgot.code, password: 'nova123' }),
});
if (!reset.session?.token) fail('Expected session token after reset', reset);

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
    INSERT INTO delivery_customers (id, name, phone, email, street, number, neighborhood, city, state, postal_code, join_club, password_hash)
    VALUES (?, ?, ?, ?, 'Rua Legacy', '20', 'Centro', 'Sao Paulo', 'SP', '01001000', 1, ?)
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

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  customerId: reset.customer.id,
  emailVerified: reset.customer.emailVerified,
  phoneVerified: reset.customer.phoneVerified,
  orders: orders.orders.length,
  passwordHash: 'scrypt',
  legacyRehash: 'scrypt',
}, null, 2));
