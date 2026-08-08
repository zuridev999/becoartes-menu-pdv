import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
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

const seedCatalog = async () => {
  const db = createClient({ url: dbUrl });
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_club_smoke', 'Smoke Club', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_club_smoke', 'Item Club Smoke', 'Produto local de teste clube', 9, 'cat_club_smoke', '', 1, 0)
  `);
};

const createOrder = async (suffix) => requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId: `delivery_club_smoke_${runId}_${suffix}`,
    customer: {
      name: 'Teste Clube',
      phone: '11999999990',
      email: `club-${runId}@example.com`,
      street: 'Rua Clube',
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
    },
    items: [{
      id: `delivery_club_smoke_${runId}_${suffix}_item_1`,
      productId: 'produto_club_smoke',
      name: 'Item Club Smoke',
      price: 9,
      quantity: 1,
      selectedModifiers: [],
      notes: 'teste clube',
    }],
  }),
});

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const first = await createOrder('one');
if (!first.order.club?.enrolled) fail('Expected first order enrolled in club', first.order);
if (first.order.club.paidOrders !== 1) fail('Expected first paidOrders 1', first.order.club);
if (first.order.club.cycleSize !== 10) fail('Expected default cycle size 10', first.order.club);
if (first.order.club.remainingToReward !== 9) fail('Expected first remaining 9', first.order.club);
if (first.order.club.rewardLabel !== '1 prato gratuito') fail('Expected default reward label', first.order.club);

const second = await createOrder('two');
if (!second.order.club?.enrolled) fail('Expected second order enrolled in club', second.order);
if (second.order.club.paidOrders !== 2) fail('Expected second paidOrders 2', second.order.club);
if (second.order.club.remainingToReward !== 8) fail('Expected second remaining 8', second.order.club);

const status = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(second.order.orderId)}`, {
  headers: { 'X-Beco-Delivery-Tracking': second.trackingToken },
});
if (status.order.club?.paidOrders !== 2) fail('Expected status club paidOrders 2', status.order);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  firstOrderId: first.order.orderId,
  secondOrderId: second.order.orderId,
  paidOrders: second.order.club.paidOrders,
  remainingToReward: second.order.club.remainingToReward,
}, null, 2));
