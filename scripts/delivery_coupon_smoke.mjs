import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';

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
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_coupon_smoke', 'Cupom Smoke', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_coupon_smoke', 'Item Cupom Smoke', 'Produto local de teste cupom', 120, 'cat_coupon_smoke', '', 1, 0)
  `);
};

const baseCustomer = {
  name: 'Teste Cupom',
  phone: '11999999996',
  email: 'cupom@example.com',
  street: 'Rua Cupom',
  number: '101',
  neighborhood: 'Centro',
  city: 'Sao Paulo',
  state: 'SP',
  postalCode: '01001000',
  complement: '',
  reference: '',
  fulfillment: 'delivery',
  paymentMethod: 'pagbank',
  joinClub: true,
};

const items = [{
  id: 'coupon_item_1',
  productId: 'produto_coupon_smoke',
  name: 'Item Cupom Smoke',
  price: 120,
  quantity: 1,
  selectedModifiers: [],
  notes: '',
}];

await seedCatalog();

const config = await requestJson('/api/delivery/config');
if (!Array.isArray(config.coupons) || !config.coupons.find((coupon) => coupon.code === 'BECO10')) {
  fail('Expected BECO10 in public delivery coupon config', config);
}

const percentOrderId = `delivery_coupon_percent_${Date.now()}`;
const percent = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId: percentOrderId,
    customer: { ...baseCustomer, coupon: 'beco10' },
    items,
  }),
});

if (percent.order.discount !== 12) fail('Expected 10% BECO10 discount on subtotal 120', percent.order);
if (percent.order.total !== 116) fail('Expected total 116 with fee 8 and discount 12', percent.order);
if (percent.order.couponCode !== 'BECO10') fail('Expected normalized coupon code BECO10', percent.order);

const capOrderId = `delivery_coupon_cap_${Date.now()}`;
const cap = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId: capOrderId,
    customer: { ...baseCustomer, phone: '11999999997', email: 'cupom-cap@example.com', coupon: 'BECO10' },
    items: [{ ...items[0], id: 'coupon_item_2', price: 500 }],
  }),
});

if (cap.order.discount !== 30) fail('Expected BECO10 max discount cap 30', cap.order);
if (cap.order.total !== 478) fail('Expected total 478 with fee 8 and cap 30', cap.order);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  coupons: config.coupons.map((coupon) => coupon.code),
  percentDiscount: percent.order.discount,
  cappedDiscount: cap.order.discount,
}, null, 2));
