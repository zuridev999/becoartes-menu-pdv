import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const orderId = `delivery_prod_smoke_${Date.now()}`;

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
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_prod_smoke', 'Smoke Production', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_prod_smoke', 'Item Production Smoke', 'Produto local de teste production', 12, 'cat_prod_smoke', '', 1, 0)
  `);
};

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const config = await requestJson('/api/delivery/config');
if (config.mode.kitchenDispatchMode !== 'production') {
  fail('Expected kitchen dispatch production. Start BFF with DELIVERY_KITCHEN_DISPATCH_MODE=production.', config);
}

const checkout = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      name: 'Teste Production',
      phone: '11999999998',
      email: 'production@example.com',
      street: 'Rua Production',
      number: '456',
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
      productId: 'produto_prod_smoke',
      name: 'Item Production Smoke',
      price: 12,
      quantity: 1,
      selectedModifiers: [],
      notes: 'teste production',
    }],
  }),
});

if (checkout.order.kitchenStatus !== 'sent_production') fail('Expected sent_production', checkout.order);

const kitchen = await requestJson('/api/app/init?view=kitchen');
const productionOrderId = `delivery_prod_${orderId}`;
const deliveryTicket = kitchen.kitchenData.orders.find((order) => (
  order.orderId === productionOrderId
  && order.origin === 'delivery'
));

if (!deliveryTicket) fail('Delivery production ticket not found in kitchen snapshot', kitchen.kitchenData.orders);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  orderId,
  productionOrderId,
  ticketId: deliveryTicket.id,
  origin: deliveryTicket.origin,
  kitchenStatus: checkout.order.kitchenStatus,
  deliveryStatus: checkout.order.deliveryStatus,
}, null, 2));
