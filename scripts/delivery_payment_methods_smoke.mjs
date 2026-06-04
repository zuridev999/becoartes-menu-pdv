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
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_payment_methods_smoke', 'Payment Methods Smoke', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_payment_methods_smoke', 'Item Payment Methods Smoke', 'Produto local de teste pagamentos delivery', 13, 'cat_payment_methods_smoke', '', 1, 0)
  `);
};

const baseCustomer = {
  name: 'Teste Pagamento Delivery',
  phone: '11999999987',
  email: `payment-methods-${runId}@example.com`,
  street: 'Rua Pagamentos',
  number: '13',
  neighborhood: 'Centro',
  city: 'Sao Paulo',
  state: 'SP',
  postalCode: '01001000',
  complement: '',
  reference: '',
  notes: '',
  fulfillment: 'delivery',
  coupon: '',
  joinClub: true,
};

const items = [{
  id: `delivery_payment_methods_${runId}_item_1`,
  productId: 'produto_payment_methods_smoke',
  name: 'Item Payment Methods Smoke',
  price: 13,
  quantity: 1,
  selectedModifiers: [],
  notes: '',
}];

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const pixOrderId = `delivery_payment_methods_${runId}_pix`;
const pix = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId: pixOrderId,
    customer: { ...baseCustomer, paymentMethod: 'pix' },
    items,
  }),
});

if (pix.order.paymentStatus !== 'missing_credentials') fail('Expected PagBank missing credentials for pix checkout', pix.order);
if (pix.order.customer.paymentMethod !== 'pix') fail('Expected persisted pix payment method', pix.order);

const unauthorizedConfirm = await fetch(`${baseUrl}/api/delivery/payment/confirm`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ orderId: pixOrderId }),
});
if (![403, 404].includes(unauthorizedConfirm.status)) {
  fail('Expected removed manual payment confirm route to be unavailable', { status: unauthorizedConfirm.status });
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  pixPaymentStatus: pix.order.paymentStatus,
  pixPaymentMethod: pix.order.customer.paymentMethod,
  manualConfirmRouteStatus: unauthorizedConfirm.status,
}, null, 2));
