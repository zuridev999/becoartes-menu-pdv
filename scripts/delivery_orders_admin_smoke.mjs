import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const adminPin = process.env.DELIVERY_SMOKE_ADMIN_PIN || process.env.ADMIN_BYPASS_PIN;
const orderId = `delivery_admin_list_${Date.now()}`;

const fail = (message, details = null) => {
  console.error(message);
  if (details) console.error(JSON.stringify(details, null, 2));
  process.exit(1);
};

if (!adminPin) {
  fail('Missing DELIVERY_SMOKE_ADMIN_PIN or ADMIN_BYPASS_PIN for delivery admin smoke.');
}

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
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_delivery_admin_smoke', 'Delivery Admin Smoke', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_delivery_admin_smoke', 'Item Delivery Admin Smoke', 'Produto local de teste admin delivery', 19, 'cat_delivery_admin_smoke', '', 1, 0)
  `);
};

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      name: 'Teste Admin Delivery',
      phone: '11999999998',
      email: 'admin-delivery@example.com',
      street: 'Rua Admin Delivery',
      number: '321',
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
      id: 'delivery_admin_item_1',
      productId: 'produto_delivery_admin_smoke',
      name: 'Item Delivery Admin Smoke',
      price: 19,
      quantity: 1,
      selectedModifiers: [],
      notes: '',
    }],
  }),
});

const unauthorized = await fetch(`${baseUrl}/api/delivery/orders?limit=5`, {
  headers: { 'content-type': 'application/json' },
});
if (unauthorized.status !== 401) {
  fail('Expected delivery orders route to require auth session', { status: unauthorized.status });
}

const login = await requestJson('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ pin: adminPin }),
});
if (!login.sessionToken) fail('Expected admin login session token', login);

const list = await requestJson('/api/delivery/orders?limit=20', {
  headers: { 'X-Beco-Session': login.sessionToken },
});
const order = list.orders?.find((item) => item.orderId === orderId);
if (!order) fail('Expected created delivery order in admin list', list);
if (order.paymentStatus !== 'paid_mock') fail('Expected paid_mock status in admin list', order);
if (order.kitchenStatus !== 'sent_mock') fail('Expected kitchen sent_mock status in admin list', order);
if (order.deliveryStatus !== 'requested_mock') fail('Expected delivery requested_mock status in admin list', order);

const publicStatus = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`);
if (publicStatus.order.events) fail('Public delivery order status must not expose internal events', publicStatus.order);

const unauthorizedDetail = await fetch(`${baseUrl}/api/delivery/order-detail?orderId=${encodeURIComponent(orderId)}`, {
  headers: { 'content-type': 'application/json' },
});
if (unauthorizedDetail.status !== 401) {
  fail('Expected delivery detail route to require auth session', { status: unauthorizedDetail.status });
}

const detail = await requestJson(`/api/delivery/order-detail?orderId=${encodeURIComponent(orderId)}`, {
  headers: { 'X-Beco-Session': login.sessionToken },
});
if (!Array.isArray(detail.order.events) || detail.order.events.length < 3) {
  fail('Expected operational delivery detail to include events', detail.order);
}
if (!detail.order.events.some((event) => event.type === 'payment')) fail('Expected payment event in delivery detail', detail.order.events);
if (!detail.order.events.some((event) => event.type === 'kitchen')) fail('Expected kitchen event in delivery detail', detail.order.events);
if (!detail.order.events.some((event) => event.type === 'delivery')) fail('Expected delivery event in delivery detail', detail.order.events);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  orderId,
  listed: list.orders.length,
  paymentStatus: order.paymentStatus,
  kitchenStatus: order.kitchenStatus,
  deliveryStatus: order.deliveryStatus,
  eventCount: detail.order.events.length,
}, null, 2));
