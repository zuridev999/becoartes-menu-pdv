import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const orderId = `delivery_pickup_smoke_${Date.now()}`;

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
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_pickup_smoke', 'Smoke Pickup', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_pickup_smoke', 'Item Pickup Smoke', 'Produto local de teste retirada', 21, 'cat_pickup_smoke', '', 1, 0)
  `);
};

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const quote = await requestJson('/api/delivery/quote', {
  method: 'POST',
  body: JSON.stringify({
    customer: {
      name: 'Teste Retirada',
      phone: '11999999991',
      email: 'pickup@example.com',
      street: '',
      number: '',
      neighborhood: '',
      city: '',
      state: '',
      postalCode: '',
      complement: '',
      reference: '',
      fulfillment: 'pickup',
      paymentMethod: 'pagbank',
      coupon: '',
      joinClub: true,
    },
    items: [{
      id: `${orderId}_item_1`,
      productId: 'produto_pickup_smoke',
      name: 'Item Pickup Smoke',
      price: 21,
      quantity: 1,
      selectedModifiers: [],
      notes: 'retirada no balcao',
    }],
  }),
});

if (quote.quote.status !== 'not_required_pickup') fail('Expected pickup quote not_required_pickup', quote);
if (quote.quote.deliveryFee !== 0) fail('Expected pickup deliveryFee 0', quote);

const checkout = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      name: 'Teste Retirada',
      phone: '11999999991',
      email: 'pickup@example.com',
      street: '',
      number: '',
      neighborhood: '',
      city: '',
      state: '',
      postalCode: '',
      complement: '',
      reference: '',
      notes: '',
      fulfillment: 'pickup',
      paymentMethod: 'pagbank',
      coupon: '',
      joinClub: true,
    },
    items: [{
      id: `${orderId}_item_1`,
      productId: 'produto_pickup_smoke',
      name: 'Item Pickup Smoke',
      price: 21,
      quantity: 1,
      selectedModifiers: [],
      notes: 'retirada no balcao',
    }],
  }),
});

if (checkout.order.total !== 21) fail('Unexpected pickup total', checkout.order);
if (checkout.order.deliveryFee !== 0) fail('Expected pickup delivery fee 0', checkout.order);
if (checkout.order.paymentStatus !== 'paid_mock') fail('Expected pickup paymentStatus paid_mock', checkout.order);
if (checkout.order.kitchenStatus !== 'sent_mock') fail('Expected pickup kitchenStatus sent_mock', checkout.order);
if (checkout.order.deliveryStatus !== 'not_required_pickup') fail('Expected pickup deliveryStatus not_required_pickup', checkout.order);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  orderId,
  total: checkout.order.total,
  deliveryFee: checkout.order.deliveryFee,
  paymentStatus: checkout.order.paymentStatus,
  kitchenStatus: checkout.order.kitchenStatus,
  deliveryStatus: checkout.order.deliveryStatus,
}, null, 2));
