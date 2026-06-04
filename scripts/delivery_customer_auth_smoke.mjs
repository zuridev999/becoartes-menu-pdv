const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const runId = Date.now();

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

await requestJson('/api/app/init?view=delivery');

const registered = await requestJson('/api/delivery/customer/register', {
  method: 'POST',
  body: JSON.stringify({ customer, password: 'senha123' }),
});
if (!registered.session?.token) fail('Expected session token on register', registered);
if (!registered.verification?.code) fail('Expected mock verification code', registered);

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

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  customerId: reset.customer.id,
  emailVerified: reset.customer.emailVerified,
  phoneVerified: reset.customer.phoneVerified,
  orders: orders.orders.length,
}, null, 2));
