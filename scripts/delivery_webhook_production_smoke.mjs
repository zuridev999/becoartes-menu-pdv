import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const orderId = `delivery_webhook_prod_smoke_${Date.now()}`;

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
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_webhook_prod_smoke', 'Smoke Webhook Production', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_webhook_prod_smoke', 'Item Webhook Production Smoke', 'Produto local de teste webhook production', 18, 'cat_webhook_prod_smoke', '', 1, 0)
  `);
};

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const config = await requestJson('/api/delivery/config');
if (config.mode.paymentProvider !== 'pagbank') {
  fail('Expected payment provider pagbank. Start BFF with DELIVERY_PAYMENT_PROVIDER=pagbank.', config);
}
if (config.mode.kitchenDispatchMode !== 'production') {
  fail('Expected kitchen dispatch production. Start BFF with DELIVERY_KITCHEN_DISPATCH_MODE=production.', config);
}
if (config.mode.paymentReady !== false) {
  fail('Expected paymentReady false without PAGBANK_TOKEN.', config);
}

const checkout = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      name: 'Teste Webhook Production',
      phone: '11999999996',
      email: 'webhook-production@example.com',
      street: 'Rua Webhook Production',
      number: '321',
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
      productId: 'produto_webhook_prod_smoke',
      name: 'Item Webhook Production Smoke',
      price: 18,
      quantity: 1,
      selectedModifiers: [],
      notes: 'teste webhook production',
    }],
  }),
});

if (checkout.order.paymentStatus !== 'missing_credentials') {
  fail('Expected checkout to wait for PagBank credentials', checkout.order);
}
if (checkout.order.kitchenStatus !== 'waiting_payment') {
  fail('Expected kitchen waiting payment before webhook', checkout.order);
}
if (checkout.order.deliveryStatus !== 'waiting_payment') {
  fail('Expected delivery waiting payment before webhook', checkout.order);
}

const webhook = await requestJson('/api/delivery/webhooks/pagbank', {
  method: 'POST',
  body: JSON.stringify({
    id: `pagbank_event_${orderId}`,
    reference_id: orderId,
    status: 'PAID',
  }),
});

if (webhook.status !== 'paid') fail('Expected webhook status paid', webhook);
if (!webhook.dispatch?.dispatched) fail('Expected webhook dispatch to run', webhook);
if (webhook.dispatch.kitchenStatus !== 'sent_production') fail('Expected production kitchen dispatch from webhook', webhook);
if (webhook.dispatch.deliveryStatus !== 'requested_mock') fail('Expected logistics request from same webhook dispatch', webhook);

const status = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`, {
  headers: { 'X-Beco-Delivery-Tracking': checkout.trackingToken },
});
if (status.order.paymentStatus !== 'paid') fail('Expected order paymentStatus paid', status.order);
if (status.order.kitchenStatus !== 'sent_production') fail('Expected order kitchenStatus sent_production', status.order);
if (status.order.deliveryStatus !== 'requested_mock') fail('Expected order deliveryStatus requested_mock', status.order);
if (!status.order.kitchenSentAt) fail('Expected kitchenSentAt after paid webhook', status.order);
if (!status.order.deliveryRequestedAt) fail('Expected deliveryRequestedAt after paid webhook', status.order);

const kitchen = await requestJson('/api/app/init?view=kitchen');
const productionOrderId = `delivery_prod_${orderId}`;
const deliveryTicket = kitchen.kitchenData.orders.find((order) => (
  order.orderId === productionOrderId
  && order.origin === 'delivery'
));

if (!deliveryTicket) fail('Delivery production ticket not found in kitchen snapshot after webhook', kitchen.kitchenData.orders);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  orderId,
  productionOrderId,
  ticketId: deliveryTicket.id,
  origin: deliveryTicket.origin,
  webhookStatus: webhook.status,
  kitchenStatus: status.order.kitchenStatus,
  deliveryStatus: status.order.deliveryStatus,
}, null, 2));
