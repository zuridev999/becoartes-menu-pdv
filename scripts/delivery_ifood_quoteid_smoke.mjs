import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const orderId = `delivery_ifood_quoteid_smoke_${Date.now()}`;

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
  await db.execute("INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_ifood_quoteid_smoke', 'iFood Quote Smoke', 1, 1)");
  await db.execute(`
    INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost)
    VALUES ('produto_ifood_quoteid_smoke', 'Item iFood Quote Smoke', 'Produto local de teste iFood quoteId', 16, 'cat_ifood_quoteid_smoke', '', 1, 0)
  `);
};

await requestJson('/api/app/init?view=delivery');
await seedCatalog();

const customer = {
  name: 'Teste iFood Quote',
  phone: '11999999988',
  email: 'ifood-quote@example.com',
  street: 'Rua iFood Quote',
  number: '88',
  neighborhood: 'Centro',
  city: 'Sao Paulo',
  state: 'SP',
  postalCode: '01001000',
  complement: '',
  reference: 'Porta vermelha',
  notes: '',
  fulfillment: 'delivery',
  paymentMethod: 'pagbank',
  coupon: '',
  joinClub: true,
  latitude: -23.5505,
  longitude: -46.6333,
};

const items = [{
  id: 'delivery_ifood_quoteid_item_1',
  productId: 'produto_ifood_quoteid_smoke',
  name: 'Item iFood Quote Smoke',
  price: 16,
  quantity: 1,
  selectedModifiers: [],
  notes: '',
}];

const quote = await requestJson('/api/delivery/quote', {
  method: 'POST',
  body: JSON.stringify({ customer, items }),
});

if (quote.quote.status !== 'ready_for_homologation') fail('Expected iFood dry-run quote ready_for_homologation', quote);
if (!quote.quote.quoteId?.startsWith('quote_dry_run_')) fail('Expected dry-run quoteId', quote);

const checkout = await requestJson('/api/delivery/checkout', {
  method: 'POST',
  body: JSON.stringify({
    orderId,
    customer: {
      ...customer,
      quoteId: quote.quote.quoteId,
      quoteExpiresAt: quote.quote.expiresAt,
    },
    items,
  }),
});

if (checkout.order.deliveryStatus !== 'ready_for_homologation') fail('Expected delivery status ready_for_homologation', checkout.order);
if (checkout.order.deliveryProvider !== 'ifood') fail('Expected delivery provider ifood', checkout.order);

const db = createClient({ url: dbUrl });
const eventRes = await db.execute({
  sql: "SELECT payload FROM delivery_events WHERE delivery_order_id = ? AND type = 'delivery' ORDER BY created_at DESC LIMIT 1",
  args: [orderId],
});
const payload = JSON.parse(eventRes.rows[0]?.payload || '{}');
const payloadQuoteId = payload.orderPayload?.delivery?.quoteId;
if (payloadQuoteId !== quote.quote.quoteId) {
  fail('Expected iFood order payload to reuse quoteId from delivery quote', { expected: quote.quote.quoteId, actual: payloadQuoteId, payload });
}

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  orderId,
  quoteId: quote.quote.quoteId,
  deliveryStatus: checkout.order.deliveryStatus,
  payloadQuoteId,
}, null, 2));
