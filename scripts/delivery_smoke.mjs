import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const orderId = `delivery_smoke_${Date.now()}`;

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
  if (!response.ok || !payload?.ok) {
    fail(`Request failed: ${options.method || 'GET'} ${path}`, payload || { status: response.status });
  }
  return payload;
};

const requestJson = async (path, options = {}) => {
  const payload = await requestEnvelope(path, options);
  return payload.data;
};

const seedCatalog = async () => {
  const db = createClient({ url: dbUrl });
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_smoke', 'Smoke', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_smoke', 'Item Smoke', 'Produto local de teste', 10, 'cat_smoke', '', 1, 0)
  `);
};

const health = await requestEnvelope('/api/health');
await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const config = await requestJson('/api/delivery/config');
if (config.mode.paymentProvider !== 'mock') fail('Expected payment provider mock', config);
if (config.mode.kitchenDispatchMode !== 'mock') fail('Expected kitchen dispatch mock', config);

const checkout = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      name: 'Teste Local',
      phone: '11999999999',
      email: 'teste@example.com',
      street: 'Rua Teste',
      number: '123',
      neighborhood: 'Centro',
      city: 'Sao Paulo',
      state: 'SP',
      postalCode: '01001000',
      complement: '',
      notes: '',
      fulfillment: 'delivery',
      paymentMethod: 'pagbank',
      coupon: 'BECO10',
      joinClub: true,
    },
    items: [{
      id: `${orderId}_item_1`,
      productId: 'produto_smoke',
      name: 'Item Smoke',
      price: 10,
      quantity: 2,
      selectedModifiers: [],
      notes: 'sem cebola',
    }],
  }),
});

if (checkout.order.total !== 26) fail('Unexpected checkout total', checkout.order);
if (checkout.order.paymentStatus !== 'paid_mock') fail('Unexpected payment status', checkout.order);
if (checkout.order.kitchenStatus !== 'sent_mock') fail('Unexpected kitchen status', checkout.order);
if (checkout.order.deliveryStatus !== 'requested_mock') fail('Unexpected delivery status', checkout.order);

const status = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`, {
  headers: { 'X-Beco-Delivery-Tracking': checkout.trackingToken },
});
if (status.order.id !== orderId) fail('Status endpoint returned different order', status.order);
if (status.order.items.length !== 1) fail('Status endpoint did not return order items', status.order);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  version: health.version || 'unknown',
  orderId,
  total: checkout.order.total,
  paymentStatus: checkout.order.paymentStatus,
  kitchenStatus: checkout.order.kitchenStatus,
  deliveryStatus: checkout.order.deliveryStatus,
}, null, 2));
