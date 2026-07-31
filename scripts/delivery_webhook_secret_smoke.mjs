import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const expectedSecret = process.env.DELIVERY_WEBHOOK_SECRET || '';
const orderId = `delivery_webhook_secret_smoke_${Date.now()}`;

const fail = (message, details = null) => {
  console.error(message);
  if (details) console.error(JSON.stringify(details, null, 2));
  process.exit(1);
};

const requestEnvelope = async (path, options = {}) => {
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
  const { response, payload } = await requestEnvelope(path, options);
  if (!response.ok || !payload?.ok) {
    fail(`Request failed: ${options.method || 'GET'} ${path}`, payload || { status: response.status });
  }
  return payload.data;
};

const seedCatalog = async () => {
  const db = createClient({ url: dbUrl });
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_webhook_secret_smoke', 'Smoke Webhook Secret', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_webhook_secret_smoke', 'Item Webhook Secret Smoke', 'Produto local de teste webhook secret', 11, 'cat_webhook_secret_smoke', '', 1, 0)
  `);
};

if (!expectedSecret) {
  fail('Expected DELIVERY_WEBHOOK_SECRET to be set for this smoke.');
}

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const config = await requestJson('/api/delivery/config');
if (config.mode.paymentProvider !== 'pagbank') {
  fail('Expected payment provider pagbank. Start BFF with DELIVERY_PAYMENT_PROVIDER=pagbank.', config);
}
if (config.webhookSecretEnabled !== true) {
  fail('Expected webhookSecretEnabled true. Start BFF with DELIVERY_WEBHOOK_SECRET.', config);
}

const checkout = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      name: 'Teste Webhook Secret',
      phone: '11999999995',
      email: 'webhook-secret@example.com',
      street: 'Rua Webhook Secret',
      number: '159',
      neighborhood: 'Centro',
      city: 'Sao Paulo',
      state: 'SP',
      postalCode: '01001000',
      complement: '',
      notes: '',
      fulfillment: 'delivery',
      paymentMethod: 'pagbank',
      coupon: '',
      joinClub: true,
    },
    items: [{
      id: `${orderId}_item_1`,
      productId: 'produto_webhook_secret_smoke',
      name: 'Item Webhook Secret Smoke',
      price: 11,
      quantity: 1,
      selectedModifiers: [],
      notes: 'teste webhook secret',
    }],
  }),
});

if (checkout.order.paymentStatus !== 'missing_credentials') {
  fail('Expected checkout to wait for PagBank credentials', checkout.order);
}

const eventPayload = {
  id: `pagbank_event_${orderId}`,
  reference_id: orderId,
  status: 'PAID',
};

const unauthorized = await requestEnvelope('/api/delivery/webhooks/pagbank', {
  method: 'POST',
  headers: { 'x-beco-delivery-secret': 'wrong-smoke-secret' },
  body: JSON.stringify(eventPayload),
});

if (unauthorized.response.status !== 401 || unauthorized.payload?.ok !== false) {
  fail('Expected webhook with wrong secret to be rejected with 401', {
    status: unauthorized.response.status,
    payload: unauthorized.payload,
  });
}

const stillPending = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`, {
  headers: { 'X-Beco-Delivery-Tracking': checkout.trackingToken },
});
if (stillPending.order.paymentStatus !== 'missing_credentials') {
  fail('Unauthorized webhook changed payment status', stillPending.order);
}
if (stillPending.order.kitchenStatus !== 'waiting_payment') {
  fail('Unauthorized webhook changed kitchen status', stillPending.order);
}

const authorized = await requestJson('/api/delivery/webhooks/pagbank', {
  method: 'POST',
  headers: { 'x-beco-delivery-secret': expectedSecret },
  body: JSON.stringify(eventPayload),
});

if (authorized.status !== 'paid') fail('Expected authorized webhook status paid', authorized);
if (!authorized.dispatch?.dispatched) fail('Expected authorized webhook dispatch to run', authorized);

const status = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`, {
  headers: { 'X-Beco-Delivery-Tracking': checkout.trackingToken },
});
if (status.order.paymentStatus !== 'paid') fail('Expected paymentStatus paid after authorized webhook', status.order);
if (status.order.kitchenStatus !== 'sent_mock') fail('Expected kitchenStatus sent_mock after authorized webhook', status.order);
if (status.order.deliveryStatus !== 'requested_mock') fail('Expected deliveryStatus requested_mock after authorized webhook', status.order);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  orderId,
  rejectedStatus: unauthorized.response.status,
  webhookStatus: authorized.status,
  kitchenStatus: status.order.kitchenStatus,
  deliveryStatus: status.order.deliveryStatus,
}, null, 2));
