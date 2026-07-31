import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const orderId = `delivery_ifood_dry_run_smoke_${Date.now()}`;

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
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_ifood_dry_run_smoke', 'Smoke iFood Dry Run', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_ifood_dry_run_smoke', 'Item iFood Dry Run Smoke', 'Produto local de teste iFood dry run', 14, 'cat_ifood_dry_run_smoke', '', 1, 0)
  `);
};

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const config = await requestJson('/api/delivery/config');
if (config.mode.logisticsProvider !== 'ifood') {
  fail('Expected logistics provider ifood. Start BFF with DELIVERY_LOGISTICS_PROVIDER=ifood.', config);
}
if (config.mode.ifoodShippingMode !== 'dry_run') {
  fail('Expected IFOOD_SHIPPING_MODE dry_run.', config);
}

const checkout = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      name: 'Teste iFood Dry Run',
      phone: '11999999994',
      email: 'ifood-dry-run@example.com',
      street: 'Rua iFood Dry Run',
      number: '753',
      neighborhood: 'Centro',
      city: 'Sao Paulo',
      state: 'SP',
      postalCode: '01001000',
      complement: '',
      reference: 'Portao principal',
      notes: '',
      fulfillment: 'delivery',
      paymentMethod: 'pagbank',
      coupon: '',
      joinClub: true,
    },
    items: [{
      id: `${orderId}_item_1`,
      productId: 'produto_ifood_dry_run_smoke',
      name: 'Item iFood Dry Run Smoke',
      price: 14,
      quantity: 1,
      selectedModifiers: [],
      notes: 'teste ifood dry run',
    }],
  }),
});

if (checkout.order.paymentStatus !== 'paid_mock') fail('Expected paymentStatus paid_mock', checkout.order);
if (checkout.order.kitchenStatus !== 'sent_mock') fail('Expected kitchenStatus sent_mock', checkout.order);
if (checkout.order.deliveryStatus !== 'missing_coordinates') fail('Expected deliveryStatus missing_coordinates', checkout.order);
if (checkout.order.deliveryProvider !== 'ifood') fail('Expected deliveryProvider ifood', checkout.order);

const status = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`, {
  headers: { 'X-Beco-Delivery-Tracking': checkout.trackingToken },
});
if (status.order.deliveryStatus !== 'missing_coordinates') fail('Expected persisted missing_coordinates status', status.order);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  orderId,
  paymentStatus: checkout.order.paymentStatus,
  kitchenStatus: checkout.order.kitchenStatus,
  deliveryStatus: checkout.order.deliveryStatus,
  deliveryProvider: checkout.order.deliveryProvider,
}, null, 2));
