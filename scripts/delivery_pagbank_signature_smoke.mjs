import { createHash } from 'node:crypto';
import { createClient } from '@libsql/client';

const baseUrl = process.env.DELIVERY_SMOKE_BASE_URL || 'http://127.0.0.1:18080';
const dbUrl = process.env.DELIVERY_SMOKE_DB_URL || process.env.TURSO_DATABASE_URL || 'file:local-delivery.db';
const pagbankToken = process.env.PAGBANK_TOKEN || 'fake_pagbank_signature_token';
const orderId = `delivery_pagbank_signature_${Date.now()}`;

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

const db = createClient({ url: dbUrl });
await requestJson('/api/app/init?view=delivery');

await db.batch([
  {
    sql: "INSERT OR IGNORE INTO categories (id, name, sort_order, visible) VALUES ('cat_pagbank_signature_smoke', 'PagBank Signature Smoke', 1, 1)",
  },
  {
    sql: "INSERT OR REPLACE INTO menu (id, name, description, price, category_id, image, visible, cost) VALUES ('produto_pagbank_signature_smoke', 'Item PagBank Signature Smoke', 'Produto local de teste assinatura PagBank', 17, 'cat_pagbank_signature_smoke', '', 1, 0)",
  },
  {
    sql: "INSERT INTO delivery_orders (id, customer_id, subtotal, delivery_fee, discount, total, coupon_code, fulfillment, payment_method, payment_status, payment_provider, payment_external_id, checkout_url, kitchen_status, delivery_status, delivery_provider, delivery_external_id, production_order_id, customer_snapshot, notes, paid_at, kitchen_sent_at, delivery_requested_at) VALUES (?, ?, 17, 0, 0, 17, NULL, 'delivery', 'pagbank', 'payment_pending', 'pagbank', ?, NULL, 'waiting_payment', 'waiting_payment', 'mock', NULL, NULL, ?, '', NULL, NULL, NULL)",
    args: [
      orderId,
      `customer_${orderId}`,
      `CHEC_${orderId}`,
      JSON.stringify({
        name: 'Teste Assinatura PagBank',
        phone: '11999999997',
        email: 'pagbank-signature@example.com',
        fulfillment: 'delivery',
      }),
    ],
  },
  {
    sql: "INSERT INTO delivery_order_items (id, delivery_order_id, product_id, name, quantity, price_at_time, selected_modifiers, notes) VALUES (?, ?, 'produto_pagbank_signature_smoke', 'Item PagBank Signature Smoke', 1, 17, '[]', '')",
    args: [`${orderId}_item_1`, orderId],
  },
], 'write');

const webhookBody = JSON.stringify({
  id: `pagbank_signature_event_${orderId}`,
  reference_id: orderId,
  status: 'PAID',
});
const signature = createHash('sha256').update(`${pagbankToken}-${webhookBody}`).digest('hex');

const unauthorized = await fetch(`${baseUrl}/api/delivery/webhooks/pagbank`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-authenticity-token': 'bad_signature' },
  body: webhookBody,
});
if (unauthorized.status !== 401) {
  fail('Expected invalid PagBank signature to be rejected', { status: unauthorized.status });
}

const webhook = await requestJson('/api/delivery/webhooks/pagbank', {
  method: 'POST',
  headers: { 'x-authenticity-token': signature },
  body: webhookBody,
});
if (webhook.status !== 'paid') fail('Expected signed PagBank webhook to mark order paid', webhook);
if (!webhook.dispatch?.dispatched) fail('Expected signed PagBank webhook to dispatch order', webhook);

const status = await requestJson(`/api/delivery/order?orderId=${encodeURIComponent(orderId)}`);
if (status.order.paymentStatus !== 'paid') fail('Expected order paymentStatus paid', status.order);
if (status.order.kitchenStatus !== 'sent_mock') fail('Expected order kitchenStatus sent_mock', status.order);
if (status.order.deliveryStatus !== 'requested_mock') fail('Expected order deliveryStatus requested_mock', status.order);

console.log(JSON.stringify({
  ok: true,
  baseUrl,
  dbUrl,
  orderId,
  signatureAccepted: true,
  paymentStatus: status.order.paymentStatus,
  kitchenStatus: status.order.kitchenStatus,
  deliveryStatus: status.order.deliveryStatus,
}, null, 2));
