import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const orderId = `delivery_webhook_idempotency_smoke_${Date.now()}`;

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

const seedCatalog = async () => {
  const db = createClient({ url: dbUrl });
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_webhook_idempotency_smoke', 'Smoke Webhook Idempotency', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_webhook_idempotency_smoke', 'Item Webhook Idempotency Smoke', 'Produto local de teste webhook idempotency', 17, 'cat_webhook_idempotency_smoke', '', 1, 0)
  `);
};

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const checkout = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      name: 'Teste Webhook Idempotency',
      phone: '11999999989',
      email: 'webhook-idempotency@example.com',
      street: 'Rua Idempotency',
      number: '42',
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
    },
    items: [{
      id: `${orderId}_item_1`,
      productId: 'produto_webhook_idempotency_smoke',
      name: 'Item Webhook Idempotency Smoke',
      price: 17,
      quantity: 1,
      selectedModifiers: [],
      notes: 'teste idempotency',
    }],
  }),
});

if (checkout.order.paymentStatus !== 'missing_credentials') {
  fail('Expected checkout to wait for PagBank credentials', checkout.order);
}

const webhookPayload = {
  id: `pagbank_event_${orderId}`,
  reference_id: orderId,
  status: 'PAID',
};

const first = await requestJson('/api/delivery/webhooks/pagbank', {
  method: 'POST',
  body: JSON.stringify(webhookPayload),
});

if (first.status !== 'paid') fail('Expected first webhook paid', first);
if (!first.dispatch?.dispatched) fail('Expected first webhook dispatch', first);

const firstStatus = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`);
const firstExternalId = firstStatus.order.deliveryExternalId;
if (!firstExternalId) fail('Expected first delivery external id', firstStatus.order);

const second = await requestJson('/api/delivery/webhooks/pagbank', {
  method: 'POST',
  body: JSON.stringify(webhookPayload),
});

if (second.status !== 'paid') fail('Expected second webhook paid', second);
if (second.dispatch?.dispatched !== false) fail('Expected second webhook to skip dispatch', second);
if (second.dispatch?.reason !== 'already_dispatched') fail('Expected already_dispatched reason', second);

const secondStatus = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`);
if (secondStatus.order.deliveryExternalId !== firstExternalId) {
  fail('Duplicate webhook changed deliveryExternalId', { firstExternalId, order: secondStatus.order });
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  orderId,
  firstDispatch: first.dispatch.dispatched,
  secondDispatch: second.dispatch.dispatched,
  secondReason: second.dispatch.reason,
  deliveryExternalId: secondStatus.order.deliveryExternalId,
}, null, 2));
